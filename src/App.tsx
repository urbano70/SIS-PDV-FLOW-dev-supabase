/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import socket, {
  getSocketAuthRole,
  isAutoAuthSuspended,
  recomputeAutoAuthRole,
  setAutoAuthSuspended,
  setSocketAuthRole,
} from './lib/socket';
import UpdateBanner from './components/UpdateBanner';
import Dashboard from './components/Dashboard';
import WaiterTerminal from './components/WaiterTerminal';
import PlaygroundTerminal from './components/PlaygroundTerminal';
import KitchenDisplay from './components/KitchenDisplay';
import POS from './components/POS';
import SelfOnboarding from './components/SelfOnboarding';
import { Table, Order, Waiter, StockItem, MenuCategory } from './types';
import { Toaster, toast } from 'sonner';
import { FirebaseProvider, useFirebase } from './components/FirebaseProvider';
import { LogIn } from 'lucide-react';
import { onAuthStateChange, getSession } from './lib/auth';
import { supabase } from './lib/supabase';
import LandingPage from './pages/LandingPage';
import DanfePage from './pages/DanfePage';
import DanfeNFePage from './pages/DanfeNFePage';
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';
import UserPanel from './pages/UserPanel';
import FinanceiroDashboard from './pages/FinanceiroDashboard';
import AttendancePage from './pages/AttendancePage';
import { ChamarGarcomPage } from './pages/ChamarGarcomPage';
import { ClientePage } from './pages/ClientePage';
import DashboardLockScreen from './components/DashboardLockScreen';

