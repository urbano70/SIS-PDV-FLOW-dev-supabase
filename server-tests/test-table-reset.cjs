#!/usr/bin/env node
'use strict';

/**
 * TEST-ONLY reset coverage. The helper and the extracted DB operation run in
 * isolation: no server listener, credentials, Supabase URL, or real database.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'src/server/test-table-reset.ts');
const SERVER = path.join(ROOT, 'server.ts');
const TEST_BUILD_ID = 'isolated-test-build-1';

function loadHelper() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-reset-helper-'));
  const outfile = path.join(dir, 'helper.cjs');
  try {
    esbuild.buildSync({
      entryPoints: [HELPER],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      outfile,
      logLevel: 'silent',
    });
    delete require.cache[require.resolve(outfile)];
    return require(outfile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function extractResetRunner(helper, buildId = TEST_BUILD_ID, env = {}) {
  const source = fs.readFileSync(SERVER, 'utf8');
  const start = source.indexOf('  const runApprovedTestTableReset');
  const end = source.indexOf('  // ── Write queue', start);
  assert.ok(start >= 0 && end > start, 'runner de reset não encontrado');
  const snippet = source.slice(start, end);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-reset-runner-'));
  const outfile = path.join(dir, 'runner.cjs');
  const deps = {
    ...helper,
    db: null,
    assertSupabaseResult: async (result) => {
      const response = await result;
      if (response?.error) throw response.error;
      return response;
    },
  };
  const wrapper = `
    const {
      db, assertSupabaseResult,
      TEST_RESET_TENANT_ID, TEST_RESET_MARKER_FIELD, TEST_RESET_DISABLE_ENV,
      shouldRunTestTableReset, resetTestTableState,
    } = globalThis.__pdvResetDeps;
    const __BUILD_ID__ = ${JSON.stringify(buildId)};
    const process = { env: ${JSON.stringify(env)} };
    ${snippet}
    module.exports = { runApprovedTestTableReset };
  `;
  globalThis.__pdvResetDeps = deps;
  try {
    esbuild.buildSync({
      stdin: { contents: wrapper, sourcefile: 'reset-runner.ts', loader: 'ts' },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      outfile,
      logLevel: 'silent',
    });
    delete require.cache[require.resolve(outfile)];
    return require(outfile).runApprovedTestTableReset;
  } finally {
    delete globalThis.__pdvResetDeps;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mockDb({ failAt = null } = {}) {
  const calls = [];
  let markerData = null;
  return {
    calls,
    from(table) {
      let operation = null;
      let pendingRow = null;
      const builder = {
        select(fields) {
          operation = 'select';
          calls.push({ table, operation, fields });
          return builder;
        },
        maybeSingle() { return builder; },
        or(filter) {
          calls.push({ table, operation: 'or', filter });
          return builder;
        },
        delete() {
          operation = 'delete';
          calls.push({ table, operation });
          return builder;
        },
        update(row) {
          operation = 'update';
          calls.push({ table, operation, row: structuredClone(row) });
          return builder;
        },
        upsert(row) {
          operation = 'upsert';
          pendingRow = row;
          calls.push({ table, operation, row: structuredClone(row) });
          return builder;
        },
        eq(field, value) {
          calls.push({ table, operation: 'eq', field, value });
          return builder;
        },
        then(resolve, reject) {
          if (table === 'config' && operation === 'upsert' && failAt !== 'config.upsert') {
            markerData = structuredClone(pendingRow.data);
          }
          const failed = failAt === `${table}.${operation}`
            ? { error: new Error(`${failAt} failed`) }
            : { error: null, data: table === 'config' && operation === 'select' && markerData ? { data: markerData } : null };
          return Promise.resolve(failed).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

async function testDecisionAndSnapshotRules(helper) {
  const tenant = helper.TEST_RESET_TENANT_ID;
  assert.equal(helper.shouldRunTestTableReset({ tenantId: tenant, buildId: TEST_BUILD_ID, marker: TEST_BUILD_ID }), false,
    'mesmo build deve ser idempotente');
  assert.equal(helper.shouldRunTestTableReset({ tenantId: tenant, buildId: 'new-build', marker: TEST_BUILD_ID }), true,
    'build novo deve executar uma vez');
  assert.equal(helper.shouldRunTestTableReset({ tenantId: 'unrelated-tenant', buildId: 'new-build' }), false,
    'tenant não allowlisted não pode resetar');
  assert.equal(helper.shouldRunTestTableReset({ tenantId: tenant, buildId: 'new-build', enabled: false }), false,
    'flag false deve desabilitar o reset');

  const snapshot = helper.resetTestTableState({
    orders: [
      { id: 'historical-table-order', isComanda: false, status: 'finalizada' },
      { id: 'open-table-order', isComanda: false, status: 'open' },
      { id: 'comanda-order', isComanda: true, status: 'open' },
    ],
    tables: [{ id: 1, status: 'occupied', currentOrder: 'open-table-order', linkedTo: 2 }],
  });
  assert.deepEqual(snapshot.orders.map(order => order.id), ['comanda-order'],
    'pedidos históricos e atuais de mesa devem ser removidos, comanda preservada');
  assert.deepEqual(snapshot.tables, [{ id: 1, status: 'free', currentOrder: null, linkedTo: null }],
    'mesas devem voltar ao estado livre');
}

async function testDbOperationAndFailure(helper) {
  const tenant = helper.TEST_RESET_TENANT_ID;
  const db = mockDb();
  const runWithDb = extractResetRunnerWithDb(helper, db);
  assert.equal(await runWithDb(tenant, { isCashRegisterOpen: true }), true);
  assert.ok(db.calls.some(call => call.table === 'orders' && call.operation === 'delete'));
  assert.ok(db.calls.some(call => call.table === 'orders' && call.operation === 'or' && call.filter === 'is_comanda.eq.false,is_comanda.is.null'),
    'o delete deve limpar mesas false/null e preservar comandas true');
  assert.ok(db.calls.some(call => call.table === 'tables' && call.operation === 'update'));
  const markerWrite = db.calls.find(call => call.table === 'config' && call.operation === 'upsert');
  assert.equal(markerWrite.row.data.lastTestTableResetBuildId, TEST_BUILD_ID);
  assert.equal(markerWrite.row.id, `${tenant}:test_table_reset`, 'marcador deve ficar separado da configuração do caixa');
  assert.equal('isCashRegisterOpen' in markerWrite.row.data, false, 'limpeza não deve regravar a configuração do caixa');

  assert.equal(await runWithDb(tenant, { dailyCounter: 200, isCashRegisterOpen: false }), false,
    'reinício no mesmo build após alterar a configuração do caixa não pode limpar novamente');
  assert.equal(db.calls.filter(call => call.table === 'orders' && call.operation === 'delete').length, 1);
  const nextBuild = extractResetRunnerWithDb(helper, db, 'isolated-test-build-2');
  assert.equal(await nextBuild(tenant, {}), true, 'nova publicação deve limpar uma vez');
  assert.equal(await nextBuild(tenant, {}), false, 'reconexão/reinício da mesma publicação não pode limpar');
  assert.equal(db.calls.filter(call => call.table === 'orders' && call.operation === 'delete').length, 2);

  const failedDb = mockDb({ failAt: 'tables.update' });
  const runFailed = extractResetRunnerWithDb(helper, failedDb);
  await assert.rejects(
    runFailed(tenant, {}),
    /tables\.update failed/,
    'falha de reset deve ser propagada e manter readiness fechado',
  );
  assert.equal(failedDb.calls.some(call => call.table === 'config' && call.operation === 'upsert'), false,
    'marker não pode ser gravado quando a limpeza falha');

  const unrelatedDb = mockDb();
  const runUnrelated = extractResetRunnerWithDb(helper, unrelatedDb);
  assert.equal(await runUnrelated('unrelated-tenant', {}), false);
  assert.equal(unrelatedDb.calls.length, 0, 'tenant não autorizado não deve tocar o DB');

  const disabledDb = mockDb();
  const runDisabled = extractResetRunnerWithDb(helper, disabledDb, TEST_BUILD_ID, { PDV_TEST_RESET_ON_DEPLOY: 'false' });
  assert.equal(await runDisabled(tenant, {}), false);
  assert.equal(disabledDb.calls.length, 0, 'desabilitado não pode consultar/apagar dados');
}

function extractResetRunnerWithDb(helper, db, buildId = TEST_BUILD_ID, env = {}) {
  const source = fs.readFileSync(SERVER, 'utf8');
  const start = source.indexOf('  const runApprovedTestTableReset');
  const end = source.indexOf('  // ── Write queue', start);
  const snippet = source.slice(start, end);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-reset-runner-db-'));
  const outfile = path.join(dir, 'runner.cjs');
  const deps = {
    ...helper,
    db,
    assertSupabaseResult: async (result) => {
      const response = await result;
      if (response?.error) throw response.error;
      return response;
    },
  };
  const wrapper = `
    const {
      db, assertSupabaseResult,
      TEST_RESET_TENANT_ID, TEST_RESET_MARKER_FIELD, TEST_RESET_DISABLE_ENV,
      shouldRunTestTableReset, resetTestTableState,
    } = globalThis.__pdvResetDeps;
    const __BUILD_ID__ = ${JSON.stringify(buildId)};
    const process = { env: ${JSON.stringify(env)} };
    ${snippet}
    module.exports = { runApprovedTestTableReset };
  `;
  globalThis.__pdvResetDeps = deps;
  try {
    esbuild.buildSync({
      stdin: { contents: wrapper, sourcefile: 'reset-runner-db.ts', loader: 'ts' },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      outfile,
      logLevel: 'silent',
    });
    delete require.cache[require.resolve(outfile)];
    return require(outfile).runApprovedTestTableReset;
  } finally {
    delete globalThis.__pdvResetDeps;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  const helper = loadHelper();
  await testDecisionAndSnapshotRules(helper);
  await testDbOperationAndFailure(helper);
  console.log('table reset tests passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
