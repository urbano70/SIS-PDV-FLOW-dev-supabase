import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { syncCollection } from '../lib/supabaseService';
import { Table, Order, Waiter, StockItem, MenuCategory } from '../types';
import { getLocalSeedData } from '../lib/seed';

interface FirebaseContextType {
  user: { email: string } | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  initLocalData: () => void;
  toggleCashRegister: (open: boolean) => Promise<void>;
  data: {
    tables: Table[];
    comandas: Table[];
    orders: Order[];
    waiters: Waiter[];
    stock: StockItem[];
    menu: MenuCategory[];
    isCashRegisterOpen: boolean;
  };
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<Table[]>([]);
  const [comandas, setComandas] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [isCashRegisterOpen, setIsCashRegisterOpen] = useState(false);

  const initLocalData = () => {
    const seed = getLocalSeedData();
    setTables(seed.tables as Table[]);
    setComandas(seed.comandas as Table[]);
    setMenu(seed.menu as MenuCategory[]);
    setIsCashRegisterOpen(seed.isCashRegisterOpen);
  };

  const toggleCashRegister = async (open: boolean) => {
    setIsCashRegisterOpen(open);
    const { error } = await supabase
      .from('config')
      .upsert({ id: 'app', is_cash_register_open: open });
    if (error) console.error('[Supabase] toggleCashRegister:', error.message);
  };

  useEffect(() => {
    // Sync all collections
    syncCollection('tables', setTables);
    syncCollection('comandas', setComandas);
    syncCollection('orders', (data) => setOrders(data as Order[]));
    syncCollection('waiters', (data) => setWaiters(data as Waiter[]));
    syncCollection('stock', (data) => setStock(data as StockItem[]));
    syncCollection('menu', (data) => setMenu(data as MenuCategory[]));

    // Config: initial load + real-time
    supabase.from('config').select('*').eq('id', 'app').single().then(({ data }) => {
      if (data) setIsCashRegisterOpen(data.is_cash_register_open);
    });

    const configChannel = supabase
      .channel('realtime:config')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, (payload) => {
        if (payload.new) setIsCashRegisterOpen((payload.new as any).is_cash_register_open);
      })
      .subscribe();

    setLoading(false);

    return () => { supabase.removeChannel(configChannel); };
  }, []);

  const signIn = async () => {};
  const logout = async () => {};

  return (
    <FirebaseContext.Provider value={{
      user: { email: 'urbano70@gmail.com' },
      loading,
      isAdmin: true,
      signIn,
      logout,
      initLocalData,
      toggleCashRegister,
      data: { tables, comandas, orders, waiters, stock, menu, isCashRegisterOpen }
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
