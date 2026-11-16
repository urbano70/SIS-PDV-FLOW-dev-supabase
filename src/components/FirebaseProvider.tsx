import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import socket from '../lib/socket';
import { Table, Order, Waiter, StockItem, MenuCategory, PizzeriaConfig } from '../types';
import { toast } from 'sonner';
import { getSession } from '../lib/auth';
import {
  getTenantStorageKey,
  getSnapshotBuildId,
  isInitDataAccepted,
  normalizeTenantId,
  readTenantCache,
  transformMenuForDisplay,
  writeTenantCache,
} from '../lib/firebaseSync';

interface FirebaseContextType {
  user: null;
  loading: boolean;
  isAdmin: boolean;
  tenantId: string | undefined;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  toggleCashRegister: (open: boolean, cashRegisterName?: string) => void;
  canMutate: () => boolean;
  activeCashRegisterName: string | null;
  updateTableStatusLocal: (id: number, isComanda: boolean, status: string) => void;
  updatePizzeriaConfig: (config: PizzeriaConfig) => void;
  optimisticAddItemToOrder: (orderId: string | number, item: any) => void;
  clockOffset: number;
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
    shiftStartedAt: string;
  };
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

interface FirebaseProviderProps {
  children: React.ReactNode;
  tenantId?: string;
  isWaiterMode?: boolean;
}

const defaultPizzeriaConfig: PizzeriaConfig = {
  enabled: false,
  yellowMinutes: 15,
  orangeMinutes: 20,
  redMinutes: 25,
  inactivityMinutes: 30,
  kdsEnabled: false,
};

function getStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function readActiveCashRegisterName(tenantId: string | undefined): string | null {
  const key = getTenantStorageKey('activeCashRegisterName', tenantId);
  if (!key) return null;
  try { return getStorage()?.getItem(key) ?? null; } catch { return null; }
}

function persistActiveCashRegisterName(tenantId: string | undefined, name: string | null): void {
  const key = getTenantStorageKey('activeCashRegisterName', tenantId);
  if (!key) return;
  try {
    const storage = getStorage();
    if (!storage) return;
    if (name) storage.setItem(key, name);
    else storage.removeItem(key);
  } catch {}
}

