'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

const clone = (value) => value === undefined || value === null ? value : structuredClone(value);
const waitTick = () => new Promise((resolve) => setImmediate(resolve));

class FakeSocket {
  constructor(id, io, tenantId = null) {
    this.id = id;
    this.io = io;
    this.handshake = { query: tenantId ? { tenant: tenantId } : {} };
    this.rooms = new Set([id]);
    this.handlers = new Map();
    this.emitted = [];
    this.connected = true;
    if (io) io.attach(this);
  }

  on(event, handler) {
    this.handlers.set(event, handler);
    return this;
  }

  emit(event, payload) {
    this.emitted.push({ event, payload: clone(payload) });
    return this;
  }

  join(room) {
    this.rooms.add(room);
    if (this.io) this.io.addToRoom(this, room);
    return this;
  }

  leave(room) {
    this.rooms.delete(room);
    if (this.io) this.io.removeFromRoom(this, room);
    return this;
  }

  async invoke(event, payload = {}, wantAck = true) {
    const handler = this.handlers.get(event);
    assert.ok(handler, `handler não registrado: ${event}`);
    let callbackResult;
    const callback = wantAck ? (ack) => { callbackResult = clone(ack); } : undefined;
    const result = await handler(payload, callback);
    await waitTick();
    return callbackResult === undefined ? result : callbackResult;
  }

  disconnect() {
    this.connected = false;
    const handler = this.handlers.get('disconnect');
    return handler ? handler() : undefined;
  }

  events(event) {
    return this.emitted.filter((entry) => entry.event === event);
  }

  last(event) {
    const events = this.events(event);
    return events.length ? events[events.length - 1].payload : undefined;
  }
}

class FakeIO {
  constructor() {
    this.sockets = new Set();
    this.rooms = new Map();
    this.emitted = [];
  }

  attach(socket) {
    this.sockets.add(socket);
    this.addToRoom(socket, socket.id);
  }

  addToRoom(socket, room) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room).add(socket);
  }

  removeFromRoom(socket, room) {
    this.rooms.get(room)?.delete(socket);
  }

  to(room) {
    return {
      emit: (event, payload) => {
        const record = { room, event, payload: clone(payload) };
        this.emitted.push(record);
        for (const socket of this.rooms.get(room) || []) {
          if (socket.connected) socket.emit(event, payload);
        }
      },
    };
  }

  roomEvents(room, event) {
    return this.emitted.filter((entry) => (!room || entry.room === room) && (!event || entry.event === event));
  }
}

