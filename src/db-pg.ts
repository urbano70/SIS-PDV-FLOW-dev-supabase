/**
 * Adaptador PostgreSQL local — usado quando DATABASE_URL está definido.
 * Quando não está, o server.ts usa Supabase normalmente.
 *
 * As operações de escrita são single-writer por tenant/coleção/registro. Isso
 * evita que dois snapshots concorrentes (por exemplo, itens adicionados em
 * sequência) terminem no banco fora de ordem.
 */
import { Pool } from 'pg';

let pool: Pool;

export const initPg = (databaseUrl: string) => {
  pool = new Pool({ connectionString: databaseUrl });
  return pool;
};

export const getPgPool = () => pool;

// ── Helpers de mapeamento (mesmos do server.ts) ─────────────────────────────
const orderToRow = (o: any) => ({
  id: String(o.id),
  table_id: o.tableId ? String(o.tableId) : null,
  waiter_id: o.waiterId ? String(o.waiterId) : null,
  waiter_name: o.waiterName || null,
  status: o.status || 'open',
  is_comanda: o.isComanda || false,
  timestamp: o.timestamp || new Date().toISOString(),
  items: JSON.stringify(o.items || []),
  payment_log: JSON.stringify(o.paymentLog || []),
  delivery_log: JSON.stringify(o.deliveryLog || []),
});

const rowToOrder = (r: any) => ({
  id: r.id,
  tableId: r.table_id,
  waiterId: r.waiter_id,
  waiterName: r.waiter_name,
  status: r.status,
  isComanda: r.is_comanda,
  timestamp: r.timestamp,
  items: r.items || [],
  paymentLog: r.payment_log || [],
  deliveryLog: r.delivery_log || [],
});

const tableToRow = (t: any) => ({
  id: t.id,
  status: t.status,
  current_order: t.currentOrder ?? null,
  linked_to: t.linkedTo ?? null,
});

const rowToTable = (r: any) => ({
  id: r.id,
  status: r.status,
  currentOrder: r.current_order ?? null,
  linkedTo: r.linked_to ?? null,
});

const stockToRow = (s: any) => ({
  id: s.id,
  menu_item_id: s.menuItemId || s.id,
  name: s.name || '',
  quantity: s.quantity || 0,
  min_quantity: s.minQuantity || 0,
  unit: s.unit || 'un',
  history: JSON.stringify(s.history || []),
});

const rowToStock = (r: any) => ({
  id: r.id,
  menuItemId: r.menu_item_id,
  name: r.name,
  quantity: Number(r.quantity),
  minQuantity: Number(r.min_quantity),
  unit: r.unit,
  history: r.history || [],
});

const tenant = (tenantId?: string) => tenantId || 'default';
const writeTails = new Map<string, Promise<void>>();

const cloneData = <T>(data: T): T => {
  if (data === undefined || data === null) return data;
  return JSON.parse(JSON.stringify(data));
};

