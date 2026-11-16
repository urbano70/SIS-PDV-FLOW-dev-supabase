#!/usr/bin/env node
'use strict';
/** Regression test for server.ts close_table. It never imports the app/server DB. */
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.ts');
const TENANT = 'tenant-close-table-test';
const BASELINE = 'ec198b7';
const clone = value => structuredClone(value);

function sourceText() {
  if (process.env.CLOSE_TABLE_SOURCE === 'baseline') {
    return childProcess.execFileSync('git', ['show', `${BASELINE}:server.ts`], { cwd: ROOT, encoding: 'utf8' });
  }
  return fs.readFileSync(SERVER, 'utf8');
}

function extractHandler(source) {
  const file = ts.createSourceFile(SERVER, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let text;
  function visit(node) {
    const isRegistration = ts.isCallExpression(node) && (
      (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'on') ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'onTenantCommand')
    );
    if (isRegistration && node.arguments.length >= 2 &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'close_table' &&
        ts.isArrowFunction(node.arguments[1])) text = node.arguments[1].getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(text, 'socket.on("close_table", ...) não encontrado via AST');
  return text;
}

function loadHandler(deps, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `close-table-${label}-`));
  const outfile = path.join(dir, 'handler.cjs');
  const wrapper = `
    const { io, saveToSupabase, _tid, _st, _room } = globalThis.__closeTableDeps;
    export const handler = ${extractHandler(sourceText())};
  `;
  globalThis.__closeTableDeps = deps;
  try {
    esbuild.buildSync({ stdin: { contents: wrapper, sourcefile: 'close-table-handler.ts', loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', target: 'node18', outfile, logLevel: 'silent' });
    delete require.cache[require.resolve(outfile)];
    return require(outfile).handler;
  } finally {
    delete globalThis.__closeTableDeps;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function harness(st, blocked, label) {
  const events = [];
  const saves = [];
  let release = () => {};
  const gate = blocked ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const deps = {
    _st: () => st,
    _tid: () => TENANT,
    _room: () => `tenant:${TENANT}`,
    io: { to: room => ({ emit: (event, payload) => events.push({
      room, event, payload: clone(payload), orders: clone(st.orders),
      tables: clone(st.tables), comandas: clone(st.comandas),
    }) }) },
    saveToSupabase: async (collection, data, docId, tenantId) => {
      saves.push({ collection, data: clone(data), docId, tenantId });
      await gate;
    },
  };
  return { st, events, saves, release, handler: loadHandler(deps, label) };
}

function assertWrites(h, collection, orderId) {
  assert.ok(h.saves.some(s => s.collection === collection), `save ${collection} ausente`);
  assert.ok(h.saves.some(s => s.collection === 'orders' && String(s.data.id) === String(orderId)), 'save do pedido ausente');
  assert.ok(h.saves.every(s => s.tenantId === TENANT), 'todo save deve receber _tid()');
  assert.ok(h.saves.every(s => s.collection !== '_st().tables'), 'coleção inválida _st().tables');
}

function assertPublishedFinal(h, orderId) {
  for (const event of h.events.filter(e => ['update_orders', 'update_tables', 'update_comandas'].includes(e.event))) {
    const stateOrder = event.orders.find(o => String(o.id) === String(orderId));
    assert.equal(stateOrder?.status, 'finalizada', `${event.event} emitido antes de finalizar pedido`);
    if (event.event === 'update_orders') {
      const payloadOrder = event.payload.find(o => String(o.id) === String(orderId));
      assert.equal(payloadOrder?.status, 'finalizada', 'payload de update_orders ficou pending');
    }
  }
  for (const name of ['update_orders', 'update_tables', 'update_comandas']) {
    assert.ok(h.events.some(e => e.event === name), `evento ${name} não emitido`);
  }
}

async function testPrimary(blocked = false) {
  const st = {
    tables: [{ id: 1, status: 'occupied', currentOrder: 100, linkedTo: null },
      { id: 9, status: 'occupied', currentOrder: '101', linkedTo: null }],
    comandas: [],
    orders: [{ id: 100, status: 'pending', tableId: 1 },
      { id: '101', status: 'pending', tableId: 9 }],
  };
  const h = harness(st, blocked, blocked ? 'waits' : 'primary');
  const task = h.handler({ tableId: 1, isComanda: false });
  if (blocked) {
    await Promise.resolve();
    assert.ok(h.saves.length, 'handler não iniciou persistência');
    assert.equal(h.events.length, 0, 'emit ocorreu antes de os saves terminarem');
    h.release();
  }
  await task;
  assert.equal(st.orders.find(o => o.id === 100).status, 'finalizada');
  assert.equal(st.orders.find(o => String(o.id) === '101').status, 'pending', 'outro pedido foi finalizado');
  assert.equal(st.tables[0].status, 'free');
  assertPublishedFinal(h, 100);
  assertWrites(h, 'tables', 100);
}

async function testMixedLinked(isComanda) {
  const st = isComanda ? {
    tables: [{ id: 90, status: 'occupied', currentOrder: 901 }],
    comandas: [{ id: '7', status: 'linked', linkedTo: 8, currentOrder: '700' },
      { id: 8, status: 'occupied', linkedTo: null, currentOrder: 700 },
      { id: '9', status: 'linked', linkedTo: '8', currentOrder: '700' },
      { id: 77, status: 'occupied', currentOrder: 701 }],
    orders: [{ id: 700, status: 'pending', tableId: 8, isComanda: true },
      { id: '701', status: 'pending', tableId: 77, isComanda: true }],
  } : {
    tables: [{ id: '10', status: 'linked', linkedTo: 20, currentOrder: '500' },
      { id: 20, status: 'occupied', linkedTo: null, currentOrder: 500 },
      { id: '30', status: 'linked', linkedTo: '20', currentOrder: '500' },
      { id: 40, status: 'occupied', currentOrder: 501 }],
    comandas: [{ id: 90, status: 'occupied', currentOrder: 902 }],
    orders: [{ id: 500, status: 'pending', tableId: 20 },
      { id: '501', status: 'pending', tableId: 40 }],
  };
  const orderId = isComanda ? 700 : 500;
  const list = isComanda ? st.comandas : st.tables;
  const h = harness(st, false, isComanda ? 'comanda' : 'linked');
  await h.handler({ tableId: isComanda ? 7 : 10, isComanda });
  for (const id of isComanda ? ['7', 8, '9'] : ['10', 20, '30']) {
    const item = list.find(x => String(x.id) === String(id));
    assert.equal(item.status, 'free', `vínculo ${id} não foi liberado`);
    assert.equal(item.currentOrder, null);
    assert.equal(item.linkedTo, null);
  }
  assert.equal(list.find(x => String(x.id) === String(isComanda ? 77 : 40)).status, 'occupied');
  assert.equal(st.orders.find(o => String(o.id) === String(orderId)).status, 'finalizada');
  assert.equal(st.orders.find(o => String(o.id) === String(isComanda ? 701 : 501)).status, 'pending');
  assertPublishedFinal(h, orderId);
  assertWrites(h, isComanda ? 'comandas' : 'tables', orderId);
}

async function testMissingAndNoOrder() {
  const missing = { tables: [{ id: 1, status: 'occupied', currentOrder: 10 }], comandas: [], orders: [{ id: 10, status: 'pending' }] };
  const before = clone(missing);
  const hm = harness(missing, false, 'missing');
  await hm.handler({ tableId: 999, isComanda: false });
  assert.deepEqual(missing, before, 'mesa inexistente alterou estado');
  assert.equal(hm.events.length, 0);
  assert.equal(hm.saves.length, 0);

  const st = { tables: [{ id: 5, status: 'occupied', currentOrder: null, linkedTo: 44 }], comandas: [], orders: [] };
  const h = harness(st, false, 'no-order');
  await h.handler({ tableId: '5', isComanda: false });
  assert.equal(st.tables[0].status, 'free');
  assert.equal(st.tables[0].currentOrder, null);
  assert.equal(st.tables[0].linkedTo, null);
  assert.ok(h.saves.some(s => s.collection === 'tables'));
  assert.ok(h.saves.every(s => s.tenantId === TENANT));
}

(async () => {
  await testPrimary();
  await testPrimary(true);
  await testMixedLinked(false);
  await testMixedLinked(true);
  await testMissingAndNoOrder();
  console.log(`close_table sync tests passed (${process.env.CLOSE_TABLE_SOURCE === 'baseline' ? 'baseline' : 'working tree'} source)`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
