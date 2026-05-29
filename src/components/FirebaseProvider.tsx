import React, { createContext, useContext, useEffect, useState } from 'react';
import socket from '../lib/socket';
import { Table, Order, Waiter, StockItem, MenuCategory, PizzeriaConfig } from '../types';
import { toast } from 'sonner';
import { getSession } from '../lib/auth';

interface FirebaseContextType {
  user: null;
  loading: boolean;
  isAdmin: boolean;
  tenantId: string | undefined;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  toggleCashRegister: (open: boolean) => void;
  updateTableStatusLocal: (id: number, isComanda: boolean, status: string) => void;
  updatePizzeriaConfig: (config: PizzeriaConfig) => void;
  data: {
    tables: Table[];
    comandas: Table[];
    orders: Order[];
    waiters: Waiter[];
    stock: StockItem[];
    stockLog: any[];
    menu: MenuCategory[];
    isCashRegisterOpen: boolean;
    pizzariaConfig: PizzeriaConfig;
  };
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

interface FirebaseProviderProps {
  children: React.ReactNode;
  tenantId?: string;
  isWaiterMode?: boolean;
}

const CACHE_KEY_PREFIX = 'pdv_init_cache_';

function loadCache(tenantId?: string) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + (tenantId || 'default'));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveCache(tenantId: string | undefined, data: any) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + (tenantId || 'default'), JSON.stringify(data));
  } catch {}
}

