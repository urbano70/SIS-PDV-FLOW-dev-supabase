import { tenantScopedCatalogId } from '../lib/menuIsolation.ts';

type MenuCategory = Record<string, any>;
type SupabaseLike = { from: (table: string) => any } | null | undefined;
type PgClientLike = {
  query: (text: string, values?: any[]) => Promise<any>;
  release?: () => void;
};
type PgPoolLike = { connect: () => Promise<PgClientLike> };

/** Builds the same durable menu rows used by the existing per-category writer. */
export const buildMenuSnapshotRows = (menu: any[], tenantId: string): MenuCategory[] => {
  if (!Array.isArray(menu)) throw new Error('Snapshot de menu inválido.');
  const tid = String(tenantId || '').trim();
  if (!tid) throw new Error('tenantId obrigatório para salvar menu.');

  return menu.map((category: MenuCategory, position: number) => {
    const localId = String(category?.name ?? category?.id ?? '').trim();
    if (!localId) throw new Error('Categoria de menu sem identificador.');
    return {
      id: tenantScopedCatalogId(tid, localId),
      tenant_id: tid,
      name: category.name,
      position,
      type: category.type ?? null,
      visible: category.visible !== false,
      items: category.items || [],
      subcategories: category.subcategories || [],
    };
  });
};

/**
 * Persists the complete moved snapshot in one PostgREST request. PostgREST
 * executes one bulk upsert statement transactionally, so a rejected request
 * cannot leave an earlier category write committed by this operation.
 */
export const persistSupabaseMenuSnapshot = async (
  db: SupabaseLike,
  menu: any[],
  tenantId: string,
): Promise<void> => {
  if (!db) return;
  const rows = buildMenuSnapshotRows(menu, tenantId);
  if (rows.length === 0) return;
  const result = await db.from('menu').upsert(rows, { onConflict: 'tenant_id,id' });
  if (result?.error) throw result.error;
};

const menuInsertSql = (rowCount: number): string => {
  const values = Array.from({ length: rowCount }, (_, index) => {
    const offset = index * 8;
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7}::jsonb,$${offset + 8}::jsonb)`;
  }).join(',');
  return `
    INSERT INTO menu (id,tenant_id,name,position,type,visible,items,subcategories)
    VALUES ${values}
    ON CONFLICT (tenant_id,id) DO UPDATE SET
      name=EXCLUDED.name, position=EXCLUDED.position, type=EXCLUDED.type,
      visible=EXCLUDED.visible, items=EXCLUDED.items, subcategories=EXCLUDED.subcategories
    WHERE menu.tenant_id = EXCLUDED.tenant_id
  `;
};

/** Persists a moved snapshot in one real PostgreSQL transaction. */
export const persistPostgresMenuSnapshot = async (
  pool: PgPoolLike,
  menu: any[],
  tenantId: string,
): Promise<void> => {
  const rows = buildMenuSnapshotRows(menu, tenantId);
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    if (rows.length > 0) {
      const values = rows.flatMap((row) => [
        row.id,
        row.tenant_id,
        row.name,
        row.position,
        row.type,
        row.visible,
        JSON.stringify(row.items),
        JSON.stringify(row.subcategories),
      ]);
      await client.query(menuInsertSql(rows.length), values);
    }
    await client.query('COMMIT');
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure; the connection is released below.
      }
    }
    throw error;
  } finally {
    client.release?.();
  }
};
