import pg from 'pg';
const { Pool } = pg;

export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pdv:pdv123@localhost:5432/pdv',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pgPool.on('error', (err) => {
  console.error('[pg] Erro inesperado no pool:', err);
});

// ── Orders ────────────────────────────────────────────────────────────────
export async function pgUpsertOrder(row: Record<string, any>) {
  await pgPool.query(
    `INSERT INTO orders (id,table_id,waiter_id,waiter_name,status,is_comanda,timestamp,items,payment_log,delivery_log)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       table_id=$2, waiter_id=$3, waiter_name=$4, status=$5, is_comanda=$6,
       timestamp=$7, items=$8, payment_log=$9, delivery_log=$10`,
    [row.id, row.table_id, row.waiter_id, row.waiter_name, row.status,
     row.is_comanda, row.timestamp, JSON.stringify(row.items || []),
     JSON.stringify(row.payment_log || []), JSON.stringify(row.delivery_log || [])]
  );
}

export async function pgLoadOrders(): Promise<any[]> {
  const { rows } = await pgPool.query('SELECT * FROM orders');
  return rows;
}

export async function pgDeleteAllOrders() {
  await pgPool.query('DELETE FROM orders');
}

// ── Tables ────────────────────────────────────────────────────────────────
export async function pgUpsertTable(row: Record<string, any>) {
  await pgPool.query(
    `INSERT INTO tables (id,status,current_order,linked_to) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET status=$2, current_order=$3, linked_to=$4`,
    [row.id, row.status, row.current_order ?? null, row.linked_to ?? null]
  );
}

export async function pgLoadTables(): Promise<any[]> {
  const { rows } = await pgPool.query('SELECT * FROM tables ORDER BY id');
  return rows;
}

export async function pgResetTables() {
  await pgPool.query("UPDATE tables SET status='free', current_order=NULL, linked_to=NULL");
}

export async function pgBulkUpsertTables(rows: any[]) {
  if (!rows.length) return;
  for (const r of rows) await pgUpsertTable(r);
}

// ── Comandas ──────────────────────────────────────────────────────────────
export async function pgUpsertComanda(row: Record<string, any>) {
  await pgPool.query(
    `INSERT INTO comandas (id,status,current_order,linked_to) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET status=$2, current_order=$3, linked_to=$4`,
    [row.id, row.status, row.current_order ?? null, row.linked_to ?? null]
  );
}

export async function pgLoadComandas(): Promise<any[]> {
  const { rows } = await pgPool.query('SELECT * FROM comandas ORDER BY id');
  return rows;
}

export async function pgResetComandas() {
  await pgPool.query("UPDATE comandas SET status='free', current_order=NULL, linked_to=NULL");
}

export async function pgBulkUpsertComandas(rows: any[]) {
  if (!rows.length) return;
  for (const r of rows) await pgUpsertComanda(r);
}

// ── Waiters ───────────────────────────────────────────────────────────────
export async function pgUpsertWaiter(waiter: Record<string, any>) {
  await pgPool.query(
    `INSERT INTO waiters (id,data) VALUES ($1,$2)
     ON CONFLICT (id) DO UPDATE SET data=$2`,
    [waiter.id, JSON.stringify(waiter)]
  );
}

export async function pgLoadWaiters(): Promise<any[]> {
  const { rows } = await pgPool.query('SELECT data FROM waiters');
  return rows.map((r: any) => r.data);
}

export async function pgDeleteAllWaiters() {
  await pgPool.query('DELETE FROM waiters');
}

// ── Menu ──────────────────────────────────────────────────────────────────
export async function pgUpsertMenu(cat: Record<string, any>, position: number) {
  await pgPool.query(
    `INSERT INTO menu (id,name,position,type,visible,items,subcategories)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       name=$2, position=$3, type=$4, visible=$5, items=$6, subcategories=$7`,
    [cat.name, cat.name, position, cat.type || null, cat.visible !== false,
     JSON.stringify(cat.items || []), JSON.stringify(cat.subcategories || [])]
  );
}

export async function pgLoadMenu(): Promise<any[]> {
  const { rows } = await pgPool.query('SELECT * FROM menu ORDER BY position');
  return rows;
}

export async function pgDeleteAllMenu() {
  await pgPool.query('DELETE FROM menu');
}

export async function pgBulkUpsertMenu(categories: any[]) {
  for (let i = 0; i < categories.length; i++) await pgUpsertMenu(categories[i], i);
}

// ── Stock ─────────────────────────────────────────────────────────────────
export async function pgUpsertStock(row: Record<string, any>) {
  await pgPool.query(
    `INSERT INTO stock (id,menu_item_id,name,quantity,min_quantity,unit,history)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       menu_item_id=$2, name=$3, quantity=$4, min_quantity=$5, unit=$6, history=$7`,
    [row.id, row.menu_item_id, row.name, row.quantity, row.min_quantity,
     row.unit, JSON.stringify(row.history || [])]
  );
}

export async function pgLoadStock(): Promise<any[]> {
  const { rows } = await pgPool.query('SELECT * FROM stock');
  return rows;
}

export async function pgDeleteStockByIds(ids: string[]) {
  if (!ids.length) return;
  await pgPool.query('DELETE FROM stock WHERE id = ANY($1)', [ids]);
}

export async function pgDeleteAllStock() {
  await pgPool.query('DELETE FROM stock');
}

// ── Config ────────────────────────────────────────────────────────────────
export async function pgUpsertConfig(id: string, data: Record<string, any>) {
  await pgPool.query(
    `INSERT INTO config (id,data) VALUES ($1,$2)
     ON CONFLICT (id) DO UPDATE SET data=$2`,
    [id, JSON.stringify(data)]
  );
}

export async function pgLoadConfig(id: string): Promise<Record<string, any> | null> {
  const { rows } = await pgPool.query('SELECT data FROM config WHERE id=$1', [id]);
  return rows[0]?.data ?? null;
}

// ── Pizza Flavors ─────────────────────────────────────────────────────────
export async function pgUpsertPizzaFlavor(flavor: Record<string, any>) {
  await pgPool.query(
    `INSERT INTO pizza_flavors (id,name,category,price,available)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET name=$2, category=$3, price=$4, available=$5`,
    [flavor.name, flavor.name, flavor.category ?? null,
     flavor.price ?? null, flavor.available !== false]
  );
}

export async function pgLoadPizzaFlavors(): Promise<any[]> {
  const { rows } = await pgPool.query('SELECT * FROM pizza_flavors');
  return rows;
}

export async function pgDeleteAllPizzaFlavors() {
  await pgPool.query('DELETE FROM pizza_flavors');
}

// ── Pizza Crusts ──────────────────────────────────────────────────────────
export async function pgUpsertPizzaCrust(name: string) {
  await pgPool.query(
    `INSERT INTO pizza_crusts (id,name) VALUES ($1,$2)
     ON CONFLICT (id) DO UPDATE SET name=$2`,
    [name, name]
  );
}

export async function pgLoadPizzaCrusts(): Promise<any[]> {
  const { rows } = await pgPool.query('SELECT * FROM pizza_crusts');
  return rows;
}

export async function pgDeleteAllPizzaCrusts() {
  await pgPool.query('DELETE FROM pizza_crusts');
}
