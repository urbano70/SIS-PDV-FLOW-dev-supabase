/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

function AppContent() {
  const { user, loading, signIn, data, isAdmin, toggleCashRegister } = useFirebase();
  const { tables, comandas, orders, waiters, stock, menu, isCashRegisterOpen } = data;
  const [isApproved, setIsApproved] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'waiters' | 'stock' | 'ai' | 'reports' | 'settings' | 'products'>('overview');
  const [pizzaFlavors, setPizzaFlavors] = useState<any[]>([]);
  const [pizzaCrusts, setPizzaCrusts] = useState<string[]>([]);
  
  const [printerConfig, setPrinterConfig] = useState({
    drinks: 'Impressora Bar',
    kitchen: 'Impressora Cozinha 2',
    kitchenLabel: 'Cozinha Geral',
    receipts: 'Impressora Caixa',
    establishmentName: 'Pizzaria & Restaurante',
    address: 'Rua Principal, 123 - Centro',
    phone: '(11) 99999-9999',
    receiptFooter: 'Obrigado pela preferência! Volte sempre.',
    showWaiter: true,
    showTimestamp: true,
    showLogo: true,
    itemFontSize: '12px',
    boldItems: false,
    autoPrintKitchen: true
  });

  useEffect(() => {
    if (user && waiters.length > 0) {
      const myRecord = waiters.find(w => w.id === user.uid || (w as any).uid === user.uid);
      if (myRecord) {
        setIsApproved(myRecord.status === 'approved');
      }
    }
  }, [user, waiters]);

  // Authenticate admin socket as soon as we know the user is admin
  useEffect(() => {
    if (isAdmin && user) {
      (user as any).getIdToken().then((token: string) => {
        socket.emit('admin_connect', token);
      }).catch(() => {});
    }
  }, [isAdmin, user]);

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
        toast.success('Acesso aprovado pelo gerente!');
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
        <h1 className="font-serif italic text-3xl mb-2">Bem-vindo ao PizzaFlow</h1>
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
        {/* Rota do Garçom - Sempre acessível para permitir auto-onboarding (via login anônimo ou salvo) */}
        <Route 
          path="/waiter" 
          element={
            isApproved ? (
              <WaiterTerminal 
                tables={tables} 
                comandas={comandas} 
                orders={orders} 
                menu={menu} 
                pizzaFlavors={pizzaFlavors} 
                pizzaCrusts={pizzaCrusts} 
                isCashRegisterOpen={isCashRegisterOpen} 
                printerConfig={printerConfig} 
              />
            ) : (
              <SelfOnboarding waiters={waiters} />
            )
          } 
        />

        {/* Dashboard e outras rotas administrativas - Requerem Admin */}
        <Route 
          path="/dashboard" 
          element={
            <Dashboard 
              tables={tables} 
              comandas={comandas}
              orders={orders} 
              waiters={waiters} 
              stock={stock} 
              menu={menu}
              pizzaFlavors={pizzaFlavors}
              pizzaCrusts={pizzaCrusts}
              activeTab={dashboardTab}
              setActiveTab={setDashboardTab}
              isCashRegisterOpen={isCashRegisterOpen}
              toggleCashRegister={toggleCashRegister}
              printerConfig={printerConfig}
              setPrinterConfig={setPrinterConfig}
            />
          } 
        />
        
        <Route path="/kitchen" element={<KitchenDisplay orders={orders} />} />
        <Route path="/pos" element={<POS tables={tables} comandas={comandas} orders={orders} printerConfig={printerConfig} />} />
        
        {/* Redirecionamentos padrão */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" richColors />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <FirebaseProvider>
        <AppContent />
      </FirebaseProvider>
    </BrowserRouter>
  );
}
