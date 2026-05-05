import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { syncCollection } from '../lib/firebaseService';
import { Table, Order, Waiter, StockItem, MenuCategory } from '../types';
import { doc } from 'firebase/firestore';

interface FirebaseContextType {
  user: { email: string } | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
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

  useEffect(() => {
    syncCollection('tables', setTables);
    syncCollection('comandas', setComandas);
    syncCollection('orders', (data) => setOrders(data as Order[]));
    syncCollection('waiters', (data) => setWaiters(data as Waiter[]));
    syncCollection('stock', (data) => setStock(data as StockItem[]));
    syncCollection('menu', (data) => setMenu(data as MenuCategory[]));

    const configRef = doc(db, 'config', 'app');
    onSnapshot(configRef, (doc) => {
      if (doc.exists()) {
        setIsCashRegisterOpen(doc.data().isCashRegisterOpen);
      }
    });

    setLoading(false);
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

// Re-exporting onSnapshot since it's needed for the config sync helper
import { onSnapshot } from 'firebase/firestore';
