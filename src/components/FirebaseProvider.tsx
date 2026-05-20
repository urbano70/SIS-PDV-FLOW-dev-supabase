import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import socket from '../lib/socket';
import { syncCollection } from '../lib/firebaseService';
import { Table, Order, Waiter, StockItem, MenuCategory } from '../types';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { toast } from 'sonner';

interface FirebaseContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
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
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [comandas, setComandas] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [isCashRegisterOpen, setIsCashRegisterOpen] = useState(false);

  useEffect(() => {
    let unsubscribes: (() => void)[] = [];

    const cleanup = () => {
      unsubscribes.forEach(unsub => unsub());
      unsubscribes = [];
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      cleanup();
      console.log("Auth state changed:", currentUser?.uid, currentUser?.email, currentUser?.isAnonymous);
      setUser(currentUser);
      
      if (currentUser) {
        // Check if Admin
        const adminEmail = 'urbano70@gmail.com';
        const isUserAdmin = currentUser.email === adminEmail;
        setIsAdmin(isUserAdmin);
        
        console.log("Starting waiters sync...");
        // Sync waiters (open to all signed in users)
        const unsubWaiters = syncCollection('waiters', (data) => {
          console.log(`Synced ${data.length} waiters`);
          setWaiters(data as Waiter[]);
        });
        if (unsubWaiters) unsubscribes.push(unsubWaiters);

        // Check if this user is an approved waiter (even if anonymous)
        let isApprovedWaiter = false;
        if (!isUserAdmin) {
          try {
            const waiterDoc = await getDoc(doc(db, 'waiters', currentUser.uid));
            if (waiterDoc.exists() && waiterDoc.data().status === 'approved') {
              isApprovedWaiter = true;
            }
          } catch (e) {
            console.error("Error checking waiter status:", e);
          }
        }

        if (currentUser.emailVerified || isUserAdmin || isApprovedWaiter) {
          console.log("Syncing restricted data...");
          // Sync Restricted Data
          const collectionsToSync = [
            { name: 'tables', setter: setTables },
            { name: 'comandas', setter: setComandas },
            { name: 'orders', setter: (d: any) => setOrders(d as Order[]) },
            { name: 'stock', setter: (d: any) => setStock(d as StockItem[]) },
            { name: 'menu', setter: (d: any) => {
              const transformedData = (d as MenuCategory[]).map(cat => ({
                ...cat,
                name: (cat.name === 'Éxodo' && cat.type === 'bebidas') ? 'Bebidas' : cat.name
              }));
              setMenu(transformedData);
            } }
          ];

          collectionsToSync.forEach(col => {
            const unsub = syncCollection(col.name, col.setter);
            if (unsub) unsubscribes.push(unsub);
          });
          
          // Socket.io sync for faster UI response
          const handleUpdateOrders = (data: Order[]) => setOrders(data);
          const handleUpdateTables = (data: Table[]) => setTables(data);
          const handleUpdateComandas = (data: Table[]) => setComandas(data);
          const handleUpdateCashRegister = (isOpen: boolean) => setIsCashRegisterOpen(isOpen);

          socket.on('update_orders', handleUpdateOrders);
          socket.on('update_tables', handleUpdateTables);
          socket.on('update_comandas', handleUpdateComandas);
          socket.on('update_cash_register', handleUpdateCashRegister);

          unsubscribes.push(() => {
            socket.off('update_orders', handleUpdateOrders);
            socket.off('update_tables', handleUpdateTables);
            socket.off('update_comandas', handleUpdateComandas);
            socket.off('update_cash_register', handleUpdateCashRegister);
          });
          
          // Sync config
          const configRef = doc(db, 'config', 'app');
          const unsubConfig = onSnapshot(configRef, (snapshot) => {
            if (snapshot.exists()) {
              setIsCashRegisterOpen(snapshot.data().isCashRegisterOpen);
            }
          });
          unsubscribes.push(unsubConfig);
        }
        setLoading(false);
      } else {
        // If no user, just stop loading. Anonymous auth is often disabled in Firebase console by default.
        setLoading(false);
      }
    });

    // Emergency loading fallback
    const loadingTimeout = setTimeout(() => {
      if (loading) {
        console.warn("Loading timeout reached, forcing ready state");
        setLoading(false);
      }
    }, 6000);

    return () => {
      unsubscribeAuth();
      cleanup();
      clearTimeout(loadingTimeout);
    };
  }, []);

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      toast.success('Login realizado com sucesso!');
    } catch (error) {
      toast.error('Erro ao realizar login.');
      console.error(error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      toast.success('Sessão encerrada.');
    } catch (error) {
      toast.error('Erro ao sair.');
    }
  };

  const toggleCashRegister = async (open: boolean) => {
    try {
      const configRef = doc(db, 'config', 'app');
      await setDoc(configRef, { 
        isCashRegisterOpen: open,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setIsCashRegisterOpen(open);
    } catch (error) {
      console.error("Error toggling cash register:", error);
    }
  };

  return (
    <FirebaseContext.Provider value={{ 
      user, 
      loading, 
      isAdmin, 
      signIn, 
      logout,
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
