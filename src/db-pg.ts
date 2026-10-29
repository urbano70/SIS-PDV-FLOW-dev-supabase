/**
 * Adaptador PostgreSQL local — usado quando DATABASE_URL está definido.
 * Quando não está, o server.ts usa Supabase normalmente.
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

// ── Save ─────────────────────────────────────────────────────────────────────
export const pgSave = async (collection: string, data: any, docId?: string) => {
  if (!pool) return;
  try {
    switch (collection) {
      case 'orders': {
        const r = orderToRow(data);
        await pool.query(
          `INSERT INTO orders (id,table_id,waiter_id,waiter_name,status,is_comanda,timestamp,items,payment_log,delivery_log)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET
             table_id=EXCLUDED.table_id, waiter_id=EXCLUDED.waiter_id, waiter_name=EXCLUDED.waiter_name,
             status=EXCLUDED.status, is_comanda=EXCLUDED.is_comanda, timestamp=EXCLUDED.timestamp,
             items=EXCLUDED.items, payment_log=EXCLUDED.payment_log, delivery_log=EXCLUDED.delivery_log`,
          [r.id,r.table_id,r.waiter_id,r.waiter_name,r.status,r.is_comanda,r.timestamp,r.items,r.payment_log,r.delivery_log]
        );
        break;
      }
      case 'tables':
      case 'comandas': {
        const r = tableToRow(data);
        await pool.query(
          `INSERT INTO ${collection} (id,status,current_order,linked_to) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, current_order=EXCLUDED.current_order, linked_to=EXCLUDED.linked_to`,
          [r.id, r.status, r.current_order, r.linked_to]
        );
        break;
      }
      case 'waiters': {
        const { id, ...rest } = data;
        await pool.query(
          `INSERT INTO waiters (id, data) VALUES ($1,$2)
           ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`,
          [String(id || docId), JSON.stringify(rest)]
        );
        break;
      }
      case 'menu': {
        const id = docId || data.name;
        await pool.query(
          `INSERT INTO menu (id,name,position,type,visible,items,subcategories) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, position=EXCLUDED.position, type=EXCLUDED.type,
             visible=EXCLUDED.visible, items=EXCLUDED.items, subcategories=EXCLUDED.subcategories`,
          [id, data.name, data.position || 0, data.type || null, data.visible !== false,
           JSON.stringify(data.items || []), JSON.stringify(data.subcategories || [])]
        );
        break;
      }
      case 'stock': {
        const r = stockToRow(data);
        await pool.query(
          `INSERT INTO stock (id,menu_item_id,name,quantity,min_quantity,unit,history) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET menu_item_id=EXCLUDED.menu_item_id, name=EXCLUDED.name,
             quantity=EXCLUDED.quantity, min_quantity=EXCLUDED.min_quantity, unit=EXCLUDED.unit, history=EXCLUDED.history`,
          [r.id, r.menu_item_id, r.name, r.quantity, r.min_quantity, r.unit, r.history]
        );
        break;
      }
      case 'config': {
        await pool.query(
          `INSERT INTO config (id, data) VALUES ($1,$2)
           ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`,
          [String(docId), JSON.stringify(data)]
        );
        break;
      }
      case 'pizzaFlavors': {
        await pool.query(
          `INSERT INTO pizza_flavors (id,name,category,price,available) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category,
             price=EXCLUDED.price, available=EXCLUDED.available`,
          [data.name, data.name, data.category || null, data.price || null, data.available !== false]
        );
        break;
      }
      case 'pizzaCrusts': {
        const id = data.name || docId;
        await pool.query(
          `INSERT INTO pizza_crusts (id, name) VALUES ($1,$2)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`,
          [id, id]
        );
        break;
      }
    }
  } catch (e: any) {
    console.error(`[pg] erro ao salvar em ${collection}:`, e.message);
  }
};

// ── Load ─────────────────────────────────────────────────────────────────────
export const pgLoad = async () => {
  if (!pool) return null;
  try {
    const [ordersR, tablesR, comandasR, waitersR, menuR, stockR, configAppR, configPizR, flavorsR, crustsR] = await Promise.all([
      pool.query('SELECT * FROM orders'),
      pool.query('SELECT * FROM tables ORDER BY id'),
      pool.query('SELECT * FROM comandas ORDER BY id'),
      pool.query('SELECT * FROM waiters'),
      pool.query('SELECT * FROM menu ORDER BY position'),
      pool.query('SELECT * FROM stock'),
      pool.query("SELECT data FROM config WHERE id='app'"),
      pool.query("SELECT data FROM config WHERE id='pizzaria'"),
      pool.query('SELECT * FROM pizza_flavors'),
      pool.query('SELECT * FROM pizza_crusts'),
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
    console.error('[pg] erro na carga inicial:', e.message);
    return null;
  }
};

// ── Seed menu inicial ─────────────────────────────────────────────────────────
export const pgSeedMenu = async (menu: any[]) => {
  if (!pool) return;
  try {
    for (let i = 0; i < menu.length; i++) {
      const cat = menu[i];
      await pool.query(
        `INSERT INTO menu (id,name,position,type,visible,items,subcategories) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [cat.name, cat.name, i, cat.type || null, true, JSON.stringify(cat.items || []), JSON.stringify(cat.subcategories || [])]
      );
    }
  } catch (e: any) {
    console.error('[pg] erro ao semear menu:', e.message);
  }
};

// ── Bulk helpers ──────────────────────────────────────────────────────────────
export const pgDeleteMenu = async () => {
  if (!pool) return;
  await pool.query("DELETE FROM menu WHERE id != ''").catch(() => {});
};

export const pgDeleteLike = async (table: string, column: string, pattern: string) => {
  if (!pool) return;
  await pool.query(`DELETE FROM ${table} WHERE ${column} LIKE $1`, [pattern]).catch(() => {});
};

export const pgDeleteOrdersByWaiterLike = async (pattern: string) => {
  if (!pool) return;
  await pool.query(`DELETE FROM orders WHERE waiter_name LIKE $1`, [pattern]).catch(() => {});
};