function loadTsModule(relativeEntry, label) {
  const entry = path.join(ROOT, relativeEntry);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pdv-isolated-${label}-`));
  const outfile = path.join(tempDir, 'module.cjs');
  try {
    esbuild.buildSync({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      outfile,
      external: ['pg'],
      logLevel: 'silent',
    });
    delete require.cache[require.resolve(outfile)];
    const previousNodePath = process.env.NODE_PATH;
    process.env.NODE_PATH = [path.join(ROOT, 'node_modules'), previousNodePath].filter(Boolean).join(path.delimiter);
    Module._initPaths();
    try {
      return require(outfile);
    } finally {
      if (previousNodePath === undefined) delete process.env.NODE_PATH;
      else process.env.NODE_PATH = previousNodePath;
      Module._initPaths();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function makeQuery(db, table) {
  const query = {
    table,
    operation: null,
    filters: [],
    payload: null,
    options: null,
    wantSingle: false,
    select() {
      if (!query.operation) query.operation = 'select';
      return query;
    },
    eq(field, value) {
      query.filters.push([field, value]);
      return query;
    },
    order() {
      return query;
    },
    upsert(row, options) {
      query.operation = 'upsert';
      query.payload = clone(row);
      query.options = options;
      return query;
    },
    update(row) {
      query.operation = 'update';
      query.payload = clone(row);
      return query;
    },
    single() {
      query.wantSingle = true;
      return query;
    },
    maybeSingle() {
      query.wantSingle = true;
      return query;
    },
    then(resolve, reject) {
      Promise.resolve().then(() => db.executeQuery(query)).then(resolve, reject);
    },
  };
  return query;
}

/**
 * Small Supabase-like fake used by the actual playground handler. Its rpc
 * implementation is deliberately stateful and request-id idempotent, so a
 * retry tests persistence semantics rather than a mocked success path.
 */
function makePlaygroundDb({ states, operators = [], entries = [], failRpc = false } = {}) {
  const db = {
    states,
    operators: operators.map(clone),
    entries: entries.map(clone),
    calls: [],
    rpcCalls: [],
    requestResults: new Map(),
    failRpc,
    from(table) {
      return makeQuery(db, table);
    },
    async rpc(name, params) {
      db.rpcCalls.push({ name, params: clone(params) });
      if (db.failRpc) return { data: null, error: new Error('fake SDK failure') };
      assert.equal(name, 'playground_add_entry');
      const key = `${params.p_tenant_id}:${params.p_request_id}`;
      if (db.requestResults.has(key)) {
        return { data: clone(db.requestResults.get(key)), error: null };
      }
      const state = db.states.get(params.p_tenant_id);
      if (!state) return { data: null, error: new Error('tenant inexistente') };
      const table = (state.tables || []).find((candidate) => Number(candidate.id) === Number(params.p_table_id));
      if (!table) return { data: null, error: new Error('mesa inexistente') };
      let order = table.currentOrder
        ? (state.orders || []).find((candidate) => String(candidate.id) === String(table.currentOrder))
        : null;
      if (!order) {
        order = {
          id: String(params.p_order_id),
          tableId: Number(params.p_table_id),
          waiterId: null,
          waiterName: null,
          status: 'open',
          isComanda: false,
          timestamp: '2026-11-16T23:45:00.000Z',
          items: [],
          paymentLog: [],
          deliveryLog: [],
        };
        state.orders.push(order);
        table.currentOrder = order.id;
        table.status = 'occupied';
      }
      const tenant = String(params.p_tenant_id);
      const productId = `parquinho:${tenant}`;
      const price = state.pizzariaConfig?.parquinhoPrice;
      const item = {
        id: `item-${params.p_request_id}`,
        menuItemId: productId,
        productId,
        name: 'Parquinho',
        source: 'parquinho',
        type: 'outros',
        price: Number(price),
        unitPrice: Number(price),
        quantity: 1,
        childName: params.p_child_name || null,
        operatorId: String(params.p_operator_id),
        operatorName: String(params.p_operator_name),
        timestamp: '2026-11-16T23:46:00.000Z',
        shiftStartedAt: String(params.p_shift_started_at),
        parquinhoEntryId: `entry-${params.p_request_id}`,
      };
      order.items.push(item);
      const entry = {
        id: item.parquinhoEntryId,
        tenant_id: tenant,
        order_id: String(order.id),
        order_item_id: item.id,
        table_id: Number(params.p_table_id),
        product_id: productId,
        product_name: 'Parquinho',
        child_name: item.childName,
        operator_id: item.operatorId,
        operator_name: item.operatorName,
        created_at: item.timestamp,
        shift_started_at: item.shiftStartedAt,
        quantity: 1,
        unit_price: Number(price),
        total_price: Number(price),
        status: 'active',
      };
      db.entries.push(entry);
      const result = { order: clone(order), table: clone(table), entry: clone(entry) };
      db.requestResults.set(key, clone(result));
      return { data: result, error: null };
    },
    async executeQuery(query) {
      const filtered = (rows) => rows.filter((row) => query.filters.every(([field, value]) => String(row?.[field] ?? '') === String(value ?? '')));
      if (query.table === 'parquinho_operators') {
        if (query.operation === 'select' || !query.operation) {
          const rows = filtered(db.operators).sort((a, b) => String(a.name).localeCompare(String(b.name)));
          if (query.wantSingle) return { data: rows[0] || null, error: null };
          return { data: rows.map(clone), error: null };
        }
        if (query.operation === 'upsert') {
          const row = clone(query.payload);
          const index = db.operators.findIndex((candidate) => String(candidate.tenant_id) === String(row.tenant_id) && String(candidate.id) === String(row.id));
          if (index >= 0) db.operators[index] = { ...db.operators[index], ...row };
          else db.operators.push(row);
          return { data: clone(db.operators[index >= 0 ? index : db.operators.length - 1]), error: null };
        }
        if (query.operation === 'update') {
          const index = db.operators.findIndex((candidate) => String(candidate.tenant_id) === String(query.filters.find(([field]) => field === 'tenant_id')?.[1]) && String(candidate.id) === String(query.filters.find(([field]) => field === 'id')?.[1]));
          if (index < 0) return { data: null, error: null };
          db.operators[index] = { ...db.operators[index], ...query.payload };
          return { data: clone(db.operators[index]), error: null };
        }
      }
      if (query.table === 'parquinho_entries') {
        const rows = filtered(db.entries).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        return { data: rows.map(clone), error: null };
      }
      throw new Error(`fake DB operation not implemented: ${query.table}/${query.operation}`);
    },
  };
  return db;
}

function installHandlers(register, deps) {
  register(deps);
  return deps.socket;
}

module.exports = {
  ROOT,
  assert,
  clone,
  waitTick,
  FakeSocket,
  FakeIO,
  loadTsModule,
  makePlaygroundDb,
  installHandlers,
};
