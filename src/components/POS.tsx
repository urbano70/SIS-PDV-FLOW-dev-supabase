import { Table, Order } from '../types';
import socket from '../lib/socket';
import { CreditCard, Banknote, QrCode, Receipt, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import React, { useState } from 'react';

interface POSProps {
  tables: Table[];
  comandas: Table[];
  orders: Order[];
  printerConfig: any;
}

export default function POS({ tables, comandas, orders, printerConfig }: POSProps) {
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [selectionType, setSelectionType] = useState<'tables' | 'comandas'>('tables');

  const currentList = selectionType === 'tables' ? tables : comandas;

  const tableOrder = selectedTable ? orders.find(o => selectedTable.currentOrder && o.id && String(o.id) === String(selectedTable.currentOrder)) : null;
  const total = tableOrder && tableOrder.items ? tableOrder.items.filter(i => !i.removed && !i.paid).reduce((acc, i) => acc + i.price, 0) : 0;

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
    <div className="h-screen flex flex-col lg:flex-row bg-[#F5F5F3] overflow-hidden">
      {/* Tables Sidebar */}
      <div className="w-full lg:w-1/3 bg-white lg:border-r border-[#141414]/10 p-4 lg:p-6 overflow-y-auto shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="font-serif italic text-2xl lg:text-3xl">Frente de Caixa</h2>
        </div>

        <div className="flex bg-[#F5F5F3] p-1 rounded-2xl mb-4 border border-[#141414]/10 shrink-0">
          <button 
            onClick={() => {
              setSelectionType('tables');
              setSelectedTable(null);
            }}
            className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${selectionType === 'tables' ? 'bg-[#141414] text-white shadow-md' : 'text-[#141414]/50'}`}
          >
            Mesas
          </button>
          <button 
            onClick={() => {
              setSelectionType('comandas');
              setSelectedTable(null);
            }}
            className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${selectionType === 'comandas' ? 'bg-[#141414] text-white shadow-md' : 'text-[#141414]/50'}`}
          >
            Comandas
          </button>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-2 gap-2 overflow-y-auto scrollbar-hide pr-1">
          {[...currentList].sort((a, b) => a.id - b.id).map(table => (
            <button 
              key={table.id}
              onClick={() => setSelectedTable(table)}
              className={`p-3 rounded-xl border-2 text-left transition-all relative ${
                selectedTable?.id === table.id ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' :
                table.status === 'bill_requested' ? 'border-yellow-500 bg-yellow-50 animate-pulse' :
                table.status === 'linked' ? 'border-blue-500 bg-blue-50 text-blue-700' :
                table.status === 'occupied' ? 'border-[#141414]/20 bg-gray-50' : 'border-[#141414]/5 opacity-30 shadow-inner'
              }`}
            >
              <p className="text-[7px] uppercase font-bold opacity-50 tracking-tighter">{selectionType === 'tables' ? 'Mesa' : 'Comanda'}</p>
              <div className="flex items-center space-x-1.5 mt-0.5">
                <p className="text-lg font-bold">{table.id}</p>
                {table.status === 'linked' && (
                  <span className="text-[10px] font-bold truncate">→ {table.linkedTo}</span>
                )}
              </div>
              {table.status === 'bill_requested' && <p className="text-[8px] mt-1 font-bold text-yellow-600 uppercase">Conta!</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Checkout Area */}
      <div className="flex-1 p-4 lg:p-8 flex flex-col min-h-0 bg-[#F5F5F3]">
        {selectedTable && tableOrder ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="flex justify-between items-center mb-4 shrink-0 px-2 lg:px-0">
              <div>
                <h3 className="font-serif italic text-2xl lg:text-4xl">{selectionType === 'tables' ? 'Mesa' : 'Comanda'} {selectedTable.id}</h3>
                <p className="text-[10px] opacity-50 uppercase font-bold tracking-widest">Resumo do consumo</p>
              </div>
              <button onClick={() => setSelectedTable(null)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 bg-white border border-[#141414]/10 rounded-3xl p-4 lg:p-6 shadow-xl flex flex-col lg:flex-row gap-6 min-h-0">
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide py-2">
                {tableOrder.items?.filter(i => !i.removed).map((item) => (
                  <div key={item.id} className={`flex justify-between items-center border-b border-[#141414]/5 pb-3 ${item.paid ? 'bg-green-50/50 p-3 rounded-xl border-green-100' : ''}`}>
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center space-x-2">
                        <p className={`font-bold text-sm lg:text-base truncate ${item.paid ? 'text-green-700' : ''}`}>
                          {item.quantity || 1}x {item.name}
                        </p>
                        {item.paid && <span className="bg-green-600 text-white px-1.5 py-0.5 rounded text-[8px] uppercase font-bold shrink-0">pago</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-2 text-[10px] opacity-50 mt-0.5">
                        {item.size && <span>{item.size}</span>}
                        {item.flavors && item.flavors.length > 0 && <span>• {item.flavors.join(' + ')}</span>}
                      </div>
                      {item.observations && <p className="text-[9px] text-blue-700 italic font-bold">Obs: {item.observations.toUpperCase()}</p>}
                    </div>
                    <p className={`font-mono font-bold text-sm lg:text-base shrink-0 ${item.paid ? 'text-green-700' : ''}`}>R$ {item.price.toFixed(2)}</p>
                  </div>
                ))}
              </div>

              <div className="w-full lg:w-[320px] flex flex-col space-y-4 shrink-0 pt-4 lg:pt-0 lg:border-l lg:border-[#141414]/10 lg:pl-6">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold tracking-widest opacity-30">Total Pendente</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-3xl font-bold font-mono">R$ {total.toFixed(2)}</span>
                    <button 
                      onClick={() => {
                        const printWindow = window.open('', '_blank');
                        if (printWindow) {
                          const tableType = selectionType === 'tables' ? 'Mesa' : 'Comanda';
                          const tableId = selectedTable.id;
                          const totalConsumido = (tableOrder.items || []).filter(i => !i.removed).reduce((acc, i) => acc + i.price, 0);
                          
                          const html = `
                            <html>
                              <head>
                                <title>Resumo ${tableType} ${tableId}</title>
                                <style>
                                  body { font-family: monospace; padding: 20px; width: 300px; margin: 0 auto; color: #141414; }
                                  .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
                                  .item { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 12px; }
                                  .footer { border-top: 1px dashed #000; padding-top: 10px; text-align: right; font-weight: bold; }
                                  @media print { body { width: 100%; margin: 0; } }
                                </style>
                              </head>
                              <body>
                                <div class="header">
                                  <div style="font-weight: bold;">CONFERÊNCIA</div>
                                  <div style="font-size: 18px; margin: 10px 0;">${tableType}: ${tableId}</div>
                                </div>
                                <div>
                                  ${(tableOrder.items || []).filter(i => !i.removed).map(item => `
                                    <div class="item">
                                      <span>${item.quantity || 1}x ${item.name} ${item.paid ? '(Pago)' : ''}</span>
                                      <span>R$ ${item.price.toFixed(2)}</span>
                                    </div>
                                  `).join('')}
                                </div>
                                <div class="footer">
                                  <div>TOTAL: R$ ${totalConsumido.toFixed(2)}</div>
                                  <div style="font-size: 14px; margin-top: 5px;">A PAGAR: R$ ${total.toFixed(2)}</div>
                                </div>
                                <script>window.onload = () => { window.print(); window.close(); }</script>
                              </body>
                            </html>
                          `;
                          printWindow.document.write(html);
                          printWindow.document.close();
                        }
                      }}
                      className="text-[9px] uppercase font-bold text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors flex items-center"
                    >
                      <Receipt size={10} className="mr-1" /> Conferência
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button 
                    onClick={() => setPaymentMethod('card')}
                    className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all space-y-1 ${paymentMethod === 'card' ? 'border-[#141414] bg-[#141414] text-white' : 'border-[#141414]/5 bg-[#F5F5F3]'}`}
                  >
                    <CreditCard size={18} />
                    <span className="text-[8px] font-bold uppercase tracking-widest">Cartão</span>
                  </button>
                  <button 
                    onClick={() => setPaymentMethod('cash')}
                    className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all space-y-1 ${paymentMethod === 'cash' ? 'border-[#141414] bg-[#141414] text-white' : 'border-[#141414]/5 bg-[#F5F5F3]'}`}
                  >
                    <Banknote size={18} />
                    <span className="text-[8px] font-bold uppercase tracking-widest">Dinheiro</span>
                  </button>
                  <button 
                    onClick={() => setPaymentMethod('pix')}
                    className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all space-y-1 ${paymentMethod === 'pix' ? 'border-[#141414] bg-[#141414] text-white' : 'border-[#141414]/5 bg-[#F5F5F3]'}`}
                  >
                    <QrCode size={18} />
                    <span className="text-[8px] font-bold uppercase tracking-widest">PIX</span>
                  </button>
                </div>

                <button 
                  onClick={closeTable}
                  disabled={!paymentMethod || isProcessing || total === 0}
                  className="w-full bg-[#141414] text-[#E4E3E0] py-4 rounded-2xl font-bold text-lg flex items-center justify-center hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-20 shrink-0 shadow-lg mt-auto"
                >
                  {isProcessing ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      <span>Processando...</span>
                    </div>
                  ) : (
                    <>
                      <span>Finalizar Conta</span>
                      <Receipt className="ml-2" size={20} />
                    </>
                  )}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showSuccess && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-[#F5F5F3]/90 backdrop-blur-sm flex flex-col items-center justify-center z-[100] rounded-3xl"
                >
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center text-white mb-4 shadow-xl shadow-green-500/20"
                  >
                    <Receipt size={32} />
                  </motion.div>
                  <h4 className="text-2xl font-serif italic mb-1">Pago com Sucesso!</h4>
                  <p className="text-sm opacity-50">A conta foi finalizada e liberada.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center opacity-20 text-center space-y-4">
            <Receipt size={80} strokeWidth={1} />
            <div>
              <h3 className="text-2xl font-serif italic">Pronto para fechar</h3>
              <p className="text-xs uppercase font-bold tracking-widest">Selecione uma mesa ou comanda ocupada</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
