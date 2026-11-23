#!/usr/bin/env node
'use strict';
require('tsx/cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const esbuild = require('esbuild');
const {
  commitOrderState,
  entityToCommitRow,
  OrderCommandError,
} = require('../src/server/order-command.ts');

const order = (id, status = 'pending', paymentLog = []) => ({
  id,
  tableId: '8',
  waiterId: 'waiter-1',
  waiterName: 'Garçom Fake',
  status,
  isComanda: false,
  timestamp: '2026-11-23T23:00:00.000Z',
  items: [{ id: 'item-1', name: 'Item fake', price: 7, quantity: 1 }],
  paymentLog,
  deliveryLog: [],
});

async function testTwoTenantsSameIdsUseExplicitTenant() {
  const calls = [];
  const db = {
    async rpc(name, params) {
      calls.push({ name, params: structuredClone(params) });
      return { data: { ok: true, tenantId: params.p_tenant_id }, error: null };
    },
  };
  await commitOrderState({ usePostgres: false, db }, {
    tenantId: 'tenant-a', order: order('same-id'),
    tables: [{ id: 8, status: 'occupied', currentOrder: 'same-id', expectedCurrentOrder: null }],
  });
  await commitOrderState({ usePostgres: false, db }, {
    tenantId: 'tenant-b', order: order('same-id'),
    tables: [{ id: 8, status: 'occupied', currentOrder: 'same-id', expectedCurrentOrder: null }],
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.params.p_tenant_id), ['tenant-a', 'tenant-b']);
  assert.equal(calls[0].params.p_order.tenant_id, undefined, 'tenant não pode vir do payload do navegador');
  assert.equal(calls[0].params.p_tables[0].expected_current_order, null);
}

function makePg({ failOnOrder = false, actualCurrentOrder = null } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === 'BEGIN') return { rowCount: 0, rows: [] };
      if (sql === 'COMMIT') { committed = true; return { rowCount: 0, rows: [] }; }
      if (sql === 'ROLLBACK') { rolledBack = true; return { rowCount: 0, rows: [] }; }
      if (sql.includes('SELECT current_order FROM tables')) return { rowCount: 1, rows: [{ current_order: actualCurrentOrder }] };
      if (failOnOrder && sql.includes('INSERT INTO orders')) throw new Error('discardable DB failure');
      return { rowCount: 1, rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  return {
    calls,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    async connect() { return client; },
  };
}

async function testPgRollbackLeavesNoCommit() {
  const pgPool = makePg({ failOnOrder: true });
  await assert.rejects(
    commitOrderState({ usePostgres: true, pgPool }, {
      tenantId: 'tenant-fail', order: order('rollback-id'),
      tables: [{ id: 8, status: 'occupied', currentOrder: 'rollback-id', expectedCurrentOrder: null }],
    }),
    error => error instanceof OrderCommandError && error.code === 'ORDER_STATE_COMMIT_FAILED',
  );
  assert.equal(pgPool.committed, false);
  assert.equal(pgPool.rolledBack, true);
  assert.ok(pgPool.calls.some(call => call.sql === 'RELEASE'));
}

async function testExpectedCurrentOrderConflictRollsBack() {
  const pgPool = makePg({ actualCurrentOrder: 'newer-order' });
  await assert.rejects(
    commitOrderState({ usePostgres: true, pgPool }, {
      tenantId: 'tenant-conflict', order: order('old-order', 'finalizada'),
      tables: [{ id: 8, status: 'free', currentOrder: null, expectedCurrentOrder: 'old-order' }],
    }),
    error => error instanceof OrderCommandError && error.code === 'ORDER_STATE_COMMIT_CONFLICT',
  );
  assert.equal(pgPool.committed, false);
  assert.equal(pgPool.rolledBack, true);
  assert.equal(pgPool.calls.filter(call => call.sql.includes('INSERT INTO orders')).length, 0);
}

async function testPgPoolFailureIsCoded() {
  await assert.rejects(
    commitOrderState({ usePostgres: true, pgPool: { async connect() { throw new Error('discardable pool failure'); } } }, {
      tenantId: 'tenant-pool-fail', order: order('pool-fail'),
    }),
    error => error instanceof OrderCommandError && error.code === 'ORDER_STATE_COMMIT_FAILED',
  );
}

async function testMissingRpcFailsClosed() {
  await assert.rejects(
    commitOrderState({ usePostgres: false, db: { async rpc() { return { data: null, error: { code: 'PGRST202', message: 'function order_state_commit not found' } }; } } }, {
      tenantId: 'tenant-no-rpc', order: order('no-rpc'), tables: [], comandas: [],
    }),
    error => error instanceof OrderCommandError && error.code === 'ORDER_STATE_COMMIT_RPC_MISSING' && error.status === 503,
  );
}

async function testRpcConflictAndInvalidResponses() {
  const input = { tenantId: 'tenant-a', order: order('order-a') };
  await assert.rejects(commitOrderState({ usePostgres: false, db: {
    async rpc() { return { error: { code: 'P0001', message: 'order_state_commit_expected_current_order' } }; },
  } }, input), error => error.code === 'ORDER_STATE_COMMIT_CONFLICT' && error.status === 409);
  for (const data of [null, {}, { ok: false }, { ok: true, tenantId: 'tenant-b' }]) {
    await assert.rejects(commitOrderState({ usePostgres: false, db: {
      async rpc() { return { data, error: null }; },
    } }, input), error => error.code === 'ORDER_STATE_COMMIT_INVALID_RESPONSE');
  }
  assert.equal(entityToCommitRow({ id: 8, status: 'linked', linkedTo: '9' }).linked_to, '9');
}

async function testCriticalCommitParticipatesInWriteBarrier() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
  const expressions = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer &&
        ['commitCriticalOrderState', 'saveToSupabase'].includes(node.name.getText(ast))) {
      expressions[node.name.getText(ast)] = node.initializer.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  };
  const older = deferred();
  const rpc = deferred();
  const tails = new Map();
  const calls = [];
  let revision = 0;
  const module = { exports: {} };
  const text = Object.entries(expressions).map(([name, expression]) => `exports.${name} = ${expression};`).join('\n');
  vm.runInNewContext(esbuild.transformSync(text, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, USE_POSTGRES: false, db: {},
    _tenantWriteTails: tails, waitForTenantWrites: () => older.promise,
    markTenantWrite: () => { revision++; },
    clonePersistenceData: data => structuredClone(data),
    commitOrderState: async () => { calls.push('rpc'); return rpc.promise; },
    saveToSupabaseRaw: async () => { calls.push('legacy-save'); },
  });
  const commit = module.exports.commitCriticalOrderState({
    tenantId: 'tenant-a', order: order('order-a'),
    tables: [{ id: 8, status: 'free', currentOrder: null }],
    comandas: [{ id: 9, status: 'free', currentOrder: null }],
  });
  assert.equal(calls.length, 0, 'critical commit must drain older debounced writes first');
  older.resolve();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.deepEqual(calls, ['rpc']);
  assert.equal(tails.size, 3, 'every affected key must participate in the load/write barrier');
  assert.equal(revision, 1);
  const legacy = module.exports.saveToSupabase('orders', order('order-a'), 'order-a', 'tenant-a');
  await Promise.resolve();
  assert.deepEqual(calls, ['rpc'], 'legacy writer must not overtake the atomic commit');
  rpc.resolve({ ok: true });
  await commit;
  await legacy;
  await Promise.resolve();
  assert.deepEqual(calls, ['rpc', 'legacy-save']);
  assert.equal(revision, 3, 'commit start/end and legacy write must invalidate stale reads');
  assert.equal(tails.size, 0);
}

