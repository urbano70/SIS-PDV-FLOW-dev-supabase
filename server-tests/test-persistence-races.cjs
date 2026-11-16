#!/usr/bin/env node
'use strict';

/**
 * Regression tests for server persistence/startup races.
 *
 * The snippets are extracted from server.ts and bundled in isolation. No app,
 * listener, environment configuration, production URL, or real database is
 * loaded: only the Supabase-like DB and Socket.IO surface are mocked.
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

function loadPersistence(deps, label) {
  const start = source.indexOf('  const clonePersistenceData');
  const end = source.indexOf('  const saveCashRegisterReport', start);
  assert.ok(start >= 0 && end > start, 'bloco de persistência não encontrado');
  const snippet = source.slice(start, end);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pdv-persistence-${label}-`));
  const outfile = path.join(dir, 'module.cjs');
  const wrapper = `
    const { USE_POSTGRES, db, pgSave } = globalThis.__pdvDeps;
    const orderToRow = (o) => ({ id: String(o.id), table_id: o.tableId || null, waiter_id: o.waiterId || null,
      waiter_name: o.waiterName || null, status: o.status || 'open', is_comanda: !!o.isComanda,
      timestamp: o.timestamp || new Date().toISOString(), items: o.items || [], payment_log: o.paymentLog || [],
      delivery_log: o.deliveryLog || [] });
    const tableToRow = (t) => ({ id: t.id, status: t.status, current_order: t.currentOrder ?? null, linked_to: t.linkedTo ?? null });
    const stockToRow = (s) => ({ id: s.id, menu_item_id: s.menuItemId || s.id, name: s.name || '',
      quantity: s.quantity || 0, min_quantity: s.minQuantity || 0, unit: s.unit || 'un', history: s.history || [] });
    ${snippet}
    module.exports = { saveToSupabase, enqueueWrite, waitForTenantWrites };
  `;
  globalThis.__pdvDeps = deps;
  try {
    esbuild.buildSync({
      stdin: { contents: wrapper, sourcefile: 'persistence-extract.ts', loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', target: 'node18',
      outfile, logLevel: 'silent',
    });
    delete require.cache[require.resolve(outfile)];
    return require(outfile);
  } finally {
    delete globalThis.__pdvDeps;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function mockDb({ gate, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(row, options) {
          calls.push({ table, row: structuredClone(row), options });
          if (fail) return Promise.resolve({ error: new Error('db write failed') });
          if (gate) return gate.promise.then(() => ({ error: null }));
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

async function testSingleWriterSnapshots() {
  const gate = deferred();
  const db = mockDb({ gate });
  const { saveToSupabase } = loadPersistence({ USE_POSTGRES: false, db, pgSave: async () => {} }, 'single-writer');
  const first = { id: 'o-1', tableId: 4, items: [{ id: 'a', name: 'A' }] };
  const second = { id: 'o-1', tableId: 4, items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };

  const firstSave = saveToSupabase('orders', first, 'o-1', 'tenant-a');
  first.items.push({ id: 'mutated-after-enqueue', name: 'must-not-leak' });
  const secondSave = saveToSupabase('orders', second, 'o-1', 'tenant-a');

  await Promise.resolve();
  assert.equal(db.calls.length, 1, 'o segundo write deve aguardar o primeiro');
  assert.deepEqual(db.calls[0].row.items, [{ id: 'a', name: 'A' }], 'primeiro snapshot foi mutado por referência');
  gate.resolve();
  await Promise.all([firstSave, secondSave]);
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[1].row.items.map(item => item.id), ['a', 'b']);
  assert.equal(db.calls[0].row.tenant_id, 'tenant-a');
  assert.equal(db.calls[1].row.tenant_id, 'tenant-a');
  assert.equal(db.calls[0].options.onConflict, 'tenant_id,id');
  assert.equal(db.calls[1].options.onConflict, 'tenant_id,id');
}

async function testDebouncedPayloadIsFlushedBeforeReload() {
  const db = mockDb();
  const { enqueueWrite, waitForTenantWrites } = loadPersistence({ USE_POSTGRES: false, db, pgSave: async () => {} }, 'debounce');
  const order = { id: 'o-2', tableId: 7, items: [{ id: 'new-item' }] };
  enqueueWrite('orders', order, 'o-2', 'tenant-b', 60_000);
  order.items.push({ id: 'mutated-later' });

  await waitForTenantWrites('tenant-b');
  assert.equal(db.calls.length, 1, 'reload deve drenar o payload ainda no debounce');
  assert.deepEqual(db.calls[0].row.items.map(item => item.id), ['new-item']);
  assert.equal(db.calls[0].row.tenant_id, 'tenant-b');
}

async function testPersistenceErrorIsObservable() {
  const db = mockDb({ fail: true });
  const { saveToSupabase } = loadPersistence({ USE_POSTGRES: false, db, pgSave: async () => {} }, 'errors');
  await assert.rejects(
    saveToSupabase('orders', { id: 'o-3', items: [] }, 'o-3', 'tenant-c'),
    /db write failed/
  );
}

async function testSameIdsForDifferentTenants() {
  const db = mockDb();
  const { saveToSupabase } = loadPersistence({ USE_POSTGRES: false, db, pgSave: async () => {} }, 'tenant-conflicts');
  for (const collection of ['orders', 'tables', 'comandas']) {
    await saveToSupabase(collection, { id: 16, items: [{ id: 'only-a' }] }, '16', 'tenant-a');
    await saveToSupabase(collection, { id: 16, items: [{ id: 'only-b' }] }, '16', 'tenant-b');
  }
  assert.equal(db.calls.length, 6);
  for (const call of db.calls) {
    assert.equal(call.options.onConflict, 'tenant_id,id');
    assert.ok(['tenant-a', 'tenant-b'].includes(call.row.tenant_id));
  }
  assert.notEqual(db.calls[0].row.tenant_id, db.calls[1].row.tenant_id);
  assert.deepEqual(db.calls[0].row.items, [{ id: 'only-a' }]);
  assert.deepEqual(db.calls[1].row.items, [{ id: 'only-b' }]);
}

(async () => {
  await testSingleWriterSnapshots();
  await testDebouncedPayloadIsFlushedBeforeReload();
  await testPersistenceErrorIsObservable();
  await testSameIdsForDifferentTenants();
  console.log('persistence race tests passed');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
