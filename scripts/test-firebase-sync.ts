import assert from 'node:assert/strict';
import {
  getTenantCacheKey,
  isInitDataAccepted,
  readTenantCache,
  writeTenantCache,
} from '../src/lib/firebaseSync.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const storage = new MemoryStorage();
assert.equal(getTenantCacheKey(undefined), null, 'unscoped clients must not use the default cache');
assert.equal(getTenantCacheKey('  tenant-a  '), 'pdv_init_cache_tenant-a');

writeTenantCache(storage, 'tenant-a', { orders: [{ id: 'a-1' }] });
writeTenantCache(storage, 'tenant-b', { orders: [{ id: 'b-1' }] });
assert.deepEqual(readTenantCache(storage, 'tenant-a')?.orders, [{ id: 'a-1' }]);
assert.deepEqual(readTenantCache(storage, 'tenant-b')?.orders, [{ id: 'b-1' }]);
assert.equal(readTenantCache(storage, 'tenant-c'), null, 'a tenant cannot read another tenant cache');

const currentTenant = 'tenant-a';
const readySnapshot = {
  tenantId: currentTenant,
  initEpoch: 'reconnect-2',
  ready: true,
  // Empty is authoritative. It must not be treated as a partial/falsy snapshot.
  orders: [],
};
assert.equal(isInitDataAccepted(readySnapshot, currentTenant, 'reconnect-2'), true);
assert.equal(isInitDataAccepted({ ...readySnapshot, tenantId: 'tenant-b' }, currentTenant, 'reconnect-2'), false);
assert.equal(isInitDataAccepted({ ...readySnapshot, initEpoch: 'reconnect-1' }, currentTenant, 'reconnect-2'), false);
assert.equal(isInitDataAccepted({ ...readySnapshot, ready: false }, currentTenant, 'reconnect-2'), false);
assert.equal(isInitDataAccepted({ orders: [{ id: 'legacy' }] }, currentTenant), false, 'legacy untagged init must not become ready');

// Model the provider listener gate: update arrays before a valid init are ignored,
// reconnect keeps the last visible authoritative state, and valid empty snapshots
// replace it without any merge that could resurrect paid/removed/deleted orders.
let ready = false;
type TestOrder = { id: string; items?: { id: string; paid?: boolean }[] };
let orders: TestOrder[] = [{ id: 'authoritative-1', items: [{ id: 'paid-item', paid: true }] }];
const applyUpdateOrders = (next: typeof orders) => {
  if (ready) orders = next;
};
const applyInit = (snapshot: any, epoch?: string) => {
  if (!isInitDataAccepted(snapshot, currentTenant, epoch)) return false;
  if (Array.isArray(snapshot.orders)) orders = snapshot.orders;
  ready = true;
  return true;
};

applyUpdateOrders([]);
assert.equal(orders.length, 1, 'partial/empty updates before auth must not wipe cached state');
assert.equal(applyInit({ tenantId: currentTenant, orders: [{ id: 'live-1' }] }, undefined), true);
assert.deepEqual(orders.map(o => o.id), ['live-1']);
applyUpdateOrders([{ id: 'live-2' }]);
assert.deepEqual(orders.map(o => o.id), ['live-2']);

// Reconnect: keep state visible while waiting, ignore a stale update, then accept
// the next authoritative snapshot for the same tenant.
ready = false;
applyUpdateOrders([{ id: 'stale-before-reconnect-init' }]);
assert.deepEqual(orders.map(o => o.id), ['live-2']);
assert.equal(applyInit({ tenantId: 'tenant-b', orders: [{ id: 'wrong-tenant' }] }, 'reconnect-2'), false);
assert.deepEqual(orders.map(o => o.id), ['live-2']);
assert.equal(applyInit(readySnapshot, 'reconnect-2'), true);
assert.deepEqual(orders, [], 'authoritative empty snapshot must remain empty');

console.log('firebase sync helper tests passed');