function AppContent({ ownerUser }: { ownerUser: any }) {
  const navigate = useNavigate();
  const { user, loading, signIn, data, isAdmin, toggleCashRegister, updatePizzeriaConfig, canMutate } = useFirebase();
  const { tables, comandas, orders, waiters, stock, stockLog, menu, isCashRegisterOpen, pizzariaConfig } = data;
  const [isApproved, setIsApproved] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'waiters' | 'stock' | 'reports' | 'settings' | 'products'>('overview');
  const [pizzaFlavors, setPizzaFlavors] = useState<any[]>([]);
  const [pizzaCrusts, setPizzaCrusts] = useState<string[]>([]);
  const [pizzaSizes, setPizzaSizes] = useState<any[]>([]);

  const defaultPrinterConfig = {
    pizzas: 'none',
    drinks: 'none',
    kitchen: 'none',
    kitchenLabel: 'Cozinha Geral',
    receipts: 'none',
    registeredPrinters: [] as { name: string; ip: string; port?: number }[],
    autoPrintPizzas: true,
    autoPrintDrinks: false,
    autoPrintKitchen: true,
    autoPrintReceipts: false,
    establishmentName: 'Pizzaria & Restaurante',
    address: 'Rua Principal, 123 - Centro',
    phone: '(11) 99999-9999',
    receiptFooter: 'Obrigado pela preferência! Volte sempre.',
    showWaiter: true,
    showTimestamp: true,
    showLogo: true,
    itemFontSize: '12px',
    boldItems: false,
    paperWidth: '80mm',
    logoUrl: '',
  };
  const [printerConfig, setPrinterConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('printerConfig');
      return saved ? { ...defaultPrinterConfig, ...JSON.parse(saved) } : defaultPrinterConfig;
    } catch {
      return defaultPrinterConfig;
    }
  });

  // Sync establishment data from Supabase user_metadata → printerConfig
  // Aplica sempre que o user_metadata mudar (campos de onboarding têm prioridade sobre o padrão)
  useEffect(() => {
    const meta = ownerUser?.user_metadata;
    if (!meta) return;
    const { establishment_name, address, phone_whatsapp, establishment_email } = meta;
    if (!establishment_name && !address && !phone_whatsapp && !establishment_email) return;
    setPrinterConfig((prev: any) => {
      const patch: Record<string, string> = {};
      if (establishment_name && prev.establishmentName === 'Pizzaria & Restaurante') patch.establishmentName = establishment_name;
      if (address && !prev.address) patch.address = address;
      if (phone_whatsapp && !prev.phone) patch.phone = phone_whatsapp;
      if (establishment_email && !prev.email) patch.email = establishment_email;
      if (Object.keys(patch).length === 0) return prev;
      const updated = { ...prev, ...patch };
      localStorage.setItem('printerConfig', JSON.stringify(updated));
      return updated;
    });
  }, [ownerUser?.user_metadata?.establishment_name, ownerUser?.user_metadata?.address, ownerUser?.user_metadata?.phone_whatsapp, ownerUser?.user_metadata?.establishment_email]);

  // Quando o tenant (ownerUser.id) muda, reseta campos tenant-específicos do printerConfig
  // Evita que nome/logo de um tenant apareça no dashboard de outro tenant (contaminação de localStorage)
  useEffect(() => {
    if (!ownerUser?.id) return;
    const savedTenantId = localStorage.getItem('printerConfigTenantId');
    if (savedTenantId === ownerUser.id) return;
    const metaName = ownerUser.user_metadata?.establishment_name;
    setPrinterConfig((prev: any) => {
      const updated = { ...prev, establishmentName: metaName || defaultPrinterConfig.establishmentName, logoUrl: '' };
      try {
        localStorage.setItem('printerConfig', JSON.stringify(updated));
        localStorage.setItem('printerConfigTenantId', ownerUser.id);
      } catch {}
      return updated;
    });
  }, [ownerUser?.id]);

  useEffect(() => {
    if (waiters.length === 0) return;

    // Tenta localizar pelo UID do Firebase primeiro
    if (user) {
      const byUid = waiters.find(w => w.id === user.uid || (w as any).uid === user.uid);
      if (byUid) {
        setIsApproved(byUid.status === 'approved');
        return;
      }
    }

    // Fallback: localiza pelo nome salvo (funciona sem Firebase Auth ativo)
    try {
      const saved = localStorage.getItem('waiter_credentials');
      if (saved) {
        const { name } = JSON.parse(saved);
        if (name) {
          const byName = waiters.find(w => w.name === name);
          if (byName) setIsApproved(byName.status === 'approved');
        }
      }
    } catch {}
  }, [user, waiters]);

  // Sync establishmentName/logoUrl do pizzariaConfig (Supabase) → printerConfig (localStorage)
  // Garante que o nome salvo pelo admin no dashboard apareça na ClientePage mesmo após hard refresh
  useEffect(() => {
    if (!pizzariaConfig) return;
    setPrinterConfig((prev: any) => {
      const patch: Record<string, string> = {};
      if (pizzariaConfig.establishmentName && pizzariaConfig.establishmentName !== prev.establishmentName) patch.establishmentName = pizzariaConfig.establishmentName;
      if (pizzariaConfig.logoUrl !== undefined && pizzariaConfig.logoUrl !== prev.logoUrl) patch.logoUrl = pizzariaConfig.logoUrl;
      if (Object.keys(patch).length === 0) return prev;
      const updated = { ...prev, ...patch };
      localStorage.setItem('printerConfig', JSON.stringify(updated));
      return updated;
    });
  }, [pizzariaConfig?.establishmentName, pizzariaConfig?.logoUrl]);

  // Persiste printerConfig no localStorage sempre que mudar (garante que alterações feitas no
  // Dashboard não se percam ao recarregar ou atualizar o sistema)
  useEffect(() => {
    try {
      localStorage.setItem('printerConfig', JSON.stringify(printerConfig));
      if (ownerUser?.id) localStorage.setItem('printerConfigTenantId', ownerUser.id);
    } catch {}
  }, [printerConfig, ownerUser?.id]);

  // Authenticate admin socket on initial mount only. Reconnects are owned
  // entirely by FirebaseProvider's handleReconnect → identifyConnection chain,
  // which runs the proxy refresh before emitting admin_connect. Registering a
  // second 'connect' listener here races that chain with a potentially stale
  // getSession() token, causing spurious auth_error events.
  useEffect(() => {
    const sendAdminConnect = async () => {
      if (isAutoAuthSuspended() || recomputeAutoAuthRole(window.location.pathname) !== 'admin') return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token && !isAutoAuthSuspended() && recomputeAutoAuthRole(window.location.pathname) === 'admin') {
          setSocketAuthRole('admin');
          socket.emit('admin_connect', token);
        }
      } catch {}
    };
    sendAdminConnect();
  }, [ownerUser?.id]);

  useEffect(() => {
    // Escutar eventos do socket para dados específicos e notificações
    const onInit = (data: any) => {
      if (ownerUser?.id && data.tenantId !== ownerUser.id) return;
      if (data.pizzaFlavors) setPizzaFlavors(data.pizzaFlavors);
      if (data.pizzaCrusts) setPizzaCrusts(data.pizzaCrusts);
      if (data.pizzaSizes) setPizzaSizes(data.pizzaSizes);
      // Restaura printerConfig do servidor (Supabase) se existir, fundindo com o localStorage
      if (data.printerConfig && Object.keys(data.printerConfig).length > 0) {
        setPrinterConfig((prev: any) => {
          const merged = { ...prev, ...data.printerConfig };
          try { localStorage.setItem('printerConfig', JSON.stringify(merged)); } catch {}
          return merged;
        });
      }
    };
    socket.on('init_data', onInit);

    socket.on('update_pizza_flavors', setPizzaFlavors);
    socket.on('update_pizza_crusts', setPizzaCrusts);
    socket.on('update_pizza_sizes', setPizzaSizes);

    const onWaiterApproved = (data: any) => {
      if (data?.status === 'inactive') {
        setIsApproved(false);
        toast.error('Seu acesso está inativo. Entre em contato com o gerente.');
      } else if (data?.status === 'approved') {
        setIsApproved(true);
        // Toast só quando for aprovação real pelo gerente, não em re-logins de rotina
        if (data?.isNewApproval) toast.success('Acesso aprovado pelo gerente!');
      } else if (data?.status === 'pending') {
        setIsApproved(false);
        toast.info('Seu cadastro ainda está pendente de aprovação.');
      }
    };
    socket.on('waiter_approved', onWaiterApproved);

    const onError = (msg: string) => toast.error(msg);
    socket.on('error_message', onError);

    const onNotification = (notif: any) => {
      if (notif.type === 'NEW_WAITER') {
        toast.info(`Novo garçom aguardando aprovação: ${notif.data.name}`, {
          action: {
            label: 'Ver',
            onClick: () => setDashboardTab('waiters')
          }
        });
      }
    };
    socket.on('admin_notification', onNotification);

    return () => {
      socket.off('init_data', onInit);
      socket.off('waiter_approved', onWaiterApproved);
      socket.off('admin_notification', onNotification);
      socket.off('error_message', onError);
      socket.off('update_pizza_flavors', setPizzaFlavors);
      socket.off('update_pizza_crusts', setPizzaCrusts);
      socket.off('update_pizza_sizes', setPizzaSizes);
    };
  }, [ownerUser?.id]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F5F3]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-[#141414] rounded-full mb-4"></div>
          <p className="font-serif italic text-lg">Carregando...</p>
        </div>
      </div>
    );
  }

  const loginScreen = (
    <div className="h-screen flex items-center justify-center bg-[#F5F5F3] p-4">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl border border-[#141414]/10 shadow-sm text-center">
        <div className="w-16 h-16 bg-[#141414] rounded-full flex items-center justify-center mx-auto mb-6">
          <LogIn className="text-[#E4E3E0] w-8 h-8" />
        </div>
        <h1 className="font-serif italic text-3xl mb-2">Bem-vindo ao FechaConta</h1>
        <p className="text-gray-500 mb-8">Faça login para acessar o sistema de gestão.</p>
        <button
          onClick={signIn}
          className="w-full bg-[#141414] text-white py-4 rounded-xl font-bold flex items-center justify-center space-x-3 hover:opacity-90 transition-opacity"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
          <span>Entrar com o Google</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      <Routes>
        {/* Dashboard e outras rotas administrativas */}
        <Route
          path="/dashboard"
          element={
            <Dashboard
              tables={tables}
              comandas={comandas}
              orders={orders}
              waiters={waiters}
              stock={stock}
              stockLog={stockLog}
              menu={menu}
              pizzaFlavors={pizzaFlavors}
              pizzaCrusts={pizzaCrusts}
              pizzaSizes={pizzaSizes}
              activeTab={dashboardTab}
              setActiveTab={setDashboardTab}
              isCashRegisterOpen={isCashRegisterOpen}
              toggleCashRegister={toggleCashRegister}
              printerConfig={printerConfig}
              setPrinterConfig={setPrinterConfig}
              pizzariaConfig={pizzariaConfig}
              updatePizzeriaConfig={updatePizzeriaConfig}
              onLogout={() => navigate('/portal')}
              plan={ownerUser?.user_metadata?.plan || 'premium'}
              ownerCreatedAt={ownerUser?.created_at}
              tenantId={ownerUser?.id || ''}
            />
          }
        />

        <Route path="/kitchen" element={<KitchenDisplay orders={orders} menu={menu} kdsEnabled={pizzariaConfig?.kdsEnabled ?? false} canMutate={canMutate} />} />
        <Route path="/pos" element={<POS tables={tables} comandas={comandas} orders={orders} printerConfig={printerConfig} />} />

        {/* Redirecionamentos padrão dentro de /app */}
        <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
      </Routes>
      <Toaster position="top-right" richColors />
    </div>
  );
}

