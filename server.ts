import 'dotenv/config';
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import os from "os";
import net from "net";
import { randomUUID } from "crypto";
import { createServer as createViteServer } from "vite";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { MENU_CATEGORIES, PIZZA_FLAVORS, PIZZA_CRUSTS } from "./src/constants.ts";
import { initPg, pgSave, pgLoad, pgSeedMenu, pgDeleteMenu, pgDeleteLike, pgDeleteOrdersByWaiterLike } from "./src/db-pg.ts";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
  const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ["http://localhost:3000", "http://0.0.0.0:3000", "http://localhost:3001", "http://0.0.0.0:3001"];

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Agente local (Node.js) não envia origin — sempre permitir
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(null, true); // em dev, permitir tudo; em prod usar: callback(new Error('Not allowed'))
      },
    },
  });

  const PORT = 3001;

  // ── Detecta modo de banco: PostgreSQL local ou Supabase ─────────────────────
  const USE_POSTGRES = !!process.env.DATABASE_URL;
  let db: SupabaseClient | null = null;

  if (USE_POSTGRES) {
    try {
      initPg(process.env.DATABASE_URL!);
      console.log('[pg] Pool PostgreSQL inicializado');
    } catch (error) {
      console.error('[pg] Falha ao inicializar PostgreSQL:', error);
      process.exit(1);
    }
  } else {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
      }
      db = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
        realtime: { transport: ws as any },
      });
      console.log('[supabase] Admin client inicializado');
    } catch (error) {
      console.error('[supabase] Falha ao inicializar:', error);
      process.exit(1);
    }
  }

  app.use(express.json({ limit: '15mb' }));

  // ── Per-tenant state ──────────────────────────────────────────────────────
  interface TenantState {
    orders: any[];
    tables: any[];
    comandas: any[];
    waiters: any[];
    menu: any[];
    stock: any[];
    stockLog: any[];
    pizzaFlavors: any[];
    pizzaCrusts: any[];
    pizzaSizes: { name: string; slices: number; dim: string; people: string; maxFlavors: number; detail: string; basePrice?: number }[];
    isCashRegisterOpen: boolean;
    shiftStartedAt: string;
    dailyCounter: number;
    lastOrderDate: string;
    pizzariaConfig: any;
    printerAgentSocket: any;
    loaded: boolean;
  }

  const DEFAULT_PIZZA_SIZES = [
    { name: 'Mini',       slices: 4,  dim: '20cm',     people: '1 pessoa',     maxFlavors: 1, detail: 'até 1 sabor',  basePrice: 28.00 },
    { name: 'Pequena',    slices: 4,  dim: '25cm',     people: '1-2 pessoas',  maxFlavors: 2, detail: 'até 2 sabores', basePrice: 38.00 },
    { name: 'Média',      slices: 6,  dim: '30cm',     people: '2-3 pessoas',  maxFlavors: 2, detail: 'até 2 sabores', basePrice: 48.00 },
    { name: 'Grande',     slices: 8,  dim: '35cm',     people: '3-4 pessoas',  maxFlavors: 4, detail: 'até 4 sabores', basePrice: 58.00 },
    { name: 'GG',         slices: 12, dim: '40cm',     people: '4-5 pessoas',  maxFlavors: 4, detail: 'até 4 sabores', basePrice: 69.00 },
    { name: 'Meio Metro', slices: 16, dim: '50x25cm',  people: '5-6 pessoas',  maxFlavors: 4, detail: 'até 4 sabores', basePrice: 85.00 },
    { name: 'Metro',      slices: 24, dim: '100x25cm', people: '8-10 pessoas', maxFlavors: 6, detail: 'até 6 sabores', basePrice: 129.00 },
  ];

  const tenants = new Map<string, TenantState>();

  function defaultTenantState(): TenantState {
    return {
      orders: [],
      tables: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, status: "free", currentOrder: null, linkedTo: null })),
      comandas: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, status: "free", currentOrder: null, linkedTo: null })),
      waiters: [],
      menu: JSON.parse(JSON.stringify(MENU_CATEGORIES)),
      stock: [],
      stockLog: [],
      pizzaFlavors: JSON.parse(JSON.stringify(PIZZA_FLAVORS)),
      pizzaCrusts: JSON.parse(JSON.stringify(PIZZA_CRUSTS)),
      pizzaSizes: JSON.parse(JSON.stringify(DEFAULT_PIZZA_SIZES)),
      isCashRegisterOpen: false,
      shiftStartedAt: new Date().toISOString(),
      dailyCounter: 0,
      lastOrderDate: '',
      pizzariaConfig: { enabled: false, yellowMinutes: 15, orangeMinutes: 20, redMinutes: 25, inactivityMinutes: 30, kdsEnabled: false, waiterCanPay: true },
      printerAgentSocket: null,
      loaded: false,
    };
  }

  function getState(tenantId: string): TenantState {
    if (!tenants.has(tenantId)) tenants.set(tenantId, defaultTenantState());
    return tenants.get(tenantId)!;
  }

  // callWaiterCooldown and clientSessions keyed by `${tenantId}:...`
  const callWaiterCooldown = new Map<string, number>();

  // â"€â"€ Mappers: Supabase row â†" app object â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const rowToTable  = (r: any) => ({ id: r.id, status: r.status, currentOrder: r.current_order ?? null, linkedTo: r.linked_to ?? null });
  const tableToRow  = (t: any) => ({ id: t.id, status: t.status, current_order: t.currentOrder ?? null, linked_to: t.linkedTo ?? null });
  const rowToOrder  = (r: any) => ({ id: r.id, tableId: r.table_id, waiterId: r.waiter_id, waiterName: r.waiter_name, status: r.status, isComanda: r.is_comanda, timestamp: r.timestamp, items: r.items || [], paymentLog: r.payment_log || [], deliveryLog: r.delivery_log || [] });
  const orderToRow  = (o: any) => ({ id: String(o.id), table_id: o.tableId ? String(o.tableId) : null, waiter_id: o.waiterId ? String(o.waiterId) : null, waiter_name: o.waiterName || null, status: o.status || 'open', is_comanda: o.isComanda || false, timestamp: o.timestamp || new Date().toISOString(), items: o.items || [], payment_log: o.paymentLog || [], delivery_log: o.deliveryLog || [] });
  const rowToStock  = (r: any) => ({ id: r.id, menuItemId: r.menu_item_id, name: r.name, quantity: r.quantity, minQuantity: r.min_quantity, unit: r.unit, history: r.history || [] });
  const stockToRow  = (s: any) => ({ id: s.id, menu_item_id: s.menuItemId || s.id, name: s.name || '', quantity: s.quantity || 0, min_quantity: s.minQuantity || 0, unit: s.unit || 'un', history: s.history || [] });

  // â"€â"€ saveToSupabase: persiste qualquer coleÃ§Ã£o â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const markShiftStart = (st: TenantState) => {
    st.shiftStartedAt = new Date().toISOString();
  };

  const saveToSupabase = async (collection: string, data: any, docId?: string, tenantId?: string) => {
    if (USE_POSTGRES) { await pgSave(collection, data, docId); return; }
    if (!db) return;
    const tid = tenantId || 'default';
    try {
      const d = JSON.parse(JSON.stringify(data));
      switch (collection) {
        case 'orders':   await db.from('orders').upsert({ ...orderToRow(d), tenant_id: tid }); break;
        case 'tables':   await db.from('tables').upsert({ ...tableToRow(d), tenant_id: tid }); break;
        case 'comandas': await db.from('comandas').upsert({ ...tableToRow(d), tenant_id: tid }); break;
        case 'waiters':  await db.from('waiters').upsert({ ...d, tenant_id: tid }); break;
        case 'menu':     await db.from('menu').upsert({ id: `${tid}:${docId || d.id}`, name: d.name, position: d.position || 0, items: d.items || [], tenant_id: tid, type: d.type, visible: d.visible !== false, subcategories: d.subcategories || [] }); break;
        case 'stock':    await db.from('stock').upsert({ ...stockToRow(d), id: `${tid}:${d.id}`, tenant_id: tid }); break;
        case 'config':   await db.from('config').upsert({ id: `${tid}:${docId}`, data: d, tenant_id: tid }); break;
        case 'pizzaFlavors': await db.from('pizza_flavors').upsert({ id: `${tid}:${d.name}`, name: d.name, category: d.category || null, price: d.price || null, available: d.available !== false, tenant_id: tid }); break;
        case 'pizzaCrusts':  await db.from('pizza_crusts').upsert({ id: `${tid}:${d.name || docId}`, name: d.name || docId, tenant_id: tid }); break;
        default: console.warn(`[supabase] coleção desconhecida: "${collection}"`);
      }
    } catch (e) {
      console.error(`[supabase] erro ao salvar em ${collection}:`, e);
    }
  };

  // ── Write queue: debounced async writes, sem bloquear o event loop ────────
  // Agrupa writes rápidos do mesmo registro (ex: vários itens na mesma order)
  // num único upsert. O socket responde imediatamente; o write vai em background.
  const _writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const _writePayload = new Map<string, { collection: string; data: any; docId: string; tenantId: string }>();

  const enqueueWrite = (collection: string, data: any, docId: string, tenantId: string, debounceMs = 80) => {
    const key = `${tenantId}:${collection}:${docId}`;
    const existing = _writeTimers.get(key);
    if (existing) clearTimeout(existing);
    _writePayload.set(key, { collection, data, docId, tenantId });
    _writeTimers.set(key, setTimeout(() => {
      _writeTimers.delete(key);
      const p = _writePayload.get(key);
      if (p) {
        _writePayload.delete(key);
        saveToSupabase(p.collection, p.data, p.docId, p.tenantId).catch(() => {});
      }
    }, debounceMs));
  };

  const saveMenuToSupabase = (st: TenantState, tenantId: string) => {
    st.menu.forEach((cat: any, idx: number) => {
      saveToSupabase('menu', { ...cat, position: idx }, cat.name, tenantId).catch(() => {});
    });
  };

  // ── Carga inicial do banco (Supabase ou PostgreSQL) ──────────────────────────
  const loadFromSupabase = async () => {
    // ── PostgreSQL local ──────────────────────────────────────────────────────
    if (USE_POSTGRES) {
      const pgData = await pgLoad();
      if (!pgData) return;
      const st = getState('default');
      const room = 'tenant:default';

      if (pgData.waiters?.length) { st.waiters = pgData.waiters; io.to(room).emit('update_waiters', st.waiters); }

      const typeMap: Record<string, string> = {};
      MENU_CATEGORIES.forEach((c: any) => { typeMap[c.name] = c.type; });

      if (pgData.menu?.length) {
        st.menu = pgData.menu.map((row: any) => ({
          ...row,
          type: row.type || typeMap[row.name] || 'lanches',
          visible: row.visible !== false,
          subcategories: row.subcategories || [],
        }));
        io.to(room).emit('update_menu', st.menu);
      } else {
        await pgSeedMenu(st.menu);
        console.log('[pg] Menu inicial semeado');
        io.to(room).emit('update_menu', st.menu);
      }

      if (pgData.orders?.length) {
        st.orders = pgData.orders.map((o: any) => {
          if (o.items && st.menu.length > 0) {
            o.items = o.items.map((item: any) => {
              if (item.type === 'pizzas') return item;
              const cat = st.menu.find((c: any) =>
                c.items?.some((i: any) => i.id === item.menuItemId || i.name === item.name) ||
                (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.id === item.menuItemId || i.name === item.name))
              );
              return cat?.type ? { ...item, type: cat.type } : item;
            });
          }
          return o;
        });
        io.to(room).emit('update_orders', st.orders);
      }

      if (pgData.tables?.length) {
        pgData.tables.forEach((dbTable: any) => {
          const idx = st.tables.findIndex(t => t.id === dbTable.id);
          if (idx !== -1) st.tables[idx] = { ...st.tables[idx], ...dbTable }; else st.tables.push(dbTable);
        });
        st.tables.sort((a, b) => a.id - b.id);
        io.to(room).emit('update_tables', st.tables);
      }

      if (pgData.comandas?.length) {
        pgData.comandas.forEach((dbC: any) => {
          const idx = st.comandas.findIndex(c => c.id === dbC.id);
          if (idx !== -1) st.comandas[idx] = { ...st.comandas[idx], ...dbC }; else st.comandas.push(dbC);
        });
        st.comandas.sort((a, b) => a.id - b.id);
        io.to(room).emit('update_comandas', st.comandas);
      }

      if (pgData.configApp) {
        const cfg = pgData.configApp as any;
        st.isCashRegisterOpen = cfg.isCashRegisterOpen || false;
        if (cfg.dailyCounter !== undefined) st.dailyCounter = cfg.dailyCounter;
        if (cfg.lastOrderDate !== undefined) st.lastOrderDate = cfg.lastOrderDate;
        io.to(room).emit('update_cash_register', st.isCashRegisterOpen);
        io.to(room).emit('update_shift_started_at', st.shiftStartedAt);
      }

      if (pgData.stock?.length) { st.stock = pgData.stock; io.to(room).emit('update_stock', st.stock); }
      if (pgData.pizzaFlavors?.length) { st.pizzaFlavors = pgData.pizzaFlavors; io.to(room).emit('update_pizza_flavors', st.pizzaFlavors); }
      if (pgData.pizzaCrusts?.length) { st.pizzaCrusts = pgData.pizzaCrusts; io.to(room).emit('update_pizza_crusts', st.pizzaCrusts); }
      if (pgData.configPizzaria) { st.pizzariaConfig = { ...st.pizzariaConfig, ...(pgData.configPizzaria as any) }; io.to(room).emit('update_pizzaria_config', st.pizzariaConfig); }

      st.loaded = true;
      console.log('[pg] Carga inicial concluída');
      return;
    }

    // Supabase: load for single default tenant on startup (backward-compat)
    await loadTenantData('default');
  };

  const loadTenantData = async (tenantId: string) => {
    if (!db) return;
    const st = getState(tenantId);
    const room = 'tenant:' + tenantId;
    try {
      const [wRes, oRes, tRes, cRes, cfgRes, mRes, sRes, pfRes, pcRes, cfgPizRes] = await Promise.all([
        db.from('waiters').select('*').eq('tenant_id', tenantId),
        db.from('orders').select('*').eq('tenant_id', tenantId),
        db.from('tables').select('*').eq('tenant_id', tenantId).order('id'),
        db.from('comandas').select('*').eq('tenant_id', tenantId).order('id'),
        db.from('config').select('data').eq('id', `${tenantId}:app`).maybeSingle(),
        db.from('menu').select('*').eq('tenant_id', tenantId).order('position'),
        db.from('stock').select('*').eq('tenant_id', tenantId),
        db.from('pizza_flavors').select('*').eq('tenant_id', tenantId),
        db.from('pizza_crusts').select('*').eq('tenant_id', tenantId),
        db.from('config').select('data').eq('id', `${tenantId}:pizzaria`).maybeSingle(),
      ]);

      if (wRes.data) {
        st.waiters = wRes.data;
        io.to(room).emit('update_waiters', st.waiters);
      }

      const typeMap: Record<string, string> = {};
      MENU_CATEGORIES.forEach((c: any) => { typeMap[c.name] = c.type; });

      if (mRes.data?.length) {
        // Mapa de preços padrão por item id (garante que preços do constants.ts prevalecem sobre price:0 no DB)
        const defaultPriceMap = new Map<string, number>();
        MENU_CATEGORIES.forEach((cat: any) => {
          (cat.subcategories || []).forEach((sub: any) => {
            (sub.items || []).forEach((item: any) => { if (item.id && item.price) defaultPriceMap.set(item.id, item.price); });
          });
          (cat.items || []).forEach((item: any) => { if (item.id && item.price) defaultPriceMap.set(item.id, item.price); });
        });
        const fixItems = (items: any[]) => (items || []).map((item: any) => ({
          ...item,
          price: (!item.price || item.price === 0) && defaultPriceMap.has(item.id) ? defaultPriceMap.get(item.id) : item.price,
        }));
        st.menu = mRes.data.map((row: any) => ({
          ...row,
          type: row.type || typeMap[row.name] || (row.name.toLowerCase().includes('pizza') ? 'pizzas' : row.name.toLowerCase().includes('bebida') ? 'bebidas' : 'lanches'),
          visible: row.visible !== false,
          items: fixItems(row.items || []),
          subcategories: (row.subcategories || []).map((sub: any) => ({ ...sub, items: fixItems(sub.items || []) })),
        }));
        io.to(room).emit('update_menu', st.menu);
      } else {
        await db.from('menu').upsert(
          st.menu.map((cat: any, idx: number) => ({ id: `${tenantId}:${cat.name}`, name: cat.name, position: idx, type: cat.type, items: cat.items || [], subcategories: cat.subcategories || [], tenant_id: tenantId }))
        );
        console.log(`[supabase][${tenantId}] Menu inicial semeado`);
        io.to(room).emit('update_menu', st.menu);
      }

      if (oRes.data) {
        st.orders = oRes.data.map((r: any) => {
          const o = rowToOrder(r);
          if (o.items && st.menu.length > 0) {
            o.items = o.items.map((item: any) => {
              if (item.type === 'pizzas') return item;
              const cat = item.menuItemId
                ? st.menu.find((c: any) => c.items?.some((i: any) => i.id === item.menuItemId) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.id === item.menuItemId)))
                : st.menu.find((c: any) => c.items?.some((i: any) => i.name === item.name) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.name === item.name)));
              return cat?.type ? { ...item, type: cat.type } : item;
            });
          }
          return o;
        });
        io.to(room).emit('update_orders', st.orders);
      }

      if (tRes.data?.length) {
        tRes.data.map(rowToTable).forEach((dbTable: any) => {
          const idx = st.tables.findIndex(t => t.id === dbTable.id);
          if (idx !== -1) st.tables[idx] = { ...st.tables[idx], ...dbTable }; else st.tables.push(dbTable);
        });
        st.tables.sort((a, b) => a.id - b.id);
        io.to(room).emit('update_tables', st.tables);
      }

      if (cRes.data?.length) {
        cRes.data.map(rowToTable).forEach((dbC: any) => {
          const idx = st.comandas.findIndex(c => c.id === dbC.id);
          if (idx !== -1) st.comandas[idx] = { ...st.comandas[idx], ...dbC }; else st.comandas.push(dbC);
        });
        st.comandas.sort((a, b) => a.id - b.id);
        io.to(room).emit('update_comandas', st.comandas);
      }

      if (cfgRes.data?.data) {
        const cfg = cfgRes.data.data as any;
        st.isCashRegisterOpen = cfg.isCashRegisterOpen || false;
        if (cfg.dailyCounter !== undefined) st.dailyCounter = cfg.dailyCounter;
        if (cfg.lastOrderDate !== undefined) st.lastOrderDate = cfg.lastOrderDate;
        io.to(room).emit('update_cash_register', st.isCashRegisterOpen);
        io.to(room).emit('update_shift_started_at', st.shiftStartedAt);
      }

      if (sRes.data) {
        const allItems = sRes.data.map(rowToStock);
        if (st.menu.length > 0) {
          const trackedIds = new Set(st.menu.flatMap((c: any) => c.items || []).filter((i: any) => i.trackStock).map((i: any) => i.id));
          st.stock = allItems.filter((s: any) => trackedIds.has(s.menuItemId));
        } else { st.stock = allItems; }
        io.to(room).emit('update_stock', st.stock);
      }

      if (pfRes.data) { st.pizzaFlavors = pfRes.data.map((r: any) => ({ id: r.id, name: r.name, category: r.category, price: r.price, available: r.available })); io.to(room).emit('update_pizza_flavors', st.pizzaFlavors); }
      if (pcRes.data) { st.pizzaCrusts = pcRes.data.map((r: any) => r.name); io.to(room).emit('update_pizza_crusts', st.pizzaCrusts); }
      if (cfgPizRes.data?.data) { st.pizzariaConfig = { ...st.pizzariaConfig, ...(cfgPizRes.data.data as any) }; io.to(room).emit('update_pizzaria_config', st.pizzariaConfig); }

      st.loaded = true;
      console.log(`[supabase][${tenantId}] Carga concluída`);
    } catch (e) {
      console.error(`[supabase][${tenantId}] Erro na carga:`, e);
    }
  };

  // Trava por tenant: evita cargas paralelas do mesmo tenant
  const _loadingTenants = new Map<string, Promise<void>>();
  const loadTenantIfNeeded = (tenantId: string): Promise<void> => {
    const st = getState(tenantId);
    if (st.loaded || USE_POSTGRES) return Promise.resolve();
    if (_loadingTenants.has(tenantId)) return _loadingTenants.get(tenantId)!;
    const p = loadTenantData(tenantId).finally(() => _loadingTenants.delete(tenantId));
    _loadingTenants.set(tenantId, p);
    return p;
  };

  loadFromSupabase().then(() => seedBebidasSubcategories('default'));

  // ── Seed: subcategorias de bebidas ──────────────────────────────────────────
  const seedBebidasSubcategories = async (tenantId: string) => {
    const st = getState(tenantId);
    const menu = st.menu;
    const SUBCATS: { name: string; items: { name: string; price: number }[] }[] = [
      { name: 'Vinhos', items: [
        { name: 'Pérgola Tinto Suave — Garrafa', price: 65 },
        { name: 'Pérgola Tinto Suave — Taça', price: 18 },
      ]},
      { name: 'Doses e Destilados', items: [
        { name: 'Dose Black Label', price: 24 },
        { name: 'Dose Campari', price: 18 },
        { name: 'Dose Velho Barreiro', price: 8 },
        { name: 'Dose Vodka', price: 12 },
        { name: 'Dose Jack Daniels', price: 0 },
        { name: 'Dose Old Parr', price: 26 },
        { name: 'Dose Red Label', price: 22 },
        { name: 'Red Bull Energético', price: 17 },
      ]},
      { name: 'Refrigerantes', items: [
        { name: 'Coca-Cola 1 L', price: 12 },
        { name: 'Coca-Cola KS', price: 7 },
        { name: 'Coca-Cola Lata', price: 8 },
        { name: 'Coca-Cola Lata Zero', price: 8 },
        { name: 'Fanta 1 L', price: 12 },
        { name: 'Fanta Laranja KS', price: 7 },
        { name: 'Fanta Laranja Lata', price: 7 },
        { name: 'Fanta Uva Lata', price: 7 },
        { name: 'Guaraná Antarctica Lata', price: 7 },
        { name: 'H2O 500 ml', price: 10 },
        { name: 'Schweppes Lata', price: 7 },
        { name: 'Sprite Lata', price: 7 },
        { name: 'Torre de Refrigerante 1,5 L', price: 18 },
      ]},
      { name: 'Sucos — Copos', items: [
        { name: 'Abacaxi', price: 15 },
        { name: 'Abacaxi com Hortelã', price: 15 },
        { name: 'Acerola', price: 15 },
        { name: 'Cupuaçu', price: 16 },
        { name: 'Laranja', price: 18 },
        { name: 'Maracujá', price: 16 },
        { name: 'Morango', price: 15 },
      ]},
      { name: 'Sucos — Jarras', items: [
        { name: 'Abacaxi', price: 24 },
        { name: 'Abacaxi com Hortelã', price: 24 },
        { name: 'Acerola', price: 24 },
        { name: 'Cupuaçu', price: 26 },
        { name: 'Laranja', price: 33 },
        { name: 'Morango', price: 24 },
        { name: 'Maracujá', price: 26 },
      ]},
      { name: 'Outros Sucos', items: [
        { name: 'Suco Kapo', price: 7 },
      ]},
      { name: 'Cervejas', items: [
        { name: 'Antarctica Original', price: 18 },
        { name: 'Brahma', price: 14 },
        { name: 'Brahma Zero Lata', price: 7 },
        { name: 'CDB', price: 3 },
        { name: 'Corona 600 ml', price: 22 },
        { name: 'Heineken', price: 22 },
        { name: 'Skol', price: 14 },
      ]},
      { name: 'Cervejas Long Neck', items: [
        { name: 'Budweiser', price: 11 },
        { name: 'Budweiser Zero', price: 11 },
        { name: 'Corona Extra Long', price: 12 },
        { name: 'Heineken Long Neck', price: 12 },
        { name: 'Stella Gold', price: 12 },
      ]},
      { name: 'Chopp', items: [
        { name: 'Caneca Cozumel 340 ml', price: 12 },
        { name: 'Chopp 1,5 L', price: 42 },
        { name: 'Chopp 1 L', price: 30 },
        { name: 'Chopp 2,5 L', price: 80 },
        { name: 'Chopp Caneca 340 ml', price: 10 },
        { name: 'Tulipinha Chopp 250 ml', price: 9 },
        { name: 'Tulipinha Chopp Cozumel 250 ml', price: 10 },
      ]},
      { name: 'Águas', items: [
        { name: 'Água com Gás', price: 6 },
        { name: 'Água sem Gás', price: 5 },
        { name: 'Água Tônica', price: 7 },
      ]},
      { name: 'Outros Itens', items: [
        { name: 'Embalagem Grande', price: 5 },
        { name: 'Embalagem Pequena', price: 3 },
        { name: 'Meio Rodízio — 5 a 10 anos', price: 31 },
        { name: 'Play Kids', price: 12 },
        { name: 'Rodízio', price: 65 },
      ]},
    ];

    const bebidasIdx = menu.findIndex((c: any) => c.type === 'bebidas' || c.name?.toLowerCase().includes('bebida'));
    if (bebidasIdx === -1) { console.log('[seed-bebidas] Categoria bebidas não encontrada'); return; }

    const cat = menu[bebidasIdx];
    const existingSubNames = (cat.subcategories || []).map((s: any) => s.name);
    const toAdd = SUBCATS.filter(s => !existingSubNames.includes(s.name));
    if (toAdd.length === 0) { console.log('[seed-bebidas] Todas as subcategorias já existem, nada a fazer.'); return; }

    const newSubs = toAdd.map((s, pos) => ({
      id: randomUUID(),
      name: s.name,
      position: (cat.subcategories || []).length + pos,
      visible: true,
      trackTime: false,
      items: s.items.map(item => ({ id: randomUUID(), name: item.name, price: item.price, visible: true })),
    }));

    st.menu[bebidasIdx] = { ...cat, subcategories: [...(cat.subcategories || []), ...newSubs] };
    const { error } = await db.from('menu').upsert({ id: `${tenantId}:${cat.name}`, name: cat.name, position: bebidasIdx, type: 'bebidas', visible: true, items: st.menu[bebidasIdx].items || [], subcategories: st.menu[bebidasIdx].subcategories, tenant_id: tenantId });
    if (error) { console.error('[seed-bebidas] Erro ao salvar:', error.message); return; }
    io.to('tenant:' + tenantId).emit('update_menu', st.menu);
    console.log(`[seed-bebidas][${tenantId}] ${newSubs.length} subcategorias adicionadas à categoria bebidas.`);
  };

  // Daily order counter state
  const COUNTER_FILE = path.join(os.tmpdir(), 'sistema-pdv-flow-order-counter.json');
  let counterData = { dailyCounter: 0, lastOrderDate: "" };
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      counterData = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error("Error reading counter file", e);
  }

  // Legacy counter kept for PostgreSQL single-instance mode
  let _pgDailyCounter = counterData.dailyCounter;
  let _pgLastOrderDate = counterData.lastOrderDate;

  const saveCounter = (st: TenantState) => {
    try {
      fs.writeFileSync(COUNTER_FILE, JSON.stringify({ dailyCounter: st.dailyCounter, lastOrderDate: st.lastOrderDate }));
    } catch (e) {
      console.error("Error saving counter file", e);
    }
  };

  const generateOrderId = (st: TenantState, tenantId: string) => {
    const now = new Date();
    const dateStr = now.getDate().toString().padStart(2, '0') +
                    (now.getMonth() + 1).toString().padStart(2, '0') +
                    now.getFullYear().toString();
    if (dateStr !== st.lastOrderDate) {
      st.dailyCounter = 1;
      st.lastOrderDate = dateStr;
    } else {
      st.dailyCounter++;
    }
    if (USE_POSTGRES) saveCounter(st);
    saveToSupabase('config', { dailyCounter: st.dailyCounter, lastOrderDate: st.lastOrderDate }, 'app', tenantId).catch(() => {});
    return `${dateStr}${st.dailyCounter.toString().padStart(4, '0')}`;
  };

  // ── Sessões do cliente por mesa ────────────────────────────────
  const clientSessions = new Map<string, { token: string; lastActivity: number; isComanda: boolean }>();
  const generateClientToken = () => Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
  const activateClientSession = (mesaId: number | string, isComanda: boolean) => {
    const key = `${isComanda ? 'c' : 't'}:${mesaId}`;
    clientSessions.set(key, { token: generateClientToken(), lastActivity: Date.now(), isComanda });
  };
  const invalidateClientSession = (mesaId: number | string, isComanda: boolean) => {
    clientSessions.delete(`${isComanda ? 'c' : 't'}:${mesaId}`);
  };
  const getClientSession = (mesaId: number | string, isComanda: boolean) => {
    return clientSessions.get(`${isComanda ? 'c' : 't'}:${mesaId}`) || null;
  };
  setInterval(() => {
    const timeoutMin = (pizzariaConfig as any).clientSessionTimeoutMin ?? 0;
    if (timeoutMin <= 0) return;
    const now = Date.now();
    clientSessions.forEach((_session, key) => {
      const s = clientSessions.get(key)!;
      if (now - s.lastActivity > timeoutMin * 60 * 1000) clientSessions.delete(key);
    });
  }, 60_000);

  // â"€â"€ Local state backup â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const LOCAL_BACKUP_FILE = path.join(process.cwd(), 'data', 'local-state.json');
  let _backupTimer: ReturnType<typeof setTimeout> | null = null;

  const saveLocalBackup = (st?: TenantState) => {
    // Only used in PostgreSQL single-instance mode
    if (!USE_POSTGRES) return;
    const state = st || getState('default');
    if (_backupTimer) clearTimeout(_backupTimer);
    _backupTimer = setTimeout(() => {
      try {
        const dir = path.dirname(LOCAL_BACKUP_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(LOCAL_BACKUP_FILE, JSON.stringify({
          orders: state.orders, tables: state.tables, comandas: state.comandas,
          waiters: state.waiters, menu: state.menu, stock: state.stock, stockLog: state.stockLog,
          isCashRegisterOpen: state.isCashRegisterOpen, pizzariaConfig: state.pizzariaConfig,
          savedAt: new Date().toISOString()
        }), 'utf-8');
      } catch (e) {
        console.error('[backup] Erro ao salvar estado local:', e);
      }
    }, 800);
  };

  const loadLocalBackup = (): boolean => {
    if (!USE_POSTGRES) return false;
    try {
      if (!fs.existsSync(LOCAL_BACKUP_FILE)) return false;
      const state = JSON.parse(fs.readFileSync(LOCAL_BACKUP_FILE, 'utf-8'));
      const st = getState('default');
      if (state.orders?.length) st.orders = state.orders;
      if (state.tables?.length) state.tables.forEach((t: any) => {
        const idx = st.tables.findIndex((tt: any) => tt.id === t.id);
        if (idx !== -1) st.tables[idx] = { ...st.tables[idx], ...t };
      });
      if (state.comandas?.length) state.comandas.forEach((c: any) => {
        const idx = st.comandas.findIndex((cc: any) => cc.id === c.id);
        if (idx !== -1) st.comandas[idx] = { ...st.comandas[idx], ...c };
      });
      if (state.waiters?.length) st.waiters = state.waiters;
      if (state.menu?.length) st.menu = state.menu;
      if (state.stock?.length) st.stock = state.stock;
      if (state.stockLog?.length) st.stockLog = state.stockLog;
      if (state.isCashRegisterOpen !== undefined) st.isCashRegisterOpen = state.isCashRegisterOpen;
      if (state.pizzariaConfig) st.pizzariaConfig = { ...st.pizzariaConfig, ...state.pizzariaConfig };
      const age = state.savedAt ? Math.round((Date.now() - new Date(state.savedAt).getTime()) / 60000) : null;
      console.log(`[backup] Estado local restaurado (salvo ${age !== null ? `há ${age} min` : 'anteriormente'})`);
      return true;
    } catch (e) {
      console.error('[backup] Erro ao carregar estado local:', e);
      return false;
    }
  };

  if (USE_POSTGRES) { loadLocalBackup(); saveLocalBackup(); }

  const getEffectiveItemPrice = (item: any) => {
    let price = Number(item.price) || 0;
    if (item.discount) {
      if (item.discountType === 'percentage') {
        price *= (1 - Number(item.discount) / 100);
      } else {
        price = Math.max(0, price - Number(item.discount));
      }
    }
    return price;
  };

  const applyStockReduction = (st: TenantState, tenantId: string, items: any[]) => {
    const room = 'tenant:' + tenantId;
    const newEntries: any[] = [];
    items.forEach(item => {
      const qty = item.quantity || 1;
      const entry = st.stock.find((s: any) =>
        (item.menuItemId && s.menuItemId === item.menuItemId) || s.name === item.name
      );
      if (entry) {
        st.stock = st.stock.map((s: any) => {
          if (s.id === entry.id) {
            newEntries.push({ id: randomUUID(), itemName: s.name, change: -qty, reason: 'Venda', timestamp: new Date().toISOString() });
            return { ...s, quantity: Math.max(0, s.quantity - qty) };
          }
          return s;
        });
      }
    });
    if (newEntries.length > 0) {
      st.stockLog = [...newEntries, ...st.stockLog].slice(0, 100);
      io.to(room).emit("update_stock_log", st.stockLog);
    }
    io.to(room).emit("update_stock", st.stock);
  };

  const AGENT_SECRET = process.env.AGENT_SECRET || '';

  // ── Socket.io logic ───────────────────────────────────────────────────────
  // Em dev local (sem env vars de produção), todo socket é admin automaticamente
  const isDevMode = !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NODE_ENV !== 'production';

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Lê o tenant do query param da URL (?tenant=<id>) — usado por garçons e clientes
    const queryTenant = (socket.handshake.query?.tenant as string) || '';
    if (queryTenant) {
      (socket as any).tenantId = queryTenant;
      socket.join('tenant:' + queryTenant);
    }

    // In dev mode, assign a default tenantId so all events work without auth
    if (isDevMode) {
      (socket as any).isAdmin = true;
      (socket as any).tenantId = (socket as any).tenantId || 'default';
      socket.join('tenant:' + ((socket as any).tenantId || 'default'));
    }

    socket.on("admin_connect", async (token) => {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (!payload?.sub) { socket.emit("auth_error", { message: "Token inválido" }); return; }
        const tenantId: string = payload.sub;
        (socket as any).isAdmin = true;
        (socket as any).tenantId = tenantId;
        socket.join('tenant:' + tenantId);
        await loadTenantIfNeeded(tenantId);
        const st = getState(tenantId);
        socket.emit("init_data", {
          waiters: st.waiters, orders: st.orders, tables: st.tables, comandas: st.comandas,
          stock: st.stock, stockLog: st.stockLog, menu: st.menu,
          pizzaFlavors: st.pizzaFlavors, pizzaCrusts: st.pizzaCrusts, pizzaSizes: st.pizzaSizes,
          isCashRegisterOpen: st.isCashRegisterOpen, shiftStartedAt: st.shiftStartedAt,
          pizzariaConfig: st.pizzariaConfig, firebaseActive: !!db,
          printerAgentOnline: !!(st.printerAgentSocket?.connected), serverNow: new Date().toISOString(),
        });
        console.log(`Admin connected: ${payload.email} (tenant: ${tenantId})`);
      } catch (e) {
        console.error("Error in admin_connect", e);
        socket.emit("auth_error", { message: "Erro de autenticação" });
      }
    });

    // ── Registro do agente de impressão local ────────────────────────────────
    socket.on("printer_agent_register", ({ secret, tenantId: agentTenantId }: { secret?: string; pairingCode?: string; tenantId?: string }) => {
      if (AGENT_SECRET && secret !== AGENT_SECRET) {
        socket.emit("printer_agent_rejected", "Segredo inválido.");
        console.warn(`[agent] Tentativa de registro rejeitada (socket ${socket.id})`);
        return;
      }
      const tid = agentTenantId || (socket as any).tenantId || 'default';
      (socket as any).isPrinterAgent = true;
      (socket as any).tenantId = tid;
      const st = getState(tid);
      st.printerAgentSocket = socket;
      socket.emit("printer_agent_accepted");
      socket.emit("printer_agent_paired");
      io.to('tenant:' + tid).emit("printer_agent_status", { online: true });
      setTimeout(() => { if (st.printerAgentSocket) st.printerAgentSocket.emit("scan_printers_request"); }, 500);
      console.log(`[agent] Agente conectado: ${socket.id} (tenant: ${tid})`);
    });

    socket.on("disconnect", () => {
      const tenantId = (socket as any).tenantId || 'default';
      if ((socket as any).isPrinterAgent) {
        const st = getState(tenantId);
        st.printerAgentSocket = null;
        io.to('tenant:' + tenantId).emit("printer_agent_status", { online: false });
        console.log(`[agent] Agente desconectado (tenant: ${tenantId})`);
      }
      if (USE_POSTGRES) saveLocalBackup(getState('default'));
    });

    // Resultado de impressão enviado pelo agente → repassa ao tenant
    socket.on("printer_agent_result", (result: { success: boolean; ip: string; error?: string }) => {
      const tenantId = (socket as any).tenantId || 'default';
      io.to('tenant:' + tenantId).emit("print_result", result);
    });

    // Resultado do scan de rede enviado pelo agente → repassa ao dashboard
    socket.on("scan_printers_result", (data: { printers: { ip: string; port: number }[] }) => {
      const tenantId = (socket as any).tenantId || 'default';
      io.to('tenant:' + tenantId).emit("scan_printers_result", data);
    });

    // Per-socket tenant helpers
    const _tid = (): string => (socket as any).tenantId || 'default';
    const _st = (): TenantState => getState(_tid());
    const _room = (): string => 'tenant:' + _tid();

    const requireAdmin = (handler: (...args: any[]) => void) => {
      return (...args: any[]) => {
        if (!(socket as any).isAdmin) {
          socket.emit("error_message", "Acesso restrito ao administrador.");
          return;
        }
        handler(...args);
      };
    };

    // init_data is sent after admin_connect (with per-tenant state); skip here for non-dev
    if (isDevMode) {
      const defSt = getState('default');
      socket.emit("init_data", {
        waiters: defSt.waiters, orders: defSt.orders, tables: defSt.tables, comandas: defSt.comandas,
        stock: defSt.stock, stockLog: defSt.stockLog, menu: defSt.menu,
        pizzaFlavors: defSt.pizzaFlavors, pizzaCrusts: defSt.pizzaCrusts, pizzaSizes: defSt.pizzaSizes,
        isCashRegisterOpen: defSt.isCashRegisterOpen, shiftStartedAt: defSt.shiftStartedAt,
        pizzariaConfig: defSt.pizzariaConfig, firebaseActive: !!db,
        printerAgentOnline: !!(defSt.printerAgentSocket?.connected), serverNow: new Date().toISOString(),
      });
    }

    socket.on("request_init_data", () => {
      const st = _st();
      socket.emit("init_data", {
        waiters: st.waiters, orders: st.orders, tables: st.tables, comandas: st.comandas,
        stock: st.stock, stockLog: st.stockLog, menu: st.menu,
        pizzaFlavors: st.pizzaFlavors, pizzaCrusts: st.pizzaCrusts, pizzaSizes: st.pizzaSizes,
        isCashRegisterOpen: st.isCashRegisterOpen, shiftStartedAt: st.shiftStartedAt,
        pizzariaConfig: st.pizzariaConfig, firebaseActive: !!db,
        printerAgentOnline: !!(st.printerAgentSocket?.connected), serverNow: new Date().toISOString(),
      });
    });

    socket.on("update_pizzaria_config", requireAdmin((config) => {
      _st().pizzariaConfig = { ..._st().pizzariaConfig, ...config };
      io.to(_room()).emit("update_pizzaria_config", _st().pizzariaConfig);
      saveToSupabase('config', _st().pizzariaConfig, 'pizzaria', _tid()).catch(() => {});
    }));

    socket.on("deliver_item", ({ orderId, itemId }) => {
      const order = _st().orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;

      const now = new Date().toISOString();
      const durationMinutes = item.timestamp
        ? Math.round((new Date(now).getTime() - new Date(item.timestamp).getTime()) / 60000)
        : null;

      const waiter = _st().waiters.find((w: any) => w.id === (socket as any).waiterId);
      const waiterName = waiter?.name || (socket as any).waiterName || '';

      item.deliveredAt = now;
      item.deliveredBy = waiterName;

      if (!order.deliveryLog) order.deliveryLog = [];
      order.deliveryLog.push({
        itemId,
        itemName: item.name,
        orderedAt: item.timestamp || null,
        deliveredAt: now,
        durationMinutes,
        tableId: order.tableId,
        isComanda: order.isComanda || false,
        waiterName,
      });

      io.to(_room()).emit("update_orders", _st().orders);

      saveToSupabase('orders', order, String(orderId, _tid())).catch(() => {});
    });

    socket.on("kitchen_start_item", async ({ orderId, itemId }) => {
      const order = _st().orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;
      item.kitchenStatus = 'preparing';
      io.to(_room()).emit("update_orders", _st().orders);
      enqueueWrite('_st().orders', order, String(order.id));
    });

    socket.on("kitchen_oven_item", async ({ orderId, itemId }) => {
      const order = _st().orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;
      item.kitchenStatus = 'oven';
      io.to(_room()).emit("update_orders", _st().orders);
      enqueueWrite('_st().orders', order, String(order.id));
    });

    socket.on("kitchen_finish_item", async ({ orderId, itemId }) => {
      const order = _st().orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;
      item.kitchenStatus = 'ready';
      io.to(_room()).emit("update_orders", _st().orders);
      enqueueWrite('_st().orders', order, String(order.id));
    });

    socket.on("waiter_register", async (waiterData) => {
      // Garante que o tenant está carregado antes de registrar o garçom
      await loadTenantIfNeeded(_tid());
      // Find by CPF or Name/Phone combination if CPF is missing
      const existingWaiterIndex = _st().waiters.findIndex(w =>
        (waiterData.cpf && w.cpf === waiterData.cpf) ||
        (waiterData.name === w.name && waiterData.phone === w.phone)
      );
      
      const waiterId = waiterData.cpf || randomUUID();
      const waiter = { 
        ...waiterData, 
        id: waiterId,
        socketId: socket.id, 
        status: "pending" 
      };
      
      // Store waiter identity on the socket
      (socket as any).waiterId = waiterId;
      
      if (existingWaiterIndex !== -1) {
        _st().waiters[existingWaiterIndex] = { ..._st().waiters[existingWaiterIndex], ...waiter, status: _st().waiters[existingWaiterIndex].status };
      } else {
        _st().waiters.push(waiter);
      }

      io.to(_room()).emit("admin_notification", {
        type: "NEW_WAITER",
        data: waiter,
      });
      io.to(_room()).emit("update_waiters", _st().waiters);
    });

    socket.on("waiter_login", async ({ name, password }) => {
      await loadTenantIfNeeded(_tid());
      const waiter = _st().waiters.find(w => w.name === name && w.password === password);
      if (waiter) {
        waiter.socketId = socket.id;
        (socket as any).waiterId = waiter.id;
        (socket as any).waiterUid = waiter.uid;
        (socket as any).waiterCpf = waiter.cpf;
        (socket as any).waiterName = waiter.name;
        delete (socket as any)._pendingLogin;

        socket.emit("waiter_approved", { status: waiter.status });
        io.to(_room()).emit("update_waiters", _st().waiters);
      } else {
        socket.emit("error_message", "Nome ou senha incorretos. Verifique seus dados ou solicite um novo cadastro.");
      }
    });

    socket.on("toggle_cash_register", requireAdmin(async (isOpen) => {
      console.log(`Cash register toggle: ${isOpen}`);
      if (!isOpen) {
        const activeTables = _st().tables.find(t => t.status !== "free");
        const activeComandas = _st().comandas.find(c => c.status !== "free");
        if (activeTables || activeComandas) {
          socket.emit("error_message", "NÃ£o Ã© possÃ­vel fechar o caixa com mesas ou _st().comandas ocupadas.");
          return;
        }
      }
      if (isOpen) {
        markShiftStart(_st());
        io.to(_room()).emit('update_shift_started_at', _st().shiftStartedAt);
      }
      _st().isCashRegisterOpen = isOpen;
      io.to(_room()).emit("update_cash_register", _st().isCashRegisterOpen);
      await saveToSupabase('config', { isCashRegisterOpen: isOpen, updatedAt: new Date().toISOString(), ...(isOpen ? { shiftStartedAt: _st().shiftStartedAt } : {}) }, 'app', _tid());
    }));

    socket.on("toggle_waiter_status", requireAdmin(({ waiterId, status }) => {
      const waiter = _st().waiters.find((w) => w.id === waiterId || w.cpf === waiterId);
      if (waiter) {
        waiter.status = status;
        io.to(_room()).emit("update_waiters", _st().waiters);
        
        // Notify the waiter via ALL their connected sockets
        const connectedSockets = io.sockets.sockets;
        connectedSockets.forEach((s) => {
          if ((s as any).waiterId === waiter.id) {
            s.emit("waiter_status_changed", { status });
          }
        });
      }
    }));

    socket.on("remove_waiter", requireAdmin((waiterId: string) => {
      const idx = _st().waiters.findIndex((w) => w.id === waiterId || w.cpf === waiterId);
      if (idx === -1) return;
      const waiter = _st().waiters[idx];
      // Notifica o garçom para que encerre a sessão
      const connectedSockets = io.sockets.sockets;
      connectedSockets.forEach((s) => {
        if (
          (s as any).waiterId  === waiter.id  ||
          (s as any).waiterId  === waiter.cpf ||
          (s as any).waiterName === waiter.name
        ) {
          s.emit("waiter_status_changed", { status: "inactive" });
        }
      });
      _st().waiters.splice(idx, 1);
      io.to(_room()).emit("update_waiters", _st().waiters);
      saveLocalBackup(_st());
    }));

    socket.on("cleanup_test_data", requireAdmin(async ({ deleteWaiters, deleteData }: { deleteWaiters: boolean; deleteData: boolean }) => {
      const prefix = 'Garcom_Fogo_';
      if (deleteWaiters) {
        _st().waiters = _st().waiters.filter((w: any) => !w.name?.startsWith(prefix));
        io.to(_room()).emit('update_waiters', _st().waiters);
        if (USE_POSTGRES) void pgDeleteLike('_st().waiters', 'id', `${prefix}%`);
        else db?.from('_st().waiters').delete().like('name', `${prefix}%`).then(() => {}).catch(() => {});
      }
      if (deleteData) {
        // Remove itens lançados por garçons de teste de pedidos mistos; exclui pedidos inteiramente do teste
        _st().orders = _st().orders
          .map((o: any) => ({
            ...o,
            items: (o.items || []).filter((i: any) => !i.waiterName?.startsWith(prefix)),
          }))
          .filter((o: any) => {
            const isTestOrder = o.waiterName?.startsWith(prefix);
            const hasRealItems = (o.items || []).some((i: any) => !i.waiterName?.startsWith(prefix));
            return !isTestOrder || hasRealItems;
          });
        // Libera mesas sem pedido ativo
        _st().tables = _st().tables.map((t: any) => {
          const hasActive = _st().orders.some((o: any) => String(o.tableId) === String(t.id) && o.status !== 'finalizada');
          return hasActive ? t : { ...t, status: 'free', currentOrder: null };
        });
        _st().comandas = _st().comandas.map((c: any) => {
          const hasActive = _st().orders.some((o: any) => o.isComanda && String(o.tableId) === String(c.id) && o.status !== 'finalizada');
          return hasActive ? c : { ...c, status: 'free', currentOrder: null };
        });
        io.to(_room()).emit('update_orders', _st().orders);
        io.to(_room()).emit('update_tables', _st().tables);
        io.to(_room()).emit('update_comandas', _st().comandas);
        if (USE_POSTGRES) void pgDeleteOrdersByWaiterLike(`${prefix}%`);
        else db?.from('_st().orders').delete().like('waiter_name', `${prefix}%`).then(() => {}).catch(() => {});
      }
    }));

    socket.on("admin_approve_waiter", requireAdmin((waiterId) => {
      const waiter = _st().waiters.find((w) => w.id === waiterId || w.cpf === waiterId);
      if (waiter) {
        waiter.status = "approved";
        io.to(_room()).emit("update_waiters", _st().waiters);
        
        // Notifica o garÃ§om por todos os identificadores possÃ­veis
        const connectedSockets = io.sockets.sockets;
        connectedSockets.forEach((s) => {
          const matches =
            (s as any).waiterId   === waiter.id   ||
            (s as any).waiterId   === waiter.uid  ||
            (s as any).waiterId   === waiter.cpf  ||
            (s as any).waiterUid  === waiter.uid  ||
            (s as any).waiterCpf  === waiter.cpf  ||
            (s as any).waiterName === waiter.name;
          if (matches) s.emit("waiter_approved", { status: "approved", isNewApproval: true });
        });
      }
    }));

    socket.on("new_order", async (orderData) => {
      await loadTenantIfNeeded(_tid());
      console.log("New order request received:", orderData.tableId, orderData.isComanda ? "Comanda" : "Table");

      if (!_st().isCashRegisterOpen) {
        console.warn("Attempted order while register is closed");
        socket.emit("error_message", "O caixa estÃ¡ fechado. Abra o caixa para realizar pedidos.");
        return;
      }
      
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? _st().waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso estÃ¡ inativo. Entre em contato com o gerente.");
        return;
      }

      const isComanda = !!orderData.isComanda;
      const targetList = isComanda ? _st().comandas : _st().tables;
      let table = targetList.find(t => orderData.tableId && t.id && String(t.id) === String(orderData.tableId));
      
      // Handle linked _st().tables
      if (table && table.status === "linked" && table.linkedTo) {
        let currentTable = table;
        const visited = new Set([currentTable.id]);
        while (currentTable.status === "linked" && currentTable.linkedTo) {
          const nextTable = targetList.find(t => currentTable.linkedTo && t.id && String(t.id) === String(currentTable.linkedTo));
          if (!nextTable || visited.has(nextTable.id)) break;
          currentTable = nextTable;
          visited.add(currentTable.id);
        }
        table = currentTable;
      }

      const waiterName = orderData.waiterName || (waiter ? waiter.name : "Desconhecido");

      // Tag items with waiter name and resolve type from server _st().menu
      const orderCreatedAt = Date.now();
      const itemsWithWaiter = (orderData.items || []).map((item: any, idx: number) => {
        // Pizzas always keep type 'pizzas'; for other items resolve from server _st().menu
        let resolvedType = item.type;
        if (item.type !== 'pizzas') {
          const cat = item.menuItemId
            ? _st().menu.find((c: any) => c.items.some((i: any) => i.id === item.menuItemId) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.id === item.menuItemId)))
            : _st().menu.find((c: any) => c.items.some((i: any) => i.name === item.name) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.name === item.name)));
          if (cat?.type) resolvedType = cat.type;
        }
        return {
          ...item,
          type: resolvedType,
          id: item.id || Math.random().toString(36).substr(2, 9),
          waiterName: item.waiterName || waiterName,
          // Offset each item by its index so items in the same cart have unique timestamps
          timestamp: new Date(orderCreatedAt + idx).toISOString()
        };
      });

      if (table && table.status === "aguardando_baixa") {
        socket.emit("error_message", "Pedido aguardando baixa no caixa. NÃ£o Ã© possÃ­vel adicionar itens.");
        return;
      }

      if (table && (table.status === "occupied" || table.status === "bill_requested") && table.currentOrder) {
        console.log("Adding items to existing order:", table.currentOrder);
        const existingOrder = _st().orders.find(o => table.currentOrder && o.id && String(o.id) === String(table.currentOrder));
        if (existingOrder) {
          if (!existingOrder.items) existingOrder.items = [];
          existingOrder.items.push(...itemsWithWaiter);
          if (orderData.observations) {
            existingOrder.observations = existingOrder.observations 
              ? `${existingOrder.observations} | ${orderData.observations}` 
              : orderData.observations;
          }
          io.to(_room()).emit("update_orders", _st().orders);
          if (itemsWithWaiter.length > 0) {
            io.to(_room()).emit("kitchen_new_order", { items: itemsWithWaiter, tableId: existingOrder.tableId, isComanda: existingOrder.isComanda });
          }
          await saveToSupabase('orders', existingOrder, existingOrder.id.toString(), _tid());
          // Renovar sessão do cliente ao adicionar itens
          { const s = getClientSession(existingOrder.tableId, existingOrder.isComanda); if (s) s.lastActivity = Date.now(); else activateClientSession(existingOrder.tableId, existingOrder.isComanda); }
          console.log("Existing order updated and emitted");
          return;
        }
      }

      const newOrder = { 
        ...orderData, 
        items: itemsWithWaiter,
        id: generateOrderId(_st(), _tid()), 
        status: "pending", 
        timestamp: new Date().toISOString(),
        waiterName: waiterName,
        isComanda: isComanda
      };
      
      console.log("Created new order object:", newOrder.id);
      _st().orders.push(newOrder);
      // Ativar sessão do cliente ao criar nova comanda
      activateClientSession(newOrder.tableId, newOrder.isComanda ?? false);

      // Emit updates immediately for faster UI
      io.to(_room()).emit("update_orders", _st().orders);
      if (isComanda) {
        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
      } else {
        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
      }
      io.to(_room()).emit("update_stock", _st().stock);
      if ((newOrder.items || []).length > 0) {
        io.to(_room()).emit("kitchen_new_order", { items: newOrder.items, tableId: newOrder.tableId, isComanda: newOrder.isComanda });
      }
      
      console.log("Emitted initial updates for new order");
      
      saveToSupabase('orders', newOrder, newOrder.id, _tid());
      saveToSupabase('config', { dailyCounter: _st().dailyCounter, lastOrderDate: _st().lastOrderDate }, 'app', _tid());
      
      if (table) {
        const orderId = newOrder.id;
        const targetId = table.id;
        const collName = isComanda ? 'comandas' : 'tables';
        
        console.log("Updating table status to occupied for:", targetId);
        
        if (isComanda) {
          _st().comandas.forEach(c => {
            if (c.id === targetId || c.linkedTo === targetId) {
              c.status = c.id === targetId ? "occupied" : "linked";
              c.currentOrder = orderId;
              saveToSupabase(collName, c, c.id.toString(), _tid());
            }
          });
          io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        } else {
          _st().tables.forEach(t => {
            if (t.id === targetId || t.linkedTo === targetId) {
              t.status = t.id === targetId ? "occupied" : "linked";
              t.currentOrder = orderId;
              saveToSupabase(collName, t, t.id.toString(), _tid());
            }
          });
          io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        }
        
        console.log("Emitted final table updates for new order");
      }

      // Dynamic _st().stock reduction
      applyStockReduction(_st(), _tid(), orderData.items);
    });

    socket.on("update_product", requireAdmin(({ categoryName, productId, updatedData, subcategoryId }) => {
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        if (subcategoryId) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map((sub: any) =>
              sub.id === subcategoryId
                ? { ...sub, items: sub.items.map((item: any) => item.id === productId ? { ...item, ...updatedData } : item) }
                : sub
            ),
          };
        }
        return { ...cat, items: cat.items.map((item: any) => item.id === productId ? { ...item, ...updatedData } : item) };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());

      // Sincroniza o nome no estoque se o produto for renomeado
      if (updatedData.name) {
        const stockEntry = _st().stock.find((s: any) => s.menuItemId === productId);
        if (stockEntry) {
          _st().stock = _st().stock.map((s: any) =>
            s.menuItemId === productId ? { ...s, name: updatedData.name } : s
          );
          io.to(_room()).emit("update_stock", _st().stock);
          saveToSupabase('stock', _st().stock.find((s: any) => s.menuItemId === productId), productId).catch(() => {});
        }
      }
    }));

    socket.on("add_product", requireAdmin(({ categoryName, productData, subcategoryId }) => {
      const newItem = { id: randomUUID(), ...productData };
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        if (subcategoryId) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map((sub: any) =>
              sub.id === subcategoryId ? { ...sub, items: [...sub.items, newItem] } : sub
            ),
          };
        }
        return { ...cat, items: [...cat.items, newItem] };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("add_category", requireAdmin((categoryData) => {
      const validTypes = ['lanches', 'pizzas', 'bebidas', 'porcoes', 'lacarte'];
      const type = validTypes.includes(categoryData.type) ? categoryData.type : 'lanches';

      // Se for pizza, monta automaticamente subcategorias Com/Sem Borda com os tamanhos cadastrados
      let subcategories: any[] = [];
      if (type === 'pizzas') {
        const makeItems = (withBorder: boolean) =>
          _st().pizzaSizes.map((s, i) => ({
            id: `${withBorder ? 'cb' : 'sb'}${i + 1}_${Date.now()}`,
            name: `${s.name} ${withBorder ? 'com Borda' : 'sem Borda'}`,
            price: 0,
            ingredients: `${s.slices} fatias · ${s.dim} · ${s.people} · ${s.detail}`,
            visible: true,
          }));
        subcategories = [
          { id: randomUUID(), name: 'Com Borda', position: 0, visible: true, items: makeItems(true) },
          { id: randomUUID(), name: 'Sem Borda', position: 1, visible: true, items: makeItems(false) },
        ];
      }

      const newCategory = {
        name: categoryData.name,
        type,
        visible: true,
        trackTime: false,
        items: [],
        subcategories,
      };
      _st().menu.push(newCategory);
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("update_category", requireAdmin(({ oldName, updatedData }) => {
      _st().menu = _st().menu.map((cat: any) => cat.name === oldName ? { ...cat, ...updatedData } : cat);
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("toggle_category_visibility", requireAdmin(({ categoryName, visible }) => {
      _st().menu = _st().menu.map((cat: any) => cat.name === categoryName ? { ...cat, visible } : cat);
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("toggle_item_visibility", requireAdmin(({ categoryName, subcategoryId, itemId, visible }) => {
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        if (subcategoryId) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map((sub: any) =>
              sub.id === subcategoryId
                ? { ...sub, items: sub.items.map((i: any) => i.id === itemId ? { ...i, visible } : i) }
                : sub
            ),
          };
        }
        return { ...cat, items: (cat.items || []).map((i: any) => i.id === itemId ? { ...i, visible } : i) };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("delete_category", requireAdmin((categoryName) => {
      _st().menu = _st().menu.filter((cat: any) => cat.name !== categoryName);
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("add_subcategory", requireAdmin(({ categoryName, subcategoryData }) => {
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        const newSub = {
          id: randomUUID(),
          name: subcategoryData.name,
          position: (cat.subcategories || []).length,
          visible: true,
          trackTime: false,
          items: [],
        };
        return { ...cat, subcategories: [...(cat.subcategories || []), newSub] };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("update_subcategory", requireAdmin(({ categoryName, subcategoryId, updatedData }) => {
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        return {
          ...cat,
          subcategories: (cat.subcategories || []).map((sub: any) =>
            sub.id === subcategoryId ? { ...sub, ...updatedData } : sub
          ),
        };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("delete_subcategory", requireAdmin(({ categoryName, subcategoryId }) => {
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        return { ...cat, subcategories: (cat.subcategories || []).filter((sub: any) => sub.id !== subcategoryId) };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("delete_product", requireAdmin(({ categoryName, productId, subcategoryId }) => {
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        if (subcategoryId) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map((sub: any) =>
              sub.id === subcategoryId ? { ...sub, items: sub.items.filter((i: any) => i.id !== productId) } : sub
            ),
          };
        }
        return { ...cat, items: cat.items.filter((item: any) => item.id !== productId) };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("toggle_stock_tracking", requireAdmin(({ menuItemId, categoryName, subcategoryId, enabled }) => {
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name === categoryName) {
          if (subcategoryId) {
            return {
              ...cat,
              subcategories: (cat.subcategories || []).map((sub: any) =>
                sub.id === subcategoryId
                  ? { ...sub, items: sub.items.map((item: any) => item.id === menuItemId ? { ...item, trackStock: enabled } : item) }
                  : sub
              ),
            };
          }
          return {
            ...cat,
            items: cat.items.map((item: any) =>
              item.id === menuItemId ? { ...item, trackStock: enabled } : item
            ),
          };
        }
        return cat;
      });

      if (enabled) {
        const allItems = _st().menu.flatMap((c: any) => [...c.items, ...(c.subcategories || []).flatMap((s: any) => s.items)]);
        const menuItem = allItems.find((i: any) => i.id === menuItemId);
        if (menuItem && !_st().stock.find((s: any) => s.menuItemId === menuItemId)) {
          _st().stock.push({
            id: menuItemId,
            menuItemId,
            name: menuItem.name,
            quantity: 0,
            unit: 'un',
            minQuantity: 0,
          });
        }
      } else {
        _st().stock = _st().stock.filter((s: any) => s.menuItemId !== menuItemId);
        _st().stockLog = _st().stockLog.filter((l: any) => {
          const entry = _st().stock.find((s: any) => s.menuItemId === menuItemId);
          return entry ? l.itemName !== entry.name : true;
        });
      }

      io.to(_room()).emit("update_menu", _st().menu);
      io.to(_room()).emit("update_stock", _st().stock);
      io.to(_room()).emit("update_stock_log", _st().stockLog);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("update_stock_item", requireAdmin(({ menuItemId, quantity, minQuantity, unit, reason }) => {
      const prev = _st().stock.find((s: any) => (s.menuItemId ?? s.id) === menuItemId);
      if (!prev) return;
      const prevQty = prev.quantity ?? 0;
      _st().stock = _st().stock.map((s: any) =>
        (s.menuItemId ?? s.id) === menuItemId
          ? { ...s, quantity, minQuantity, unit: unit || s.unit }
          : s
      );
      if (quantity !== prevQty) {
        const change = quantity - prevQty;
        const defaultReason = change > 0 ? 'Entrada manual' : 'Ajuste manual';
        _st().stockLog = [{
          id: randomUUID(),
          itemName: prev.name,
          change,
          reason: (reason && String(reason).trim()) ? String(reason).trim() : defaultReason,
          timestamp: new Date().toISOString(),
        }, ..._st().stockLog].slice(0, 100);
        io.to(_room()).emit("update_stock_log", _st().stockLog);
      }
      io.to(_room()).emit("update_stock", _st().stock);
    }));

    socket.on("update_pizza_flavor", requireAdmin(({ flavorName, updatedData }) => {
      _st().pizzaFlavors = _st().pizzaFlavors.map(f => {
        if (f.name === flavorName) {
          return { ...f, ...updatedData };
        }
        return f;
      });
      io.to(_room()).emit("update_pizza_flavors", _st().pizzaFlavors);
    }));

    socket.on("add_pizza_flavor", requireAdmin((flavorData) => {
      _st().pizzaFlavors.push(flavorData);
      io.to(_room()).emit("update_pizza_flavors", _st().pizzaFlavors);
    }));

    socket.on("delete_pizza_flavor", requireAdmin((flavorName) => {
      _st().pizzaFlavors = _st().pizzaFlavors.filter(f => f.name !== flavorName);
      io.to(_room()).emit("update_pizza_flavors", _st().pizzaFlavors);
    }));

    socket.on("update_pizza_crust", requireAdmin(({ oldName, newName }) => {
      _st().pizzaCrusts = _st().pizzaCrusts.map(c => c === oldName ? newName : c);
      io.to(_room()).emit("update_pizza_crusts", _st().pizzaCrusts);
    }));

    socket.on("add_pizza_crust", requireAdmin((crustName) => {
      _st().pizzaCrusts.push(crustName);
      io.to(_room()).emit("update_pizza_crusts", _st().pizzaCrusts);
    }));

    socket.on("delete_pizza_crust", requireAdmin((crustName) => {
      _st().pizzaCrusts = _st().pizzaCrusts.filter(c => c !== crustName);
      io.to(_room()).emit("update_pizza_crusts", _st().pizzaCrusts);
    }));

    socket.on("add_pizza_size", requireAdmin((sizeData) => {
      _st().pizzaSizes.push(sizeData);
      io.to(_room()).emit("update_pizza_sizes", _st().pizzaSizes);
    }));

    socket.on("update_pizza_size", requireAdmin(({ index, updatedData }) => {
      if (index >= 0 && index < _st().pizzaSizes.length) {
        _st().pizzaSizes[index] = { ..._st().pizzaSizes[index], ...updatedData };
        io.to(_room()).emit("update_pizza_sizes", _st().pizzaSizes);
      }
    }));

    socket.on("delete_pizza_size", requireAdmin((index) => {
      if (index >= 0 && index < _st().pizzaSizes.length) {
        _st().pizzaSizes.splice(index, 1);
        io.to(_room()).emit("update_pizza_sizes", _st().pizzaSizes);
      }
    }));

    socket.on("reorder_pizza_sizes", requireAdmin((newOrder: any[]) => {
      _st().pizzaSizes = newOrder;
      io.to(_room()).emit("update_pizza_sizes", _st().pizzaSizes);
    }));

    socket.on("bulk_import", requireAdmin(async ({ menu: importedMenu, stock: importedStock, pizzaFlavors: impFlavors, pizzaCrusts: impCrusts, pizzariaConfig: impPizConfig, stockLog: impStockLog }) => {
      if (importedMenu && Array.isArray(importedMenu)) {
        _st().menu = importedMenu;
        io.to(_room()).emit("update_menu", _st().menu);
        if (USE_POSTGRES) { await pgDeleteMenu(); saveMenuToSupabase(_st(), _tid()); }
        else if (db) {
          try { await db.from('_st().menu').delete().neq('id', ''); } catch {}
          saveMenuToSupabase(_st(), _tid());
        }
      }
      if (importedStock && Array.isArray(importedStock)) {
        _st().stock = importedStock;
        io.to(_room()).emit("update_stock", _st().stock);
        if (impStockLog && Array.isArray(impStockLog)) {
          _st().stockLog = impStockLog;
        } else {
          _st().stockLog = [];
        }
        io.to(_room()).emit("update_stock_log", _st().stockLog);
      }
      if (impFlavors && Array.isArray(impFlavors)) {
        _st().pizzaFlavors = impFlavors;
        io.to(_room()).emit("update_pizza_flavors", _st().pizzaFlavors);
        if (USE_POSTGRES) { for (const f of _st().pizzaFlavors) await pgSave('_st().pizzaFlavors', f); }
        else if (db) {
          try {
            await db.from('pizza_flavors').delete().neq('id', '');
            for (const f of _st().pizzaFlavors) {
              await db.from('pizza_flavors').upsert({ id: f.name, name: f.name, category: f.category || null, price: f.price || null, available: f.available !== false });
            }
          } catch {}
        }
      }
      if (impCrusts && Array.isArray(impCrusts)) {
        _st().pizzaCrusts = impCrusts;
        io.to(_room()).emit("update_pizza_crusts", _st().pizzaCrusts);
        if (USE_POSTGRES) { for (const c of _st().pizzaCrusts) await pgSave('_st().pizzaCrusts', { name: c }, c); }
        else if (db) {
          try {
            await db.from('pizza_crusts').delete().neq('id', '');
            for (const c of _st().pizzaCrusts) {
              await db.from('pizza_crusts').upsert({ id: c, name: c });
            }
          } catch {}
        }
      }
      if (impPizConfig && typeof impPizConfig === 'object') {
        _st().pizzariaConfig = { ..._st().pizzariaConfig, ...impPizConfig, kdsEnabled: false };
        io.to(_room()).emit("update_pizzaria_config", _st().pizzariaConfig);
        saveToSupabase('config', _st().pizzariaConfig, 'pizzaria').catch(() => {});
      }
      socket.emit("import_complete", {
        menuCategories: importedMenu?.length ?? 0,
        stockItems: importedStock?.length ?? 0,
        flavors: impFlavors?.length ?? 0,
        crusts: impCrusts?.length ?? 0,
      });
    }));

    socket.on("add_item_to_order", async ({ orderId, item }) => {
      await loadTenantIfNeeded(_tid());
      if (!_st().isCashRegisterOpen) {
        socket.emit("error_message", "O caixa estÃ¡ fechado. Abra o caixa para adicionar itens.");
        return;
      }

      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? _st().waiters.find(w => w.id === waiterId) : null;

      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso estÃ¡ inativo. Entre em contato com o gerente.");
        return;
      }

      const order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        if (order.status === "aguardando_baixa") {
          socket.emit("error_message", "Pedido aguardando baixa no caixa. NÃ£o Ã© possÃ­vel adicionar itens.");
          return;
        }
        const resolvedWaiterName = waiter?.name || (socket as any).waiterName || item.waiterName || 'Desconhecido';
        // Resolve type from server _st().menu for non-pizza items
        let resolvedType = item.type;
        if (item.type !== 'pizzas') {
          const cat = item.menuItemId
            ? _st().menu.find((c: any) => c.items.some((i: any) => i.id === item.menuItemId) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.id === item.menuItemId)))
            : _st().menu.find((c: any) => c.items.some((i: any) => i.name === item.name) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.name === item.name)));
          if (cat?.type) resolvedType = cat.type;
        }
        const itemWithTimestamp = { ...item, type: resolvedType, waiterName: resolvedWaiterName, timestamp: new Date().toISOString() };
        if (!order.items) order.items = [];
        order.items.push(itemWithTimestamp);

        // Emit immediately for fast UI
        io.to(_room()).emit("update_orders", _st().orders);
        io.to(_room()).emit("kitchen_new_order", { items: [itemWithTimestamp], tableId: order.tableId, isComanda: order.isComanda });

        // Non-blocking: respond to socket immediately, persist in background
        enqueueWrite('_st().orders', order, String(order.id));

        // Update _st().stock for the added item
        applyStockReduction(_st(), _tid(), [itemWithTimestamp]);
      }
    });

    socket.on("set_order_guests", async ({ orderId, guests }: { orderId: any, guests: string[] }) => {
      const order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order && Array.isArray(guests)) {
        (order as any).guests = guests;
        io.to(_room()).emit("update_orders", _st().orders);
        enqueueWrite('_st().orders', order, String(order.id));
      }
    });

    socket.on("set_item_guest", async ({ orderId, itemId, guestName }: { orderId: any, itemId: string, guestName: string | null }) => {
      const order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        const item = (order.items || []).find((i: any) => i.id === itemId);
        if (item) {
          (item as any).guestName = guestName || undefined;
          io.to(_room()).emit("update_orders", _st().orders);
          enqueueWrite('_st().orders', order, String(order.id));
        }
      }
    });

    socket.on("remove_item", async ({ orderId, itemId, quantity, reason, removedBy }) => {
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? _st().waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso estÃ¡ inativo. Entre em contato com o gerente.");
        return;
      }

      const order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        const hasPartialPayment = (order.paymentLog || []).some((p: any) => p.type === 'partial');
        if (hasPartialPayment) {
          socket.emit("error_message", "NÃ£o Ã© possÃ­vel remover itens de uma comanda com pagamento parcial registrado.");
          return;
        }
        const itemIndex = order.items.findIndex(i => String(i.id) === String(itemId));
        if (itemIndex !== -1) {
          const item = order.items[itemIndex];
          const removeQty = quantity || item.quantity || 1;
          const currentQty = item.quantity || 1;

          if (removeQty < currentQty) {
            const unitPrice = item.price / currentQty;
            const removedItem = {
              ...item,
              id: randomUUID(),
              quantity: removeQty,
              price: unitPrice * removeQty,
              removed: true,
              removedBy: removedBy || (waiter ? waiter.name : "Desconhecido"),
              removalReason: reason || ""
            };
            item.quantity = currentQty - removeQty;
            item.price = unitPrice * (currentQty - removeQty);
            order.items.push(removedItem);
          } else {
            item.removed = true;
            item.removedBy = removedBy || (waiter ? waiter.name : "Desconhecido"),
            item.removalReason = reason || "";
          }
          enqueueWrite('_st().orders', order, String(order.id));
          io.to(_room()).emit("update_orders", _st().orders);
        }
      }
    });

    socket.on("pay_items", async ({ orderId, selectedItems, partialAmount, paymentMethod, payerName, fromAdmin }) => {
      const order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        console.log(`Processing payment for order ${orderId}. Partial: ${partialAmount}`);
        if (!order.paymentLog) order.paymentLog = [];
        
        const itemIds = Object.keys(selectedItems || {});
        const isPartialOnly = itemIds.length === 0;
        const numericPartialAmount = partialAmount !== undefined ? Number(partialAmount) : 0;

        if (isPartialOnly && numericPartialAmount > 0) {
          const payment: any = {
            amount: numericPartialAmount,
            method: paymentMethod || "NÃ£o informado",
            timestamp: new Date().toISOString(),
            type: 'partial' as const
          };
          if (payerName && typeof payerName === 'string') payment.payer = payerName.trim();
          order.paymentLog.push(payment);
        } else if (itemIds.length > 0) {
          const activeItemsForTotal = (order.items || []).filter(i => !i.removed);
          const selectedItemsTotal = activeItemsForTotal
            .filter(i => selectedItems[i.id] !== undefined)
            .reduce((acc, i) => {
              const qty = Number(selectedItems[i.id]);
              const price = getEffectiveItemPrice(i);
              const unitPrice = price / (i.quantity || 1);
              return acc + (unitPrice * qty);
            }, 0);

          const actualAmountPaid = partialAmount !== undefined ? Number(partialAmount) : selectedItemsTotal;

          const itemPayment: any = {
            amount: actualAmountPaid,
            method: paymentMethod || "NÃ£o informado",
            timestamp: new Date().toISOString(),
            type: 'items'
          };
          if (payerName && typeof payerName === 'string') itemPayment.payer = payerName.trim();
          order.paymentLog.push(itemPayment);
          
          itemIds.forEach(itemId => {
            const itemIndex = order.items.findIndex(i => String(i.id) === String(itemId));
            if (itemIndex !== -1) {
              const item = order.items[itemIndex];
              const payQty = Number(selectedItems[itemId] || 0);
              const currentQty = Number(item.quantity) || 1;

              if (payQty > 0 && payQty < currentQty) {
                const unitPrice = Number(item.price) / currentQty;
                const paidItem = {
                  ...item,
                  id: randomUUID(),
                  quantity: payQty,
                  price: unitPrice * payQty,
                  paid: true
                };
                item.quantity = currentQty - payQty;
                item.price = unitPrice * (currentQty - payQty);
                order.items.push(paidItem);
              } else {
                item.paid = true;
              }
            }
          });
        }

        // Check total paid from paymentLog
        const totalPaid = (order.paymentLog || []).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

        // Calculate final total with item-level discounts AND order-level discount
        const totalItemsPrice = (order.items || []).filter(i => !i.removed).reduce((acc, i) => acc + getEffectiveItemPrice(i), 0);

        let finalTotal = totalItemsPrice;
        if (order.discount) {
          const dVal = Number(order.discount) || 0;
          if (order.discountType === 'percentage') finalTotal *= (1 - dVal / 100);
          else finalTotal = Math.max(0, finalTotal - dVal);
        }
        
        // Use rounding to avoid floating point issues
        const roundedTotalPaid = Math.round(totalPaid * 100) / 100;
        const roundedFinalTotal = Math.round(finalTotal * 100) / 100;

        console.log(`Order ${orderId}: ItemsTotal: ${totalItemsPrice.toFixed(2)}, FinalTotal: ${roundedFinalTotal.toFixed(2)}, PaidSoFar: ${roundedTotalPaid.toFixed(2)}`);

        // Use a clearer epsilon comparison (allow for small rounding differences)
        const IS_FULLY_PAID = roundedTotalPaid >= (roundedFinalTotal - 0.1);

        if (IS_FULLY_PAID) {
          if (fromAdmin) {
            // Pagamento via ADM: libera mesa imediatamente sem passar por aguardando_baixa
            console.log(`Order ${orderId} fully paid via admin. Freeing _st().tables directly.`);
            order.status = "finalizada";

            const entitiesToUpdate: any[] = [];
            _st().tables.forEach((t: any) => {
              if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
                t.status = "free";
                t.currentOrder = null;
                t.linkedTo = null;
                entitiesToUpdate.push({ entity: t, collection: '_st().tables' });
              }
            });
            _st().comandas.forEach((c: any) => {
              if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
                c.status = "free";
                c.currentOrder = null;
                c.linkedTo = null;
                entitiesToUpdate.push({ entity: c, collection: '_st().comandas' });
              }
            });

            io.to(_room()).emit("update_orders", _st().orders);
            io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
            await saveToSupabase('orders', order, String(order.id, _tid()));
            for (const item of entitiesToUpdate) {
              await saveToSupabase(item.collection, item.entity, String(item.entity.id, _tid()));
            }
            return;
          } else {
            // Pagamento via GarÃ§om: aguarda baixa para liberar mesa
            console.log(`Order ${orderId} fully paid. Setting aguardando_baixa.`);
            order.status = "aguardando_baixa";

            _st().tables.forEach(t => {
              if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
                t.status = "aguardando_baixa";
                saveToSupabase('tables', t, String(t.id, _tid())).catch(() => {});
              }
            });
            _st().comandas.forEach(c => {
              if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
                c.status = "aguardando_baixa";
                saveToSupabase('comandas', c, String(c.id, _tid())).catch(() => {});
              }
            });
          }
        }

        // Emit updates IMMEDIATELY for UI responsiveness
        io.to(_room()).emit("update_orders", _st().orders);
        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        
        await saveToSupabase('orders', order, String(order.id, _tid()));
      }
    });

    socket.on("link_tables", requireAdmin(async ({ sourceTableId, targetTableId, isComanda }) => {
      const targetList = isComanda ? _st().comandas : _st().tables;
      const sourceTable = targetList.find(t => String(t.id) === String(sourceTableId));
      let targetTable = targetList.find(t => String(t.id) === String(targetTableId));

      if (sourceTable && targetTable) {
        // Find ultimate target if the target is already linked
        const visited = new Set([String(sourceTable.id), String(targetTable.id)]);
        while (targetTable.status === "linked" && targetTable.linkedTo) {
          const nextTable = targetList.find(t => String(t.id) === String(targetTable.linkedTo));
          if (!nextTable || visited.has(String(nextTable.id))) break;
          targetTable = nextTable;
          visited.add(String(targetTable.id));
        }
        const finalTargetTableId = targetTable.id;

        // If source has an order, transfer items to target
        if (sourceTable.currentOrder) {
          const sourceOrder = _st().orders.find(o => String(o.id) === String(sourceTable.currentOrder));
          if (sourceOrder) {
            if (targetTable.currentOrder) {
              const targetOrder = _st().orders.find(o => String(o.id) === String(targetTable.currentOrder));
              if (targetOrder) {
                // Merge items preserving paid flags
                targetOrder.items.push(...sourceOrder.items);

                // Merge paymentLog so partial payments from source are preserved
                // in the pending amount calculation of the unified order
                if (sourceOrder.paymentLog && sourceOrder.paymentLog.length > 0) {
                  if (!targetOrder.paymentLog) targetOrder.paymentLog = [];
                  targetOrder.paymentLog.push(...sourceOrder.paymentLog);
                }

                // Carry over source discount to target only if target has none
                if (sourceOrder.discount && !targetOrder.discount) {
                  targetOrder.discount = sourceOrder.discount;
                  targetOrder.discountType = sourceOrder.discountType;
                }

                sourceOrder.status = "finalizada";
              }
            } else {
              sourceOrder.tableId = finalTargetTableId;
              targetTable.currentOrder = sourceOrder.id;
              targetTable.status = "occupied";
            }
          }
        }

        sourceTable.status = "linked";
        sourceTable.linkedTo = finalTargetTableId;
        sourceTable.currentOrder = targetTable.currentOrder;

        // Update all _st().tables and _st().comandas that were linked to source to now point to ultimateTarget
        const updateLinked = (t) => {
          if (String(t.linkedTo) === String(sourceTable.id)) {
            t.linkedTo = finalTargetTableId;
            t.currentOrder = targetTable.currentOrder;
          }
        };
        if (isComanda) {
          _st().comandas.forEach(updateLinked);
        } else {
          _st().tables.forEach(updateLinked);
        }

        // Persist changes to Firestore
        const tableCol = isComanda ? '_st().comandas' : '_st().tables';
        await saveToSupabase(tableCol, sourceTable, sourceTable.id.toString(), _tid());
        await saveToSupabase(tableCol, targetTable, targetTable.id.toString(), _tid());
        
        if (targetTable.currentOrder) {
          const tOrder = _st().orders.find(o => o.id.toString() === targetTable.currentOrder.toString());
          if (tOrder) await saveToSupabase('orders', tOrder, tOrder.id.toString(), _tid());
        }

        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        io.to(_room()).emit("update_orders", _st().orders);
      }
    }));

    socket.on("transfer_table", async ({ sourceTableId, targetTableId, isComanda, reason }) => {
      const targetList = isComanda ? _st().comandas : _st().tables;
      const sourceTable = targetList.find(t => String(t.id) === String(sourceTableId));
      const targetTable = targetList.find(t => String(t.id) === String(targetTableId));

      if (sourceTable && targetTable && sourceTable.currentOrder) {
        const sourceOrder = _st().orders.find(o => String(o.id) === String(sourceTable.currentOrder));
        const targetOrder = targetTable.currentOrder ? _st().orders.find(o => String(o.id) === String(targetTable.currentOrder)) : null;

        if (sourceOrder) {
          if (targetOrder) {
            // Merge items
            sourceOrder.items.forEach(item => {
              targetOrder.items.push({
                ...item,
                id: randomUUID(),
                transferReason: reason || "Troca de mesa"
              });
            });
            // Merge observations
            if (sourceOrder.observations) {
              targetOrder.observations = targetOrder.observations 
                ? `${targetOrder.observations} | ${sourceOrder.observations}`
                : sourceOrder.observations;
            }
            // Remove source order
            const sourceOrderIndex = _st().orders.findIndex(o => String(o.id) === String(sourceOrder.id));
            if (sourceOrderIndex !== -1) _st().orders.splice(sourceOrderIndex, 1);
          } else {
            // Simple transfer
            sourceOrder.tableId = targetTableId;
            targetTable.currentOrder = sourceOrder.id;
            targetTable.status = sourceTable.status === "linked" ? "occupied" : sourceTable.status;
          }
          
          // Update any _st().tables/_st().comandas linked to the source table to point to the target table
          const updateLinked = (t) => {
            if (String(t.linkedTo) === String(sourceTableId)) {
              t.linkedTo = targetTableId;
              t.currentOrder = targetTable.currentOrder;
            }
          };
          if (isComanda) {
            _st().comandas.forEach(updateLinked);
          } else {
            _st().tables.forEach(updateLinked);
          }

          sourceTable.currentOrder = null;
          sourceTable.status = "free";
          sourceTable.linkedTo = null;

          // Persist changes
          await saveToSupabase(isComanda ? 'comandas' : '_st().tables', sourceTable, sourceTable.id.toString());
          await saveToSupabase(isComanda ? 'comandas' : '_st().tables', targetTable, targetTable.id.toString());
          if (sourceOrder) await saveToSupabase('orders', sourceOrder, sourceOrder.id, _tid());
          if (targetOrder) await saveToSupabase('orders', targetOrder, targetOrder.id, _tid());
        }

        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        io.to(_room()).emit("update_orders", _st().orders);
      }
    });

    socket.on("transfer_items", async ({ sourceTableId, targetTableId, isComanda, itemIds }) => {
      console.log(`[transfer_items] src=${sourceTableId} dst=${targetTableId} isComanda=${isComanda} itemIds=${JSON.stringify(itemIds)}`);

      const tableList = isComanda ? _st().comandas : _st().tables;
      const sourceTable = tableList.find(t => String(t.id) === String(sourceTableId));
      const targetTable = tableList.find(t => String(t.id) === String(targetTableId));

      if (!sourceTable || !targetTable) {
        console.warn(`[transfer_items] table not found: src=${!!sourceTable} dst=${!!targetTable}`);
        return;
      }
      if (!sourceTable.currentOrder) {
        console.warn(`[transfer_items] sourceTable has no currentOrder`);
        return;
      }

      const sourceOrder = _st().orders.find(o => String(o.id) === String(sourceTable.currentOrder));
      if (!sourceOrder) {
        console.warn(`[transfer_items] sourceOrder not found for id=${sourceTable.currentOrder}`);
        return;
      }

      const hasPartialPayment = (sourceOrder.paymentLog || []).some((p: any) => p.type === 'partial');
      if (hasPartialPayment) {
        socket.emit("error_message", "NÃ£o Ã© possÃ­vel transferir itens: a mesa possui pagamento parcial registrado.");
        return;
      }

      const itemIdSet = new Set((itemIds || []).map(String));
      console.log(`[transfer_items] itemIdSet=${JSON.stringify([...itemIdSet])}`);
      console.log(`[transfer_items] sourceOrder.items ids=${JSON.stringify(sourceOrder.items.map((i: any) => ({ id: i.id, removed: i.removed, paid: i.paid })))}`);

      // Reject if any of the requested items are already paid
      const paidRequested = sourceOrder.items.filter(
        (i: any) => itemIdSet.has(String(i.id)) && i.paid
      );
      if (paidRequested.length > 0) {
        socket.emit("error_message", "NÃ£o Ã© possÃ­vel transferir item(s) jÃ¡ pagos.");
        return;
      }

      // Collect items BEFORE any mutation (excludes removed and paid)
      const itemsToTransfer = sourceOrder.items.filter(
        (i: any) => itemIdSet.has(String(i.id)) && !i.removed && !i.paid
      );
      if (itemsToTransfer.length === 0) {
        console.warn(`[transfer_items] itemsToTransfer is empty â€" no matching active items found`);
        return;
      }
      console.log(`[transfer_items] itemsToTransfer.length=${itemsToTransfer.length}`);

      // Find or create target order â€" ignore finalized _st().orders (items would be invisible)
      let targetOrder: any = targetTable.currentOrder
        ? _st().orders.find(o => String(o.id) === String(targetTable.currentOrder) && o.status !== 'finalizada')
        : null;

      if (!targetOrder) {
        targetOrder = {
          id: generateOrderId(_st(), _tid()),
          tableId: Number(targetTableId),
          isComanda: !!isComanda,
          status: 'pending',
          items: [],
          timestamp: new Date().toISOString(),
          paymentLog: [],
          waiterName: sourceOrder.waiterName || 'TransferÃªncia'
        };
        _st().orders.push(targetOrder);
        targetTable.currentOrder = targetOrder.id;
        targetTable.status = 'occupied';
        console.log(`[transfer_items] created new targetOrder id=${targetOrder.id}`);
      } else {
        console.log(`[transfer_items] reusing existing targetOrder id=${targetOrder.id}`);
      }

      const tableCol = isComanda ? '_st().comandas' : '_st().tables';

      // Mark each source item as removed, then deep-copy a clean version to target
      itemsToTransfer.forEach((item: any) => {
        item.removed = true;
        item.removedBy = 'Sistema';
        item.removalReason = `Transferido para ${isComanda ? 'Comanda' : 'Mesa'} ${targetTableId}`;

        const clone = JSON.parse(JSON.stringify(item));
        clone.id = randomUUID();
        clone.removed = false;
        delete clone.removedBy;
        delete clone.removalReason;
        clone.transferredFrom = `${isComanda ? 'Comanda' : 'Mesa'} ${sourceTableId}`;
        targetOrder.items.push(clone);
      });

      // If source has no remaining active items, free source table and any _st().tables linked to it
      const remainingActive = sourceOrder.items.filter((i: any) => !i.removed && !i.paid);
      console.log(`[transfer_items] remainingActive=${remainingActive.length}`);

      // Capture linked _st().tables BEFORE nulling their linkedTo (so we can persist them later)
      const linkedTablesToFree = remainingActive.length === 0
        ? tableList.filter((t: any) => t.id !== sourceTable.id && String(t.linkedTo) === String(sourceTableId))
        : [];

      if (remainingActive.length === 0) {
        sourceOrder.status = 'finalizada';
        sourceTable.currentOrder = null;
        sourceTable.status = 'free';
        sourceTable.linkedTo = null;
        for (const lt of linkedTablesToFree) {
          lt.linkedTo = null;
          lt.currentOrder = null;
          lt.status = 'free';
        }
      }

      // Emit immediately with the correct in-memory state BEFORE async Firestore saves.
      // This prevents the Firestore onSnapshot (triggered by saveToSupabase) from racing
      // and emitting stale data that overwrites the correct state on clients.
      io.to(_room()).emit("update_orders", _st().orders);
      io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
      console.log(`[transfer_items] emitted updates â€" persisting to Firestore`);

      // Persist to Firestore (onSnapshot will re-emit after each save with the same correct data)
      await saveToSupabase('orders', sourceOrder, String(sourceOrder.id, _tid()));
      await saveToSupabase('orders', targetOrder, String(targetOrder.id, _tid()));
      await saveToSupabase(tableCol, targetTable, targetTable.id.toString(), _tid());
      if (remainingActive.length === 0) {
        await saveToSupabase(tableCol, sourceTable, sourceTable.id.toString(), _tid());
        for (const lt of linkedTablesToFree) {
          await saveToSupabase(tableCol, lt, lt.id.toString(), _tid());
        }
      }
      console.log(`[transfer_items] Firestore persistence complete`);
    });

    socket.on("apply_discount", requireAdmin(async ({ orderId, itemId, discount, discountType }) => {
      const order = _st().orders.find(o => String(o.id) === String(orderId));
      if (order) {
        if (itemId) {
          const item = order.items.find(i => String(i.id) === String(itemId));
          if (item) {
            item.discount = Number(discount);
            item.discountType = discountType;
          }
        } else {
          order.discount = Number(discount);
          order.discountType = discountType;
        }
        await saveToSupabase('orders', order, order.id, _tid());
        io.to(_room()).emit("update_orders", _st().orders);
      }
    }));

    socket.on("confirm_baixa", async ({ orderId }) => {
      const order = _st().orders.find((o: any) => String(o.id) === String(orderId));
      if (!order || order.status !== "aguardando_baixa") return;

      order.status = "finalizada";

      const entitiesToUpdate: any[] = [];
      _st().tables.forEach((t: any) => {
        if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
          t.status = "free";
          t.currentOrder = null;
          t.linkedTo = null;
          entitiesToUpdate.push({ entity: t, collection: '_st().tables' });
        }
      });
      _st().comandas.forEach((c: any) => {
        if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
          c.status = "free";
          c.currentOrder = null;
          c.linkedTo = null;
          entitiesToUpdate.push({ entity: c, collection: '_st().comandas' });
        }
      });

      io.to(_room()).emit("update_orders", _st().orders);
      io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);

      await saveToSupabase('orders', order, String(order.id, _tid()));
      for (const item of entitiesToUpdate) {
        await saveToSupabase(item.collection, item.entity, String(item.entity.id, _tid()));
      }
      // Invalidar sessão do cliente ao dar baixa
      _st().tables.forEach((t: any) => { if (String(t.currentOrder) === String(orderId) || (order.tableId && t.id === order.tableId)) invalidateClientSession(t.id, false); });
      _st().comandas.forEach((c: any) => { if (String(c.currentOrder) === String(orderId) || (order.isComanda && c.id === order.tableId)) invalidateClientSession(c.id, true); });
      console.log(`Baixa confirmada para pedido ${orderId}`);
    });

    socket.on("update_order_status", async ({ orderId, status }) => {
      const order = _st().orders.find(o => String(o.id) === String(orderId));
      if (order) {
        order.status = status;
        await saveToSupabase('orders', order, order.id, _tid());
        io.to(_room()).emit("update_orders", _st().orders);
      }
    });

    socket.on("request_bill", async ({ tableId, isComanda }) => {
      const targetList = isComanda ? _st().comandas : _st().tables;
      const table = targetList.find(t => t.id === tableId);
      if (table) {
        table.status = "bill_requested";
        await saveToSupabase(isComanda ? 'comandas' : '_st().tables', table, table.id.toString());
        if (isComanda) {
          io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        } else {
          io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        }
      }
    });

    socket.on("close_table", async ({ tableId, isComanda }) => {
      const targetList = isComanda ? _st().comandas : _st().tables;
      let table = targetList.find(t => t.id === tableId);
      
      if (table) {
        // Find the ultimate target table if this one is linked
        let ultimateTargetId = tableId;
        let current = table;
        const visited = new Set([current.id]);
        while (current.status === "linked" && current.linkedTo) {
          const next = targetList.find(t => t.id === current.linkedTo);
          if (!next || visited.has(next.id)) break;
          current = next;
          visited.add(current.id);
          ultimateTargetId = current.id;
        }

        const orderId = current.currentOrder;
        
        // Free the main table, the ultimate target, and all _st().tables/_st().comandas linked to that target or sharing the order
        const entitiesToFree = [];
        const processFree = (t, targetId, orderId) => {
          if (
            t.id === targetId || 
            t.linkedTo === targetId || 
            (orderId && t.currentOrder === orderId)
          ) {
            t.status = "free";
            t.currentOrder = null;
            t.linkedTo = null;
            entitiesToFree.push(t);
          }
        };

        if (isComanda) {
          _st().comandas.forEach(c => processFree(c, ultimateTargetId, orderId));
        } else {
          _st().tables.forEach(t => processFree(t, ultimateTargetId, orderId));
        }

        // Also ensure the initial tableId is freed if it wasn't covered
        const initialTable = targetList.find(t => t.id === tableId);
        if (initialTable && !entitiesToFree.includes(initialTable)) {
          initialTable.status = "free";
          initialTable.currentOrder = null;
          initialTable.linkedTo = null;
          entitiesToFree.push(initialTable);
        }

        // Persist all freed entities
        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        io.to(_room()).emit("update_orders", _st().orders);

        for (const entity of entitiesToFree) {
          await saveToSupabase(isComanda ? 'comandas' : '_st().tables', entity, entity.id.toString());
        }

        if (orderId) {
          const order = _st().orders.find(o => o.id === orderId);
          if (order) {
            order.status = "finalizada";
            await saveToSupabase('orders', order, order.id, _tid());
          }
        }
      }
    });

    // Reset all in-memory state: free all _st().tables/_st().comandas and wipe _st().orders.
    // No requireAdmin wrapper â€" auth may be unavailable when Firebase is disabled,
    // and the button is already protected by the admin-only dashboard UI.
    socket.on("reset_system", async () => {
      console.log("reset_system: clearing all in-memory _st().orders, _st().tables, _st().comandas and _st().stockLog");

      _st().orders = [];
      _st().stockLog = [];

      _st().tables.forEach(t => {
        t.status = "free";
        t.currentOrder = null;
        t.linkedTo = null;
      });

      _st().comandas.forEach(c => {
        c.status = "free";
        c.currentOrder = null;
        c.linkedTo = null;
      });

      _st().isCashRegisterOpen = false;

      io.to(_room()).emit("update_orders", _st().orders);
      io.to(_room()).emit("update_stock_log", _st().stockLog);
      io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
      io.to(_room()).emit("update_cash_register", false);

      // Persist reset to Supabase
      try {
        await db.from('_st().orders').delete().neq('id', '');
        await db.from('_st().tables').update({ status: 'free', current_order: null, linked_to: null }).neq('id', 0);
        await db.from('_st().comandas').update({ status: 'free', current_order: null, linked_to: null }).neq('id', 0);
        console.log('reset_system: Supabase cleared successfully');
      } catch (err) {
        console.error('reset_system: failed to clear Supabase', err);
      }
    });

    // Cliente pede status atual do agente (ex: após reconexão do socket)
    socket.on("request_agent_status", () => {
      socket.emit("printer_agent_status", { online: !!(_st().printerAgentSocket?.connected) });
    });

    // Scan de impressoras — Dashboard pede, servidor repassa ao agente
    socket.on("scan_printers_request", () => {
      if (_st().printerAgentSocket?.connected) {
        _st().printerAgentSocket.emit("scan_printers_request");
      } else {
        socket.emit("scan_printers_result", { printers: [], error: "Agente offline" });
      }
    });

    // ── Impressão ESC/POS ─────────────────────────────────────────────────────
    // Se o agente local estiver conectado, delega para ele (cenário VPS).
    // Caso contrário, o servidor tenta conexão TCP direta (cenário local/dev).
    socket.on("print_escpos", ({ ip, port = 9100, localName, data }: { ip?: string; port?: number; localName?: string; data: number[] }) => {
      if (!data?.length) return;

      if (_st().printerAgentSocket && _st().printerAgentSocket.connected) {
        _st().printerAgentSocket.emit("do_print", { ip, port, localName, data });
        return;
      }

      // Sem agente e sem IP → não há como imprimir no servidor (USB é local)
      if (!ip) {
        socket.emit("print_result", { success: false, error: "Impressora USB requer o agente local conectado." });
        return;
      }

      // Fallback: conexão TCP direta (funciona apenas quando servidor e impressora estão na mesma rede)
      const client = new net.Socket();
      let finished = false;
      const done = () => { if (!finished) { finished = true; client.destroy(); } };

      client.setTimeout(6000);
      client.connect(port, ip, () => {
        client.write(Buffer.from(data), () => {
          socket.emit("print_result", { success: true, ip });
          setTimeout(done, 300);
        });
      });
      client.on("timeout", () => {
        socket.emit("print_result", { success: false, ip, error: "Timeout — impressora não responde" });
        done();
      });
      client.on("error", (err: Error) => {
        socket.emit("print_result", { success: false, ip, error: err.message });
        done();
      });
    });

    // Consolidated init_data is at the beginning of connection

    // ── Chama Garçom ──────────────────────────────────────────────────────
    socket.on("call_waiter", ({ tableId, rateLimitMinutes }: { tableId: number; rateLimitMinutes?: number }) => {
      const id = Number(tableId);
      if (!id || isNaN(id)) return;

      // Caixa deve estar aberto
      if (!_st().isCashRegisterOpen) {
        socket.emit("call_waiter_result", { success: false, tableId: id });
        return;
      }

      // Rate limiting por mesa
      const limitMs = Math.max(1, Math.min(rateLimitMinutes ?? 3, 60)) * 60 * 1000;
      const now = Date.now();
      const lastCall = callWaiterCooldown.get(id) ?? 0;
      if (now - lastCall < limitMs) {
        socket.emit("call_waiter_result", { success: false, tableId: id });
        return;
      }
      callWaiterCooldown.set(id, now);

      socket.emit("call_waiter_result", { success: true, tableId: id });
      io.to(_room()).emit("waiter_called", { tableId: id, timestamp: now });
    });
    // ── End Chama Garçom ───────────────────────────────────────────────────

  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // ── Sessão do cliente ──────────────────────────────────────────
  app.get("/api/cliente-session/:mesaId", (req, res) => {
    const mesaId = req.params.mesaId;
    const isComanda = req.query.comanda === '1';
    const session = getClientSession(mesaId, isComanda);
    if (!session) return res.json({ active: false });
    res.json({ active: true, token: session.token, mesaId, isComanda });
  });

  app.get("/api/cliente-session/:mesaId/validate", (req, res) => {
    const mesaId = req.params.mesaId;
    const token = req.query.token as string;
    const isComanda = req.query.comanda === '1';
    const session = getClientSession(mesaId, isComanda);
    if (!session || session.token !== token) return res.json({ valid: false });
    session.lastActivity = Date.now();
    res.json({ valid: true, mesaId, isComanda });
  });

  // Serve o executável do agente de impressão para download
  app.get("/download/fechaconta-agente.exe", (req, res) => {
    const agentPath = path.join(process.cwd(), "print-agent", "fechaconta-agente.exe");
    if (!fs.existsSync(agentPath)) {
      return res.status(404).json({ error: "Executável não encontrado. Execute 'npm run build' na pasta print-agent/." });
    }
    res.download(agentPath, "fechaconta-agente.exe");
  });

  // Serve o instalador PowerShell
  app.get("/download/install.ps1", (req, res) => {
    const scriptPath = path.join(process.cwd(), "print-agent", "install.ps1");
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).send("Not found");
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.download(scriptPath, "install.ps1");
  });

  app.post("/api/seed", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Supabase não inicializado" });

    const tenantId: string = req.body?.tenantId || 'default';
    const steps: string[] = [];
    const log = (msg: string) => { steps.push(msg); console.log("[seed]", msg); };

    try {
      log("Limpando tabelas antigas...");
      await db.from('orders').delete().eq('tenant_id', tenantId);
      await db.from('stock').delete().eq('tenant_id', tenantId);
      await db.from('pizza_flavors').delete().eq('tenant_id', tenantId);
      await db.from('pizza_crusts').delete().eq('tenant_id', tenantId);

      log("Configurando 40 mesas...");
      await db.from('tables').upsert(
        Array.from({ length: 40 }, (_, i) => ({ id: `${tenantId}:${i+1}`, num: i + 1, status: 'free', current_order: null, linked_to: null, tenant_id: tenantId }))
      );

      log("Configurando 50 comandas...");
      await db.from('comandas').upsert(
        Array.from({ length: 50 }, (_, i) => ({ id: `${tenantId}:${i+1}`, num: i + 1, status: 'free', current_order: null, linked_to: null, tenant_id: tenantId }))
      );

      log("Carregando categorias do menu...");
      await db.from('menu').upsert(
        MENU_CATEGORIES.map((cat: any, idx: number) => ({ id: `${tenantId}:${cat.name}`, name: cat.name, position: idx, items: cat.items || [], tenant_id: tenantId }))
      );

      log("Carregando sabores de pizza...");
      await db.from('pizza_flavors').upsert(
        PIZZA_FLAVORS.map((f: any) => ({ id: `${tenantId}:${f.name}`, name: f.name, category: f.category || null, price: f.price || null, available: f.available !== false, tenant_id: tenantId }))
      );

      log("Carregando bordas...");
      await db.from('pizza_crusts').upsert(
        PIZZA_CRUSTS.map((c: any) => ({ id: `${tenantId}:${c}`, name: c, tenant_id: tenantId }))
      );

      log("Configurando sistema de caixa...");
      await db.from('config').upsert({ id: `${tenantId}:app`, data: { isCashRegisterOpen: false, dailyCounter: 0, lastOrderDate: '' }, tenant_id: tenantId });

      log("Resetando estado em memória...");
      // Reseta o estado de todos os tenants carregados
      tenants.forEach((st, tid) => {
        st.orders = [];
        st.tables = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, status: 'free', currentOrder: null, linkedTo: null }));
        st.comandas = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, status: 'free', currentOrder: null, linkedTo: null }));
        st.isCashRegisterOpen = false;
        st.loaded = false;
        const room = `tenant:${tid}`;
        io.to(room).emit('update_orders', st.orders);
        io.to(room).emit('update_tables', st.tables);
        io.to(room).emit('update_comandas', st.comandas);
        io.to(room).emit('update_cash_register', st.isCashRegisterOpen);
      });

      log("ConcluÃ­do!");
      res.json({ ok: true, steps });
    } catch (err: any) {
      console.error("[seed] Erro:", err);
      res.status(500).json({ error: err.message, steps });
    }
  });

  // Atualiza apenas o menu (sem apagar pedidos, mesas, sabores, etc.)
  app.post("/api/seed-menu", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Supabase não inicializado" });
    const tenantId: string = req.body?.tenantId || 'default';
    try {
      await db.from('menu').upsert(
        MENU_CATEGORIES.map((cat: any, idx: number) => ({
          id: `${tenantId}:${cat.name}`,
          name: cat.name,
          position: idx,
          type: cat.type,
          items: cat.items || [],
          subcategories: cat.subcategories || [],
          tenant_id: tenantId,
        }))
      );
      const st = getState(tenantId);
      st.menu = JSON.parse(JSON.stringify(MENU_CATEGORIES));
      st.loaded = false;
      io.to(`tenant:${tenantId}`).emit('update_menu', st.menu);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/create-waiter", express.json(), (req, res) => {
    const { name, password } = req.body;
    if (!name || !password) {
      return res.status(400).json({ error: "name e password sÃ£o obrigatÃ³rios" });
    }
    const tenantId = (req as any).tenantId || 'default';
    const st = getState(tenantId);
    const existing = st.waiters.find((w: any) => w.name === name);
    if (existing) {
      return res.status(409).json({ error: "Garçom com esse nome já existe" });
    }
    const newWaiter = {
      id: `waiter_${Date.now()}`,
      name,
      password,
      status: "approved",
      role: "waiter",
      createdAt: new Date().toISOString(),
    };
    st.waiters.push(newWaiter);
    io.to(`tenant:${tenantId}`).emit("update_waiters", st.waiters);
    console.log(`[admin] GarÃ§om criado: ${name}`);
    return res.json({ success: true, waiter: { id: newWaiter.id, name: newWaiter.name, status: newWaiter.status } });
  });

  // ── Controle de Presença ──────────────────────────────────────────────────────

  function todayDateStr() {
    return new Date().toISOString().split('T')[0];
  }

  // Gera ou retorna o token do dia para um tenant
  app.post("/api/attendance/token", express.json(), async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB não disponível" });
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId obrigatório" });

    const today = todayDateStr();
    const { data: existing } = await db.from('fin_attendance_tokens').select('*').eq('tenant_id', tenantId).eq('date', today).single();
    if (existing) {
      return res.json({ token: existing.token, date: existing.date });
    }

    const newToken = {
      id: `att_${tenantId}_${today}`,
      tenant_id: tenantId,
      date: today,
      token: Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10),
    };
    const { data, error } = await db.from('fin_attendance_tokens').insert(newToken).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ token: (data as any).token, date: (data as any).date });
  });

  // Página pública: info do token (data + lista de colaboradores do tenant)
  app.get("/api/attendance/:token", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB não disponível" });
    const { token } = req.params;

    const { data: tokenData } = await db.from('fin_attendance_tokens').select('*').eq('token', token).single();
    if (!tokenData) return res.status(404).json({ error: "QR Code inválido ou expirado." });

    const today = todayDateStr();
    if ((tokenData as any).date !== today) return res.status(410).json({ error: "QR Code expirado. Solicite um novo ao gestor." });

    const { data: employees } = await db.from('fin_employees').select('id, name').eq('tenant_id', (tokenData as any).tenant_id).in('status', ['ativo', 'pago']).order('name');
    const { data: records } = await db.from('fin_attendance_records').select('employee_id').eq('tenant_id', (tokenData as any).tenant_id).eq('date', today);
    const confirmedIds = new Set(((records || []) as any[]).map(r => r.employee_id));

    return res.json({
      date: (tokenData as any).date,
      employees: ((employees || []) as any[]).map(e => ({ id: e.id, name: e.name, confirmed: confirmedIds.has(e.id) })),
    });
  });

  // Confirmação pública de presença
  app.post("/api/attendance/:token/confirm", express.json(), async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB não disponível" });
    const { token } = req.params;
    const { employee_id } = req.body;
    if (!employee_id) return res.status(400).json({ error: "employee_id obrigatório" });

    const { data: tokenData } = await db.from('fin_attendance_tokens').select('*').eq('token', token).single();
    if (!tokenData) return res.status(404).json({ error: "QR Code inválido." });

    const today = todayDateStr();
    if ((tokenData as any).date !== today) return res.status(410).json({ error: "QR Code expirado." });

    const { data: emp } = await db.from('fin_employees').select('name').eq('id', employee_id).single();
    if (!emp) return res.status(404).json({ error: "Colaborador não encontrado." });

    const record = {
      id: `rec_${(tokenData as any).tenant_id}_${employee_id}_${today}`,
      tenant_id: (tokenData as any).tenant_id,
      employee_id,
      employee_name: (emp as any).name,
      date: today,
      confirmed_at: new Date().toISOString(),
      token_id: (tokenData as any).id,
    };

    const { error } = await db.from('fin_attendance_records').upsert(record);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, name: (emp as any).name });
  });

  // Registros de presença por tenant e período (usado pelo Dashboard)
  app.get("/api/attendance/records/:tenantId", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB não disponível" });
    const { tenantId } = req.params;
    const { from, to } = req.query as { from?: string; to?: string };

    let q = db.from('fin_attendance_records').select('*').eq('tenant_id', tenantId).order('date', { ascending: false }).order('confirmed_at', { ascending: true });
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ records: data || [] });
  });

  // ── PDF Reservation API ────────────────────────────────────────────────────

  interface PdfDrawOpServer {
    valueKey: string;
    centerX: number; y: number;
    maxWidth: number; maxFontSize: number; minFontSize: number;
    font: string; color: string;
    rotateDeg?: number;
    coverRect?: { x: number; y: number; width: number; height: number; fillColor: string };
  }

  // Page: 595.5 × 842.2 pt (A4 portrait)
  // Black bar bottom (frente): x=146.8 y=220.8 w=301.7 h=88.5 → center (297.6, 265.1)
  // Black bar top   (verso):   x=146.8 y=549.0 w=301.7 h=88.5 → center (297.6, 593.2)
  const PDF_TEMPLATES: Record<string, {
    file: string; page: number;
    draws: PdfDrawOpServer[];
    fields: { name: { centerX: number; y: number; maxWidth: number; maxFontSize: number; minFontSize: number; color: string } };
  }> = {
    reservaPrincipal: {
      file: 'templates/reserva.pdf',
      page: 0,
      draws: [
        // Frente — parte inferior, texto normal
        {
          valueKey: 'name',
          centerX: 297.6, y: 257,
          maxWidth: 280, maxFontSize: 52, minFontSize: 16,
          font: 'TimesRomanBoldItalic', color: '#0a0a0a',
          rotateDeg: 0,
          coverRect: { x: 146.8, y: 220.8, width: 301.7, height: 88.5, fillColor: '#ffffff' },
        },
        // Verso — parte superior, texto invertido 180°
        {
          valueKey: 'name',
          centerX: 297.6, y: 601,
          maxWidth: 280, maxFontSize: 52, minFontSize: 16,
          font: 'TimesRomanBoldItalic', color: '#0a0a0a',
          rotateDeg: 180,
          coverRect: { x: 146.8, y: 549.0, width: 301.7, height: 88.5, fillColor: '#ffffff' },
        },
      ],
      fields: {
        name: { centerX: 297.6, y: 257, maxWidth: 280, maxFontSize: 52, minFontSize: 16, color: '#0a0a0a' },
      },
    },
  };

  /** Finds the largest font size where text fits within maxWidth */
  function fitFontSize(
    text: string,
    widthFn: (t: string, s: number) => number,
    maxWidth: number, maxFs: number, minFs: number,
  ): number {
    let fs = maxFs;
    while (fs > minFs && widthFn(text, fs) > maxWidth) fs--;
    return fs;
  }

  /** Hex color string → pdf-lib rgb() */
  function hexToRgb(hex: string): ReturnType<typeof rgb> {
    const h = hex.replace('#', '');
    return rgb(
      parseInt(h.substring(0, 2), 16) / 255,
      parseInt(h.substring(2, 4), 16) / 255,
      parseInt(h.substring(4, 6), 16) / 255,
    );
  }

  /** Resolves a font name string to a pdf-lib StandardFonts value */
  function resolveFont(name: string): string {
    const map: Record<string, string> = {
      TimesRomanBoldItalic: StandardFonts.TimesRomanBoldItalic,
      TimesRomanBold:       StandardFonts.TimesRomanBold,
      TimesRoman:           StandardFonts.TimesRoman,
      HelveticaBold:        StandardFonts.HelveticaBold,
      Helvetica:            StandardFonts.Helvetica,
      CourierBold:          StandardFonts.CourierBold,
    };
    return map[name] ?? StandardFonts.TimesRomanBoldItalic;
  }

  // Upload a custom template PDF (base64-encoded)
  app.post("/api/reservas/upload-template", async (req, res) => {
    try {
      const { pdfBase64 } = req.body ?? {};
      if (!pdfBase64 || typeof pdfBase64 !== 'string') {
        return res.status(400).json({ error: 'Dados do PDF ausentes.' });
      }
      const headerBytes = Buffer.from(pdfBase64.slice(0, 8), 'base64').toString('ascii');
      if (!headerBytes.startsWith('%PDF')) {
        return res.status(400).json({ error: 'O arquivo enviado não é um PDF válido.' });
      }
      const decoded = Buffer.from(pdfBase64, 'base64');
      if (decoded.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'O arquivo excede o tamanho máximo de 10 MB.' });
      }
      const publicDir = path.resolve(process.cwd(), 'public');
      const dest = path.join(publicDir, 'templates', 'reserva.pdf');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, decoded);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[/api/reservas/upload-template]', err);
      return res.status(500).json({ error: 'Não foi possível salvar o template.' });
    }
  });

  app.post("/api/reservas/gerar-pdf", async (req, res) => {
    try {
      const { name, templateId = 'reservaPrincipal', fieldConfig } = req.body ?? {};

      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'O campo nome é obrigatório.' });
      }
      const safeName = name.trim().slice(0, 100);
      if (!/^[a-zA-ZÀ-ÿ0-9 \-'.]+$/u.test(safeName)) {
        return res.status(400).json({ error: 'Nome contém caracteres inválidos.' });
      }

      const template = PDF_TEMPLATES[templateId as string];
      if (!template) return res.status(400).json({ error: 'Template não encontrado.' });

      const publicDir = path.resolve(process.cwd(), 'public');
      const templatePath = path.join(publicDir, template.file);
      if (!templatePath.startsWith(publicDir)) return res.status(400).json({ error: 'Template inválido.' });
      if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Arquivo de template não encontrado.' });

      const pdfDoc = await PDFDocument.load(fs.readFileSync(templatePath));
      const pages = pdfDoc.getPages();
      const page = pages[template.page] ?? pages[0];

      // Cache for embedded fonts (avoid embedding the same font twice)
      const fontCache: Record<string, Awaited<ReturnType<typeof pdfDoc.embedFont>>> = {};
      const getFont = async (name: string) => {
        if (!fontCache[name]) fontCache[name] = await pdfDoc.embedFont(resolveFont(name));
        return fontCache[name];
      };

      // Apply fieldConfig override — only font size and color; position always from template
      const draws: PdfDrawOpServer[] = template.draws.map((draw) => {
        if (draw.valueKey !== 'name' || !fieldConfig) return draw;
        return {
          ...draw,
          maxFontSize: typeof fieldConfig.maxFontSize === 'number' ? fieldConfig.maxFontSize : draw.maxFontSize,
          minFontSize: typeof fieldConfig.minFontSize === 'number' ? fieldConfig.minFontSize : draw.minFontSize,
          color: (typeof fieldConfig.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(fieldConfig.color))
                   ? fieldConfig.color : draw.color,
        };
      });

      const values: Record<string, string> = { name: safeName };

      for (const draw of draws) {
        const text = values[draw.valueKey];
        if (!text) continue;

        const font = await getFont(draw.font);

        // Cover the placeholder bar with a solid rectangle
        if (draw.coverRect) {
          const cr = draw.coverRect;
          page.drawRectangle({
            x: cr.x, y: cr.y, width: cr.width, height: cr.height,
            color: hexToRgb(cr.fillColor),
            borderWidth: 0,
          });
        }

        const fontSize = fitFontSize(
          text, (t, s) => font.widthOfTextAtSize(t, s),
          draw.maxWidth, draw.maxFontSize, draw.minFontSize,
        );
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        const rotateDeg = draw.rotateDeg ?? 0;

        let x: number;
        let y: number;

        if (rotateDeg === 0) {
          // Normal: (x,y) = baseline-left
          x = draw.centerX - textWidth / 2;
          y = draw.y;
        } else {
          // 180° rotation: pdf-lib uses (x,y) as the anchor (bottom-left in local space).
          // After 180° rotation the visual text extends LEFT from x, with cap-height going DOWN.
          // To center visually at (centerX, y): anchor = (centerX + textWidth/2, y)
          x = draw.centerX + textWidth / 2;
          y = draw.y;
        }

        page.drawText(text, {
          x, y,
          size: fontSize,
          font,
          color: hexToRgb(draw.color),
          rotate: rotateDeg !== 0 ? degrees(rotateDeg) : undefined,
        });
      }

      const pdfBytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="reserva.pdf"');
      return res.end(Buffer.from(pdfBytes));
    } catch (err) {
      console.error('[/api/reservas/gerar-pdf]', err);
      return res.status(500).json({ error: 'Não foi possível gerar a reserva. Tente novamente.' });
    }
  });

  // ── End PDF Reservation API ────────────────────────────────────────────────

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
