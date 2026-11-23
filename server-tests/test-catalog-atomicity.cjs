#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { clone, loadTsModule } = require('./testsHelpers.cjs');

const persistence = loadTsModule('src/server/menu-persistence.ts', 'menu-persistence');
const dbPg = loadTsModule('src/db-pg.ts', 'db-pg-catalog-atomicity');

const menu = [
  {
    name: 'Origem', type: 'lanches', visible: true,
    items: [{ id: 'produto-origem', name: 'Produto', price: 17, custom: { keep: true } }],
    subcategories: [],
  },
  {
    name: 'Destino', type: 'bebidas', visible: true,
    items: [],
    subcategories: [{ id: 'sub-destino', name: 'Sub destino', visible: true, items: [] }],
  },
];

async function testSupabaseUsesOneBulkRequestAndPreservesRows() {
  const calls = [];
  const db = {
    from(table) {
      assert.equal(table, 'menu');
      return {
        upsert(rows, options) {
          calls.push({ rows: clone(rows), options: clone(options) });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  const moved = clone(menu);
  moved[0].items = [];
  moved[1].subcategories[0].items.push(menu[0].items[0]);

  await persistence.persistSupabaseMenuSnapshot(db, moved, 'tenant-catalog');

  assert.equal(calls.length, 1, 'Supabase deve receber um único upsert bulk');
  assert.deepEqual(calls[0].options, { onConflict: 'tenant_id,id' });
  assert.deepEqual(calls[0].rows.map((row) => ({ id: row.id, tenant_id: row.tenant_id, name: row.name, position: row.position })), [
    { id: 'tenant-catalog:Origem', tenant_id: 'tenant-catalog', name: 'Origem', position: 0 },
    { id: 'tenant-catalog:Destino', tenant_id: 'tenant-catalog', name: 'Destino', position: 1 },
  ]);
  assert.deepEqual(calls[0].rows[0].items, [], 'origem persistida como snapshot movido');
  assert.equal(calls[0].rows[1].subcategories[0].items[0].id, 'produto-origem', 'destino persistido com o item movido');
  assert.deepEqual(calls[0].rows[0].subcategories, [], 'campos de linha existentes permanecem no formato do modelo');

  const failingDb = {
    from: () => ({ upsert: () => Promise.resolve({ error: new Error('bulk failure') }) }),
  };
  await assert.rejects(
    persistence.persistSupabaseMenuSnapshot(failingDb, moved, 'tenant-catalog'),
    /bulk failure/,
    'falha do único request deve rejeitar sem uma segunda gravação parcial',
  );
}

function makePool({ failInsert = false } = {}) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values: values ? clone(values) : undefined });
      if (failInsert && /^\s*INSERT INTO menu/i.test(text)) throw new Error('insert failure');
      return { rows: [] };
    },
    release() {
      calls.push({ text: 'RELEASE' });
    },
  };
  return { calls, pool: { connect: async () => client } };
}

async function testPostgresBulkTransactionAndRollback() {
  const successful = makePool();
  await persistence.persistPostgresMenuSnapshot(successful.pool, menu, 'tenant-pg');
  const sqlCalls = successful.calls.filter((call) => typeof call.text === 'string');
  assert.deepEqual(sqlCalls.map((call) => call.text), [
    'BEGIN',
    sqlCalls[1].text,
    'COMMIT',
    'RELEASE',
  ]);
  assert.match(sqlCalls[1].text, /INSERT INTO menu/);
  assert.equal(sqlCalls.filter((call) => /INSERT INTO menu/.test(call.text)).length, 1, 'PG deve executar uma única instrução INSERT bulk');
  assert.deepEqual(sqlCalls[1].values.slice(0, 8), [
    'tenant-pg:Origem', 'tenant-pg', 'Origem', 0, 'lanches', true,
    JSON.stringify(menu[0].items), JSON.stringify(menu[0].subcategories),
  ]);
  assert.equal(sqlCalls[1].values[8], 'tenant-pg:Destino', 'segunda categoria mantém seu tenant e ID');

  const failing = makePool({ failInsert: true });
  await assert.rejects(
    persistence.persistPostgresMenuSnapshot(failing.pool, menu, 'tenant-pg'),
    /insert failure/,
  );
  const failedTexts = failing.calls.map((call) => call.text);
  assert.deepEqual(failedTexts, ['BEGIN', failing.calls[1].text, 'ROLLBACK', 'RELEASE']);
  assert.equal(failedTexts.includes('COMMIT'), false, 'falha não pode confirmar transação');
}

function testImportContractsAndCrustName() {
  const serverSource = fs.readFileSync('server.ts', 'utf8');
  assert.match(serverSource, /pgSave\('pizzaFlavors', f, f\.name, _tid\(\)\)/);
  assert.match(serverSource, /pgSave\('pizzaCrusts', \{ name: c \}, c, _tid\(\)\)/);
  assert.doesNotMatch(serverSource, /pgSave\('_st\(\)\.pizzaFlavors'/);
  assert.doesNotMatch(serverSource, /pgSave\('_st\(\)\.pizzaCrusts'/);
  assert.ok(
    serverSource.indexOf("pgSave('pizzaFlavors', f, f.name, _tid())") < serverSource.indexOf('_st().pizzaFlavors = impFlavors'),
    'PG sabores são persistidos antes da memória/broadcast',
  );
  assert.ok(
    serverSource.indexOf("pgSave('pizzaCrusts', { name: c }, c, _tid())") < serverSource.indexOf('_st().pizzaCrusts = impCrusts'),
    'PG bordas são persistidas antes da memória/broadcast',
  );

  const crust = dbPg.buildPizzaCrustRow('tenant-pg', { name: 'Catupiry: Especial' }, 'fallback');
  assert.deepEqual(crust, {
    id: 'tenant-pg:Catupiry: Especial',
    tenant_id: 'tenant-pg',
    name: 'Catupiry: Especial',
  }, 'nome literal da borda é preservado e só o ID recebe o escopo do tenant');
}

(async () => {
  await testSupabaseUsesOneBulkRequestAndPreservesRows();
  await testPostgresBulkTransactionAndRollback();
  testImportContractsAndCrustName();
  console.log('test-catalog-atomicity: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