// Rota do garçom: lê ?tenant= da URL e prepara uma conexão de staff quando
// a navegação veio de uma sessão administrativa, sem recarregar a página.
function WaiterRoute({ ownerUser }: { ownerUser?: any }) {
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('tenant') || undefined;
  const [socketReady, setSocketReady] = useState(() => (
    socket.connected && !(recomputeAutoAuthRole(window.location.pathname) === 'waiter' && getSocketAuthRole() === 'admin')
  ));
  const roleTransitionRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const expectedRole = recomputeAutoAuthRole(window.location.pathname);
    const needsRoleTransition = expectedRole === 'waiter' && getSocketAuthRole() === 'admin' && !roleTransitionRef.current;
    const onConnect = () => {
      if (disposed) return;
      setAutoAuthSuspended(false);
      setSocketReady(true);
    };

    socket.on('connect', onConnect);
    if (needsRoleTransition) {
      roleTransitionRef.current = true;
      setAutoAuthSuspended(true);
      setSocketReady(false);
      if (socket.connected) socket.disconnect();
      socket.connect();
    } else if (socket.connected) {
      setAutoAuthSuspended(false);
      setSocketReady(true);
    } else {
      setSocketReady(false);
    }

    return () => {
      disposed = true;
      socket.off('connect', onConnect);
    };
  }, [ownerUser?.id]);

  if (!socketReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F5F3]">
        <p className="font-serif italic text-lg">Conectando ao terminal...</p>
      </div>
    );
  }

  return (
    <FirebaseProvider tenantId={tenantId} isWaiterMode={true}>
      <WaiterRouteInner tenantId={tenantId} />
    </FirebaseProvider>
  );
}

