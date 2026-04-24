import React, { useState, useEffect } from 'react';
import { Order } from '../types';
import socket from '../lib/socket';
import { Clock, CheckCircle2, ChefHat } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface KitchenDisplayProps {
  orders: Order[];
}

export default function KitchenDisplay({ orders }: KitchenDisplayProps) {
  const activeOrders = orders.filter(o => o.status === 'pending' || o.status === 'preparing');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const updateStatus = (orderId: number | string, status: string) => {
    socket.emit('update_order_status', { orderId, status });
  };

  const getElapsedTime = (timestamp: string) => {
    const start = new Date(timestamp).getTime();
    const diff = Math.floor((now - start) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    const isLate = mins >= 15;
    return {
      text: `${mins}:${secs.toString().padStart(2, '0')}`,
      isLate
    };
  };

  return (
    <div className="h-screen flex flex-col bg-[#141414]">
      <header className="p-8 border-b border-white/10 flex justify-between items-center shrink-0">
        <div className="flex items-center space-x-4">
          <ChefHat className="text-[#E4E3E0] w-10 h-10" />
          <h1 className="font-serif italic text-4xl text-[#E4E3E0]">KDS Digital</h1>
        </div>
        <div className="text-[#E4E3E0] text-right">
          <p className="text-[10px] uppercase tracking-widest opacity-50">Pedidos Ativos</p>
          <p className="text-3xl font-bold">{activeOrders.length}</p>
        </div>
      </header>

      <main className="flex-1 overflow-x-auto p-8 flex space-x-6">
        <AnimatePresence>
          {activeOrders.map(order => {
            const elapsed = getElapsedTime(order.timestamp);
            return (
              <motion.div 
                key={order.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, x: -100 }}
                className={`w-80 flex-shrink-0 rounded-3xl p-6 flex flex-col h-full max-h-[700px] transition-colors ${
                  elapsed.isLate ? 'bg-red-50' : 'bg-[#E4E3E0]'
                }`}
              >
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest opacity-50">Mesa</p>
                    <p className="text-4xl font-bold">{order.tableId}</p>
                  </div>
                  <div className="text-right">
                    <div className={`flex items-center text-xs font-mono font-bold mb-1 ${
                      elapsed.isLate ? 'text-red-600 animate-pulse' : 'text-[#141414]'
                    }`}>
                      <Clock size={12} className="mr-1" />
                      {elapsed.text}
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${
                      order.status === 'pending' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                    }`}>
                      {order.status === 'pending' ? 'Novo' : 'Em Preparo'}
                    </span>
                  </div>
                </div>

              <div className="flex-1 overflow-y-auto space-y-4 mb-6">
                {order.items.filter(i => !i.removed).map((item) => (
                  <div key={item.id} className={`border-b border-[#141414]/10 pb-3 ${item.paid ? 'bg-green-100/50 p-2 rounded-lg' : ''}`}>
                    <div className="flex items-center justify-between">
                      <p className={`font-bold text-lg leading-tight ${item.paid ? 'text-green-800' : ''}`}>{item.name}</p>
                      {item.paid && <span className="text-[8px] bg-green-600 text-white px-1 rounded uppercase font-bold">pago</span>}
                    </div>
                    <p className="text-[10px] opacity-50 uppercase font-bold">{item.size}</p>
                    {item.observations && (
                      <p className="text-[10px] text-blue-600 font-bold bg-blue-50 p-1 rounded mt-1 italic">
                        Obs: {item.observations}
                      </p>
                    )}
                  </div>
                ))}
                {order.observations && (
                  <div className="bg-yellow-100 p-4 rounded-2xl border-2 border-yellow-200">
                    <p className="text-[10px] uppercase font-bold text-yellow-800 opacity-50 mb-1">Observações do Pedido</p>
                    <p className="text-sm text-yellow-900 font-medium italic">{order.observations}</p>
                  </div>
                )}
              </div>

              <button 
                onClick={() => updateStatus(order.id, order.status === 'pending' ? 'preparing' : 'ready')}
                className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center transition-all ${
                  order.status === 'pending' ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-green-600 text-white'
                }`}
              >
                {order.status === 'pending' ? "Começar Preparo" : "Marcar como Pronto"}
                <CheckCircle2 size={20} className="ml-2" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>

        {activeOrders.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/20 text-center">
            <ChefHat size={120} className="mb-6" />
            <h3 className="text-3xl font-serif italic">Cozinha Limpa</h3>
            <p className="text-sm">Aguardando novos pedidos...</p>
          </div>
        )}
      </main>
    </div>
  );
}
