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

export default function App() {
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [pizzaFlavors, setPizzaFlavors] = useState<any[]>([]);
  const [pizzaCrusts, setPizzaCrusts] = useState<string[]>([]);
  const [comandas, setComandas] = useState<Table[]>([]);
  const [isApproved, setIsApproved] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'waiters' | 'stock' | 'ai' | 'reports' | 'settings' | 'products'>('overview');

  useEffect(() => {
    socket.on('init_data', (data) => {
      setTables(data.tables);
      setOrders(data.orders);
      setWaiters(data.waiters);
      setStock(data.stock);
      if (data.menu) setMenu(data.menu);
      if (data.pizzaFlavors) setPizzaFlavors(data.pizzaFlavors);
      if (data.pizzaCrusts) setPizzaCrusts(data.pizzaCrusts);
      if (data.comandas) setComandas(data.comandas);
    });

    socket.on('update_tables', setTables);
    socket.on('update_comandas', setComandas);
    socket.on('update_orders', setOrders);
    socket.on('update_waiters', setWaiters);
    socket.on('update_stock', setStock);
    socket.on('update_menu', setMenu);
    socket.on('update_pizza_flavors', setPizzaFlavors);
    socket.on('update_pizza_crusts', setPizzaCrusts);

    socket.on('waiter_approved', () => {
      setIsApproved(true);
      toast.success('Acesso aprovado pelo gerente!');
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
      socket.off('update_tables');
      socket.off('update_orders');
      socket.off('update_waiters');
      socket.off('waiter_approved');
      socket.off('admin_notification');
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" />} />
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
              />
            } 
          />
          <Route path="/waiter" element={isApproved ? <WaiterTerminal tables={tables} comandas={comandas} orders={orders} menu={menu} pizzaFlavors={pizzaFlavors} pizzaCrusts={pizzaCrusts} /> : <SelfOnboarding />} />
          <Route path="/kitchen" element={<KitchenDisplay orders={orders} />} />
          <Route path="/pos" element={<POS tables={tables} comandas={comandas} orders={orders} />} />
        </Routes>
        <Toaster position="top-right" richColors />
      </div>
    </BrowserRouter>
  );
}
