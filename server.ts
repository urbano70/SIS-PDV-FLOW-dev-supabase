import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { MENU_CATEGORIES, PIZZA_FLAVORS, PIZZA_CRUSTS } from "./src/constants.ts";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
  const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ["http://localhost:3000", "http://0.0.0.0:3000"];

  const io = new Server(httpServer, {
    cors: {
      origin: ALLOWED_ORIGINS,
    },
  });

  const PORT = 3000;

  // Initialize Firebase Admin on Server
  let db: admin.firestore.Firestore | any;
  try {
    const rawConfig = process.env.FIREBASE_CONFIG
      || (fs.existsSync(path.join(process.cwd(), 'firebase-applet-config.json'))
          ? fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8')
          : null);
    if (!rawConfig) throw new Error('Firebase config not found');
    const firebaseConfig = JSON.parse(rawConfig);
    if (!admin.apps.length) {
      // Aceita base64 (FIREBASE_SERVICE_ACCOUNT_B64) ou JSON puro (FIREBASE_SERVICE_ACCOUNT) ou arquivo local
      const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_B64
        ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf-8')
        : process.env.FIREBASE_SERVICE_ACCOUNT
          || (fs.existsSync(path.join(process.cwd(), 'service-account.json'))
              ? fs.readFileSync(path.join(process.cwd(), 'service-account.json'), 'utf-8')
              : null);
      console.log('[firebase-init] credential source:', process.env.FIREBASE_SERVICE_ACCOUNT_B64 ? 'B64 env' : process.env.FIREBASE_SERVICE_ACCOUNT ? 'JSON env' : fs.existsSync(path.join(process.cwd(), 'service-account.json')) ? 'file' : 'none');
      if (rawServiceAccount) {
        const credential = admin.credential.cert(JSON.parse(rawServiceAccount));
        admin.initializeApp({ credential, projectId: firebaseConfig.projectId });
      } else {
        admin.initializeApp({ projectId: firebaseConfig.projectId });
      }
    }
    // Usa o banco nomeado se configurado (firestoreDatabaseId no firebase-applet-config.json),
    // garantindo que servidor e cliente React leiam/gravem no mesmo banco.
    db = firebaseConfig.firestoreDatabaseId
      ? getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId)
      : getFirestore();
    console.log("Firebase Admin initialized on server");
  } catch (error) {
    console.error("Failed to initialize Firebase Admin on server:", error);
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

  // Initial Data Load and Real-time Sync from Firestore to Socket
  if (db) {
    // Sync waiters
    db.collection("waiters").onSnapshot((snapshot) => {
      waiters = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      io.emit("update_waiters", waiters);
    });

    // Sync active orders
    db.collection("orders").onSnapshot((snapshot) => {
      orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      io.emit("update_orders", orders);
    });

    // Sync tables
    db.collection("tables").onSnapshot((snapshot) => {
      const dbTables = snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
      dbTables.forEach(dbTable => {
        const index = tables.findIndex(t => t.id === dbTable.id);
        if (index !== -1) {
          tables[index] = { ...tables[index], ...dbTable };
        } else {
          tables.push(dbTable);
        }
      });
      tables.sort((a, b) => a.id - b.id);
      io.emit("update_tables", tables);
    });

    // Sync comandas
    db.collection("comandas").onSnapshot((snapshot) => {
      const dbComandas = snapshot.docs.map(doc => ({ id: parseInt(doc.id), ...doc.data() }));
      dbComandas.forEach(dbComanda => {
        const index = comandas.findIndex(c => c.id === dbComanda.id);
        if (index !== -1) {
          comandas[index] = { ...comandas[index], ...dbComanda };
        } else {
          comandas.push(dbComanda);
        }
      });
      comandas.sort((a, b) => a.id - b.id);
      io.emit("update_comandas", comandas);
    });

    // Sync config
    db.collection("config").doc("app").onSnapshot((snapshot) => {
      if (snapshot.exists) {
        const data = snapshot.data();
        isCashRegisterOpen = data.isCashRegisterOpen;
        io.emit("update_cash_register", isCashRegisterOpen);
        
        if (data.dailyCounter !== undefined) dailyCounter = data.dailyCounter;
        if (data.lastOrderDate !== undefined) lastOrderDate = data.lastOrderDate;
      }
    });

    // Sync menu
    db.collection("menu").onSnapshot((snapshot) => {
      menu = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      io.emit("update_menu", menu);
    });

    // Sync stock
    db.collection("stock").onSnapshot((snapshot) => {
      stock = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      io.emit("update_stock", stock);
    });

    // Sync pizza flavors
    db.collection("pizzaFlavors").onSnapshot((snapshot) => {
      pizzaFlavors = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      io.emit("update_pizza_flavors", pizzaFlavors);
    });

    // Sync pizza crusts
    db.collection("pizzaCrusts").onSnapshot((snapshot) => {
      pizzaCrusts = snapshot.docs.map(doc => doc.data().name || doc.id);
      io.emit("update_pizza_crusts", pizzaCrusts);
    });

    // Sync pizzaria config
    db.collection("config").doc("pizzaria").onSnapshot((snapshot) => {
      if (snapshot.exists) {
        pizzariaConfig = { ...pizzariaConfig, ...snapshot.data() };
        io.emit("update_pizzaria_config", pizzariaConfig);
      }
    });
  }

  // Helper to save to Firestore
  const saveToFirestore = async (path: string, data: any, docId?: string) => {
    if (!db) return;
    try {
      const sanitized = JSON.parse(JSON.stringify(data));
      if (docId) {
        await db.collection(path).doc(docId.toString()).set({
          ...sanitized,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } else {
        await db.collection(path).add({
          ...sanitized,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.error(`Error saving to Firestore (${path}):`, e);
    }
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
    
    // Persist to Firestore config for global sync
    if (db) {
      db.collection("config").doc("app").set({ 
        dailyCounter, 
        lastOrderDate,
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(err => console.error("Error syncing counter to Firestore:", err));
    }

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

  // ── Local state backup ───────────────────────────────────────────────────
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
      const age = state.savedAt ? Math.round((Date.now() - new Date(state.savedAt).getTime()) / 60000) : null;
      console.log(`[backup] Estado local restaurado (salvo ${age !== null ? `há ${age} min` : 'anteriormente'})`);
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

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

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
      firebaseActive: !!db
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
        firebaseActive: !!db
      });
    });

    socket.on("update_pizzaria_config", requireAdmin((config) => {
      pizzariaConfig = { ...pizzariaConfig, ...config };
      io.emit("update_pizzaria_config", pizzariaConfig);
      if (db) {
        db.collection("config").doc("pizzaria").set(pizzariaConfig, { merge: true })
          .catch((err: any) => console.error("Error saving pizzaria config:", err));
      }
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
      const waiterName = waiter?.name || '';

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

      if (db) {
        db.collection("orders").doc(String(orderId)).set(
          { items: order.items, deliveryLog: order.deliveryLog },
          { merge: true }
        ).catch((err: any) => console.error("Error saving delivery:", err));
      }
    });

    socket.on("kitchen_start_item", async ({ orderId, itemId }) => {
      const order = orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;
      item.kitchenStatus = 'preparing';
      io.emit("update_orders", orders);
      await saveToFirestore('orders', order, String(order.id));
    });

    socket.on("kitchen_finish_item", async ({ orderId, itemId }) => {
      const order = orders.find((o: any) => String(o.id) === String(orderId));
      if (!order) return;
      const item = order.items.find((i: any) => i.id === itemId);
      if (!item || item.deliveredAt) return;
      item.kitchenStatus = 'ready';
      io.emit("update_orders", orders);
      await saveToFirestore('orders', order, String(order.id));
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
        // Armazena todos os identificadores possíveis para matching robusto
        (socket as any).waiterId = waiter.id;
        (socket as any).waiterUid = waiter.uid;
        (socket as any).waiterCpf = waiter.cpf;
        (socket as any).waiterName = waiter.name;

        socket.emit("waiter_approved", { status: waiter.status });
        io.emit("update_waiters", waiters);
      } else {
        socket.emit("login_error", "Nome ou senha incorretos.");
      }
    });

    socket.on("toggle_cash_register", requireAdmin(async (isOpen) => {
      console.log(`Cash register toggle: ${isOpen}`);
      if (!isOpen) {
        const activeTables = tables.find(t => t.status !== "free");
        const activeComandas = comandas.find(c => c.status !== "free");
        if (activeTables || activeComandas) {
          socket.emit("error_message", "Não é possível fechar o caixa com mesas ou comandas ocupadas.");
          return;
        }
      }
      isCashRegisterOpen = isOpen;
      io.emit("update_cash_register", isCashRegisterOpen);
      await saveToFirestore('config', { isCashRegisterOpen: isOpen, updatedAt: new Date().toISOString() }, 'app');
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
        
        // Notifica o garçom por todos os identificadores possíveis
        const connectedSockets = io.sockets.sockets;
        connectedSockets.forEach((s) => {
          const matches =
            (s as any).waiterId   === waiter.id   ||
            (s as any).waiterId   === waiter.uid  ||
            (s as any).waiterId   === waiter.cpf  ||
            (s as any).waiterUid  === waiter.uid  ||
            (s as any).waiterCpf  === waiter.cpf  ||
            (s as any).waiterName === waiter.name;
          if (matches) s.emit("waiter_approved", { status: "approved" });
        });
      }
    }));

    socket.on("new_order", async (orderData) => {
      console.log("New order request received:", orderData.tableId, orderData.isComanda ? "Comanda" : "Table");
      
      if (!isCashRegisterOpen) {
        console.warn("Attempted order while register is closed");
        socket.emit("error_message", "O caixa está fechado. Abra o caixa para realizar pedidos.");
        return;
      }
      
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso está inativo. Entre em contato com o gerente.");
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
      const itemsWithWaiter = (orderData.items || []).map((item: any) => {
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
          timestamp: new Date().toISOString()
        };
      });

      if (table && table.status === "aguardando_baixa") {
        socket.emit("error_message", "Pedido aguardando baixa no caixa. Não é possível adicionar itens.");
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
          const kitchenItemsExisting = itemsWithWaiter.filter((i: any) => i.type === 'pizzas' || i.type === 'lanches');
          if (kitchenItemsExisting.length > 0) {
            io.emit("kitchen_new_order", { items: kitchenItemsExisting, tableId: existingOrder.tableId, isComanda: existingOrder.isComanda });
          }
          await saveToFirestore('orders', existingOrder, existingOrder.id.toString());
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
      const kitchenItemsNew = (newOrder.items || []).filter((i: any) => i.type === 'pizzas' || i.type === 'lanches');
      if (kitchenItemsNew.length > 0) {
        io.emit("kitchen_new_order", { items: kitchenItemsNew, tableId: newOrder.tableId, isComanda: newOrder.isComanda });
      }
      
      console.log("Emitted initial updates for new order");
      
      saveToFirestore('orders', newOrder, newOrder.id);
      saveToFirestore('config', { dailyCounter, lastOrderDate }, 'app');
      
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
              saveToFirestore(collName, c, c.id.toString());
            }
          });
          io.emit("update_comandas", comandas);
        } else {
          tables.forEach(t => {
            if (t.id === targetId || t.linkedTo === targetId) {
              t.status = t.id === targetId ? "occupied" : "linked";
              t.currentOrder = orderId;
              saveToFirestore(collName, t, t.id.toString());
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
    }));

    socket.on("add_category", requireAdmin((categoryData) => {
      const newCategory = {
        name: categoryData.name,
        type: categoryData.type || "lanches",
        items: []
      };
      menu.push(newCategory);
      io.emit("update_menu", menu);
    }));

    socket.on("update_category", requireAdmin(({ oldName, updatedData }) => {
      menu = menu.map(cat => {
        if (cat.name === oldName) {
          return { ...cat, ...updatedData };
        }
        return cat;
      });
      io.emit("update_menu", menu);
    }));

    socket.on("delete_category", requireAdmin((categoryName) => {
      menu = menu.filter(cat => cat.name !== categoryName);
      io.emit("update_menu", menu);
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
    }));

    socket.on("update_stock_item", requireAdmin(({ menuItemId, quantity, minQuantity, unit, reason }) => {
      const prev = stock.find((s: any) => s.menuItemId === menuItemId);
      if (!prev) return;
      const prevQty = prev.quantity ?? 0;
      stock = stock.map((s: any) =>
        s.menuItemId === menuItemId
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

    socket.on("bulk_import", requireAdmin(({ menu: importedMenu, stock: importedStock }) => {
      if (importedMenu && Array.isArray(importedMenu)) {
        menu = importedMenu;
        io.emit("update_menu", menu);
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
        socket.emit("error_message", "O caixa está fechado. Abra o caixa para adicionar itens.");
        return;
      }

      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? waiters.find(w => w.id === waiterId) : null;

      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso está inativo. Entre em contato com o gerente.");
        return;
      }

      const order = orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        if (order.status === "aguardando_baixa") {
          socket.emit("error_message", "Pedido aguardando baixa no caixa. Não é possível adicionar itens.");
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
        if (itemWithTimestamp.type === 'pizzas' || itemWithTimestamp.type === 'lanches') {
          io.emit("kitchen_new_order", { items: [itemWithTimestamp], tableId: order.tableId, isComanda: order.isComanda });
        }

        await saveToFirestore('orders', order, String(order.id));
        
        // Update stock for the added item
        applyStockReduction([itemWithTimestamp]);
      }
    });

    socket.on("remove_item", async ({ orderId, itemId, quantity, reason, removedBy }) => {
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso está inativo. Entre em contato com o gerente.");
        return;
      }

      const order = orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        const hasPartialPayment = (order.paymentLog || []).some((p: any) => p.type === 'partial');
        if (hasPartialPayment) {
          socket.emit("error_message", "Não é possível remover itens de uma comanda com pagamento parcial registrado.");
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
          await saveToFirestore('orders', order, String(order.id));
          io.emit("update_orders", orders);
        }
      }
    });

    socket.on("pay_items", async ({ orderId, selectedItems, partialAmount, paymentMethod, payerName }) => {
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
            method: paymentMethod || "Não informado",
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
            method: paymentMethod || "Não informado",
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
          console.log(`Order ${orderId} fully paid. Setting aguardando_baixa.`);
          order.status = "aguardando_baixa";

          // Mark tables/comandas as aguardando_baixa (keep currentOrder, don't free yet)
          tables.forEach(t => {
            if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
              t.status = "aguardando_baixa";
              saveToFirestore('tables', t, String(t.id)).catch(() => {});
            }
          });
          comandas.forEach(c => {
            if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
              c.status = "aguardando_baixa";
              saveToFirestore('comandas', c, String(c.id)).catch(() => {});
            }
          });
        }

        // Emit updates IMMEDIATELY for UI responsiveness
        io.emit("update_orders", orders);
        io.emit("update_comandas", comandas);
        io.emit("update_tables", tables);
        
        await saveToFirestore('orders', order, String(order.id));
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
        await saveToFirestore(tableCol, sourceTable, sourceTable.id.toString());
        await saveToFirestore(tableCol, targetTable, targetTable.id.toString());
        
        if (targetTable.currentOrder) {
          const tOrder = orders.find(o => o.id.toString() === targetTable.currentOrder.toString());
          if (tOrder) await saveToFirestore('orders', tOrder, tOrder.id.toString());
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
          await saveToFirestore(isComanda ? 'comandas' : 'tables', sourceTable, sourceTable.id.toString());
          await saveToFirestore(isComanda ? 'comandas' : 'tables', targetTable, targetTable.id.toString());
          if (sourceOrder) await saveToFirestore('orders', sourceOrder, sourceOrder.id);
          if (targetOrder) await saveToFirestore('orders', targetOrder, targetOrder.id);
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
        socket.emit("error_message", "Não é possível transferir itens: a mesa possui pagamento parcial registrado.");
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
        socket.emit("error_message", "Não é possível transferir item(s) já pagos.");
        return;
      }

      // Collect items BEFORE any mutation (excludes removed and paid)
      const itemsToTransfer = sourceOrder.items.filter(
        (i: any) => itemIdSet.has(String(i.id)) && !i.removed && !i.paid
      );
      if (itemsToTransfer.length === 0) {
        console.warn(`[transfer_items] itemsToTransfer is empty — no matching active items found`);
        return;
      }
      console.log(`[transfer_items] itemsToTransfer.length=${itemsToTransfer.length}`);

      // Find or create target order — ignore finalized orders (items would be invisible)
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
          waiterName: sourceOrder.waiterName || 'Transferência'
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
      // This prevents the Firestore onSnapshot (triggered by saveToFirestore) from racing
      // and emitting stale data that overwrites the correct state on clients.
      io.emit("update_orders", orders);
      io.emit("update_tables", tables);
      io.emit("update_comandas", comandas);
      console.log(`[transfer_items] emitted updates — persisting to Firestore`);

      // Persist to Firestore (onSnapshot will re-emit after each save with the same correct data)
      await saveToFirestore('orders', sourceOrder, String(sourceOrder.id));
      await saveToFirestore('orders', targetOrder, String(targetOrder.id));
      await saveToFirestore(tableCol, targetTable, targetTable.id.toString());
      if (remainingActive.length === 0) {
        await saveToFirestore(tableCol, sourceTable, sourceTable.id.toString());
        for (const lt of linkedTablesToFree) {
          await saveToFirestore(tableCol, lt, lt.id.toString());
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
        await saveToFirestore('orders', order, order.id);
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

      await saveToFirestore('orders', order, String(order.id));
      for (const item of entitiesToUpdate) {
        await saveToFirestore(item.collection, item.entity, String(item.entity.id));
      }
      console.log(`Baixa confirmada para pedido ${orderId}`);
    });

    socket.on("update_order_status", async ({ orderId, status }) => {
      const order = orders.find(o => String(o.id) === String(orderId));
      if (order) {
        order.status = status;
        await saveToFirestore('orders', order, order.id);
        io.emit("update_orders", orders);
      }
    });

    socket.on("request_bill", async ({ tableId, isComanda }) => {
      const targetList = isComanda ? comandas : tables;
      const table = targetList.find(t => t.id === tableId);
      if (table) {
        table.status = "bill_requested";
        await saveToFirestore(isComanda ? 'comandas' : 'tables', table, table.id.toString());
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
          await saveToFirestore(isComanda ? 'comandas' : 'tables', entity, entity.id.toString());
        }

        if (orderId) {
          const order = orders.find(o => o.id === orderId);
          if (order) {
            order.status = "finalizada";
            await saveToFirestore('orders', order, order.id);
          }
        }
      }
    });

    // Reset all in-memory state: free all tables/comandas and wipe orders.
    // No requireAdmin wrapper — auth may be unavailable when Firebase is disabled,
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

      // Persist reset to Firestore so server restarts don't reload stale state
      if (db) {
        try {
          const batch = db.batch();

          // Delete all orders from Firestore
          const ordersSnap = await db.collection("orders").get();
          ordersSnap.docs.forEach(doc => batch.delete(doc.ref));

          // Free all tables in Firestore
          const tablesSnap = await db.collection("tables").get();
          tablesSnap.docs.forEach(doc =>
            batch.set(doc.ref, { status: "free", currentOrder: null, linkedTo: null }, { merge: true })
          );

          // Free all comandas in Firestore
          const comandasSnap = await db.collection("comandas").get();
          comandasSnap.docs.forEach(doc =>
            batch.set(doc.ref, { status: "free", currentOrder: null, linkedTo: null }, { merge: true })
          );

          await batch.commit();
          console.log("reset_system: Firestore cleared successfully");
        } catch (err) {
          console.error("reset_system: failed to clear Firestore", err);
        }
      }
    });

    // Consolidated init_data is at the beginning of connection
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/admin/create-waiter", express.json(), (req, res) => {
    const { name, password } = req.body;
    if (!name || !password) {
      return res.status(400).json({ error: "name e password são obrigatórios" });
    }
    const existing = waiters.find((w: any) => w.name === name);
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
    waiters.push(newWaiter);
    io.emit("update_waiters", waiters);
    console.log(`[admin] Garçom criado: ${name}`);
    return res.json({ success: true, waiter: { id: newWaiter.id, name: newWaiter.name, status: newWaiter.status } });
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
