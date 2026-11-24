import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import socket, { clearAdminConnectDedup, isAutoAuthSuspended, setSocketAuthRole } from '../lib/socket';
import { Table, Order, Waiter, StockItem, MenuCategory, PizzeriaConfig } from '../types';
import { toast } from 'sonner';
import { forceRefreshSession, getProxyRefreshError, getSession, refreshViaProxy } from '../lib/auth';
import { sendOrderCommand, orderCommandMessage } from '../lib/order-command';
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
  ready: boolean;
  syncError: string | null;
  refreshSnapshot: () => void;
  currentWaiter: Waiter | null;
  activeCashRegisterName: string | null;
  openCashRegisterNames: string[];
  updateTableStatusLocal: (id: number, isComanda: boolean, status: string) => void;
  updatePizzeriaConfig: (config: PizzeriaConfig) => Promise<boolean>;
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
  parquinhoEnabled: false,
  parquinhoChildNameRequired: true,
  parquinhoPrice: null,
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

const MAX_SOCKET_AUTH_TOKEN_LENGTH = 48_000;

function readStoredAuthSession(): any | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const key = Object.keys(localStorage).find(
      k => k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (!key) return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function hasInlineLogoMetadata(session: any): boolean {
  const metadata = session?.user?.user_metadata || session?.user_metadata;
  return [metadata?.logo_url, metadata?.logo, metadata?.logoUrl].some(
    logo => typeof logo === 'string' && /^data:/i.test(logo),
  );
}

function isUnsafeSocketAuthSession(session: any): boolean {
  const token = session?.access_token;
  return (typeof token === 'string' && token.length > MAX_SOCKET_AUTH_TOKEN_LENGTH) ||
    hasInlineLogoMetadata(session);
}

export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  tenantId,
  isWaiterMode = false,
}) => {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const isAdmin = !isWaiterMode;
  const [initialCache] = useState<Record<string, any> | null>(() =>
    isWaiterMode ? null : readTenantCache<Record<string, any>>(getStorage(), normalizedTenantId)
  );

  const [loading, setLoading] = useState(!initialCache);
  const [tables, setTables] = useState<Table[]>(initialCache?.tables ?? []);
  const [comandas, setComandas] = useState<Table[]>(initialCache?.comandas ?? []);
  const [orders, setOrders] = useState<Order[]>(initialCache?.orders ?? []);
  const [waiters, setWaiters] = useState<Waiter[]>(isWaiterMode ? [] : (initialCache?.waiters ?? []));
  const [currentWaiter, setCurrentWaiter] = useState<Waiter | null>(null);
  const [stock, setStock] = useState<StockItem[]>(initialCache?.stock ?? []);
  const [stockLog, setStockLog] = useState<any[]>(initialCache?.stockLog ?? []);
  const [menu, setMenu] = useState<MenuCategory[]>(initialCache?.menu ?? []);
  const [isCashRegisterOpen, setIsCashRegisterOpen] = useState<boolean>(initialCache?.isCashRegisterOpen ?? false);
  const [pizzariaConfig, setPizzeriaConfig] = useState<PizzeriaConfig>(
    initialCache?.pizzariaConfig ? { ...initialCache.pizzariaConfig } : defaultPizzeriaConfig
  );
  // shiftStartedAt: when the current service shift began — used to cap stale timestamps
  const [shiftStartedAt, setShiftStartedAt] = useState<string>(initialCache?.shiftStartedAt ?? new Date().toISOString());
  // clockOffset: ms difference (client - server). Use Date.now() - clockOffset for server-aligned time.
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [activeCashRegisterName, setActiveCashRegisterName] = useState<string | null>(() =>
    readActiveCashRegisterName(normalizedTenantId)
  );
  const [openCashRegisterNames, setOpenCashRegisterNames] = useState<string[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);

  // These refs intentionally survive renders but are reset when the tenant scope changes.
  // A reconnect never clears the visible state; it only blocks pre-ready updates until a
  // tenant-tagged authoritative init snapshot arrives.
  const cacheRef = useRef<Record<string, any>>(initialCache ?? {});
  const lifecycleRef = useRef(0);
  const readyRef = useRef(false);
  const [connectionReady, setConnectionReady] = useState(false);
  const readySocketRef = useRef<string | null>(null);
  const effectTenantRef = useRef(normalizedTenantId);
  const refreshSnapshotRef = useRef<() => void>(() => {});
  const everReadyRef = useRef(false);
  const waiterApprovedRef = useRef(false);
  const pendingInitRef = useRef<{ epoch: string; socketId: string | null } | null>(null);
  const approvedRequestSocketRef = useRef<string | null>(null);
  const initCounterRef = useRef(0);
  const handshakeInFlightRef = useRef<Promise<void> | null>(null);
  const adminTokenRef = useRef<string | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handshakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authRetryCountRef = useRef(0);

  const canMutate = () => socket.connected && readyRef.current && navigator.onLine &&
    readySocketRef.current === (socket.id || null) && effectTenantRef.current === normalizedTenantId;
  const refreshSnapshot = () => refreshSnapshotRef.current();

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
    let connectionGeneration = 0;
    const current = () => !disposed && lifecycleRef.current === lifecycle;
    const cache = isWaiterMode ? null : readTenantCache<Record<string, any>>(getStorage(), normalizedTenantId);
    const clearHandshakeTimeout = () => {
      if (handshakeTimeoutRef.current) clearTimeout(handshakeTimeoutRef.current);
      handshakeTimeoutRef.current = null;
    };

    // A tenant change is a hard state boundary. Load only that tenant's cache and
    // never leave the previous account's orders/tables visible while the new socket
    // handshake is pending.
    cacheRef.current = cache ?? {};
    readyRef.current = false;
    readySocketRef.current = null;
    effectTenantRef.current = normalizedTenantId;
    setConnectionReady(false);
    everReadyRef.current = false;
    authRetryCountRef.current = 0;
    waiterApprovedRef.current = false;
    pendingInitRef.current = null;
    approvedRequestSocketRef.current = null;
    adminTokenRef.current = null;
    // App.tsx fires admin_connect while DashboardLockScreen is visible, before
    // this provider mounts. The dedup in socket.ts records that emission and
    // would silently skip the first admin_connect here (same token + same socket
    // connection), causing init_data to never arrive. Clear the dedup so this
    // provider's first handshake always reaches the server.
    clearAdminConnectDedup();
    // The previous scope may still be awaiting getSession(). It must not block
    // the new tenant's handshake; its completion is ignored by `current()`.
    handshakeInFlightRef.current = null;
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    clearHandshakeTimeout();
    setSyncError(null);
    setLoading(!cache);
    setTables(cache?.tables ?? []);
    setComandas(cache?.comandas ?? []);
    setOrders(cache?.orders ?? []);
    setWaiters(isWaiterMode ? [] : (cache?.waiters ?? []));
    setCurrentWaiter(null);
    setStock(cache?.stock ?? []);
    setStockLog(cache?.stockLog ?? []);
    setMenu(cache?.menu ?? []);
    setIsCashRegisterOpen(cache?.isCashRegisterOpen ?? false);
    setPizzeriaConfig(cache?.pizzariaConfig ? { ...cache.pizzariaConfig } : defaultPizzeriaConfig);
    setShiftStartedAt(cache?.shiftStartedAt ?? new Date().toISOString());
    setActiveCashRegisterName(readActiveCashRegisterName(normalizedTenantId));

    const persistPatch = (patch: Record<string, unknown>) => {
      if (!current() || !readyRef.current || !normalizedTenantId || isWaiterMode) return;
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
      if (!current() || !Array.isArray(data) || isWaiterMode) return;
      setWaiters(data);
      if (readyRef.current) persistPatch({ waiters: data });
    };

    const handleInitData = (data: any) => {
      if (!current()) return;
      const snapshotWaiter = data?.currentWaiter || data?.current_waiter || data?.waiter;
      const safeSnapshotWaiter = isWaiterMode && snapshotWaiter && typeof snapshotWaiter === 'object'
        ? (() => {
            const { password: _password, ...safe } = snapshotWaiter;
            return safe;
          })()
        : null;
      if (isWaiterMode && (!safeSnapshotWaiter || safeSnapshotWaiter.status !== 'approved')) {
        waiterApprovedRef.current = false;
        readyRef.current = false;
        readySocketRef.current = null;
        setConnectionReady(false);
        pendingInitRef.current = null;
        setCurrentWaiter(safeSnapshotWaiter || null);
        setWaiters(safeSnapshotWaiter ? [safeSnapshotWaiter as Waiter] : []);
        setLoading(false);
        return;
      }
      const pending = pendingInitRef.current;
      if (!pending || !socket.connected || pending.socketId !== (socket.id || null)) return;
      // This is intentionally strict for a scoped provider. A pre-auth/default or
      // old-tenant snapshot is ignored and cannot wipe current/cache state.
      if (!isInitDataAccepted(data, normalizedTenantId, pending?.epoch)) {
        return;
      }
      // Once ready, an unsolicited duplicate init on the same connection can be an
      // older snapshot caused by a second auth listener. Only a reconnect opens this gate.
      if (readyRef.current && (!pending || pending.socketId === (socket.id || null))) {
        return;
      }

      const transformMenu = (cats: MenuCategory[]) => transformMenuForDisplay(cats);
      const cachePatch: Record<string, unknown> = {};
      if (Array.isArray(data.tables)) { setTables(data.tables); cachePatch.tables = data.tables; }
      if (Array.isArray(data.comandas)) { setComandas(data.comandas); cachePatch.comandas = data.comandas; }
      if (Array.isArray(data.orders)) { setOrders(data.orders); cachePatch.orders = data.orders; }
      if (Array.isArray(data.stock)) { setStock(data.stock); cachePatch.stock = data.stock; }
      if (Array.isArray(data.stockLog)) { setStockLog(data.stockLog); cachePatch.stockLog = data.stockLog; }
      if (!isWaiterMode && Array.isArray(data.waiters)) {
        setWaiters(data.waiters);
        cachePatch.waiters = data.waiters;
      }
      if (isWaiterMode) {
        const own = safeSnapshotWaiter;
        if (own && typeof own === 'object') {
          waiterApprovedRef.current = true;
          setCurrentWaiter(own as Waiter);
          setWaiters([own as Waiter]);
        }
      }
      if (data.isCashRegisterOpen !== undefined) { setIsCashRegisterOpen(data.isCashRegisterOpen); cachePatch.isCashRegisterOpen = data.isCashRegisterOpen; }
      if (Array.isArray(data.openCashRegisterNames)) setOpenCashRegisterNames(data.openCashRegisterNames);
      if (data.pizzariaConfig) {
        const config = { ...data.pizzariaConfig };
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
      readySocketRef.current = socket.id || null;
      setConnectionReady(true);
      everReadyRef.current = true;
      authRetryCountRef.current = 0;
      pendingInitRef.current = null;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      clearHandshakeTimeout();
      setSyncError(null);
      cacheRef.current = { ...cacheRef.current, ...cachePatch, tenantId: normalizedTenantId };
      if (!isWaiterMode) writeTenantCache(getStorage(), normalizedTenantId, cacheRef.current);
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
      if (!socket.connected) return;
      // In waiter mode, WaiterRouteInner owns tenant identification and login.
      // Emitting waiter_identify_tenant here races with waiter_login unnecessarily.
      if (isWaiterMode) return;
      const connectionId = socket.id || null;
      const generation = connectionGeneration;
      const connectionCurrent = () => current() && socket.connected &&
        (socket.id || null) === connectionId && connectionGeneration === generation;
      const epoch = makeInitEpoch();
      pendingInitRef.current = { epoch, socketId: socket.id || null };
      clearHandshakeTimeout();
      handshakeTimeoutRef.current = setTimeout(() => {
        if (!connectionCurrent() || readyRef.current || pendingInitRef.current?.epoch !== epoch) return;
        connectionGeneration++;
        handshakeInFlightRef.current = null;
        adminTokenRef.current = null;
        pendingInitRef.current = null;
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
        handshakeTimeoutRef.current = null;
        setConnectionReady(false);
        setSyncError('Tempo limite ao sincronizar. Tente sincronizar novamente.');
        setLoading(false);
      }, 18_000);
      const promise = (async () => {

        let token = isReconnect && adminTokenRef.current &&
          adminTokenRef.current.length <= MAX_SOCKET_AUTH_TOKEN_LENGTH
          ? adminTokenRef.current : null;
        let unsafeFallback = false;
        let unsafeReason: string | null = null;
        let proxyError: string | null = null;
        if (!token) {
          const storedSession = readStoredAuthSession();
          unsafeFallback = isUnsafeSocketAuthSession(storedSession);
          if (unsafeFallback) {
            unsafeReason = 'A sessão contém uma logo inline antiga; a recuperação deve usar o proxy.';
          }
          // 0. Proxy refresh — contorna extensões que bloqueiam o domínio do Supabase.
          try {
            const proxyResult = await refreshViaProxy();
            const proxyToken = proxyResult?.access_token ?? null;
            if (proxyToken && proxyToken.length <= MAX_SOCKET_AUTH_TOKEN_LENGTH) {
              token = proxyToken;
            } else if (proxyToken) {
              unsafeFallback = true;
              unsafeReason = 'O proxy devolveu uma sessão maior que o limite de sincronização.';
            } else {
              proxyError = getProxyRefreshError();
            }
          } catch {
            proxyError = getProxyRefreshError();
          }
          if (!connectionCurrent() || isAutoAuthSuspended()) return;
          // 1. SDK refresh — renovação direta pelo Supabase Auth SDK.
          if (!token && !unsafeFallback) {
            try {
              const session = await forceRefreshSession();
              if (isUnsafeSocketAuthSession(session)) {
                unsafeFallback = true;
                unsafeReason = 'A sessão renovada pelo SDK ainda contém dados de logo inline ou um JWT grande.';
              } else {
                token = session?.access_token ?? null;
              }
            } catch {
              token = null;
            }
          }
          if (!connectionCurrent() || isAutoAuthSuspended()) return;
          // 2. Sessão em cache — lê sem precisar de lock exclusivo (múltiplas abas).
          if (!token && !unsafeFallback) {
            try {
              const cached = await getSession();
              if (isUnsafeSocketAuthSession(cached)) {
                unsafeFallback = true;
                unsafeReason = 'A sessão em cache ainda contém dados de logo inline ou um JWT grande.';
              } else {
                token = cached?.access_token ?? null;
              }
            } catch {
              token = null;
            }
          }
          // 3. Último recurso: lê o token diretamente do localStorage, sem SDK.
          if (!token && !unsafeFallback) {
            const storedSession = readStoredAuthSession();
            if (isUnsafeSocketAuthSession(storedSession)) {
              unsafeReason = 'A sessão local ainda contém dados de logo inline ou um JWT grande.';
            } else {
              token = storedSession?.access_token ?? null;
            }
          }
        }
        if (!connectionCurrent()) return;
        if (isAutoAuthSuspended()) {
          setSyncError('A autenticação automática está temporariamente suspensa.');
          setLoading(false);
          return;
        }
        if (!token) {
          const reason = proxyError || getProxyRefreshError() || unsafeReason ||
            'Sessão não confirmada. Tente sincronizar novamente.';
          setSyncError(reason);
          toast.error(reason);
          setLoading(false);
          clearHandshakeTimeout();
          pendingInitRef.current = null;
          return;
        }
        adminTokenRef.current = token;
        // admin_connect itself produces the authoritative init_data response. Do
        // not race it with request_init_data; a delayed fallback is only for a
        // server that acknowledges auth without sending the response.
        setSocketAuthRole('admin');
        // The dedup was cleared at useEffect start, but a reconnect during the
        // async getSession() above may have caused App.tsx's connect listener to
        // re-set it.  Clear again synchronously right before emit — these two
        // statements are atomic from JavaScript's perspective.
        clearAdminConnectDedup();
        socket.emit('admin_connect', token);
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = setTimeout(() => {
          if (connectionCurrent() && !readyRef.current && pendingInitRef.current?.epoch === epoch) {
            requestInitData(epoch);
          }
        }, 2000);
      })().finally(() => {
        if (handshakeInFlightRef.current === promise) handshakeInFlightRef.current = null;
      });
      handshakeInFlightRef.current = promise;
    };

    const applyWaiterStatus = (data: any): boolean | null => {
      if (!current() || !isWaiterMode) return null;
      const status = String(data?.status || data?.waiter?.status || '');
      const waiter = data?.waiter && typeof data.waiter === 'object'
        ? (() => {
            const { password: _password, ...safe } = data.waiter;
            return safe;
          })()
        : null;
      if (status === 'approved') {
        waiterApprovedRef.current = true;
        if (waiter) {
          setCurrentWaiter(waiter as Waiter);
          setWaiters([waiter as Waiter]);
        }
        return true;
      }
      if (status === 'pending' || status === 'inactive' || status === 'rejected') {
        waiterApprovedRef.current = false;
        readyRef.current = false;
        readySocketRef.current = null;
        setConnectionReady(false);
        pendingInitRef.current = null;
        approvedRequestSocketRef.current = null;
        setCurrentWaiter(waiter as Waiter | null);
        setWaiters(waiter ? [waiter as Waiter] : []);
        setLoading(false);
        return false;
      }
      return null;
    };

    const requestApprovedInit = () => {
      if (!current() || !isWaiterMode || !normalizedTenantId || readyRef.current) return;
      const socketId = socket.id || null;
      if (approvedRequestSocketRef.current === socketId) return;
      approvedRequestSocketRef.current = socketId;
      const epoch = makeInitEpoch();
      pendingInitRef.current = { epoch, socketId };
      requestInitData(epoch);
    };

    const handleWaiterApproved = (data: any) => {
      if (applyWaiterStatus(data) === true) requestApprovedInit();
    };
    const handleWaiterStatusChanged = (data: any) => {
      if (applyWaiterStatus(data) === true) requestApprovedInit();
    };

    const handleReconnect = () => {
      if (!current()) return;
      // Preserve the last known state for a seamless reconnect, but reject update
      // arrays until a fresh, tenant-tagged init snapshot is ready.
      connectionGeneration++;
      readyRef.current = false;
      readySocketRef.current = null;
      setConnectionReady(false);
      handshakeInFlightRef.current = null;
      authRetryCountRef.current = 0;
      pendingInitRef.current = null;
      approvedRequestSocketRef.current = null;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      clearHandshakeTimeout();
      // Clear cached token so identifyConnection always runs the full proxy
      // refresh chain. Reusing an old token risks sending an expired JWT when
      // the socket reconnects after the 1-hour Supabase expiry window.
      adminTokenRef.current = null;
      identifyConnection(true);
    };

    const handleDisconnect = () => {
      if (!current()) return;
      connectionGeneration++;
      readyRef.current = false;
      readySocketRef.current = null;
      setConnectionReady(false);
      pendingInitRef.current = null;
      handshakeInFlightRef.current = null;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      clearHandshakeTimeout();
    };

    // A command can lose authorization even after the initial handshake. Never
    // leave the cached screen mutable while the server is rejecting that socket.
    const handleAuthError = (data: any) => {
      if (!current() || !socket.connected || isAutoAuthSuspended()) return;
      const errorTenant = normalizeTenantId(data?.tenantId || data?.tenant_id);
      if (errorTenant && errorTenant !== normalizedTenantId) return;
      const wasReady = readyRef.current;
      readyRef.current = false;
      readySocketRef.current = null;
      setConnectionReady(false);
      connectionGeneration++;
      handshakeInFlightRef.current = null;
      adminTokenRef.current = null;
      pendingInitRef.current = null;
      approvedRequestSocketRef.current = null;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      clearHandshakeTimeout();
      const serverMsg: string = data?.message || '(sem mensagem)';
      setSyncError(serverMsg);
      authRetryCountRef.current += 1;
      if (authRetryCountRef.current > 2) {
        toast.error(`Sessão não confirmada. Tente sincronizar novamente. ${serverMsg}`);
        setLoading(false);
        return;
      }
      if (isWaiterMode) {
        // WaiterRouteInner, not an admin token, owns waiter re-identification.
        waiterApprovedRef.current = false;
        toast.error(`Conexão não autorizada. Entre novamente. ${serverMsg}`);
        setLoading(false);
        return;
      }
      if (wasReady) toast.info('Conexão em sincronização. Aguarde antes de lançar ou pagar.');
      // Reuse the existing fresh-token chain; no mutation is replayed here.
      identifyConnection(false);
    };

    refreshSnapshotRef.current = () => {
      if (!current() || !normalizedTenantId || !socket.connected) return;
      if (!readyRef.current) {
        // A tentativa manual também invalida uma promessa antiga: só a geração
        // atual pode emitir o JWT e aceitar o init_data correspondente.
        connectionGeneration++;
        handshakeInFlightRef.current = null;
        adminTokenRef.current = null;
        pendingInitRef.current = null;
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
        clearHandshakeTimeout();
        setSyncError(null);
        setLoading(true);
        if (isWaiterMode) {
          requestApprovedInit();
        } else {
          identifyConnection(false);
        }
        return;
      }
      if (handshakeInFlightRef.current) return;
      readyRef.current = false;
      readySocketRef.current = null;
      setConnectionReady(false);
      setSyncError(null);
      const epoch = makeInitEpoch();
      pendingInitRef.current = { epoch, socketId: socket.id || null };
      requestInitData(epoch);
    };

    socket.on('init_data', handleInitData);
    socket.on('update_orders', handleUpdateOrders);
    socket.on('update_tables', handleUpdateTables);
    socket.on('update_comandas', handleUpdateComandas);
    socket.on('update_cash_register', handleUpdateCashRegister);
    socket.on('update_my_cash_register_name', handleUpdateMyCashRegisterName);
    socket.on('update_open_cash_register_names', setOpenCashRegisterNames);
    socket.on('update_pizzaria_config', handleUpdatePizzeriaConfig);
    socket.on('update_shift_started_at', handleUpdateShiftStartedAt);
    socket.on('update_menu', handleUpdateMenu);
    socket.on('update_stock', handleUpdateStock);
    socket.on('update_stock_log', handleUpdateStockLog);
    socket.on('update_waiters', handleUpdateWaiters);
    socket.on('relay_print_job', handleRelayPrintJob);
    socket.on('error_message', handleErrorMessage);
    socket.on('connect', handleReconnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('auth_error', handleAuthError);
    socket.on('waiter_approved', handleWaiterApproved);
    socket.on('waiter_status_changed', handleWaiterStatusChanged);

    // If this shared singleton was already connected before this effect mounted,
    // perform exactly one handshake. Otherwise the connect listener owns it.
    if (socket.connected) identifyConnection(false);

    return () => {
      disposed = true;
      lifecycleRef.current++;
      readyRef.current = false;
      readySocketRef.current = null;
      refreshSnapshotRef.current = () => {};
      pendingInitRef.current = null;
      handshakeInFlightRef.current = null;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      clearHandshakeTimeout();
      socket.off('init_data', handleInitData);
      socket.off('update_orders', handleUpdateOrders);
      socket.off('update_tables', handleUpdateTables);
      socket.off('update_comandas', handleUpdateComandas);
      socket.off('update_cash_register', handleUpdateCashRegister);
      socket.off('update_my_cash_register_name', handleUpdateMyCashRegisterName);
      socket.off('update_open_cash_register_names', setOpenCashRegisterNames);
      socket.off('update_pizzaria_config', handleUpdatePizzeriaConfig);
      socket.off('update_shift_started_at', handleUpdateShiftStartedAt);
      socket.off('update_menu', handleUpdateMenu);
      socket.off('update_stock', handleUpdateStock);
      socket.off('update_stock_log', handleUpdateStockLog);
      socket.off('update_waiters', handleUpdateWaiters);
      socket.off('relay_print_job', handleRelayPrintJob);
      socket.off('error_message', handleErrorMessage);
      socket.off('connect', handleReconnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('auth_error', handleAuthError);
      socket.off('waiter_approved', handleWaiterApproved);
      socket.off('waiter_status_changed', handleWaiterStatusChanged);
    };
  }, [normalizedTenantId, isWaiterMode]);

  const signIn = async () => { toast.info('Autenticação não disponível neste modo.'); };
  const logout = async () => { toast.info('Sessão encerrada.'); };

  const updatePizzeriaConfig = async (config: PizzeriaConfig): Promise<boolean> => {
    try {
      const ack = await sendOrderCommand({
        socket, event: 'update_pizzaria_config', tenantId: normalizedTenantId || '',
        payload: { ...config }, canMutate,
        getScope: () => ({
          tenantId: effectTenantRef.current || '', socketId: socket.id || null,
          lifecycle: lifecycleRef.current,
        }),
        refreshSnapshot,
      });
      if (!ack.ok) { toast.error(orderCommandMessage(ack)); return false; }
      // The server broadcasts only its persisted configuration. Never reapply
      // the caller's stale branding over a concurrent profile update.
      return true;
    } catch (error) {
      toast.error(orderCommandMessage(error));
      return false;
    }
  };

  const toggleCashRegister = (open: boolean, cashRegisterName?: string) => {
    if (open && !canMutate()) {
      toast.error('Aguarde a conexão sincronizar antes de abrir o caixa.');
      return;
    }
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
      ready: connectionReady,
      syncError,
      refreshSnapshot,
      currentWaiter,
      activeCashRegisterName,
      openCashRegisterNames,
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
