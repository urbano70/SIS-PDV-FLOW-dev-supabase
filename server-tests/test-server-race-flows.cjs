#!/usr/bin/env node
'use strict';

/**
 * Extracts real socket handlers from server.ts. It deliberately does not
 * import/start the application and does not use DATABASE_URL, Supabase, or a
 * production endpoint.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.ts');
const source = fs.readFileSync(SERVER, 'utf8');

function extractHandler(eventName) {
  const file = ts.createSourceFile(SERVER, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let text;
  function visit(node) {
    const isRegistration = ts.isCallExpression(node) && (
      (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'on') ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'onTenantCommand')
    );
    if (isRegistration && node.arguments.length >= 2 &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === eventName &&
        ts.isArrowFunction(node.arguments[1])) {
      text = node.arguments[1].getText(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(text, `handler ${eventName} não encontrado`);
  return text;
}

function loadHandler(eventName, deps, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pdv-handler-${label}-`));
  const outfile = path.join(dir, 'handler.cjs');
  const handler = extractHandler(eventName);
  const file = ts.createSourceFile(SERVER, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let commandQueue;
  let cashPatch;
  function findQueue(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'withTenantCommand') commandQueue = node.initializer.getText(file);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'cashRegisterConfigPatch') cashPatch = node.initializer.getText(file);
    ts.forEachChild(node, findQueue);
  }
  findQueue(file);
  assert.ok(commandQueue, 'fila real de comandos deve estar presente');
  assert.ok(cashPatch, 'configuração real de caixa deve estar presente');
  const serialized = ['new_order', 'add_item_to_order'].includes(eventName);
  const wrapper = `
    import { isPlaygroundReservedItem } from ${JSON.stringify(path.join(ROOT, 'src/server/playground-core.ts'))};
    import { getOpenCashRegisterNames } from ${JSON.stringify(path.join(ROOT, 'src/server/cash-register-state.ts'))};
    import { authActorSafe, isApprovedWaiter, isWaiterActorForTenant, projectWaitersForActor, sanitizeWaiter, sanitizeWaiters } from ${JSON.stringify(path.join(ROOT, 'src/server/waiter-auth.ts'))};
    const {
      socket, _st, _tid, _room, io, db, loadTenantIfNeeded, getState,
      generateOrderId, activateClientSession, applyStockReduction,
      emitPrintOrder, enqueueWrite, saveToSupabase, getClientSession,
    } = globalThis.__pdvHandlerDeps;
    const __BUILD_ID__ = 'isolated-test-build';
    const _tenantCommandTails = globalThis.__pdvHandlerDeps.commandTails || new Map();
    // Writes in this harness resolve synchronously into arrays; actual write
    // tails/debounce are exercised by test-persistence-races separately.
    const waitForTenantWrites = async () => {};
    const withTenantCommand = ${commandQueue};
    const cashRegisterConfigPatch = ${cashPatch};
    const publicWaiters = sanitizeWaiters;
    const isAdminForTenant = (tenantId) => {
      const actor = authActorSafe(socket.authContext);
      return Boolean(socket.isAdmin && socket.authContext?.ready === true && actor?.role === 'admin' && actor.tenantId === tenantId);
    };
    const waiterForTenant = (tenantId) => {
      const actor = authActorSafe(socket.authContext);
      if (!actor || actor.role !== 'waiter' || actor.tenantId !== tenantId) return null;
      const waiter = getState(tenantId).waiters.find(candidate => String(candidate.id) === actor.waiterId);
      return isWaiterActorForTenant(actor, tenantId, waiter) ? waiter : null;
    };
    const rejectPlaygroundReserved = () => socket.emit('error_message', 'Use o aplicativo do Parquinho.');
    const handler = ${handler};
    module.exports = { handler: ${serialized ? '(...args) => withTenantCommand(_tid(), () => Promise.resolve(handler(...args)))' : 'handler'} };
  `;
  globalThis.__pdvHandlerDeps = deps;
  try {
    esbuild.buildSync({
      stdin: { contents: wrapper, sourcefile: `${eventName}-extract.ts`, resolveDir: ROOT, loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', target: 'node18',
      outfile, logLevel: 'silent',
    });
    delete require.cache[require.resolve(outfile)];
    return require(outfile).handler;
  } finally {
    delete globalThis.__pdvHandlerDeps;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));

function baseState() {
  return {
    orders: [],
    tables: [{ id: 1, status: 'free', currentOrder: null, linkedTo: null }],
    comandas: [],
    waiters: [],
    menu: [{ name: 'Lanches', type: 'lanches', items: [{ id: 'burger', name: 'Burger' }], subcategories: [] }],
    stock: [],
    isCashRegisterOpen: true,
    shiftStartedAt: new Date().toISOString(),
    dailyCounter: 0,
    lastOrderDate: '',
  };
}

function makeOrderDeps(st) {
  const events = [];
  const saves = [];
  const queued = [];
  let nextId = 100;
  const socket = {
    tenantId: 'tenant-flow',
    id: 'socket-flow',
    emit(event, payload) { events.push({ event, payload: clone(payload) }); },
  };
  const io = {
    sockets: { adapter: { rooms: new Map() } },
    to(room) {
      return { emit(event, payload) { events.push({ room, event, payload: clone(payload) }); } };
    },
  };
  const deps = {
    socket,
    io,
    commandTails: new Map(),
    _st: () => st,
    _tid: () => 'tenant-flow',
    _room: () => 'tenant:tenant-flow',
    loadTenantIfNeeded: async () => {},
    getState: () => st,
    generateOrderId: () => nextId++,
    activateClientSession: () => {},
    getClientSession: () => null,
    applyStockReduction: () => {},
    emitPrintOrder: () => {},
    saveToSupabase: async (collection, data, docId, tenantId) => {
      saves.push({ collection, data: clone(data), docId, tenantId });
    },
    enqueueWrite: (collection, data, docId, tenantId) => {
      queued.push({ collection, data: clone(data), docId, tenantId });
    },
  };
  return { deps, events, saves, queued };
}

async function testFastOpenAndAdd() {
  const st = baseState();
  const h = makeOrderDeps(st);
  const open = loadHandler('new_order', h.deps, 'open');
  const add = loadHandler('add_item_to_order', h.deps, 'add');
  const item = (id, name) => ({ id, menuItemId: 'burger', name, price: 20, quantity: 1, type: 'lanches' });

  // Two launches arriving in the same tick must converge on one order.
  await Promise.all([
    open({ tableId: 1, isComanda: false, waiterName: 'Garcom A', items: [item('i-1', 'Burger 1')] }),
    open({ tableId: 1, isComanda: false, waiterName: 'Garcom A', items: [item('i-2', 'Burger 2')] }),
  ]);
  assert.equal(st.orders.length, 1);
  assert.equal(st.orders[0].items.length, 2);
  assert.equal(st.tables[0].status, 'occupied');
  assert.equal(String(st.tables[0].currentOrder), String(st.orders[0].id));
  assert.ok(h.saves.some(save => save.collection === 'orders'));
  assert.ok(h.saves.every(save => save.tenantId === 'tenant-flow'));
  assert.equal(h.queued.length, 1, 'a segunda abertura deve usar a fila do mesmo pedido');

  // Two rapid additions must not replace one another with an old object.
  await Promise.all([
    add({ orderId: st.orders[0].id, item: item('i-3', 'Burger 3') }),
    add({ orderId: st.orders[0].id, item: item('i-4', 'Burger 4') }),
  ]);
  assert.equal(st.orders[0].items.length, 4);
  assert.equal(h.queued.length, 3);
  assert.deepEqual(h.queued.at(-1).data.items.map(i => i.id), ['i-1', 'i-2', 'i-3', 'i-4']);

  // A reconnect/reload built from the last persisted snapshot retains all items.
  const reloaded = clone(h.queued.at(-1).data);
  assert.deepEqual(reloaded.items.map(i => i.id), ['i-1', 'i-2', 'i-3', 'i-4']);
  await tick();
}

async function testRequestInitRequiresScopedTenant() {
  const st = baseState();
  let loadCalls = 0;
  const gate = { resolve: null };
  const pending = new Promise(resolve => { gate.resolve = resolve; });
  const events = [];
  const socket = {
    connected: true,
    emit(event, payload) { events.push({ event, payload: clone(payload) }); },
  };
  const deps = {
    socket,
    db: null,
    _st: () => st,
    _tid: () => 'default',
    _room: () => 'tenant:default',
    io: { to: () => ({ emit() {} }) },
    getState: () => st,
    loadTenantIfNeeded: async () => { loadCalls += 1; await pending; },
  };
  const requestInit = loadHandler('request_init_data', deps, 'request-init');

  // The handler's _tid fallback must not authorize default in production.
  await requestInit();
  assert.equal(events.length, 0);
  assert.equal(loadCalls, 0);

  socket.tenantId = 'tenant-scoped';
  // A URL/tenant hint alone no longer grants a complete snapshot.
  await requestInit();
  assert.equal(loadCalls, 0);
  assert.equal(events.some(event => event.event === 'init_data'), false);
  events.length = 0;
  // Represents the server-side proof already tested by test-waiter-auth;
  // this suite tests only the load-before-snapshot race.
  socket.isAdmin = true;
  socket.authContext = { role: 'admin', tenantId: 'tenant-scoped', ready: true };
  const task = requestInit();
  await Promise.resolve();
  assert.equal(events.length, 0, 'init não pode sair antes do tenant estar pronto');
  gate.resolve();
  await task;
  const init = events.find(event => event.event === 'init_data');
  assert.equal(init.payload.tenantId, 'tenant-scoped');
}

(async () => {
  await testFastOpenAndAdd();
  await testRequestInitRequiresScopedTenant();
  assert.equal((source.match(/socket\.emit\("init_data"/g) || []).length, 3);
  assert.ok((source.match(/ready:\s*true/g) || []).length >= 3);
  assert.ok((source.match(/buildId:\s*__BUILD_ID__/g) || []).length >= 4,
    'app_version, os três init_data e a projeção extra devem usar a build compilada');
  assert.ok(source.indexOf('const clientSessions =') < source.indexOf('startupReady = loadFromSupabase().then'),
    'startupReady não pode executar antes de clientSessions existir');
  console.log('server race flow tests passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