export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  tenantId,
  isWaiterMode = false,
}) => {
  const user = null;
  const isAdmin = !isWaiterMode;

  const cached = loadCache(tenantId);

  const defaultPizzeriaConfig: PizzeriaConfig = {
    enabled: false,
    yellowMinutes: 15,
    orangeMinutes: 20,
    redMinutes: 25,
    inactivityMinutes: 30,
  };

  const [loading, setLoading] = useState(!cached);
  const [tables, setTables] = useState<Table[]>(cached?.tables ?? []);
  const [comandas, setComandas] = useState<Table[]>(cached?.comandas ?? []);
  const [orders, setOrders] = useState<Order[]>(cached?.orders ?? []);
  const [waiters, setWaiters] = useState<Waiter[]>(cached?.waiters ?? []);
  const [stock, setStock] = useState<StockItem[]>(cached?.stock ?? []);
  const [stockLog, setStockLog] = useState<any[]>(cached?.stockLog ?? []);
  const [menu, setMenu] = useState<MenuCategory[]>(cached?.menu ?? []);
  const [isCashRegisterOpen, setIsCashRegisterOpen] = useState<boolean>(cached?.isCashRegisterOpen ?? false);
  const [pizzariaConfig, setPizzeriaConfig] = useState<PizzeriaConfig>(cached?.pizzariaConfig ?? defaultPizzeriaConfig);

  const updateTableStatusLocal = (id: number, isComanda: boolean, status: string) => {
    if (isComanda) {
      setComandas(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    } else {
      setTables(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    }
  };

  useEffect(() => {
    let socketUnsubscribes: (() => void)[] = [];

    const handleUpdateOrders = (data: Order[]) => setOrders(data);
    const handleUpdateTables = (data: Table[]) => setTables(data);
    const handleUpdateComandas = (data: Table[]) => setComandas(data);
    const handleUpdateCashRegister = (isOpen: boolean) => setIsCashRegisterOpen(isOpen);
    const handleUpdatePizzeriaConfig = (config: PizzeriaConfig) => setPizzeriaConfig(config);
    const handleUpdateMenu = (data: MenuCategory[]) => {
      const transformed = data.map((cat: any) => ({
        ...cat,
        name: (cat.name === 'Éxodo' && cat.type === 'bebidas') ? 'Bebidas' : cat.name
      }));
      setMenu(transformed);
      saveCache(tenantId, { ...loadCache(tenantId), menu: transformed });
    };
    const handleUpdateStock = (data: StockItem[]) => setStock(data);
    const handleUpdateStockLog = (data: any[]) => setStockLog(data);
    const handleUpdateWaiters = (data: Waiter[]) => setWaiters(data);

    const handleInitData = (data: any) => {
      const transformMenu = (cats: any[]) => cats.map((cat: any) => ({
        ...cat,
        name: (cat.name === 'Éxodo' && cat.type === 'bebidas') ? 'Bebidas' : cat.name
      }));

      if (data.tables) setTables(data.tables);
      if (data.comandas) setComandas(data.comandas);
      if (data.orders) setOrders(data.orders);
      if (data.stock) setStock(data.stock);
      if (data.stockLog) setStockLog(data.stockLog);
      if (data.waiters) setWaiters(data.waiters);
      if (data.isCashRegisterOpen !== undefined) setIsCashRegisterOpen(data.isCashRegisterOpen);
      if (data.pizzariaConfig) setPizzeriaConfig(data.pizzariaConfig);
      if (data.menu) setMenu(transformMenu(data.menu));

      saveCache(tenantId, {
        ...data,
        menu: data.menu ? transformMenu(data.menu) : undefined,
      });
      setLoading(false);
    };

    socket.on('init_data', handleInitData);
    socket.on('update_orders', handleUpdateOrders);
    socket.on('update_tables', handleUpdateTables);
    socket.on('update_comandas', handleUpdateComandas);
    socket.on('update_cash_register', handleUpdateCashRegister);
    socket.on('update_pizzaria_config', handleUpdatePizzeriaConfig);
    socket.on('update_menu', handleUpdateMenu);
    socket.on('update_stock', handleUpdateStock);
    socket.on('update_stock_log', handleUpdateStockLog);
    socket.on('update_waiters', handleUpdateWaiters);

    // Request init data immediately — no need to wait for auth
    socket.emit('request_init_data');

    // Auth in background: grants admin privileges on the socket
    const identifyConnection = async () => {
      if (isWaiterMode && tenantId) {
        socket.emit('waiter_identify_tenant', { tenantId });
        return;
      }
      try {
        const session = await getSession();
        const token = session?.access_token;
        if (token) {
          socket.emit('admin_connect', token);
          if (tenantId) socket.emit('tenant_connect', { tenantId, supabaseToken: token });
        }
      } catch {}
    };

    identifyConnection();

    // Re-identify and re-request data on reconnect
    const handleReconnect = () => {
      socket.emit('request_init_data');
      identifyConnection();
    };
    socket.on('connect', handleReconnect);

    socketUnsubscribes.push(() => {
      socket.off('init_data', handleInitData);
      socket.off('update_orders', handleUpdateOrders);
      socket.off('update_tables', handleUpdateTables);
      socket.off('update_comandas', handleUpdateComandas);
      socket.off('update_cash_register', handleUpdateCashRegister);
      socket.off('update_pizzaria_config', handleUpdatePizzeriaConfig);
      socket.off('update_menu', handleUpdateMenu);
      socket.off('update_stock', handleUpdateStock);
      socket.off('update_stock_log', handleUpdateStockLog);
      socket.off('update_waiters', handleUpdateWaiters);
      socket.off('connect', handleReconnect);
    });

    return () => {
      socketUnsubscribes.forEach(unsub => unsub());
    };
  }, [tenantId, isWaiterMode]);

  const signIn = async () => { toast.info('Autenticação não disponível neste modo.'); };
  const logout = async () => { toast.info('Sessão encerrada.'); };

  const updatePizzeriaConfig = (config: PizzeriaConfig) => {
    setPizzeriaConfig(config);
    socket.emit('update_pizzaria_config', config);
  };

  const toggleCashRegister = (open: boolean) => {
    socket.emit('toggle_cash_register', open);
    setIsCashRegisterOpen(open);
  };

  return (
    <FirebaseContext.Provider value={{
      user,
      loading,
      isAdmin,
      tenantId,
      signIn,
      logout,
      toggleCashRegister,
      updateTableStatusLocal,
      updatePizzeriaConfig,
      data: { tables, comandas, orders, waiters, stock, stockLog, menu, isCashRegisterOpen, pizzariaConfig }
    }}>
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
};
