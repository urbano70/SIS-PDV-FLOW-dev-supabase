import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut, signInAnonymously } from 'firebase/auth';
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
  updateTableStatusLocal: (id: number, isComanda: boolean, status: string) => void;
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
  const [isAdmin, setIsAdmin] = useState(true);
  const [tables, setTables] = useState<Table[]>([]);
  const [comandas, setComandas] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [isCashRegisterOpen, setIsCashRegisterOpen] = useState(false);

  const updateTableStatusLocal = (id: number, isComanda: boolean, status: string) => {
    if (isComanda) {
      setComandas(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    } else {
      setTables(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    }
  };

  useEffect(() => {
    let socketUnsubscribes: (() => void)[] = [];
    let firestoreUnsubscribes: (() => void)[] = [];

    const cleanupFirestore = () => {
      firestoreUnsubscribes.forEach(unsub => unsub());
      firestoreUnsubscribes = [];
    };

    // 1. Inicializar Socket.io imediatamente para carregamento rápido
    const handleUpdateOrders = (data: Order[]) => setOrders(data);
    const handleUpdateTables = (data: Table[]) => setTables(data);
    const handleUpdateComandas = (data: Table[]) => setComandas(data);
    const handleUpdateCashRegister = (isOpen: boolean) => setIsCashRegisterOpen(isOpen);

    const handleInitData = (data: any) => {
      console.log("Received init_data from socket, populating states immediately");
      if (data.tables) setTables(data.tables);
      if (data.comandas) setComandas(data.comandas);
      if (data.orders) setOrders(data.orders);
      if (data.stock) setStock(data.stock);
      if (data.waiters) setWaiters(data.waiters);
      if (data.isCashRegisterOpen !== undefined) setIsCashRegisterOpen(data.isCashRegisterOpen);
      if (data.menu) {
        const transformedData = data.menu.map((cat: any) => ({
          ...cat,
          name: (cat.name === 'Éxodo' && cat.type === 'bebidas') ? 'Bebidas' : cat.name
        }));
        setMenu(transformedData);
      }
      setLoading(false); // Finaliza o loading assim que os dados do socket chegam!
    };

    socket.on('init_data', handleInitData);
    socket.on('update_orders', handleUpdateOrders);
    socket.on('update_tables', handleUpdateTables);
    socket.on('update_comandas', handleUpdateComandas);
    socket.on('update_cash_register', handleUpdateCashRegister);

    // Solicitar os dados iniciais ativamente
    socket.emit('request_init_data');

    socketUnsubscribes.push(() => {
      socket.off('init_data', handleInitData);
      socket.off('update_orders', handleUpdateOrders);
      socket.off('update_tables', handleUpdateTables);
      socket.off('update_comandas', handleUpdateComandas);
      socket.off('update_cash_register', handleUpdateCashRegister);
    });

    // 2. Inicializar Firebase Auth e Firestore em segundo plano
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      cleanupFirestore();
      console.log("Auth state changed:", currentUser?.uid, currentUser?.email, currentUser?.isAnonymous);
      setUser(currentUser);
      setIsAdmin(true);
      
      if (!currentUser) {
        // Se não houver usuário, faz login anônimo automático em segundo plano
        try {
          await signInAnonymously(auth);
        } catch (e) {
          console.error("Error signing in anonymously:", e);
        }
        return;
      }
      
      if (currentUser) {
        console.log("Syncing Firestore collections in background...");
        
        // Sync waiters (open to all signed in users)
        const unsubWaiters = syncCollection('waiters', (data) => {
          setWaiters(data as Waiter[]);
        });
        if (unsubWaiters) firestoreUnsubscribes.push(unsubWaiters);

        // Sempre sincroniza dados restritos para o painel livre
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
          if (unsub) firestoreUnsubscribes.push(unsub);
        });
        
        // Sync config
        const configRef = doc(db, 'config', 'app');
        const unsubConfig = onSnapshot(configRef, (snapshot) => {
          if (snapshot.exists()) {
            setIsCashRegisterOpen(snapshot.data().isCashRegisterOpen);
          }
        });
        firestoreUnsubscribes.push(unsubConfig);
      }
    });

    // Fallback de emergência (reduzido para 4 segundos se nada responder)
    const loadingTimeout = setTimeout(() => {
      setLoading(false);
    }, 4000);

    return () => {
      unsubscribeAuth();
      cleanupFirestore();
      socketUnsubscribes.forEach(unsub => unsub());
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
      updateTableStatusLocal,
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
