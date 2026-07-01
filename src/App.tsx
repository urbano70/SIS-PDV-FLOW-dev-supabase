/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import socket from './lib/socket';
import Dashboard from './components/Dashboard';
import WaiterTerminal from './components/WaiterTerminal';
import KitchenDisplay from './components/KitchenDisplay';
import POS from './components/POS';
import SelfOnboarding from './components/SelfOnboarding';
import { Table, Order, Waiter, StockItem, MenuCategory } from './types';
import { Toaster, toast } from 'sonner';
import { FirebaseProvider, useFirebase } from './components/FirebaseProvider';
import { LogIn } from 'lucide-react';
import { onAuthStateChange, getSession } from './lib/auth';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import UserPanel from './pages/UserPanel';
import FinanceiroDashboard from './pages/FinanceiroDashboard';
import AttendancePage from './pages/AttendancePage';

function AppContent({ ownerUser }: { ownerUser: any }) {
  const navigate = useNavigate();
  const { user, loading, signIn, data, isAdmin, toggleCashRegister, updatePizzeriaConfig } = useFirebase();
  const { tables, comandas, orders, waiters, stock, stockLog, menu, isCashRegisterOpen, pizzariaConfig } = data;
  const [isApproved, setIsApproved] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'waiters' | 'stock' | 'reports' | 'settings' | 'products'>('overview');
  const [pizzaFlavors, setPizzaFlavors] = useState<any[]>([]);
  const [pizzaCrusts, setPizzaCrusts] = useState<string[]>([]);

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

  // Sync establishment name from Supabase user_metadata → printerConfig
  useEffect(() => {
    const name = ownerUser?.user_metadata?.establishment_name;
    if (!name) return;
    setPrinterConfig((prev: any) => {
      if (prev.establishmentName === name) return prev;
      const updated = { ...prev, establishmentName: name };
      localStorage.setItem('printerConfig', JSON.stringify(updated));
      return updated;
    });
  }, [ownerUser]);

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

  // Authenticate admin socket — runs on login and on every socket reconnect
  useEffect(() => {
    const sendAdminConnect = () => {
      if (isAdmin && user) {
        (user as any).getIdToken().then((token: string) => {
          socket.emit('admin_connect', token);
        }).catch(() => {});
      }
    };
    sendAdminConnect();
    socket.on('connect', sendAdminConnect);
    return () => { socket.off('connect', sendAdminConnect); };
  }, [isAdmin, user]);

  // Re-autentica o garçom sempre que o socket (re)conectar ao servidor
  useEffect(() => {
    const relogin = () => {
      const saved = localStorage.getItem('waiter_credentials');
      if (saved) {
        try {
          const { name, password } = JSON.parse(saved);
          if (name && password) socket.emit('waiter_login', { name, password });
        } catch {}
      }
    };
    socket.on('connect', relogin);
    return () => { socket.off('connect', relogin); };
  }, []);

  useEffect(() => {
    // Escutar eventos do socket para dados específicos e notificações
    socket.on('init_data', (data) => {
      if (data.pizzaFlavors) setPizzaFlavors(data.pizzaFlavors);
      if (data.pizzaCrusts) setPizzaCrusts(data.pizzaCrusts);
    });

    socket.on('update_pizza_flavors', setPizzaFlavors);
    socket.on('update_pizza_crusts', setPizzaCrusts);

    socket.on('waiter_approved', (data) => {
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
    });

    socket.on('error_message', (msg) => {
      toast.error(msg);
    });

    socket.on('admin_notification', (notif) => {
      if (notif.type === 'NEW_WAITER') {
        toast.info(`Novo garçom aguardando aprovação: ${notif.data.name}`, {
          action: {
            label: 'Ver',
            onClick: () => setDashboardTab('waiters')
          }
        });
      }
    });

    return () => {
      socket.off('init_data');
      socket.off('waiter_approved');
      socket.off('admin_notification');
      socket.off('error_message');
      socket.off('update_pizza_flavors');
      socket.off('update_pizza_crusts');
    };
  }, []);

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
              activeTab={dashboardTab}
              setActiveTab={setDashboardTab}
              isCashRegisterOpen={isCashRegisterOpen}
              toggleCashRegister={toggleCashRegister}
              printerConfig={printerConfig}
              setPrinterConfig={setPrinterConfig}
              pizzariaConfig={pizzariaConfig}
              updatePizzeriaConfig={updatePizzeriaConfig}
              onLogout={() => navigate('/portal')}
              plan={ownerUser?.user_metadata?.plan || 'free'}
              ownerCreatedAt={ownerUser?.created_at}
            />
          }
        />

        <Route path="/kitchen" element={<KitchenDisplay orders={orders} menu={menu} />} />
        <Route path="/pos" element={<POS tables={tables} comandas={comandas} orders={orders} printerConfig={printerConfig} />} />

        {/* Redirecionamentos padrão dentro de /app */}
        <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
      </Routes>
      <Toaster position="top-right" richColors />
    </div>
  );
}

// Rota do garçom: lê ?tenant= da URL
function WaiterRoute() {
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('tenant') || undefined;

  return (
    <FirebaseProvider tenantId={tenantId} isWaiterMode={true}>
      <WaiterRouteInner tenantId={tenantId} />
    </FirebaseProvider>
  );
}

function WaiterRouteInner({ tenantId }: { tenantId?: string }) {
  const { data } = useFirebase();
  const { tables, comandas, orders, menu, waiters, isCashRegisterOpen, pizzariaConfig, shiftStartedAt } = data;
  const [isApproved, setIsApproved] = useState(false);
  const [pizzaFlavors, setPizzaFlavors] = useState<any[]>([]);
  const [pizzaCrusts, setPizzaCrusts] = useState<string[]>([]);

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
    socket.on('init_data', (d: any) => {
      if (d.pizzaFlavors) setPizzaFlavors(d.pizzaFlavors);
      if (d.pizzaCrusts) setPizzaCrusts(d.pizzaCrusts);
    });
    socket.on('update_pizza_flavors', setPizzaFlavors);
    socket.on('update_pizza_crusts', setPizzaCrusts);
    socket.on('waiter_approved', (d: any) => {
      if (d?.status === 'approved') setIsApproved(true);
      else setIsApproved(false);
    });
    return () => {
      socket.off('init_data');
      socket.off('update_pizza_flavors');
      socket.off('update_pizza_crusts');
      socket.off('waiter_approved');
    };
  }, []);

  return isApproved ? (
    <WaiterTerminal
      tables={tables}
      comandas={comandas}
      orders={orders}
      menu={menu}
      pizzaFlavors={pizzaFlavors}
      pizzaCrusts={pizzaCrusts}
      isCashRegisterOpen={isCashRegisterOpen}
      printerConfig={printerConfig}
      pizzariaConfig={pizzariaConfig}
      shiftStartedAt={shiftStartedAt}
    />
  ) : (
    <SelfOnboarding waiters={waiters} />
  );
}

export default function App() {
  const [ownerUser, setOwnerUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // Load initial session
    getSession().then(session => {
      setOwnerUser(session?.user ?? null);
      setAuthLoading(false);
    });
    // Subscribe to auth changes
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
              <FirebaseProvider tenantId={ownerUser.id} isWaiterMode={false}>
                <AppContent ownerUser={ownerUser} />
              </FirebaseProvider>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/financeiro"
          element={ownerUser ? <FinanceiroDashboard ownerUser={ownerUser} /> : <Navigate to="/login" replace />}
        />
        <Route path="/waiter" element={<WaiterRoute />} />
        <Route path="/presenca/:token" element={<AttendancePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