function WaiterRouteInner({ tenantId }: { tenantId?: string }) {
  const { data, clockOffset, canMutate, currentWaiter } = useFirebase();
  const { tables, comandas, orders, menu, isCashRegisterOpen, pizzariaConfig, shiftStartedAt } = data;
  const [isApproved, setIsApproved] = useState(false);
  const [isAutoLogging, setIsAutoLogging] = useState(() => {
    try { return !!localStorage.getItem('waiter_credentials'); } catch { return false; }
  });
  const [pizzaFlavors, setPizzaFlavors] = useState<any[]>([]);
  const [pizzaCrusts, setPizzaCrusts] = useState<string[]>([]);
  const [pizzaSizes, setPizzaSizes] = useState<any[]>([]);
  const waiterLoginKeyRef = useRef<string | null>(null);

  // Persist tenant ID so the PWA can re-login even from start_url (/waiter, no ?tenant=)
  useEffect(() => {
    if (tenantId) {
      try { localStorage.setItem('waiter_tenant_id', tenantId); } catch {}
    }
  }, [tenantId]);

  // This is the only reconnect/login owner for the waiter route. It remains
  // mounted while WaiterTerminal is shown, so a normal socket reconnect keeps
  // the approved waiter and never enables mutations before init_data arrives.
  useEffect(() => {
    const applyLoginAck = (ack: any = {}) => {
      setIsAutoLogging(false);
      if (ack?.status === 'approved' || (ack?.ok === true && !ack?.status)) {
        setSocketAuthRole('waiter');
        setIsApproved(true);
      } else {
        setIsApproved(false);
        if (ack?.message) toast.error(ack.message);
      }
    };
    const loginOwnStaff = () => {
      const saved = localStorage.getItem('waiter_credentials');
      if (!saved || !socket.connected) {
        setIsAutoLogging(false);
        return;
      }
      try {
        const { name, password } = JSON.parse(saved);
        // Fallback para tenant salvo: necessário quando o PWA abre via start_url sem ?tenant=
        let savedTenantId = '';
        try { savedTenantId = localStorage.getItem('waiter_tenant_id') || ''; } catch {}
        const effectiveTenantId = tenantId || savedTenantId;
        const loginKey = `${socket.id || '__pending__'}:${effectiveTenantId}`;
        if (waiterLoginKeyRef.current === loginKey) return;
        if (name && password) {
          waiterLoginKeyRef.current = loginKey;
          if (effectiveTenantId) socket.emit('waiter_identify_tenant', { tenantId: effectiveTenantId });
          socket.emit('waiter_login', { name, password }, applyLoginAck);
        }
      } catch { setIsAutoLogging(false); }
    };
    // Fallback: se em 8s não vier resposta, mostra o formulário
    const autoLoginTimeout = setTimeout(() => setIsAutoLogging(false), 8000);
    loginOwnStaff();
    socket.on('connect', loginOwnStaff);
    return () => {
      clearTimeout(autoLoginTimeout);
      socket.off('connect', loginOwnStaff);
    };
  }, [tenantId]);

  const defaultPrinterConfig = {
    pizzas: 'none', drinks: 'none', kitchen: 'none', kitchenLabel: 'Cozinha Geral',
    receipts: 'none', registeredPrinters: [] as { name: string; ip: string; port?: number }[],
    autoPrintPizzas: true, autoPrintDrinks: false, autoPrintKitchen: true, autoPrintReceipts: false,
    establishmentName: 'Pizzaria & Restaurante', address: 'Rua Principal, 123 - Centro',
    phone: '(11) 99999-9999', receiptFooter: 'Obrigado pela preferência! Volte sempre.',
    showWaiter: true, showTimestamp: true, showLogo: true,
    itemFontSize: '12px', boldItems: false, paperWidth: '80mm',
  };
  const [printerConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('printerConfig');
      return saved ? { ...defaultPrinterConfig, ...JSON.parse(saved) } : defaultPrinterConfig;
    } catch { return defaultPrinterConfig; }
  });

  useEffect(() => {
    const onInit = (d: any) => {
      if (tenantId && d.tenantId !== tenantId) return;
      if (d.pizzaFlavors) setPizzaFlavors(d.pizzaFlavors);
      if (d.pizzaCrusts) setPizzaCrusts(d.pizzaCrusts);
      if (d.pizzaSizes) setPizzaSizes(d.pizzaSizes);
    };
    socket.on('init_data', onInit);
    socket.on('update_pizza_flavors', setPizzaFlavors);
    socket.on('update_pizza_crusts', setPizzaCrusts);
    socket.on('update_pizza_sizes', setPizzaSizes);
    const onWaiterApproved = (d: any) => {
      if (d?.status === 'approved') setIsApproved(true);
      else setIsApproved(false);
    };
    socket.on('waiter_approved', onWaiterApproved);
    return () => {
      socket.off('init_data', onInit);
      socket.off('update_pizza_flavors', setPizzaFlavors);
      socket.off('update_pizza_crusts', setPizzaCrusts);
      socket.off('update_pizza_sizes', setPizzaSizes);
      socket.off('waiter_approved', onWaiterApproved);
    };
  }, [tenantId]);

  useEffect(() => {
    setIsApproved(currentWaiter?.status === 'approved');
  }, [currentWaiter]);

  return (
    <>
      {isApproved ? (
        <WaiterTerminal
          tables={tables}
          comandas={comandas}
          orders={orders}
          menu={menu}
          pizzaFlavors={pizzaFlavors}
          pizzaCrusts={pizzaCrusts}
          pizzaSizes={pizzaSizes}
          isCashRegisterOpen={isCashRegisterOpen}
          printerConfig={printerConfig}
          pizzariaConfig={pizzariaConfig}
          shiftStartedAt={shiftStartedAt}
          clockOffset={clockOffset}
          canSubmitOrder={canMutate}
        />
      ) : isAutoLogging ? (
        <div className="h-screen flex items-center justify-center bg-[#F5F5F3]">
          <p className="font-serif italic text-lg">Acessando terminal...</p>
        </div>
      ) : (
        <SelfOnboarding
          autoLogin={false}
          tenantId={tenantId}
          onAuthStatus={(ack) => setIsApproved(ack.status === 'approved' || (ack.ok === true && !ack.status))}
        />
      )}
    </>
  );
}