const pgSaveNow = async (collection: string, data: any, docId?: string, tenantId = 'default') => {
  if (!pool) return;
  const tid = tenant(tenantId);
  try {
    switch (collection) {
      case 'orders': {
        const r = orderToRow(data);
        await pool.query(
          `INSERT INTO orders (id,tenant_id,table_id,waiter_id,waiter_name,status,is_comanda,timestamp,items,payment_log,delivery_log)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (tenant_id,id) DO UPDATE SET
             table_id=EXCLUDED.table_id, waiter_id=EXCLUDED.waiter_id, waiter_name=EXCLUDED.waiter_name,
             status=EXCLUDED.status, is_comanda=EXCLUDED.is_comanda, timestamp=EXCLUDED.timestamp,
             items=EXCLUDED.items, payment_log=EXCLUDED.payment_log, delivery_log=EXCLUDED.delivery_log
           WHERE orders.tenant_id = EXCLUDED.tenant_id`,
          [r.id, tid, r.table_id, r.waiter_id, r.waiter_name, r.status, r.is_comanda, r.timestamp, r.items, r.payment_log, r.delivery_log]
        );
        break;
      }
      case 'tables':
      case 'comandas': {
        const r = tableToRow(data);
        await pool.query(
          `INSERT INTO ${collection} (id,tenant_id,status,current_order,linked_to) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id,id) DO UPDATE SET status=EXCLUDED.status, current_order=EXCLUDED.current_order, linked_to=EXCLUDED.linked_to
           WHERE ${collection}.tenant_id = EXCLUDED.tenant_id`,
          [r.id, tid, r.status, r.current_order, r.linked_to]
        );
        break;
      }
      case 'waiters': {
        const { id, ...rest } = data;
        await pool.query(
          `INSERT INTO waiters (id,tenant_id,data) VALUES ($1,$2,$3)
           ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data
           WHERE waiters.tenant_id = EXCLUDED.tenant_id`,
          [String(id || docId), tid, JSON.stringify(rest)]
        );
        break;
      }
      case 'menu': {
        const id = `${tid}:${docId || data.name}`;
        await pool.query(
          `INSERT INTO menu (id,tenant_id,name,position,type,visible,items,subcategories) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, position=EXCLUDED.position, type=EXCLUDED.type,
             visible=EXCLUDED.visible, items=EXCLUDED.items, subcategories=EXCLUDED.subcategories
           WHERE menu.tenant_id = EXCLUDED.tenant_id`,
          [id, tid, data.name, data.position || 0, data.type || null, data.visible !== false,
            JSON.stringify(data.items || []), JSON.stringify(data.subcategories || [])]
        );
        break;
      }
      case 'stock': {
        const r = stockToRow(data);
        const id = `${tid}:${r.id}`;
        await pool.query(
          `INSERT INTO stock (id,tenant_id,menu_item_id,name,quantity,min_quantity,unit,history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET menu_item_id=EXCLUDED.menu_item_id, name=EXCLUDED.name,
             quantity=EXCLUDED.quantity, min_quantity=EXCLUDED.min_quantity, unit=EXCLUDED.unit, history=EXCLUDED.history
           WHERE stock.tenant_id = EXCLUDED.tenant_id`,
          [id, tid, r.menu_item_id, r.name, r.quantity, r.min_quantity, r.unit, r.history]
        );
        break;
      }
      case 'config': {
        const id = `${tid}:${docId}`;
        await pool.query(
          `INSERT INTO config (id,tenant_id,data) VALUES ($1,$2,$3)
           ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data
           WHERE config.tenant_id = EXCLUDED.tenant_id`,
          [id, tid, JSON.stringify(data)]
        );
        break;
      }
      case 'pizzaFlavors': {
        const id = `${tid}:${data.name}`;
        await pool.query(
          `INSERT INTO pizza_flavors (id,tenant_id,name,category,price,available) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category,
             price=EXCLUDED.price, available=EXCLUDED.available
           WHERE pizza_flavors.tenant_id = EXCLUDED.tenant_id`,
          [id, tid, data.name, data.category || null, data.price || null, data.available !== false]
        );
        break;
      }
      case 'pizzaCrusts': {
        const id = `${tid}:${data.name || docId}`;
        await pool.query(
          `INSERT INTO pizza_crusts (id,tenant_id,name) VALUES ($1,$2,$3)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name
           WHERE pizza_crusts.tenant_id = EXCLUDED.tenant_id`,
          [id, tid, id]
        );
        break;
      }
      default:
        throw new Error(`Coleção PostgreSQL desconhecida: ${collection}`);
    }
  } catch (e: any) {
    console.error(`[pg] erro ao salvar em ${collection} (tenant ${tid}):`, e.message);
    throw e;
  }
};

/**
 * Persiste um snapshot e aguarda todas as escritas anteriores do mesmo registro.
 * O snapshot é clonado antes de entrar na fila para não observar mutações futuras
 * do objeto em memória enquanto o banco ainda está processando a operação.
 */
export const pgSave = (collection: string, data: any, docId?: string, tenantId = 'default'): Promise<void> => {
  if (!pool) return Promise.resolve();
  const tid = tenant(tenantId);
  const key = `${tid}:${collection}:${String(docId ?? data?.id ?? '')}`;
  const snapshot = cloneData(data);
  const previous = writeTails.get(key);
  const current = previous
    ? previous.catch(() => undefined).then(() => pgSaveNow(collection, snapshot, docId, tid))
    : pgSaveNow(collection, snapshot, docId, tid);
  const tracked = current.finally(() => {
    if (writeTails.get(key) === tracked) writeTails.delete(key);
  });
  tracked.catch(() => undefined);
  writeTails.set(key, tracked);
  return current;
};

