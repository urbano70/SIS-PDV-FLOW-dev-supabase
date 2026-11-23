export type TenantCatalogRow = {
  tenant_id?: unknown;
  id?: unknown;
  [key: string]: unknown;
};

export type TenantCatalogReadResult<T extends TenantCatalogRow> =
  | { kind: 'loaded'; rows: T[] }
  | { kind: 'empty'; rows: [] };

/**
 * Catalog reads are an authorization boundary. A successful empty result is
 * authoritative and must not be replaced by bundled examples. A failed or
 * malformed result throws so callers cannot fall through to a seed/write.
 */
export function resolveTenantCatalogRead<T extends TenantCatalogRow>(args: {
  tenantId: string;
  rows: unknown;
  error?: unknown;
}): TenantCatalogReadResult<T> {
  const tenantId = String(args.tenantId || '').trim();
  if (!tenantId) throw new Error('tenantId obrigatório para carregar catálogo');
  if (args.error) throw args.error;
  if (!Array.isArray(args.rows)) {
    throw new Error(`Leitura do catálogo do tenant ${tenantId} não retornou uma lista`);
  }

  const rows = args.rows as T[];
  for (const row of rows) {
    const rowTenantId = String(row?.tenant_id ?? '').trim();
    if (rowTenantId !== tenantId) {
      throw new Error(`Registro de catálogo fora do tenant solicitado (${tenantId})`);
    }
  }
  return rows.length > 0 ? { kind: 'loaded', rows } : { kind: 'empty', rows: [] };
}

/** IDs are scoped for durable catalog/config records, not only in memory. */
export function tenantScopedCatalogId(tenantId: string, localId: string | number): string {
  const tenant = String(tenantId || '').trim();
  const id = String(localId ?? '').trim();
  if (!tenant || !id) throw new Error('tenantId e id local são obrigatórios');
  return `${tenant}:${id}`;
}

/**
 * Automatic initialization is deliberately disabled. An initial copy is only
 * valid when an authenticated administrator explicitly supplies the data.
 */
export function maySeedEmptyTenantCatalog(args: {
  readSucceeded: boolean;
  rowCount: number;
  explicitAdministratorAction: boolean;
}): boolean {
  return args.readSucceeded && args.rowCount === 0 && args.explicitAdministratorAction === true;
}