// Parquinho is deliberately outside FirebaseProvider: its dedicated Socket.IO
// client receives only the PlaygroundData projection after operator auth.
function PlaygroundRoute() {
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('tenant') || '';
  return <PlaygroundTerminal tenantId={tenantId} buildId={__BUILD_ID__} />;
}

const PDV_UNLOCKED_KEY = 'pdv_session_unlocked';

export default function App() {
  const [ownerUser, setOwnerUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dashboardLocked, setDashboardLocked] = useState(() => {
    try { return sessionStorage.getItem(PDV_UNLOCKED_KEY) !== '1'; } catch { return false; }
  });

  useEffect(() => {
    // Load cached session first (fast), then refresh metadata from server
    getSession().then(async session => {
      setOwnerUser(session?.user ?? null);
      setAuthLoading(false);
      if (session?.user) {
        // getUser() fetches fresh user_metadata from Supabase, correcting stale cached JWT
        const { data: { user } } = await supabase.auth.getUser();
        if (user) setOwnerUser(user);
      }
    });
    // Subscribe to auth changes (also fires on updateUser → USER_UPDATED)
    const { data: { subscription } } = onAuthStateChange(user => {
      setOwnerUser(user);
    });
    return () => { subscription.unsubscribe(); };
  }, []);

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#E4E3E0]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-[#141414] rounded-full mb-4"></div>
          <p className="font-serif italic text-lg">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <UpdateBanner />
      <Routes>
        <Route path="/" element={<LandingPage ownerUser={ownerUser} />} />
        <Route
          path="/login"
          element={ownerUser ? <Navigate to="/portal" replace /> : <LoginPage />}
        />
        <Route
          path="/portal"
          element={ownerUser ? <UserPanel ownerUser={ownerUser} /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/app/*"
          element={
            ownerUser ? (
              dashboardLocked ? (
                <DashboardLockScreen
                  ownerEmail={ownerUser.email}
                  onUnlock={() => {
                    try { sessionStorage.setItem(PDV_UNLOCKED_KEY, '1'); } catch {}
                    setDashboardLocked(false);
                  }}
                />
              ) : (
                <FirebaseProvider tenantId={ownerUser.id} isWaiterMode={false}>
                  <AppContent ownerUser={ownerUser} />
                </FirebaseProvider>
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/financeiro"
          element={ownerUser ? <FinanceiroDashboard ownerUser={ownerUser} /> : <Navigate to="/login" replace />}
        />
        <Route path="/waiter" element={<WaiterRoute ownerUser={ownerUser} />} />
        <Route path="/parquinho" element={<PlaygroundRoute />} />
        <Route path="/presenca/:token" element={<AttendancePage />} />
        <Route path="/chamar/:tenantId/:tableId" element={<ChamarGarcomPage />} />
        <Route path="/mesa/:tenantId/:mesaId" element={<ClientePage />} />
        <Route path="/danfe/nfce/:chaveAcesso" element={<DanfePage />} />
        <Route path="/danfe/nfe/:chaveAcesso" element={<DanfeNFePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