// ── Load ─────────────────────────────────────────────────────────────────────
export const pgLoad = async (tenantId = 'default') => {
  if (!pool) return null;
  const tid = tenant(tenantId);
  try {
    const [ordersR, tablesR, comandasR, waitersR, menuR, stockR, configAppR, configPizR, flavorsR, crustsR] = await Promise.all([
      pool.query('SELECT * FROM orders WHERE tenant_id=$1', [tid]),
      pool.query('SELECT * FROM tables WHERE tenant_id=$1 ORDER BY id', [tid]),
      pool.query('SELECT * FROM comandas WHERE tenant_id=$1 ORDER BY id', [tid]),
      pool.query('SELECT * FROM waiters WHERE tenant_id=$1', [tid]),
      pool.query('SELECT * FROM menu WHERE tenant_id=$1 ORDER BY position', [tid]),
      pool.query('SELECT * FROM stock WHERE tenant_id=$1', [tid]),
      pool.query("SELECT data FROM config WHERE id=$1 AND tenant_id=$2", [`${tid}:app`, tid]),
      pool.query("SELECT data FROM config WHERE id=$1 AND tenant_id=$2", [`${tid}:pizzaria`, tid]),
      pool.query('SELECT * FROM pizza_flavors WHERE tenant_id=$1', [tid]),
      pool.query('SELECT * FROM pizza_crusts WHERE tenant_id=$1', [tid]),
    ]);
    return {
      orders: ordersR.rows.map(rowToOrder),
      tables: tablesR.rows.map(rowToTable),
      comandas: comandasR.rows.map(rowToTable),
      waiters: waitersR.rows.map((r: any) => ({ id: r.id, ...(r.data || {}) })),
      menu: menuR.rows.map((r: any) => ({
        id: r.id, name: r.name, position: r.position, type: r.type,
        visible: r.visible !== false,
        items: r.items || [],
        subcategories: r.subcategories || [],
      })),
      stock: stockR.rows.map(rowToStock),
      configApp: configAppR.rows[0]?.data || null,
      configPizzaria: configPizR.rows[0]?.data || null,
      pizzaFlavors: flavorsR.rows.map((r: any) => ({ id: r.id, name: r.name, category: r.category, price: r.price, available: r.available })),
      pizzaCrusts: crustsR.rows.map((r: any) => r.name),
    };
  } catch (e: any) {
    console.error(`[pg] erro na carga inicial (tenant ${tid}):`, e.message);
    throw e;
  }
};

// ── Seed menu inicial ─────────────────────────────────────────────────────────
export const pgSeedMenu = async (menu: any[], tenantId = 'default') => {
  if (!pool) return;
  const tid = tenant(tenantId);
  try {
    for (let i = 0; i < menu.length; i++) {
      const cat = menu[i];
      await pool.query(
        `INSERT INTO menu (id,tenant_id,name,position,type,visible,items,subcategories) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [`${tid}:${cat.name}`, tid, cat.name, i, cat.type || null, true, JSON.stringify(cat.items || []), JSON.stringify(cat.subcategories || [])]
      );
    }
  } catch (e: any) {
    console.error(`[pg] erro ao semear menu (tenant ${tid}):`, e.message);
    throw e;
  }
};

// ── Bulk helpers ──────────────────────────────────────────────────────────────
export const pgDeleteMenu = async () => {
  if (!pool) return;
  await pool.query("DELETE FROM menu WHERE id != ''");
};

export const pgDeleteLike = async (table: string, column: string, pattern: string) => {
  if (!pool) return;
  await pool.query(`DELETE FROM ${table} WHERE ${column} LIKE $1`, [pattern]);
};

export const pgDeleteOrdersByWaiterLike = async (pattern: string) => {
  if (!pool) return;
  await pool.query(`DELETE FROM orders WHERE waiter_name LIKE $1`, [pattern]);
};
