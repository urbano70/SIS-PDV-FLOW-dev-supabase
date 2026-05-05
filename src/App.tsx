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

function AppContent() {
  const { loading, data, isAdmin } = useFirebase();
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
    boldItems: false
  });

  useEffect(() => {
    // Initial data from socket if needed, but we prioritize Firebase
    socket.on('init_data', (data) => {
      // Only set if Firebase is not yet providing data or for specific items
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

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" />} />
          <Route 
            path="/dashboard" 
            element={
              isAdmin ? (
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
                  printerConfig={printerConfig}
                  setPrinterConfig={setPrinterConfig}
                />
              ) : (
                <div className="h-screen flex items-center justify-center bg-[#F5F5F3]">
                  <div className="text-center p-8 bg-white rounded-2xl border border-red-100 italic font-serif">
                    Acesso restrito ao Administrador.
                  </div>
                </div>
              )
            } 
          />
          <Route path="/waiter" element={isApproved ? <WaiterTerminal tables={tables} comandas={comandas} orders={orders} menu={menu} pizzaFlavors={pizzaFlavors} pizzaCrusts={pizzaCrusts} isCashRegisterOpen={isCashRegisterOpen} /> : <SelfOnboarding />} />
          <Route path="/kitchen" element={<KitchenDisplay orders={orders} />} />
          <Route path="/pos" element={<POS tables={tables} comandas={comandas} orders={orders} printerConfig={printerConfig} />} />
        </Routes>
        <Toaster position="top-right" richColors />
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <FirebaseProvider>
      <AppContent />
    </FirebaseProvider>
  );
}
