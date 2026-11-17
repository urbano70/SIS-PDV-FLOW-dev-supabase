export const INIT_CACHE_KEY_PREFIX = 'pdv_init_cache_';

export type TenantId = string | undefined | null;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Normalize IDs at the boundary so an empty URL/query value is never a tenant. */
export function normalizeTenantId(tenantId: TenantId): string | undefined {
  if (tenantId === undefined || tenantId === null) return undefined;
  const normalized = String(tenantId).trim();
  return normalized || undefined;
}

/** Return null for an unscoped client; never create/read the shared "default" cache. */
export function getTenantCacheKey(tenantId: TenantId): string | null {
  const normalized = normalizeTenantId(tenantId);
  return normalized ? `${INIT_CACHE_KEY_PREFIX}${normalized}` : null;
}

export function getTenantStorageKey(prefix: string, tenantId: TenantId): string | null {
  const normalized = normalizeTenantId(tenantId);
  return normalized ? `${prefix}_${normalized}` : null;
}

function readMetadataValue(data: unknown, keys: string[]): unknown {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
  }
  return undefined;
}

/**
 * Read only explicit snapshot metadata. Do not infer a tenant from an order/table,
 * since those payloads are intentionally unchanged and are not an auth boundary.
 */
export function getSnapshotTenantId(data: unknown): string | undefined {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const direct = readMetadataValue(record, ['tenantId', 'tenant_id', 'tenant']);
  if (direct !== undefined) return normalizeTenantId(direct as TenantId);

  const metadata = record.metadata;
  if (metadata && typeof metadata === 'object') {
    return normalizeTenantId(readMetadataValue(metadata, ['tenantId', 'tenant_id', 'tenant']) as TenantId);
  }
  return undefined;
}

/** Optional request correlation fields supported by newer servers. */
export function getSnapshotEpoch(data: unknown): string | undefined {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const value = readMetadataValue(record, [
    'initEpoch', 'init_epoch', 'requestEpoch', 'request_epoch', 'requestId', 'request_id', 'epoch',
  ]);
  return value === undefined ? undefined : String(value);
}

export function getSnapshotBuildId(data: unknown): string | undefined {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const direct = readMetadataValue(record, ['buildId', 'build_id']);
  if (direct !== undefined) return String(direct);
  const metadata = record.metadata;
  if (metadata && typeof metadata === 'object') {
    const nested = readMetadataValue(metadata, ['buildId', 'build_id']);
    if (nested !== undefined) return String(nested);
  }
  return undefined;
}

/**
 * Modern servers must identify an init snapshot with the requested tenant. For an
 * unscoped client, accept only an untagged/default snapshot. This deliberately
 * rejects a missing tenant when the provider has an expected tenant: an old or
 * unauthenticated snapshot must never replace the visible tenant's state.
 */
export function isInitDataForTenant(data: unknown, expectedTenantId: TenantId): boolean {
  const expected = normalizeTenantId(expectedTenantId);
  const actual = getSnapshotTenantId(data);
  if (expected) return actual === expected;
  return actual === undefined || actual === 'default';
}

export function isInitDataAccepted(
  data: unknown,
  expectedTenantId: TenantId,
  expectedEpoch?: string,
): boolean {
  if (!isInitDataForTenant(data, expectedTenantId)) return false;

  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  // A readiness lock is optional for compatibility, but an explicit negative
  // readiness marker is never an authoritative snapshot.
  if (record.ready === false || record.initReady === false || record.initialized === false) return false;

  const actualEpoch = getSnapshotEpoch(data);
  return !expectedEpoch || !actualEpoch || actualEpoch === String(expectedEpoch);
}

export function readTenantCache<T = Record<string, unknown>>(
  storage: StorageLike | undefined,
  tenantId: TenantId,
): T | null {
  const key = getTenantCacheKey(tenantId);
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    if (!parsed || typeof parsed !== 'object') return null;
    const cachedTenant = getSnapshotTenantId(parsed);
    const expected = normalizeTenantId(tenantId);
    if (expected && cachedTenant && cachedTenant !== expected) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeTenantCache(
  storage: StorageLike | undefined,
  tenantId: TenantId,
  data: Record<string, unknown>,
): void {
  const key = getTenantCacheKey(tenantId);
  const normalized = normalizeTenantId(tenantId);
  if (!storage || !key || !normalized) return;
  try {
    storage.setItem(key, JSON.stringify({ ...data, tenantId: normalized }));
  } catch {
    // localStorage can be unavailable or full; the socket remains authoritative.
  }
}

/** Keep the server's event shape unchanged while applying the display-only name fix. */
export function transformMenuForDisplay<T extends { name?: string; type?: string }>(cats: T[]): T[] {
  return cats.map((cat) => ({
    ...cat,
    name: cat.name === 'Éxodo' && cat.type === 'bebidas' ? 'Bebidas' : cat.name,
  }));
}
