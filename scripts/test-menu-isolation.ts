import assert from 'node:assert/strict';
import {
  maySeedEmptyTenantCatalog,
  resolveTenantCatalogRead,
  tenantScopedCatalogId,
} from '../src/lib/menuIsolation.ts';

type Row = { tenant_id: string; id: string; name: string };

class FakeCatalogStore {
  rows: Row[] = [];
  writes: Row[] = [];

  read(tenantId: string, error?: Error) {
    return resolveTenantCatalogRead<Row>({
      tenantId,
      rows: error ? undefined : this.rows.filter(row => row.tenant_id === tenantId),
      error,
    });
  }

  loadAfterRestart(tenantId: string) {
    const result = this.read(tenantId);
    // This mirrors the server's empty branch: publish [] and never write it.
    assert.equal(result.kind, 'empty');
    assert.equal(maySeedEmptyTenantCatalog({
      readSucceeded: true,
      rowCount: result.rows.length,
      explicitAdministratorAction: false,
    }), false);
    return result.rows;
  }

  explicitSeed(tenantId: string, row: Omit<Row, 'tenant_id' | 'id'> & { id: string }) {
    const durable = { ...row, tenant_id: tenantId, id: tenantScopedCatalogId(tenantId, row.id) };
    this.rows.push(durable);
    this.writes.push(durable);
  }
}

const store = new FakeCatalogStore();
const tenantA = 'fixture-account-a';
const tenantB = 'fixture-account-b';

// A new account is intentionally empty. Restart/deploy must not reintroduce
// bundled/model data or create a write as a side effect of the read.
assert.deepEqual(store.loadAfterRestart(tenantA), []);
assert.deepEqual(store.loadAfterRestart(tenantA), []);
assert.equal(store.writes.length, 0);

// Equal local product IDs remain separate durable records and reads are scoped.
store.explicitSeed(tenantA, { id: 'same-product-id', name: 'Produto A' });
store.explicitSeed(tenantB, { id: 'same-product-id', name: 'Produto B' });
assert.equal(store.rows[0].id, `${tenantA}:same-product-id`);
assert.equal(store.rows[1].id, `${tenantB}:same-product-id`);
assert.deepEqual(store.read(tenantA).rows.map(row => row.name), ['Produto A']);
assert.deepEqual(store.read(tenantB).rows.map(row => row.name), ['Produto B']);
assert.throws(
  () => resolveTenantCatalogRead<Row>({
    tenantId: tenantA,
    rows: [{ tenant_id: tenantB, id: 'same-product-id', name: 'Produto B' }],
  }),
  /fora do tenant solicitado/,
);

// A read error is fail-closed and cannot turn into seed/write behavior.
const writesBeforeError = store.writes.length;
assert.throws(
  () => store.read(tenantA, new Error('fixture read failure')),
  /fixture read failure/,
);
assert.equal(store.writes.length, writesBeforeError);
assert.equal(maySeedEmptyTenantCatalog({
  readSucceeded: false,
  rowCount: 0,
  explicitAdministratorAction: false,
}), false);

console.log('test-menu-isolation: passed (two tenants, restart/deploy, intentional empty, equal IDs, read error)');