export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  tenantId,
  isWaiterMode = false,
}) => {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const isAdmin = !isWaiterMode;
  const [initialCache] = useState<Record<string, any> | null>(() =>
    readTenantCache<Record<string, any>>(getStorage(), normalizedTenantId)
  );

  const [loading, setLoading] = useState(!initialCache);
  const [tables, setTables] = useState<Table[]>(initialCache?.tables ?? []);
  const [comandas, setComandas] = useState<Table[]>(initialCache?.comandas ?? []);
  const [orders, setOrders] = useState<Order[]>(initialCache?.orders ?? []);
  const [waiters, setWaiters] = useState<Waiter[]>(initialCache?.waiters ?? []);
  const [stock, setStock] = useState<StockItem[]>(initialCache?.stock ?? []);
  const [stockLog, setStockLog] = useState<any[]>(initialCache?.stockLog ?? []);
  const [menu, setMenu] = useState<MenuCategory[]>(initialCache?.menu ?? []);
  const [isCashRegisterOpen, setIsCashRegisterOpen] = useState<boolean>(initialCache?.isCashRegisterOpen ?? false);
  const [pizzariaConfig, setPizzeriaConfig] = useState<PizzeriaConfig>(
    initialCache?.pizzariaConfig ? { ...initialCache.pizzariaConfig, kdsEnabled: false } : defaultPizzeriaConfig
  );
  // shiftStartedAt: when the current service shift began — used to cap stale timestamps
  const [shiftStartedAt, setShiftStartedAt] = useState<string>(initialCache?.shiftStartedAt ?? new Date().toISOString());
  // clockOffset: ms difference (client - server). Use Date.now() - clockOffset for server-aligned time.
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [activeCashRegisterName, setActiveCashRegisterName] = useState<string | null>(() =>
    readActiveCashRegisterName(normalizedTenantId)
  );

  // These refs intentionally survive renders but are reset when the tenant scope changes.
  // A reconnect never clears the visible state; it only blocks pre-ready updates until a
  // tenant-tagged authoritative init snapshot arrives.
  const cacheRef = useRef<Record<string, any>>(initialCache ?? {});
  const lifecycleRef = useRef(0);
  const readyRef = useRef(false);
  const pendingInitRef = useRef<{ epoch: string; socketId: string | null } | null>(null);
  const initCounterRef = useRef(0);
  const handshakeInFlightRef = useRef<Promise<void> | null>(null);
  const adminTokenRef = useRef<string | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canMutate = () => socket.connected && readyRef.current && navigator.onLine;

  const updateTableStatusLocal = (id: number, isComanda: boolean, status: string) => {
    if (!canMutate()) return;
    if (isComanda) {
      setComandas(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    } else {
      setTables(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    }
  };

  const optimisticAddItemToOrder = (orderId: string | number, item: any) => {
    if (!canMutate()) return;
    setOrders(prev => prev.map(o =>
      o.id && String(o.id) === String(orderId)
        ? { ...o, items: [...(o.items || []), { ...item, timestamp: item.timestamp || new Date().toISOString() }] }
        : o
    ));
  };

  useEffect(() => {
    let disposed = false;
    const lifecycle = ++lifecycleRef.current;
    const current = () => !disposed && lifecycleRef.current === lifecycle;
    const cache = readTenantCache<Record<string, any>>(getStorage(), normalizedTenantId);

    // A tenant change is a hard state boundary. Load only that tenant's cache and
    // never leave the previous account's orders/tables visible while the new socket
    // handshake is pending.
    cacheRef.current = cache ?? {};
    readyRef.current = false;
    pendingInitRef.current = null;
    adminTokenRef.current = null;
    // The previous scope may still be awaiting getSession(). It must not block
    // the new tenant's handshake; its completion is ignored by `current()`.
    handshakeInFlightRef.current = null;
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    setLoading(!cache);
    setTables(cache?.tables ?? []);
    setComandas(cache?.comandas ?? []);
    setOrders(cache?.orders ?? []);
    setWaiters(cache?.waiters ?? []);
    setStock(cache?.stock ?? []);
    setStockLog(cache?.stockLog ?? []);
    setMenu(cache?.menu ?? []);
    setIsCashRegisterOpen(cache?.isCashRegisterOpen ?? false);
    setPizzeriaConfig(cache?.pizzariaConfig ? { ...cache.pizzariaConfig, kdsEnabled: false } : defaultPizzeriaConfig);
    setShiftStartedAt(cache?.shiftStartedAt ?? new Date().toISOString());
    setActiveCashRegisterName(readActiveCashRegisterName(normalizedTenantId));

    const persistPatch = (patch: Record<string, unknown>) => {
      if (!current() || !readyRef.current || !normalizedTenantId) return;
      cacheRef.current = { ...cacheRef.current, ...patch, tenantId: normalizedTenantId };
      writeTenantCache(getStorage(), normalizedTenantId, cacheRef.current);
    };

    const handleUpdateOrders = (data: Order[]) => {
      if (!current() || !readyRef.current || !Array.isArray(data)) return;
      setOrders(data);
      persistPatch({ orders: data });
    };
    const handleUpdateTables = (data: Table[]) => {
      if (!current() || !readyRef.current || !Array.isArray(data)) return;
      setTables(data);
      persistPatch({ tables: data });
    };
    const handleUpdateComandas = (data: Table[]) => {
      if (!current() || !readyRef.current || !Array.isArray(data)) return;
      setComandas(data);
      persistPatch({ comandas: data });
    };
    const handleUpdateCashRegister = (isOpen: boolean) => {
      if (!current() || !readyRef.current) return;
      setIsCashRegisterOpen(isOpen);
      persistPatch({ isCashRegisterOpen: isOpen });
      if (!isOpen) {
        setActiveCashRegisterName(null);
        persistActiveCashRegisterName(normalizedTenantId, null);
      }
    };
    const handleUpdateMyCashRegisterName = (name: string | null) => {
      if (!current() || !readyRef.current) return;
      setActiveCashRegisterName(name);
      persistActiveCashRegisterName(normalizedTenantId, name);
    };
    const handleRelayPrintJob = ({ ip, port, localName, data }: { ip?: string; port?: number; localName?: string; data: number[] }) => {
      if (!current()) return;
      socket.emit('print_escpos', { ip, port, localName, data });
    };
    const handleErrorMessage = (msg: string) => { if (current()) toast.error(msg); };
    const handleUpdatePizzeriaConfig = (config: PizzeriaConfig) => {
      if (!current() || !readyRef.current) return;
      setPizzeriaConfig(config);
      persistPatch({ pizzariaConfig: config });
    };
    const handleUpdateShiftStartedAt = (ts: string) => {
      if (!current() || !readyRef.current) return;
      setShiftStartedAt(ts);
      persistPatch({ shiftStartedAt: ts });
    };
    const handleUpdateMenu = (data: MenuCategory[]) => {
      if (!current() || !readyRef.current || !Array.isArray(data)) return;
      const transformed = transformMenuForDisplay(data);
      setMenu(transformed);
      persistPatch({ menu: transformed });
    };
    const handleUpdateStock = (data: StockItem[]) => {
      if (!current() || !readyRef.current || !Array.isArray(data)) return;
      setStock(data);
      persistPatch({ stock: data });
    };
    const handleUpdateStockLog = (data: any[]) => {
      if (!current() || !readyRef.current || !Array.isArray(data)) return;
      setStockLog(data);
      persistPatch({ stockLog: data });
    };
    const handleUpdateWaiters = (data: Waiter[]) => {
      if (!current() || !readyRef.current || !Array.isArray(data)) return;
      setWaiters(data);
      persistPatch({ waiters: data });
    };

    const handleInitData = (data: any) => {
      if (!current()) return;
      const pending = pendingInitRef.current;
      // This is intentionally strict for a scoped provider. A pre-auth/default or
      // old-tenant snapshot is ignored and cannot wipe current/cache state.
      if (!isInitDataAccepted(data, normalizedTenantId, pending?.epoch)) return;
      // Once ready, an unsolicited duplicate init on the same connection can be an
      // older snapshot caused by a second auth listener. Only a reconnect opens this gate.
      if (readyRef.current && (!pending || pending.socketId === (socket.id || null))) return;

      const transformMenu = (cats: MenuCategory[]) => transformMenuForDisplay(cats);
      const cachePatch: Record<string, unknown> = {};
      if (Array.isArray(data.tables)) { setTables(data.tables); cachePatch.tables = data.tables; }
      if (Array.isArray(data.comandas)) { setComandas(data.comandas); cachePatch.comandas = data.comandas; }
      if (Array.isArray(data.orders)) { setOrders(data.orders); cachePatch.orders = data.orders; }
      if (Array.isArray(data.stock)) { setStock(data.stock); cachePatch.stock = data.stock; }
      if (Array.isArray(data.stockLog)) { setStockLog(data.stockLog); cachePatch.stockLog = data.stockLog; }
      if (Array.isArray(data.waiters)) { setWaiters(data.waiters); cachePatch.waiters = data.waiters; }
      if (data.isCashRegisterOpen !== undefined) { setIsCashRegisterOpen(data.isCashRegisterOpen); cachePatch.isCashRegisterOpen = data.isCashRegisterOpen; }
      if (data.pizzariaConfig) {
        const config = { ...data.pizzariaConfig, kdsEnabled: false };
        setPizzeriaConfig(config);
        cachePatch.pizzariaConfig = config;
      }
      if (Array.isArray(data.menu)) {
        const transformed = transformMenu(data.menu);
        setMenu(transformed);
        cachePatch.menu = transformed;
      }
      if (data.shiftStartedAt) { setShiftStartedAt(data.shiftStartedAt); cachePatch.shiftStartedAt = data.shiftStartedAt; }
      if (data.serverNow) {
        const serverTime = new Date(data.serverNow).getTime();
        if (Number.isFinite(serverTime)) setClockOffset(Date.now() - serverTime);
      }
      const buildId = getSnapshotBuildId(data);
      if (buildId) cachePatch.buildId = buildId;

      readyRef.current = true;
      pendingInitRef.current = null;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      cacheRef.current = { ...cacheRef.current, ...cachePatch, tenantId: normalizedTenantId };
      writeTenantCache(getStorage(), normalizedTenantId, cacheRef.current);
      setLoading(false);
    };

    const makeInitEpoch = () => `${lifecycle}-${++initCounterRef.current}`;
    const requestInitData = (epoch: string) => {
      if (!current() || !normalizedTenantId) return;
      socket.emit('request_init_data', {
        tenantId: normalizedTenantId,
        initEpoch: epoch,
      }, (ack: any) => {
        // New servers may acknowledge the handshake with the same authoritative
        // object; older servers simply ignore the callback and emit init_data.
        if (ack && typeof ack === 'object' && (ack.tenantId || ack.tenant_id) && current()) {
          handleInitData(ack);
        }
      });
    };

    const identifyConnection = (isReconnect: boolean) => {
      if (!current() || handshakeInFlightRef.current) return;
      const epoch = makeInitEpoch();
      pendingInitRef.current = { epoch, socketId: socket.id || null };
      const promise = (async () => {
        if (isWaiterMode) {
          if (!normalizedTenantId) return;
          // Tenant identification is synchronous on the current server; request
          // data only after it, never before auth/tenant selection.
          socket.emit('waiter_identify_tenant', { tenantId: normalizedTenantId });
          requestInitData(epoch);
          return;
        }

        let token = isReconnect ? adminTokenRef.current : null;
        if (!token) {
          try {
            const session = await getSession();
            token = session?.access_token ?? null;
          } catch {
            token = null;
          }
        }
        if (!token || !current()) return;
        adminTokenRef.current = token;
        // admin_connect itself produces the authoritative init_data response. Do
        // not race it with request_init_data; a delayed fallback is only for a
        // server that acknowledges auth without sending the response.
        socket.emit('admin_connect', token);
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = setTimeout(() => {
          if (current() && !readyRef.current && pendingInitRef.current?.epoch === epoch && socket.connected) {
            requestInitData(epoch);
          }
        }, 2000);
      })().finally(() => {
        if (handshakeInFlightRef.current === promise) handshakeInFlightRef.current = null;
      });
      handshakeInFlightRef.current = promise;
    };

    const handleReconnect = () => {
      if (!current()) return;
      // Preserve the last known state for a seamless reconnect, but reject update
      // arrays until a fresh, tenant-tagged init snapshot is ready.
      readyRef.current = false;
      pendingInitRef.current = null;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      identifyConnection(true);
    };

    socket.on('init_data', handleInitData);
    socket.on('update_orders', handleUpdateOrders);
    socket.on('update_tables', handleUpdateTables);
    socket.on('update_comandas', handleUpdateComandas);
    socket.on('update_cash_register', handleUpdateCashRegister);
    socket.on('update_my_cash_register_name', handleUpdateMyCashRegisterName);
    socket.on('update_pizzaria_config', handleUpdatePizzeriaConfig);
    socket.on('update_shift_started_at', handleUpdateShiftStartedAt);
    socket.on('update_menu', handleUpdateMenu);
    socket.on('update_stock', handleUpdateStock);
    socket.on('update_stock_log', handleUpdateStockLog);
    socket.on('update_waiters', handleUpdateWaiters);
    socket.on('relay_print_job', handleRelayPrintJob);
    socket.on('error_message', handleErrorMessage);
    socket.on('connect', handleReconnect);

    // If this shared singleton was already connected before this effect mounted,
    // perform exactly one handshake. Otherwise the connect listener owns it.
    if (socket.connected) identifyConnection(false);

    return () => {
      disposed = true;
      lifecycleRef.current++;
      readyRef.current = false;
      pendingInitRef.current = null;
      handshakeInFlightRef.current = null;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      socket.off('init_data', handleInitData);
      socket.off('update_orders', handleUpdateOrders);
      socket.off('update_tables', handleUpdateTables);
      socket.off('update_comandas', handleUpdateComandas);
      socket.off('update_cash_register', handleUpdateCashRegister);
      socket.off('update_my_cash_register_name', handleUpdateMyCashRegisterName);
      socket.off('update_pizzaria_config', handleUpdatePizzeriaConfig);
      socket.off('update_shift_started_at', handleUpdateShiftStartedAt);
      socket.off('update_menu', handleUpdateMenu);
      socket.off('update_stock', handleUpdateStock);
      socket.off('update_stock_log', handleUpdateStockLog);
      socket.off('update_waiters', handleUpdateWaiters);
      socket.off('relay_print_job', handleRelayPrintJob);
      socket.off('error_message', handleErrorMessage);
      socket.off('connect', handleReconnect);
    };
  }, [normalizedTenantId, isWaiterMode]);

  const signIn = async () => { toast.info('Autenticação não disponível neste modo.'); };
  const logout = async () => { toast.info('Sessão encerrada.'); };

  const updatePizzeriaConfig = (config: PizzeriaConfig) => {
    if (!canMutate()) { toast.error('Aguarde a conexão sincronizar antes de salvar.'); return; }
    setPizzeriaConfig(config);
    socket.emit('update_pizzaria_config', config);
  };

  const toggleCashRegister = (open: boolean, cashRegisterName?: string) => {
    if (!canMutate()) { toast.error('Aguarde a conexão sincronizar antes de alterar o caixa.'); return; }
    socket.emit('toggle_cash_register', cashRegisterName !== undefined ? { isOpen: open, cashRegisterName } : open);
    setIsCashRegisterOpen(open);
    if (!open) {
      setActiveCashRegisterName(null);
      persistActiveCashRegisterName(normalizedTenantId, null);
    }
  };

  return (
    <FirebaseContext.Provider value={{
      user: null,
      loading,
      isAdmin,
      tenantId: normalizedTenantId,
      signIn,
      logout,
      toggleCashRegister,
      canMutate,
      activeCashRegisterName,
      updateTableStatusLocal,
      updatePizzeriaConfig,
      clockOffset,
      optimisticAddItemToOrder,
      data: { tables, comandas, orders, waiters, stock, stockLog, menu, isCashRegisterOpen, pizzariaConfig, shiftStartedAt }
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