function testServerContractGuards() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
  assert.match(source, /fromAdmin === true && isAdminForTenant\(tenantId\)/, 'pagamento ADM deve depender do ator autenticado');
  assert.match(source, /previousPayment.*requestId/, 'retry de pagamento precisa deduplicar requestId');
  assert.match(source, /ORDER_ALREADY_FINALIZED/, 'pagamento de pedido finalizado deve rejeitar antes do log');
  assert.match(source, /expectedCurrentOrder: table\.currentOrder/, 'force release deve validar vínculo esperado');
  assert.match(source, /alreadyFinal = order\.status === 'finalizada' \|\| order\.status === 'paid'/, 'force release deve preservar pedido finalizado');
  assert.match(source, /const ackCommandEvents = new Set\(\['new_order', 'add_item_to_order', 'pay_items', 'confirm_baixa', 'force_release_table'\]\)/, 'ACK deve cobrir os cinco comandos');
  assert.match(source, /await loadTenantIfNeeded\(tenantId\);\n        const st = getState\(tenantId\);/, 'HTTP force release deve carregar tenant frio antes do estado');
  assert.match(source, /withTenantCommand\(tenantId, async \(\) => \{/, 'HTTP force release deve reutilizar fila por tenant');
}

(async () => {
  await testTwoTenantsSameIdsUseExplicitTenant();
  await testPgRollbackLeavesNoCommit();
  await testExpectedCurrentOrderConflictRollsBack();
  await testPgPoolFailureIsCoded();
  await testMissingRpcFailsClosed();
  await testRpcConflictAndInvalidResponses();
  await testCriticalCommitParticipatesInWriteBarrier();
  testServerContractGuards();
  console.log('order command tests passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
