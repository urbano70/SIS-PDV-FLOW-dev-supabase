#!/usr/bin/env node
'use strict';

/**
 * Regressão da política de 23/11/2026: deploys preservam todos os pedidos.
 * Extrai por AST a carga REAL, sem importar/iniciar servidor, dotenv, listeners
 * ou clientes de banco. Apenas fixtures locais; nenhuma rede ou credencial.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.ts');
const source = fs.readFileSync(SERVER, 'utf8');
const file = ts.createSourceFile(SERVER, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const ORIGINAL_TENANT = 'c5c88a54-4bcc-477d-aa8e-d095423484d6';
const NEW_TENANT = '850ca6b0-7f83-4773-a17b-b95f845cd7da';
const clone = value => structuredClone(value);
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function extract(name) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      initializer = node.initializer?.getText(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(initializer, `${name} real deve existir`);
  return `const ${name} = ${initializer};`;
}

const loaderSource = extract('loadTenantData');
const compiled = esbuild.buildSync({
  stdin: {
    contents: `
      import { resolveTenantCatalogRead } from './src/lib/menuIsolation.ts';
      import { restoreOpenCashRegisterOwners, getOpenCashRegisterNames } from './src/server/cash-register-state.ts';
      import { normalizePlaygroundConfig, ensurePlaygroundProduct } from './src/server/playground-core.ts';
      import { sanitizeWaiters } from './src/server/waiter-auth.ts';
      const { db, getState, io, waitForTenantWrites, tenantWriteRevision,
        commitCriticalOrderState, saveMenuToSupabase, clientSessions } = globalThis.__deps;
      ${['rowToOrder', 'rowToTable', 'rowToStock', 'publicWaiters', 'replaceStagedOrderState'].map(extract).join('\n')}
      ${loaderSource}
      module.exports = { loadTenantData, rowToOrder, rowToTable };
    `,
    sourcefile: 'preserve-data-load.ts', resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', target: 'node20', write: false, logLevel: 'silent',
}).outputFiles[0].text;

function fixture(tenantId, marker) {
  const order = (id, tableId, status, isComanda, waiterName = 'Garçom fixture') => ({
    tenant_id: tenantId, id, table_id: tableId, waiter_id: 'waiter-1', waiter_name: waiterName,
    status, is_comanda: isComanda, timestamp: '2026-11-23T22:00:00.000Z',
    items: [{ id: `${id}-item`, name: `Item ${tenantId}`, price: 20, quantity: 1, type: 'outros',
      playground: id === 'active-table' ? { childName: 'Criança fixture', operatorId: 'operator-1' } : undefined }],
    payment_log: [{ id: `${id}-payment`, amount: 10, method: 'dinheiro' }],
    delivery_log: [{ itemId: `${id}-item`, deliveredBy: 'waiter-1', timestamp: '2026-11-23T22:01:00.000Z' }],
  });
  return {
    orders: [
      order('active-table', '1', 'open', false),
      order('historical-table', '4', 'finalizada', false),
      order('active-comanda', '1', 'open', true),
      order('fire-test', '2', 'open', false, 'Garcom_Fogo_fixture'),
      order('legacy-null', '3', 'open', null),
    ],
    tables: [
      { tenant_id: tenantId, id: 1, status: 'occupied', current_order: 'active-table', linked_to: null },
      { tenant_id: tenantId, id: 2, status: 'occupied', current_order: 'fire-test', linked_to: null },
      { tenant_id: tenantId, id: 3, status: 'occupied', current_order: 'legacy-null', linked_to: null },
      { tenant_id: tenantId, id: 4, status: 'free', current_order: null, linked_to: null },
    ],
    comandas: [{ tenant_id: tenantId, id: 1, status: 'occupied', current_order: 'active-comanda', linked_to: null }],
    config: [
      { tenant_id: tenantId, id: `${tenantId}:app`, data: { isCashRegisterOpen: true, dailyCounter: 50 } },
      { tenant_id: tenantId, id: `${tenantId}:test_table_reset`, data: { lastTestTableResetBuildId: marker, resetAt: 'historical' } },
    ],
    waiters: [], menu: [], stock: [], pizza_flavors: [], pizza_crusts: [],
  };
}

function harness({ tenantId, rows, env, buildId, failRead = false, allowRepair = false }) {
  const state = { loaded: false, orders: [], tables: [], comandas: [], menu: [], stock: [], waiters: [], pizzariaConfig: {} };
  const calls = [];
  const events = [];
  const commits = [];
  const sessions = new Map([[`${tenantId}:t:1`, { orderId: 'active-table' }], [`${tenantId}:c:1`, { orderId: 'active-comanda' }]]);
  let waits = 0;
  const db = {
    from(table) {
      const filters = [];
      const call = { table, operation: null, filters };
      calls.push(call);
      const builder = {
        select() { call.operation = 'select'; return builder; },
        eq(field, value) { filters.push([field, value]); return builder; },
        order() { return builder; },
        maybeSingle() { call.single = true; return builder; },
        // Fail immediately if the loader tries ANY database mutation.
        delete() { throw new Error('DELETE proibido na carga'); },
        update() { throw new Error('UPDATE inesperado na carga'); },
        upsert() { throw new Error('UPSERT inesperado nesta fixture existente'); },
        insert() { throw new Error('INSERT inesperado na carga'); },
        then(resolve, reject) {
          assert.equal(call.operation, 'select');
          assert.ok(filters.some(([field, value]) => field === 'tenant_id' && value === tenantId), 'SELECT precisa isolar tenant');
          if (failRead && table === 'orders') return Promise.resolve({ error: new Error('fixture read failure'), data: null }).then(resolve, reject);
          const selected = (rows[table] || []).filter(row => filters.every(([field, value]) => row[field] === value));
          return Promise.resolve({ data: clone(call.single ? selected[0] || null : selected), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const context = {
    module: { exports: {} },
    require: specifier => {
      assert.ok(['node:crypto', 'node:util'].includes(specifier), 'harness não permite clientes de rede/banco');
      return require(specifier);
    },
    process: { env: env === undefined ? {} : { PDV_TEST_RESET_ON_DEPLOY: env } },
    __BUILD_ID__: buildId,
    console: { log() {}, error() {} },
    __deps: {
      db, getState: id => { assert.equal(id, tenantId); return state; },
      io: { to: room => ({ emit: (event, payload) => events.push({ room, event, payload: plain(payload) }) }) },
      waitForTenantWrites: async id => { assert.equal(id, tenantId); waits += 1; },
      tenantWriteRevision: () => 0,
      commitCriticalOrderState: async input => {
        assert.ok(allowRepair, 'não pode liberar mesas com pedido ativo durante carga');
        assert.equal(input.tenantId, tenantId);
        assert.equal(input.order, null, 'reparo de vínculo não pode modificar/excluir pedido');
        commits.push(plain(input));
      },
      saveMenuToSupabase: () => { throw new Error('não deve reintroduzir catálogo'); },
      clientSessions: sessions,
    },
  };
  vm.runInNewContext(compiled, context, { timeout: 1000 });
  return { ...context.module.exports, state, calls, events, commits, sessions, waits: () => waits };
}

function assertNoResetCalls(h) {
  assert.ok(h.calls.every(call => call.operation === 'select'));
  assert.ok(h.calls.every(call => !call.filters.some(([field, value]) => field === 'id' && String(value).endsWith(':test_table_reset'))),
    'marcador histórico não deve ser consultado nem escrito');
  assert.ok(h.events.every(event => event.room.startsWith('tenant:')));
}

async function testPreservationMatrix() {
  let loads = 0;
  for (const tenantId of [ORIGINAL_TENANT, NEW_TENANT, 'other-tenant']) {
    for (const env of [undefined, 'false', 'true', 'TRUE', '1', 'on', '']) {
      for (const marker of [undefined, 'old-build', 'new-build']) {
        const rows = fixture(tenantId, marker);
        // Same IDs in another tenant ensure fixture reads cannot cross accounts.
        const other = fixture('isolated-other-tenant', 'old-build');
        for (const table of Object.keys(rows)) rows[table].push(...other[table]);
        const before = clone(rows);
        for (const buildId of ['old-build', 'new-build']) {
          // New harness models a new process/build. Three real loads model
          // initial login, F5/reconnect and repeated load in that process.
          const h = harness({ tenantId, rows, env, buildId });
          const expectedOrders = rows.orders.filter(row => row.tenant_id === tenantId).map(h.rowToOrder);
          const expectedTables = rows.tables.filter(row => row.tenant_id === tenantId).map(h.rowToTable);
          const expectedComandas = rows.comandas.filter(row => row.tenant_id === tenantId).map(h.rowToTable);
          const sessionsBefore = plain([...h.sessions]);
          for (let reload = 0; reload < 3; reload += 1) {
            await h.loadTenantData(tenantId);
            loads += 1;
            assert.equal(h.state.loaded, true);
            assert.deepEqual(plain(h.state.orders), plain(expectedOrders), 'preservar pedidos/itens/pagamentos/entregas/Parquinho');
            assert.deepEqual(plain(h.state.tables), plain(expectedTables), 'preservar ocupação e vínculo de pedidos ativos');
            assert.deepEqual(plain(h.state.comandas), plain(expectedComandas));
            assert.deepEqual(plain([...h.sessions]), sessionsBefore, 'carga não invalida sessões por reset');
            assert.deepEqual(rows, before, 'fixture persistente e marcadores devem permanecer intactos');
            const updates = h.events.filter(event => event.event === 'update_orders');
            assert.deepEqual(updates.at(-1).payload, plain(expectedOrders), 'broadcast deve conservar histórico completo');
          }
          assert.equal(h.waits(), 6, 'preservar barreiras de escrita antes/depois dos SELECTs');
          assertNoResetCalls(h);
          assert.equal(h.commits.length, 0);
        }
      }
    }
  }
  return loads;
}

async function testReadFailurePreservesState() {
  const tenantId = ORIGINAL_TENANT;
  const rows = fixture(tenantId, 'old-build');
  const before = clone(rows);
  const h = harness({ tenantId, rows, env: 'true', buildId: 'new-build', failRead: true });
  h.state.orders = [{ id: 'previous-visible-order', items: [{ id: 'previous-item' }] }];
  const visibleBefore = clone(h.state.orders);
  await assert.rejects(h.loadTenantData(tenantId), /fixture read failure/);
  assert.equal(h.state.loaded, false);
  assert.deepEqual(h.state.orders, visibleBefore);
  assert.equal(h.events.length, 0, 'falha não emite snapshot vazio');
  assert.deepEqual(rows, before);
  assertNoResetCalls(h);
}

async function testExistingReleaseRepairPreservesHistory() {
  const tenantId = ORIGINAL_TENANT;
  const rows = fixture(tenantId, 'old-build');
  rows.tables[3] = { ...rows.tables[3], status: 'occupied', current_order: 'historical-table' };
  const h = harness({ tenantId, rows, env: 'true', buildId: 'new-build', allowRepair: true });
  await h.loadTenantData(tenantId);
  assert.equal(h.commits.length, 1, 'PR #504 continua reparando vínculo inconsistente');
  assert.deepEqual(h.commits[0].tables.map(table => table.id), [4]);
  assert.equal(h.commits[0].tables[0].expectedCurrentOrder, 'historical-table');
  assert.equal(h.state.tables.find(table => table.id === 4).status, 'free');
  assert.deepEqual(plain(h.state.orders), plain(rows.orders.map(h.rowToOrder)), 'reparo conserva histórico e pagamentos');
  assertNoResetCalls(h);
}

function testRemovedEntrypointsAndDefaults() {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/server/test-table-reset.ts')), false, 'helper destrutivo foi removido');
  assert.doesNotMatch(source, /runApprovedTestTableReset|shouldRunTestTableReset|resetTestTableState|testTableResetApplied|TEST_RESET_(TENANT_ID|MARKER_FIELD|DISABLE_ENV)/);
  assert.doesNotMatch(loaderSource, /__BUILD_ID__|PDV_TEST_RESET_ON_DEPLOY|lastTestTableResetBuildId|Garcom_Fogo_|clientSessions\.delete|\.delete\(/);
  for (const filename of ['Dockerfile', 'docker/Dockerfile']) {
    const docker = fs.readFileSync(path.join(ROOT, filename), 'utf8');
    const runtimeImage = docker.slice(docker.lastIndexOf('FROM '));
    assert.match(runtimeImage, /^ENV PDV_TEST_RESET_ON_DEPLOY=false$/m, `${filename}: imagem final deve declarar false`);
    assert.match(docker, /RUN npm run build/, `${filename}: imagem deve recompilar a fonte, não reutilizar bundle antigo`);
  }
  for (const filename of ['.env.example', 'docker/.env.example']) {
    assert.match(fs.readFileSync(path.join(ROOT, filename), 'utf8'), /^PDV_TEST_RESET_ON_DEPLOY=false$/m);
  }
}

(async () => {
  testRemovedEntrypointsAndDefaults();
  const loads = await testPreservationMatrix();
  await testReadFailurePreservesState();
  await testExistingReleaseRepairPreservesHistory();
  console.log(`deploy data preservation tests passed: ${loads} real loads + read failure + non-destructive release repair`);
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
