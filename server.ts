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
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { MENU_CATEGORIES, PIZZA_FLAVORS, PIZZA_CRUSTS } from "./src/constants.ts";

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

  // â"€â"€ Inicializa Supabase Admin (service_role â€" bypassa RLS) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  let db: SupabaseClient;
  try {
    const supabaseUrl     = process.env.SUPABASE_URL;
    const supabaseKey     = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sÃ£o obrigatÃ³rios');
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

  app.use(express.json());

  // In-memory state
  let waiters: any[] = [];
  let orders: any[] = [];
  let isCashRegisterOpen = false;
  let tables: any[] = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    status: "free",
    currentOrder: null,
    linkedTo: null,
  }));

  let comandas: any[] = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    status: "free",
    currentOrder: null,
    linkedTo: null,
  }));

  // â"€â"€ Mappers: Supabase row â†" app object â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const rowToTable  = (r: any) => ({ id: r.id, status: r.status, currentOrder: r.current_order ?? null, linkedTo: r.linked_to ?? null });
  const tableToRow  = (t: any) => ({ id: t.id, status: t.status, current_order: t.currentOrder ?? null, linked_to: t.linkedTo ?? null });
  const rowToOrder  = (r: any) => ({ id: r.id, tableId: r.table_id, waiterId: r.waiter_id, waiterName: r.waiter_name, status: r.status, isComanda: r.is_comanda, timestamp: r.timestamp, items: r.items || [], paymentLog: r.payment_log || [], deliveryLog: r.delivery_log || [] });
  const orderToRow  = (o: any) => ({ id: String(o.id), table_id: o.tableId ? String(o.tableId) : null, waiter_id: o.waiterId ? String(o.waiterId) : null, waiter_name: o.waiterName || null, status: o.status || 'open', is_comanda: o.isComanda || false, timestamp: o.timestamp || new Date().toISOString(), items: o.items || [], payment_log: o.paymentLog || [], delivery_log: o.deliveryLog || [] });
  const rowToStock  = (r: any) => ({ id: r.id, menuItemId: r.menu_item_id, name: r.name, quantity: r.quantity, minQuantity: r.min_quantity, unit: r.unit, history: r.history || [] });
  const stockToRow  = (s: any) => ({ id: s.id, menu_item_id: s.menuItemId || s.id, name: s.name || '', quantity: s.quantity || 0, min_quantity: s.minQuantity || 0, unit: s.unit || 'un', history: s.history || [] });

  // â"€â"€ saveToSupabase: persiste qualquer coleÃ§Ã£o â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const resetActiveOrderTimestamps = () => {
    const now = new Date().toISOString();
    for (const order of orders) {
      if (order.status === 'paid' || order.status === 'delivered') continue;
      let updated = false;
      if (order.items) {
        for (const item of order.items) {
          if (item.status === 'removed') continue;
          item.timestamp = now;
          updated = true;
        }
      }
      if (updated) {
        order.timestamp = now;
        saveToSupabase('orders', order, String(order.id)).catch(() => {});
      }
    }
  };

  const saveToSupabase = async (collection: string, data: any, docId?: string) => {
    if (!db) return;
    try {
      const d = JSON.parse(JSON.stringify(data));
      switch (collection) {
        case 'orders':   await db.from('orders').upsert(orderToRow(d)); break;
        case 'tables':   await db.from('tables').upsert(tableToRow(d)); break;
        case 'comandas': await db.from('comandas').upsert(tableToRow(d)); break;
        case 'waiters':  await db.from('waiters').upsert(d); break;
        case 'menu':     await db.from('menu').upsert({ id: docId || d.id, name: d.name, position: d.position || 0, items: d.items || [] }); break;
        case 'stock':    await db.from('stock').upsert(stockToRow(d)); break;
        case 'config':   await db.from('config').upsert({ id: docId, data: d }); break;
        case 'pizzaFlavors': await db.from('pizza_flavors').upsert({ id: d.name, name: d.name, category: d.category || null, price: d.price || null, available: d.available !== false }); break;
        case 'pizzaCrusts':  await db.from('pizza_crusts').upsert({ id: d.name || docId, name: d.name || docId }); break;
        default: console.warn(`[supabase] coleÃ§Ã£o desconhecida: "${collection}"`);
      }
    } catch (e) {
      console.error(`[supabase] erro ao salvar em ${collection}:`, e);
    }
  };

  const saveMenuToSupabase = () => {
    menu.forEach((cat: any, idx: number) => {
      saveToSupabase('menu', { ...cat, position: idx }, cat.name).catch(() => {});
    });
  };

  // â"€â"€ Carga inicial do Supabase â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const loadFromSupabase = async () => {
    try {
      const [wRes, oRes, tRes, cRes, cfgRes, mRes, sRes, pfRes, pcRes, cfgPizRes] = await Promise.all([
        db.from('waiters').select('*'),
        db.from('orders').select('*'),
        db.from('tables').select('*').order('id'),
        db.from('comandas').select('*').order('id'),
        db.from('config').select('data').eq('id', 'app').maybeSingle(),
        db.from('menu').select('*').order('position'),
        db.from('stock').select('*'),
        db.from('pizza_flavors').select('*'),
        db.from('pizza_crusts').select('*'),
        db.from('config').select('data').eq('id', 'pizzaria').maybeSingle(),
      ]);

      if (wRes.data) {
        waiters = wRes.data;
        io.emit('update_waiters', waiters);
        // Retry pending logins
        io.sockets.sockets.forEach((s: any) => {
          if (s._pendingLogin && !s.waiterId) {
            const { name, password } = s._pendingLogin;
            const w = waiters.find((x: any) => x.name === name && x.password === password);
            if (w) { w.socketId = s.id; s.waiterId = w.id; s.waiterName = w.name; s.waiterCpf = w.cpf; s.waiterUid = w.uid; s.emit('waiter_approved', { status: w.status }); }
            else if (waiters.length > 0) s.emit('error_message', 'Nome ou senha incorretos. Verifique seus dados ou solicite um novo cadastro.');
            delete s._pendingLogin;
          }
        });
      }

      if (mRes.data?.length) {
        // Re-hidrata o campo `type` (não persistido no schema Supabase) a partir
        // das constantes ou do nome da categoria
        const typeMap: Record<string, string> = {};
        MENU_CATEGORIES.forEach((c: any) => { typeMap[c.name] = c.type; });
        menu = mRes.data.map((row: any) => ({
          ...row,
          type: row.type || typeMap[row.name] || (row.name.toLowerCase().includes('pizza') ? 'pizzas' : row.name.toLowerCase().includes('bebida') ? 'bebidas' : 'lanches'),
        }));
        io.emit('update_menu', menu);
      } else {
        // Supabase menu vazio — semeia a partir das constantes
        await db.from('menu').upsert(
          menu.map((cat: any, idx: number) => ({ id: cat.name, name: cat.name, position: idx, items: cat.items || [] }))
        );
        console.log('[supabase] Menu inicial semeado ao Supabase');
        io.emit('update_menu', menu);
      }

      if (oRes.data) {
        orders = oRes.data.map((r: any) => {
          const o = rowToOrder(r);
          if (o.items && menu.length > 0) {
            o.items = o.items.map((item: any) => {
              if (item.type === 'pizzas') return item;
              const cat = item.menuItemId
                ? menu.find((c: any) => c.items?.some((i: any) => i.id === item.menuItemId))
                : menu.find((c: any) => c.items?.some((i: any) => i.name === item.name));
              return cat?.type ? { ...item, type: cat.type } : item;
            });
          }
          return o;
        });
        io.emit('update_orders', orders);
      }

      if (tRes.data) {
        tRes.data.map(rowToTable).forEach((dbTable: any) => {
          const idx = tables.findIndex(t => t.id === dbTable.id);
          if (idx !== -1) tables[idx] = { ...tables[idx], ...dbTable }; else tables.push(dbTable);
        });
        tables.sort((a, b) => a.id - b.id);
        io.emit('update_tables', tables);
      }

      if (cRes.data) {
        const dbComandas = cRes.data.map(rowToTable);
        dbComandas.forEach((dbC: any) => {
          const idx = comandas.findIndex(c => c.id === dbC.id);
          if (idx !== -1) comandas[idx] = { ...comandas[idx], ...dbC }; else comandas.push(dbC);
        });
        comandas.sort((a, b) => a.id - b.id);
        io.emit('update_comandas', comandas);
      }

      if (cfgRes.data?.data) {
        const cfg = cfgRes.data.data as any;
        isCashRegisterOpen = cfg.isCashRegisterOpen || false;
        if (cfg.dailyCounter !== undefined) dailyCounter = cfg.dailyCounter;
        if (cfg.lastOrderDate !== undefined) lastOrderDate = cfg.lastOrderDate;
        io.emit('update_cash_register', isCashRegisterOpen);
        // Reset stale timestamps on startup so timers start fresh each session
        if (isCashRegisterOpen) {
          resetActiveOrderTimestamps();
          io.emit('update_orders', orders);
        }
      }

      if (sRes.data) {
        const allItems = sRes.data.map(rowToStock);
        if (menu.length > 0) {
          const trackedIds = new Set(menu.flatMap((c: any) => c.items || []).filter((i: any) => i.trackStock).map((i: any) => i.id));
          const orphanIds = allItems.filter((s: any) => !trackedIds.has(s.menuItemId)).map((s: any) => s.id);
          if (orphanIds.length > 0) (db.from('stock').delete().in('id', orphanIds) as any).catch(() => {});
          stock = allItems.filter((s: any) => trackedIds.has(s.menuItemId));
        } else { stock = allItems; }
        io.emit('update_stock', stock);
      }

      if (pfRes.data) { pizzaFlavors = pfRes.data.map((r: any) => ({ id: r.id, name: r.name, category: r.category, price: r.price, available: r.available })); io.emit('update_pizza_flavors', pizzaFlavors); }
      if (pcRes.data) { pizzaCrusts = pcRes.data.map((r: any) => r.name); io.emit('update_pizza_crusts', pizzaCrusts); }
      if (cfgPizRes.data?.data) { pizzariaConfig = { ...pizzariaConfig, ...(cfgPizRes.data.data as any) }; io.emit('update_pizzaria_config', pizzariaConfig); }

      console.log('[supabase] Carga inicial concluÃ­da');
    } catch (e) {
      console.error('[supabase] Erro na carga inicial:', e);
    }
  };

  loadFromSupabase();

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

  let dailyCounter = counterData.dailyCounter;
  let lastOrderDate = counterData.lastOrderDate;

  const saveCounter = () => {
    try {
      fs.writeFileSync(COUNTER_FILE, JSON.stringify({ dailyCounter, lastOrderDate }));
    } catch (e) {
      console.error("Error saving counter file", e);
    }
  };

  const generateOrderId = () => {
    const now = new Date();
    // Use local date for the ID (DDMMYYYY)
    const dateStr = now.getDate().toString().padStart(2, '0') + 
                    (now.getMonth() + 1).toString().padStart(2, '0') + 
                    now.getFullYear().toString();
    
    // Reset counter if the date has changed
    if (dateStr !== lastOrderDate) {
      dailyCounter = 1;
      lastOrderDate = dateStr;
    } else {
      dailyCounter++;
    }
    
    saveCounter();
    
    saveToSupabase('config', { dailyCounter, lastOrderDate }, 'app').catch(() => {});

    // Format: DDMMYYYY0001
    return `${dateStr}${dailyCounter.toString().padStart(4, '0')}`;
  };

  // Stock is now driven by menu items with trackStock=true.
  // Each entry: { id, menuItemId, name, quantity, unit, minQuantity }
  let stock: any[] = [];
  let stockLog: any[] = [];

  let menu = JSON.parse(JSON.stringify(MENU_CATEGORIES));
  let pizzaFlavors = JSON.parse(JSON.stringify(PIZZA_FLAVORS));
  let pizzaCrusts = JSON.parse(JSON.stringify(PIZZA_CRUSTS));
  let pizzariaConfig = { enabled: false, yellowMinutes: 15, orangeMinutes: 20, redMinutes: 25, inactivityMinutes: 30, kdsEnabled: true, waiterCanPay: true };

  // â"€â"€ Local state backup â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const LOCAL_BACKUP_FILE = path.join(process.cwd(), 'data', 'local-state.json');
  let _backupTimer: ReturnType<typeof setTimeout> | null = null;

  const saveLocalBackup = () => {
    if (_backupTimer) clearTimeout(_backupTimer);
    _backupTimer = setTimeout(() => {
      try {
        const dir = path.dirname(LOCAL_BACKUP_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(LOCAL_BACKUP_FILE, JSON.stringify({
          orders, tables, comandas, waiters, menu, stock, stockLog,
          isCashRegisterOpen, pizzariaConfig,
          savedAt: new Date().toISOString()
        }), 'utf-8');
      } catch (e) {
        console.error('[backup] Erro ao salvar estado local:', e);
      }
    }, 800);
  };

  const loadLocalBackup = (): boolean => {
    try {
      if (!fs.existsSync(LOCAL_BACKUP_FILE)) return false;
      const state = JSON.parse(fs.readFileSync(LOCAL_BACKUP_FILE, 'utf-8'));
      if (state.orders?.length) orders = state.orders;
      if (state.tables?.length) state.tables.forEach((t: any) => {
        const idx = tables.findIndex((tt: any) => tt.id === t.id);
        if (idx !== -1) tables[idx] = { ...tables[idx], ...t };
      });
      if (state.comandas?.length) state.comandas.forEach((c: any) => {
        const idx = comandas.findIndex((cc: any) => cc.id === c.id);
        if (idx !== -1) comandas[idx] = { ...comandas[idx], ...c };
      });
      if (state.waiters?.length) waiters = state.waiters;
      if (state.menu?.length) menu = state.menu;
      if (state.stock?.length) stock = state.stock;
      if (state.stockLog?.length) stockLog = state.stockLog;
      if (state.isCashRegisterOpen !== undefined) isCashRegisterOpen = state.isCashRegisterOpen;
      if (state.pizzariaConfig) pizzariaConfig = { ...pizzariaConfig, ...state.pizzariaConfig };
      // Reset timestamps so timers start fresh after server restart
      resetActiveOrderTimestamps();
      const age = state.savedAt ? Math.round((Date.now() - new Date(state.savedAt).getTime()) / 60000) : null;
      console.log(`[backup] Estado local restaurado (salvo ${age !== null ? `hÃ¡ ${age} min` : 'anteriormente'})`);
      return true;
    } catch (e) {
      console.error('[backup] Erro ao carregar estado local:', e);
      return false;
    }
  };

  loadLocalBackup();
  saveLocalBackup(); // Persist initial/restored state immediately on startup

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

  const applyStockReduction = (items: any[]) => {
    const newEntries: any[] = [];
    items.forEach(item => {
      const qty = item.quantity || 1;
      const entry = stock.find((s: any) =>
        (item.menuItemId && s.menuItemId === item.menuItemId) || s.name === item.name
      );
      if (entry) {
        stock = stock.map((s: any) => {
          if (s.id === entry.id) {
            newEntries.push({
              id: randomUUID(),
              itemName: s.name,
              change: -qty,
              reason: 'Venda',
              timestamp: new Date().toISOString(),
            });
            return { ...s, quantity: Math.max(0, s.quantity - qty) };
          }
          return s;
        });
      }
    });
    if (newEntries.length > 0) {
      stockLog = [...newEntries, ...stockLog].slice(0, 100);
      io.emit("update_stock_log", stockLog);
    }
    io.emit("update_stock", stock);
  };

  // Auto-save whenever state is broadcast to clients
  const _origIoEmit = io.emit.bind(io);
  (io as any).emit = (...args: Parameters<typeof io.emit>) => {
    const result = _origIoEmit(...args);
    if (['update_orders','update_tables','update_comandas','update_cash_register',
         'update_menu','update_stock','update_stock_log','update_pizzaria_config'].includes(args[0] as string)) {
      saveLocalBackup();
    }
    return result;
  };

  // ── Agente de impressão local ─────────────────────────────────────────────
  // Armazena o socket do agente conectado (um por instância de servidor)
  let printerAgentSocket: any = null;

  const AGENT_SECRET = process.env.AGENT_SECRET || '';

  // ── Socket.io logic ───────────────────────────────────────────────────────
  // Em dev local (sem env vars de produção), todo socket é admin automaticamente
  const isDevMode = !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NODE_ENV !== 'production';

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    if (isDevMode) {
      (socket as any).isAdmin = true;
    }

    socket.on("admin_connect", (token) => {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (payload) {
          (socket as any).isAdmin = true;
          console.log(`Admin connected: ${payload.email}`);
        }
      } catch (e) {
        console.error("Error decoding token", e);
      }
    });

    // ── Registro do agente de impressão local ────────────────────────────────
    socket.on("printer_agent_register", ({ secret }: { secret?: string; pairingCode?: string }) => {
      if (AGENT_SECRET && secret !== AGENT_SECRET) {
        socket.emit("printer_agent_rejected", "Segredo inválido.");
        console.warn(`[agent] Tentativa de registro rejeitada (socket ${socket.id})`);
        return;
      }
      printerAgentSocket = socket;
      (socket as any).isPrinterAgent = true;
      socket.emit("printer_agent_accepted");
      socket.emit("printer_agent_paired"); // auto-emparelha sem código
      io.emit("printer_agent_status", { online: true });
      console.log(`[agent] Agente de impressão conectado e emparelhado: ${socket.id}`);
    });

    socket.on("disconnect", () => {
      if ((socket as any).isPrinterAgent) {
        printerAgentSocket = null;
        io.emit("printer_agent_status", { online: false });
        console.log("[agent] Agente de impressão desconectado.");
      }
    });

    // Resultado de impressão enviado pelo agente → repassa a todos
    socket.on("printer_agent_result", (result: { success: boolean; ip: string; error?: string }) => {
      io.emit("print_result", result);
    });

    // Resultado do scan de rede enviado pelo agente → repassa ao dashboard
    socket.on("scan_printers_result", (data: { printers: { ip: string; port: number }[] }) => {
      io.emit("scan_printers_result", data);
    });

    const requireAdmin = (handler: (...args: any[]) => void) => {
      return (...args: any[]) => {
        if (!(socket as any).isAdmin) {
          socket.emit("error_message", "Acesso restrito ao administrador.");
          return;
        }
        handler(...args);
      };
    };

    socket.emit("init_data", {
      waiters,
      orders,
      tables,
      comandas,
      stock,
      stockLog,
      menu,
      pizzaFlavors,
      pizzaCrusts,
      isCashRegisterOpen,
      pizzariaConfig,
      firebaseActive: !!db,
      printerAgentOnline: !!(printerAgentSocket?.connected),
    });

    socket.on("request_init_data", () => {
      socket.emit("init_data", {
        waiters,
        orders,
        tables,
        comandas,
        stock,
        stockLog,
        menu,
        pizzaFlavors,
        pizzaCrusts,
        isCashRegisterOpen,
        pizzariaConfig,
        firebaseActive: !!db,
        printerAgentOnline: !!(printerAgentSocket?.connected),
      });
    });

    socket.on("update_pizzaria_config", requireAdmin((config) => {
      pizzariaConfig = { ...pizzariaConfig, ...config };
      io.emit("update_pizzaria_config", pizzariaConfig);
      saveToSupabase('config', pizzariaConfig, 'pizzaria').catch(() => {});
    }));

    socket.on("deliver_item", ({ orderId, itemId }) => {
      const order = orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;

      const now = new Date().toISOString();
      const durationMinutes = item.timestamp
        ? Math.round((new Date(now).getTime() - new Date(item.timestamp).getTime()) / 60000)
        : null;

      const waiter = waiters.find((w: any) => w.id === (socket as any).waiterId);
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

      io.emit("update_orders", orders);

      saveToSupabase('orders', order, String(orderId)).catch(() => {});
    });

    socket.on("kitchen_start_item", async ({ orderId, itemId }) => {
      const order = orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;
      item.kitchenStatus = 'preparing';
      io.emit("update_orders", orders);
      await saveToSupabase('orders', order, String(order.id));
    });

    socket.on("kitchen_oven_item", async ({ orderId, itemId }) => {
      const order = orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;
      item.kitchenStatus = 'oven';
      io.emit("update_orders", orders);
      await saveToSupabase('orders', order, String(order.id));
    });

    socket.on("kitchen_finish_item", async ({ orderId, itemId }) => {
      const order = orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;
      item.kitchenStatus = 'ready';
      io.emit("update_orders", orders);
      await saveToSupabase('orders', order, String(order.id));
    });

    socket.on("waiter_register", (waiterData) => {
      // Find by CPF or Name/Phone combination if CPF is missing
      const existingWaiterIndex = waiters.findIndex(w => 
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
        waiters[existingWaiterIndex] = { ...waiters[existingWaiterIndex], ...waiter, status: waiters[existingWaiterIndex].status };
      } else {
        waiters.push(waiter);
      }

      io.emit("admin_notification", {
        type: "NEW_WAITER",
        data: waiter,
      });
      io.emit("update_waiters", waiters);
    });

    socket.on("waiter_login", ({ name, password }) => {
      const waiter = waiters.find(w => w.name === name && w.password === password);
      if (waiter) {
        waiter.socketId = socket.id;
        (socket as any).waiterId = waiter.id;
        (socket as any).waiterUid = waiter.uid;
        (socket as any).waiterCpf = waiter.cpf;
        (socket as any).waiterName = waiter.name;
        delete (socket as any)._pendingLogin;

        socket.emit("waiter_approved", { status: waiter.status });
        io.emit("update_waiters", waiters);
      } else if (waiters.length === 0) {
        // Race condition: waiters not loaded from Firestore yet â€" save for retry
        (socket as any)._pendingLogin = { name, password };
      } else {
        socket.emit("error_message", "Nome ou senha incorretos. Verifique seus dados ou solicite um novo cadastro.");
      }
    });

    socket.on("toggle_cash_register", requireAdmin(async (isOpen) => {
      console.log(`Cash register toggle: ${isOpen}`);
      if (!isOpen) {
        const activeTables = tables.find(t => t.status !== "free");
        const activeComandas = comandas.find(c => c.status !== "free");
        if (activeTables || activeComandas) {
          socket.emit("error_message", "NÃ£o Ã© possÃ­vel fechar o caixa com mesas ou comandas ocupadas.");
          return;
        }
      }
      if (isOpen) {
        resetActiveOrderTimestamps();
        io.emit('update_orders', orders);
      }
      isCashRegisterOpen = isOpen;
      io.emit("update_cash_register", isCashRegisterOpen);
      await saveToSupabase('config', { isCashRegisterOpen: isOpen, updatedAt: new Date().toISOString() }, 'app');
    }));

    socket.on("toggle_waiter_status", requireAdmin(({ waiterId, status }) => {
      const waiter = waiters.find((w) => w.id === waiterId || w.cpf === waiterId);
      if (waiter) {
        waiter.status = status;
        io.emit("update_waiters", waiters);
        
        // Notify the waiter via ALL their connected sockets
        const connectedSockets = io.sockets.sockets;
        connectedSockets.forEach((s) => {
          if ((s as any).waiterId === waiter.id) {
            s.emit("waiter_status_changed", { status });
          }
        });
      }
    }));

    socket.on("admin_approve_waiter", requireAdmin((waiterId) => {
      const waiter = waiters.find((w) => w.id === waiterId || w.cpf === waiterId);
      if (waiter) {
        waiter.status = "approved";
        io.emit("update_waiters", waiters);
        
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
      console.log("New order request received:", orderData.tableId, orderData.isComanda ? "Comanda" : "Table");
      
      if (!isCashRegisterOpen) {
        console.warn("Attempted order while register is closed");
        socket.emit("error_message", "O caixa estÃ¡ fechado. Abra o caixa para realizar pedidos.");
        return;
      }
      
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso estÃ¡ inativo. Entre em contato com o gerente.");
        return;
      }

      const isComanda = !!orderData.isComanda;
      const targetList = isComanda ? comandas : tables;
      let table = targetList.find(t => orderData.tableId && t.id && String(t.id) === String(orderData.tableId));
      
      // Handle linked tables
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

      // Tag items with waiter name and resolve type from server menu
      const orderCreatedAt = Date.now();
      const itemsWithWaiter = (orderData.items || []).map((item: any, idx: number) => {
        // Pizzas always keep type 'pizzas'; for other items resolve from server menu
        let resolvedType = item.type;
        if (item.type !== 'pizzas') {
          const cat = item.menuItemId
            ? menu.find((c: any) => c.items.some((i: any) => i.id === item.menuItemId))
            : menu.find((c: any) => c.items.some((i: any) => i.name === item.name));
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
        const existingOrder = orders.find(o => table.currentOrder && o.id && String(o.id) === String(table.currentOrder));
        if (existingOrder) {
          if (!existingOrder.items) existingOrder.items = [];
          existingOrder.items.push(...itemsWithWaiter);
          if (orderData.observations) {
            existingOrder.observations = existingOrder.observations 
              ? `${existingOrder.observations} | ${orderData.observations}` 
              : orderData.observations;
          }
          io.emit("update_orders", orders);
          if (itemsWithWaiter.length > 0) {
            io.emit("kitchen_new_order", { items: itemsWithWaiter, tableId: existingOrder.tableId, isComanda: existingOrder.isComanda });
          }
          await saveToSupabase('orders', existingOrder, existingOrder.id.toString());
          console.log("Existing order updated and emitted");
          return;
        }
      }

      const newOrder = { 
        ...orderData, 
        items: itemsWithWaiter,
        id: generateOrderId(), 
        status: "pending", 
        timestamp: new Date().toISOString(),
        waiterName: waiterName,
        isComanda: isComanda
      };
      
      console.log("Created new order object:", newOrder.id);
      orders.push(newOrder);

      // Emit updates immediately for faster UI
      io.emit("update_orders", orders);
      if (isComanda) {
        io.emit("update_comandas", comandas);
      } else {
        io.emit("update_tables", tables);
      }
      io.emit("update_stock", stock);
      if ((newOrder.items || []).length > 0) {
        io.emit("kitchen_new_order", { items: newOrder.items, tableId: newOrder.tableId, isComanda: newOrder.isComanda });
      }
      
      console.log("Emitted initial updates for new order");
      
      saveToSupabase('orders', newOrder, newOrder.id);
      saveToSupabase('config', { dailyCounter, lastOrderDate }, 'app');
      
      if (table) {
        const orderId = newOrder.id;
        const targetId = table.id;
        const collName = isComanda ? 'comandas' : 'tables';
        
        console.log("Updating table status to occupied for:", targetId);
        
        if (isComanda) {
          comandas.forEach(c => {
            if (c.id === targetId || c.linkedTo === targetId) {
              c.status = c.id === targetId ? "occupied" : "linked";
              c.currentOrder = orderId;
              saveToSupabase(collName, c, c.id.toString());
            }
          });
          io.emit("update_comandas", comandas);
        } else {
          tables.forEach(t => {
            if (t.id === targetId || t.linkedTo === targetId) {
              t.status = t.id === targetId ? "occupied" : "linked";
              t.currentOrder = orderId;
              saveToSupabase(collName, t, t.id.toString());
            }
          });
          io.emit("update_tables", tables);
        }
        
        console.log("Emitted final table updates for new order");
      }

      // Dynamic stock reduction
      applyStockReduction(orderData.items);
    });

    socket.on("update_product", requireAdmin(({ categoryName, productId, updatedData }) => {
      menu = menu.map(cat => {
        if (cat.name === categoryName) {
          return {
            ...cat,
            items: cat.items.map(item => {
              if (item.id === productId) {
                return { ...item, ...updatedData };
              }
              return item;
            })
          };
        }
        return cat;
      });
      io.emit("update_menu", menu);
      saveMenuToSupabase();

      // Sincroniza o nome no estoque se o produto for renomeado
      if (updatedData.name) {
        const stockEntry = stock.find((s: any) => s.menuItemId === productId);
        if (stockEntry) {
          stock = stock.map((s: any) =>
            s.menuItemId === productId ? { ...s, name: updatedData.name } : s
          );
          io.emit("update_stock", stock);
          saveToSupabase('stock', stock.find((s: any) => s.menuItemId === productId), productId).catch(() => {});
        }
      }
    }));

    socket.on("add_product", requireAdmin(({ categoryName, productData }) => {
      menu = menu.map(cat => {
        if (cat.name === categoryName) {
          const newItem = {
            id: randomUUID(),
            ...productData
          };
          return {
            ...cat,
            items: [...cat.items, newItem]
          };
        }
        return cat;
      });
      io.emit("update_menu", menu);
      saveMenuToSupabase();
    }));

    socket.on("add_category", requireAdmin((categoryData) => {
      const newCategory = {
        name: categoryData.name,
        type: categoryData.type || "lanches",
        items: []
      };
      menu.push(newCategory);
      io.emit("update_menu", menu);
      saveMenuToSupabase();
    }));

    socket.on("update_category", requireAdmin(({ oldName, updatedData }) => {
      menu = menu.map(cat => {
        if (cat.name === oldName) {
          return { ...cat, ...updatedData };
        }
        return cat;
      });
      io.emit("update_menu", menu);
      saveMenuToSupabase();
    }));

    socket.on("delete_category", requireAdmin((categoryName) => {
      menu = menu.filter(cat => cat.name !== categoryName);
      io.emit("update_menu", menu);
      saveMenuToSupabase();
    }));

    socket.on("delete_product", requireAdmin(({ categoryName, productId }) => {
      menu = menu.map(cat => {
        if (cat.name === categoryName) {
          return {
            ...cat,
            items: cat.items.filter(item => item.id !== productId)
          };
        }
        return cat;
      });
      io.emit("update_menu", menu);
      saveMenuToSupabase();
    }));

    socket.on("toggle_stock_tracking", requireAdmin(({ menuItemId, categoryName, enabled }) => {
      menu = menu.map((cat: any) => {
        if (cat.name === categoryName) {
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
        const menuItem = menu.flatMap((c: any) => c.items).find((i: any) => i.id === menuItemId);
        if (menuItem && !stock.find((s: any) => s.menuItemId === menuItemId)) {
          stock.push({
            id: menuItemId,
            menuItemId,
            name: menuItem.name,
            quantity: 0,
            unit: 'un',
            minQuantity: 0,
          });
        }
      } else {
        stock = stock.filter((s: any) => s.menuItemId !== menuItemId);
        stockLog = stockLog.filter((l: any) => {
          const entry = stock.find((s: any) => s.menuItemId === menuItemId);
          return entry ? l.itemName !== entry.name : true;
        });
      }

      io.emit("update_menu", menu);
      io.emit("update_stock", stock);
      io.emit("update_stock_log", stockLog);
      saveMenuToSupabase();
    }));

    socket.on("update_stock_item", requireAdmin(({ menuItemId, quantity, minQuantity, unit, reason }) => {
      const prev = stock.find((s: any) => (s.menuItemId ?? s.id) === menuItemId);
      if (!prev) return;
      const prevQty = prev.quantity ?? 0;
      stock = stock.map((s: any) =>
        (s.menuItemId ?? s.id) === menuItemId
          ? { ...s, quantity, minQuantity, unit: unit || s.unit }
          : s
      );
      if (quantity !== prevQty) {
        const change = quantity - prevQty;
        const defaultReason = change > 0 ? 'Entrada manual' : 'Ajuste manual';
        stockLog = [{
          id: randomUUID(),
          itemName: prev.name,
          change,
          reason: (reason && String(reason).trim()) ? String(reason).trim() : defaultReason,
          timestamp: new Date().toISOString(),
        }, ...stockLog].slice(0, 100);
        io.emit("update_stock_log", stockLog);
      }
      io.emit("update_stock", stock);
    }));

    socket.on("update_pizza_flavor", requireAdmin(({ flavorName, updatedData }) => {
      pizzaFlavors = pizzaFlavors.map(f => {
        if (f.name === flavorName) {
          return { ...f, ...updatedData };
        }
        return f;
      });
      io.emit("update_pizza_flavors", pizzaFlavors);
    }));

    socket.on("add_pizza_flavor", requireAdmin((flavorData) => {
      pizzaFlavors.push(flavorData);
      io.emit("update_pizza_flavors", pizzaFlavors);
    }));

    socket.on("delete_pizza_flavor", requireAdmin((flavorName) => {
      pizzaFlavors = pizzaFlavors.filter(f => f.name !== flavorName);
      io.emit("update_pizza_flavors", pizzaFlavors);
    }));

    socket.on("update_pizza_crust", requireAdmin(({ oldName, newName }) => {
      pizzaCrusts = pizzaCrusts.map(c => c === oldName ? newName : c);
      io.emit("update_pizza_crusts", pizzaCrusts);
    }));

    socket.on("add_pizza_crust", requireAdmin((crustName) => {
      pizzaCrusts.push(crustName);
      io.emit("update_pizza_crusts", pizzaCrusts);
    }));

    socket.on("delete_pizza_crust", requireAdmin((crustName) => {
      pizzaCrusts = pizzaCrusts.filter(c => c !== crustName);
      io.emit("update_pizza_crusts", pizzaCrusts);
    }));

    socket.on("bulk_import", requireAdmin(async ({ menu: importedMenu, stock: importedStock }) => {
      if (importedMenu && Array.isArray(importedMenu)) {
        menu = importedMenu;
        io.emit("update_menu", menu);
        if (db) {
          try {
            await db.from('menu').delete().neq('id', '');
          } catch {}
          saveMenuToSupabase();
        }
      }
      if (importedStock && Array.isArray(importedStock)) {
        stock = importedStock;
        io.emit("update_stock", stock);
        stockLog = [];
        io.emit("update_stock_log", stockLog);
      }
      socket.emit("import_complete", {
        menuCategories: importedMenu?.length ?? 0,
        stockItems: importedStock?.length ?? 0,
      });
    }));

    socket.on("add_item_to_order", async ({ orderId, item }) => {
      if (!isCashRegisterOpen) {
        socket.emit("error_message", "O caixa estÃ¡ fechado. Abra o caixa para adicionar itens.");
        return;
      }

      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? waiters.find(w => w.id === waiterId) : null;

      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso estÃ¡ inativo. Entre em contato com o gerente.");
        return;
      }

      const order = orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        if (order.status === "aguardando_baixa") {
          socket.emit("error_message", "Pedido aguardando baixa no caixa. NÃ£o Ã© possÃ­vel adicionar itens.");
          return;
        }
        const resolvedWaiterName = waiter?.name || (socket as any).waiterName || item.waiterName || 'Desconhecido';
        // Resolve type from server menu for non-pizza items
        let resolvedType = item.type;
        if (item.type !== 'pizzas') {
          const cat = item.menuItemId
            ? menu.find((c: any) => c.items.some((i: any) => i.id === item.menuItemId))
            : menu.find((c: any) => c.items.some((i: any) => i.name === item.name));
          if (cat?.type) resolvedType = cat.type;
        }
        const itemWithTimestamp = { ...item, type: resolvedType, waiterName: resolvedWaiterName, timestamp: new Date().toISOString() };
        if (!order.items) order.items = [];
        order.items.push(itemWithTimestamp);

        // Emit immediately for fast UI
        io.emit("update_orders", orders);
        io.emit("kitchen_new_order", { items: [itemWithTimestamp], tableId: order.tableId, isComanda: order.isComanda });

        await saveToSupabase('orders', order, String(order.id));
        
        // Update stock for the added item
        applyStockReduction([itemWithTimestamp]);
      }
    });

    socket.on("remove_item", async ({ orderId, itemId, quantity, reason, removedBy }) => {
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso estÃ¡ inativo. Entre em contato com o gerente.");
        return;
      }

      const order = orders.find(o => orderId && o.id && String(o.id) === String(orderId));
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
          await saveToSupabase('orders', order, String(order.id));
          io.emit("update_orders", orders);
        }
      }
    });

    socket.on("pay_items", async ({ orderId, selectedItems, partialAmount, paymentMethod, payerName, fromAdmin }) => {
      const order = orders.find(o => orderId && o.id && String(o.id) === String(orderId));
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
            console.log(`Order ${orderId} fully paid via admin. Freeing tables directly.`);
            order.status = "finalizada";

            const entitiesToUpdate: any[] = [];
            tables.forEach((t: any) => {
              if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
                t.status = "free";
                t.currentOrder = null;
                t.linkedTo = null;
                entitiesToUpdate.push({ entity: t, collection: 'tables' });
              }
            });
            comandas.forEach((c: any) => {
              if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
                c.status = "free";
                c.currentOrder = null;
                c.linkedTo = null;
                entitiesToUpdate.push({ entity: c, collection: 'comandas' });
              }
            });

            io.emit("update_orders", orders);
            io.emit("update_tables", tables);
            io.emit("update_comandas", comandas);
            await saveToSupabase('orders', order, String(order.id));
            for (const item of entitiesToUpdate) {
              await saveToSupabase(item.collection, item.entity, String(item.entity.id));
            }
            return;
          } else {
            // Pagamento via GarÃ§om: aguarda baixa para liberar mesa
            console.log(`Order ${orderId} fully paid. Setting aguardando_baixa.`);
            order.status = "aguardando_baixa";

            tables.forEach(t => {
              if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
                t.status = "aguardando_baixa";
                saveToSupabase('tables', t, String(t.id)).catch(() => {});
              }
            });
            comandas.forEach(c => {
              if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
                c.status = "aguardando_baixa";
                saveToSupabase('comandas', c, String(c.id)).catch(() => {});
              }
            });
          }
        }

        // Emit updates IMMEDIATELY for UI responsiveness
        io.emit("update_orders", orders);
        io.emit("update_comandas", comandas);
        io.emit("update_tables", tables);
        
        await saveToSupabase('orders', order, String(order.id));
      }
    });

    socket.on("link_tables", requireAdmin(async ({ sourceTableId, targetTableId, isComanda }) => {
      const targetList = isComanda ? comandas : tables;
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
          const sourceOrder = orders.find(o => String(o.id) === String(sourceTable.currentOrder));
          if (sourceOrder) {
            if (targetTable.currentOrder) {
              const targetOrder = orders.find(o => String(o.id) === String(targetTable.currentOrder));
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

        // Update all tables and comandas that were linked to source to now point to ultimateTarget
        const updateLinked = (t) => {
          if (String(t.linkedTo) === String(sourceTable.id)) {
            t.linkedTo = finalTargetTableId;
            t.currentOrder = targetTable.currentOrder;
          }
        };
        if (isComanda) {
          comandas.forEach(updateLinked);
        } else {
          tables.forEach(updateLinked);
        }

        // Persist changes to Firestore
        const tableCol = isComanda ? 'comandas' : 'tables';
        await saveToSupabase(tableCol, sourceTable, sourceTable.id.toString());
        await saveToSupabase(tableCol, targetTable, targetTable.id.toString());
        
        if (targetTable.currentOrder) {
          const tOrder = orders.find(o => o.id.toString() === targetTable.currentOrder.toString());
          if (tOrder) await saveToSupabase('orders', tOrder, tOrder.id.toString());
        }

        io.emit("update_comandas", comandas);
        io.emit("update_tables", tables);
        io.emit("update_orders", orders);
      }
    }));

    socket.on("transfer_table", async ({ sourceTableId, targetTableId, isComanda, reason }) => {
      const targetList = isComanda ? comandas : tables;
      const sourceTable = targetList.find(t => String(t.id) === String(sourceTableId));
      const targetTable = targetList.find(t => String(t.id) === String(targetTableId));

      if (sourceTable && targetTable && sourceTable.currentOrder) {
        const sourceOrder = orders.find(o => String(o.id) === String(sourceTable.currentOrder));
        const targetOrder = targetTable.currentOrder ? orders.find(o => String(o.id) === String(targetTable.currentOrder)) : null;

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
            const sourceOrderIndex = orders.findIndex(o => String(o.id) === String(sourceOrder.id));
            if (sourceOrderIndex !== -1) orders.splice(sourceOrderIndex, 1);
          } else {
            // Simple transfer
            sourceOrder.tableId = targetTableId;
            targetTable.currentOrder = sourceOrder.id;
            targetTable.status = sourceTable.status === "linked" ? "occupied" : sourceTable.status;
          }
          
          // Update any tables/comandas linked to the source table to point to the target table
          const updateLinked = (t) => {
            if (String(t.linkedTo) === String(sourceTableId)) {
              t.linkedTo = targetTableId;
              t.currentOrder = targetTable.currentOrder;
            }
          };
          if (isComanda) {
            comandas.forEach(updateLinked);
          } else {
            tables.forEach(updateLinked);
          }

          sourceTable.currentOrder = null;
          sourceTable.status = "free";
          sourceTable.linkedTo = null;

          // Persist changes
          await saveToSupabase(isComanda ? 'comandas' : 'tables', sourceTable, sourceTable.id.toString());
          await saveToSupabase(isComanda ? 'comandas' : 'tables', targetTable, targetTable.id.toString());
          if (sourceOrder) await saveToSupabase('orders', sourceOrder, sourceOrder.id);
          if (targetOrder) await saveToSupabase('orders', targetOrder, targetOrder.id);
        }

        io.emit("update_comandas", comandas);
        io.emit("update_tables", tables);
        io.emit("update_orders", orders);
      }
    });

    socket.on("transfer_items", async ({ sourceTableId, targetTableId, isComanda, itemIds }) => {
      console.log(`[transfer_items] src=${sourceTableId} dst=${targetTableId} isComanda=${isComanda} itemIds=${JSON.stringify(itemIds)}`);

      const tableList = isComanda ? comandas : tables;
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

      const sourceOrder = orders.find(o => String(o.id) === String(sourceTable.currentOrder));
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

      // Find or create target order â€" ignore finalized orders (items would be invisible)
      let targetOrder: any = targetTable.currentOrder
        ? orders.find(o => String(o.id) === String(targetTable.currentOrder) && o.status !== 'finalizada')
        : null;

      if (!targetOrder) {
        targetOrder = {
          id: generateOrderId(),
          tableId: Number(targetTableId),
          isComanda: !!isComanda,
          status: 'pending',
          items: [],
          timestamp: new Date().toISOString(),
          paymentLog: [],
          waiterName: sourceOrder.waiterName || 'TransferÃªncia'
        };
        orders.push(targetOrder);
        targetTable.currentOrder = targetOrder.id;
        targetTable.status = 'occupied';
        console.log(`[transfer_items] created new targetOrder id=${targetOrder.id}`);
      } else {
        console.log(`[transfer_items] reusing existing targetOrder id=${targetOrder.id}`);
      }

      const tableCol = isComanda ? 'comandas' : 'tables';

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

      // If source has no remaining active items, free source table and any tables linked to it
      const remainingActive = sourceOrder.items.filter((i: any) => !i.removed && !i.paid);
      console.log(`[transfer_items] remainingActive=${remainingActive.length}`);

      // Capture linked tables BEFORE nulling their linkedTo (so we can persist them later)
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
      io.emit("update_orders", orders);
      io.emit("update_tables", tables);
      io.emit("update_comandas", comandas);
      console.log(`[transfer_items] emitted updates â€" persisting to Firestore`);

      // Persist to Firestore (onSnapshot will re-emit after each save with the same correct data)
      await saveToSupabase('orders', sourceOrder, String(sourceOrder.id));
      await saveToSupabase('orders', targetOrder, String(targetOrder.id));
      await saveToSupabase(tableCol, targetTable, targetTable.id.toString());
      if (remainingActive.length === 0) {
        await saveToSupabase(tableCol, sourceTable, sourceTable.id.toString());
        for (const lt of linkedTablesToFree) {
          await saveToSupabase(tableCol, lt, lt.id.toString());
        }
      }
      console.log(`[transfer_items] Firestore persistence complete`);
    });

    socket.on("apply_discount", requireAdmin(async ({ orderId, itemId, discount, discountType }) => {
      const order = orders.find(o => String(o.id) === String(orderId));
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
        await saveToSupabase('orders', order, order.id);
        io.emit("update_orders", orders);
      }
    }));

    socket.on("confirm_baixa", async ({ orderId }) => {
      const order = orders.find((o: any) => String(o.id) === String(orderId));
      if (!order || order.status !== "aguardando_baixa") return;

      order.status = "finalizada";

      const entitiesToUpdate: any[] = [];
      tables.forEach((t: any) => {
        if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
          t.status = "free";
          t.currentOrder = null;
          t.linkedTo = null;
          entitiesToUpdate.push({ entity: t, collection: 'tables' });
        }
      });
      comandas.forEach((c: any) => {
        if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
          c.status = "free";
          c.currentOrder = null;
          c.linkedTo = null;
          entitiesToUpdate.push({ entity: c, collection: 'comandas' });
        }
      });

      io.emit("update_orders", orders);
      io.emit("update_tables", tables);
      io.emit("update_comandas", comandas);

      await saveToSupabase('orders', order, String(order.id));
      for (const item of entitiesToUpdate) {
        await saveToSupabase(item.collection, item.entity, String(item.entity.id));
      }
      console.log(`Baixa confirmada para pedido ${orderId}`);
    });

    socket.on("update_order_status", async ({ orderId, status }) => {
      const order = orders.find(o => String(o.id) === String(orderId));
      if (order) {
        order.status = status;
        await saveToSupabase('orders', order, order.id);
        io.emit("update_orders", orders);
      }
    });

    socket.on("request_bill", async ({ tableId, isComanda }) => {
      const targetList = isComanda ? comandas : tables;
      const table = targetList.find(t => t.id === tableId);
      if (table) {
        table.status = "bill_requested";
        await saveToSupabase(isComanda ? 'comandas' : 'tables', table, table.id.toString());
        if (isComanda) {
          io.emit("update_comandas", comandas);
        } else {
          io.emit("update_tables", tables);
        }
      }
    });

    socket.on("close_table", async ({ tableId, isComanda }) => {
      const targetList = isComanda ? comandas : tables;
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
        
        // Free the main table, the ultimate target, and all tables/comandas linked to that target or sharing the order
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
          comandas.forEach(c => processFree(c, ultimateTargetId, orderId));
        } else {
          tables.forEach(t => processFree(t, ultimateTargetId, orderId));
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
        io.emit("update_comandas", comandas);
        io.emit("update_tables", tables);
        io.emit("update_orders", orders);

        for (const entity of entitiesToFree) {
          await saveToSupabase(isComanda ? 'comandas' : 'tables', entity, entity.id.toString());
        }

        if (orderId) {
          const order = orders.find(o => o.id === orderId);
          if (order) {
            order.status = "finalizada";
            await saveToSupabase('orders', order, order.id);
          }
        }
      }
    });

    // Reset all in-memory state: free all tables/comandas and wipe orders.
    // No requireAdmin wrapper â€" auth may be unavailable when Firebase is disabled,
    // and the button is already protected by the admin-only dashboard UI.
    socket.on("reset_system", async () => {
      console.log("reset_system: clearing all in-memory orders, tables, comandas and stockLog");

      orders = [];
      stockLog = [];

      tables.forEach(t => {
        t.status = "free";
        t.currentOrder = null;
        t.linkedTo = null;
      });

      comandas.forEach(c => {
        c.status = "free";
        c.currentOrder = null;
        c.linkedTo = null;
      });

      isCashRegisterOpen = false;

      io.emit("update_orders", orders);
      io.emit("update_stock_log", stockLog);
      io.emit("update_tables", tables);
      io.emit("update_comandas", comandas);
      io.emit("update_cash_register", false);

      // Persist reset to Supabase
      try {
        await db.from('orders').delete().neq('id', '');
        await db.from('tables').update({ status: 'free', current_order: null, linked_to: null }).neq('id', 0);
        await db.from('comandas').update({ status: 'free', current_order: null, linked_to: null }).neq('id', 0);
        console.log('reset_system: Supabase cleared successfully');
      } catch (err) {
        console.error('reset_system: failed to clear Supabase', err);
      }
    });

    // Scan de impressoras — Dashboard pede, servidor repassa ao agente
    socket.on("scan_printers_request", () => {
      if (printerAgentSocket?.connected) {
        printerAgentSocket.emit("scan_printers_request");
      } else {
        socket.emit("scan_printers_result", { printers: [], error: "Agente offline" });
      }
    });

    // ── Impressão ESC/POS ─────────────────────────────────────────────────────
    // Se o agente local estiver conectado, delega para ele (cenário VPS).
    // Caso contrário, o servidor tenta conexão TCP direta (cenário local/dev).
    socket.on("print_escpos", ({ ip, port = 9100, localName, data }: { ip?: string; port?: number; localName?: string; data: number[] }) => {
      if (!data?.length) return;

      if (printerAgentSocket && printerAgentSocket.connected) {
        printerAgentSocket.emit("do_print", { ip, port, localName, data });
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
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
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
    if (!db) return res.status(503).json({ error: "Supabase nÃ£o inicializado" });

    const steps: string[] = [];
    const log = (msg: string) => { steps.push(msg); console.log("[seed]", msg); };

    try {
      log("Limpando tabelas antigas...");
      await db.from('orders').delete().neq('id', '');
      await db.from('stock').delete().neq('id', '');
      await db.from('pizza_flavors').delete().neq('id', '');
      await db.from('pizza_crusts').delete().neq('id', '');

      log("Configurando 40 mesas...");
      await db.from('tables').upsert(
        Array.from({ length: 40 }, (_, i) => ({ id: i + 1, status: 'free', current_order: null, linked_to: null }))
      );

      log("Configurando 50 comandas...");
      await db.from('comandas').upsert(
        Array.from({ length: 50 }, (_, i) => ({ id: i + 1, status: 'free', current_order: null, linked_to: null }))
      );

      log("Carregando categorias do menu...");
      await db.from('menu').upsert(
        MENU_CATEGORIES.map((cat: any, idx: number) => ({ id: cat.name, name: cat.name, position: idx, items: cat.items || [] }))
      );

      log("Carregando sabores de pizza...");
      await db.from('pizza_flavors').upsert(
        PIZZA_FLAVORS.map((f: any) => ({ id: f.name, name: f.name, category: f.category || null, price: f.price || null, available: f.available !== false }))
      );

      log("Carregando bordas...");
      await db.from('pizza_crusts').upsert(
        PIZZA_CRUSTS.map((c: any) => ({ id: c, name: c }))
      );

      log("Configurando sistema de caixa...");
      await db.from('config').upsert({ id: 'app', data: { isCashRegisterOpen: false, dailyCounter: 0, lastOrderDate: '' } });

      log("ConcluÃ­do!");
      res.json({ ok: true, steps });
    } catch (err: any) {
      console.error("[seed] Erro:", err);
      res.status(500).json({ error: err.message, steps });
    }
  });

  app.post("/api/admin/create-waiter", express.json(), (req, res) => {
    const { name, password } = req.body;
    if (!name || !password) {
      return res.status(400).json({ error: "name e password sÃ£o obrigatÃ³rios" });
    }
    const existing = waiters.find((w: any) => w.name === name);
    if (existing) {
      return res.status(409).json({ error: "GarÃ§om com esse nome jÃ¡ existe" });
    }
    const newWaiter = {
      id: `waiter_${Date.now()}`,
      name,
      password,
      status: "approved",
      role: "waiter",
      createdAt: new Date().toISOString(),
    };
    waiters.push(newWaiter);
    io.emit("update_waiters", waiters);
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

    const { data: employees } = await db.from('fin_employees').select('id, name').eq('tenant_id', (tokenData as any).tenant_id).neq('status', 'inativo').order('name');
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
