import { Table, Order } from '../types';
import socket from '../lib/socket';
import { CreditCard, Banknote, QrCode, Receipt, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import React, { useState } from 'react';

interface POSProps {
  tables: Table[];
  comandas: Table[];
  orders: Order[];
}

export default function POS({ tables, comandas, orders }: POSProps) {
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [selectionType, setSelectionType] = useState<'tables' | 'comandas'>('tables');

  const currentList = selectionType === 'tables' ? tables : comandas;

  const tableOrder = selectedTable ? orders.find(o => o.id === selectedTable.currentOrder) : null;
  const total = tableOrder ? tableOrder.items.filter(i => !i.removed && !i.paid).reduce((acc, i) => acc + i.price, 0) : 0;

  const closeTable = () => {
    if (!selectedTable || !paymentMethod) return;
    
    setIsProcessing(true);
    
    // Simulate processing
    setTimeout(() => {
      socket.emit('close_table', { 
        tableId: selectedTable.id, 
        isComanda: selectionType === 'comandas' 
      });
      setIsProcessing(false);
      setShowSuccess(true);
      
      setTimeout(() => {
        setShowSuccess(false);
        setSelectedTable(null);
        setPaymentMethod(null);
      }, 3000);
    }, 1500);
  };

  return (
    <div className="h-screen flex bg-gray-100">
      {/* Tables Sidebar */}
      <div className="w-1/3 bg-white border-r-2 border-[#141414] p-8 overflow-y-auto">
        <div className="flex items-center justify-between mb-8">
          <h2 className="font-serif italic text-3xl">Frente de Caixa</h2>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-2xl mb-8 border border-[#141414]/10">
          <button 
            onClick={() => {
              setSelectionType('tables');
              setSelectedTable(null);
            }}
            className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all ${selectionType === 'tables' ? 'bg-[#141414] text-white shadow-lg' : 'text-[#141414]/50'}`}
          >
            Mesas
          </button>
          <button 
            onClick={() => {
              setSelectionType('comandas');
              setSelectedTable(null);
            }}
            className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all ${selectionType === 'comandas' ? 'bg-[#141414] text-white shadow-lg' : 'text-[#141414]/50'}`}
          >
            Comandas
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {currentList.map(table => (
            <button 
              key={table.id}
              onClick={() => setSelectedTable(table)}
              className={`p-6 rounded-2xl border-2 text-left transition-all relative ${
                selectedTable?.id === table.id ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' :
                table.status === 'bill_requested' ? 'border-yellow-500 bg-yellow-50 animate-pulse' :
                table.status === 'linked' ? 'border-blue-500 bg-blue-50 text-blue-700' :
                table.status === 'occupied' ? 'border-[#141414]/20 bg-gray-50' : 'border-[#141414]/5 opacity-30'
              }`}
            >
              <p className="text-[10px] uppercase font-bold">{selectionType === 'tables' ? 'Mesa' : 'Comanda'}</p>
              <div className="flex items-center space-x-2">
                <p className="text-2xl font-bold">{table.id}</p>
                {table.status === 'linked' && (
                  <span className="text-[10px] font-bold">→ {table.linkedTo}</span>
                )}
              </div>
              {table.status === 'bill_requested' && <p className="text-[10px] mt-2 font-bold text-yellow-600">CONTA!</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Checkout Area */}
      <div className="flex-1 p-12 flex flex-col">
        {selectedTable && tableOrder ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col"
          >
            <div className="flex justify-between items-start mb-10">
              <div>
                <h3 className="font-serif italic text-5xl mb-2">{selectionType === 'tables' ? 'Mesa' : 'Comanda'} {selectedTable.id}</h3>
                <p className="text-sm opacity-50">Resumo do consumo</p>
              </div>
              <button onClick={() => setSelectedTable(null)} className="p-2 hover:bg-gray-200 rounded-full">
                <X size={32} />
              </button>
            </div>

            <div className="flex-1 bg-white border-2 border-[#141414] rounded-3xl p-10 shadow-lg flex flex-col">
              <div className="flex-1 overflow-y-auto space-y-6 mb-10">
                {tableOrder.items.map((item) => (
                  <div key={item.id} className={`flex justify-between items-center border-b border-gray-100 pb-4 ${item.paid ? 'bg-green-50 p-4 rounded-2xl border-green-200' : ''}`}>
                    <div>
                      <div className="flex items-center space-x-3">
                        <p className={`font-bold text-xl ${item.paid ? 'text-green-700' : ''}`}>{item.name}</p>
                        {item.paid && <span className="bg-green-600 text-white px-2 py-0.5 rounded-lg text-xs uppercase font-bold">pago</span>}
                      </div>
                      <p className="text-sm opacity-50">{item.size} • {item.flavors.join(' + ')}</p>
                    </div>
                    <p className={`font-bold text-xl ${item.paid ? 'text-green-700' : ''}`}>R$ {item.price.toFixed(2)}</p>
                  </div>
                ))}
              </div>

              <div className="border-t-4 border-double border-[#141414] pt-8">
                <div className="flex justify-between items-center mb-8">
                  <span className="text-2xl font-serif italic">Total a Pagar</span>
                  <span className="text-5xl font-bold">R$ {total.toFixed(2)}</span>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <PaymentButton 
                    icon={<CreditCard />} 
                    label="Cartão" 
                    active={paymentMethod === 'card'} 
                    onClick={() => setPaymentMethod('card')} 
                  />
                  <PaymentButton 
                    icon={<Banknote />} 
                    label="Dinheiro" 
                    active={paymentMethod === 'cash'} 
                    onClick={() => setPaymentMethod('cash')} 
                  />
                  <PaymentButton 
                    icon={<QrCode />} 
                    label="PIX" 
                    active={paymentMethod === 'pix'} 
                    onClick={() => setPaymentMethod('pix')} 
                  />
                </div>

                <button 
                  onClick={closeTable}
                  disabled={!paymentMethod || isProcessing}
                  className="w-full mt-6 bg-[#141414] text-[#E4E3E0] py-6 rounded-2xl font-bold text-xl flex items-center justify-center hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:scale-100"
                >
                  {isProcessing ? 'Processando...' : 'Finalizar e Imprimir Cupom'} <Receipt className="ml-3" />
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showSuccess && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="absolute inset-0 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center z-50 rounded-3xl"
                >
                  <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center text-white mb-6">
                    <Receipt size={48} />
                  </div>
                  <h4 className="text-4xl font-serif italic mb-2">Pagamento Realizado!</h4>
                  <p className="text-lg opacity-50">Cupom fiscal impresso com sucesso.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center opacity-20 text-center">
            <Receipt size={120} className="mb-6" />
            <h3 className="text-3xl font-serif italic">Aguardando Seleção</h3>
            <p>Selecione uma mesa ocupada para processar o pagamento.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentButton({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center p-6 border-2 rounded-2xl transition-all ${
        active ? 'border-[#141414] bg-gray-50' : 'border-[#141414]/10 hover:border-[#141414]/30'
      }`}
    >
      <div className={`mb-2 ${active ? 'text-[#141414]' : 'opacity-30'}`}>{icon}</div>
      <span className={`text-xs font-bold uppercase tracking-widest ${active ? 'text-[#141414]' : 'opacity-30'}`}>{label}</span>
    </button>
  );
}
