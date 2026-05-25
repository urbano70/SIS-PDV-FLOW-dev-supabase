import React, { useState, useEffect, useRef } from 'react';
import { Table, Order, Waiter, StockItem, MenuCategory, MenuItem, PizzeriaConfig } from '../types';
import socket from '../lib/socket';
import { LayoutDashboard, Users, ChefHat, ShoppingCart, CheckCircle, XCircle, Video, Package, AlertTriangle, Wallet, FileText, Settings, Printer, Calendar, Download, Wifi, Menu, X, PlusCircle, Trash2, Search, Pizza, Sandwich, Beer, Clock, Edit, Save, Link as LinkIcon, History, BarChart3, PieChart, TrendingUp, ListPlus, ArrowLeft, RefreshCcw, Lock, Database } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PaymentModal from './PaymentModal';
import { OrderTimer } from './OrderTimer';
import { QRCodeSVG } from 'qrcode.react';
import { GoogleGenAI } from "@google/genai";
import { toast } from 'sonner';
import { MENU_CATEGORIES, PIZZA_FLAVORS, PIZZA_CRUSTS } from '../constants';
import { seedDatabase } from '../lib/seed';
import { useFirebase } from './FirebaseProvider';

interface DashboardProps {
  tables: Table[];
  comandas: Table[];
  orders: Order[];
  waiters: Waiter[];
  stock: StockItem[];
  stockLog: any[];
  menu: MenuCategory[];
  pizzaFlavors: any[];
  pizzaCrusts: string[];
  activeTab: 'overview' | 'waiters' | 'stock' | 'ai' | 'reports' | 'settings' | 'products';
  setActiveTab: (tab: 'overview' | 'waiters' | 'stock' | 'ai' | 'reports' | 'settings' | 'products') => void;
  isCashRegisterOpen: boolean;
  toggleCashRegister: (open: boolean) => Promise<void>;
  printerConfig: any;
  setPrinterConfig: (config: any) => void;
  pizzariaConfig: PizzeriaConfig;
  updatePizzeriaConfig: (config: PizzeriaConfig) => void;
}

// Separate component for Order Details to avoid Hook issues and improve readability
const OrderDetails = ({ 
  isComandaSelected, 
  selectedComandaId, 
  selectedTableId, 
  comandas, 
  tables, 
  orders, 
  waiters, 
  isCashRegisterOpen,
  setIsAddItemModalOpen,
  setIsHistoryModalOpen,
  setIsLinkModalOpen,
  setIsTransferModalOpen,
  setIsPaymentModalOpen,
  setIsBaixaModalOpen,
  handleRemoveItem,
  printerConfig
}: any) => {
  const { data: { pizzariaConfig } } = useFirebase();
  const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
  if (!targetId) return (
    <div className="bg-white/50 border-2 border-dashed border-[#141414]/10 rounded-2xl p-10 text-center opacity-30 flex-1 flex flex-col justify-center">
      <p className="text-sm">Selecione uma mesa ou comanda para ver os detalhes.</p>
    </div>
  );

  const currentItem = (isComandaSelected ? comandas : tables).find((t: any) => targetId && t.id && String(t.id) === String(targetId));

  const hasHistory = React.useMemo(() => {
    if (!targetId) return false;
    const today = new Date().toISOString().split('T')[0];
    return orders.some((o: any) =>
      String(o.tableId) === String(targetId) &&
      !!o.isComanda === !!isComandaSelected &&
      o.timestamp?.startsWith(today)
    );
  }, [orders, targetId, isComandaSelected]);

  const activeOrder = React.useMemo(() => {
    if (!targetId) return null;
    
    // First try to find by currentOrder ID if the table/comanda points to one
    if (currentItem?.currentOrder) {
      const orderById = orders.find((o: any) => 
        String(o.id) === String(currentItem.currentOrder) && o.status !== 'finalizada'
      );
      if (orderById) return orderById;
    }

    // Fallback: find the most recent non-finalized order for this table/comanda
    const activeOrders = orders.filter((o: any) => 
      o.status !== 'finalizada' && 
      o.tableId && String(o.tableId) === String(targetId) && 
      !!o.isComanda === !!isComandaSelected
    );

    if (activeOrders.length > 0) {
      // Sort by timestamp descending to get the most recent one
      return activeOrders.sort((a: any, b: any) => {
        const dateA = new Date(a.timestamp || 0).getTime();
        const dateB = new Date(b.timestamp || 0).getTime();
        return dateB - dateA;
      })[0];
    }

    return null;
  }, [orders, currentItem, targetId, isComandaSelected]);
  const waiter = waiters.find((w: any) => String(w.id) === String(activeOrder?.waiterId));
  const hasItems = activeOrder && activeOrder.items && activeOrder.items.filter((i: any) => !i.removed).length > 0;

  const pendingAmount = React.useMemo(() => {
    if (!activeOrder || !activeOrder.items) return 0;
    const activeItems = activeOrder.items.filter((i: any) => !i.removed && !i.paid);
    const orderTotal = activeItems.reduce((acc: number, i: any) => {
      let price = i.price;
      if (i.discount) {
        if (i.discountType === 'percentage') {
          price = price * (1 - i.discount / 100);
        } else {
          price = Math.max(0, price - i.discount);
        }
      }
      return acc + price;
    }, 0);
    let finalOrderTotal = orderTotal;
    if (activeOrder.discount) {
      if (activeOrder.discountType === 'percentage') {
        finalOrderTotal = orderTotal * (1 - activeOrder.discount / 100);
      } else {
        finalOrderTotal = Math.max(0, orderTotal - activeOrder.discount);
      }
    }
    const existingPartialPaid = (activeOrder.paymentLog || [])
      .filter((p: any) => p.type === 'partial')
      .reduce((acc: number, p: any) => acc + p.amount, 0);
    return Math.max(0, finalOrderTotal - existingPartialPaid);
  }, [activeOrder]);

  return (
    <div className="flex flex-col h-full">
      <h3 className="font-serif italic text-xl mb-3 flex items-center justify-between shrink-0">
        <span className="truncate mr-4">
          {isComandaSelected 
            ? `Detalhes C${selectedComandaId ?? ''}` 
            : `Detalhes M${selectedTableId ?? ''}`}
        </span>
        <div className="flex items-center space-x-2 shrink-0">
          <button 
            onClick={() => hasItems && setIsLinkModalOpen(true)}
            disabled={!hasItems}
            className={`px-2 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase transition-colors ${
              hasItems 
                ? 'bg-gray-100 hover:bg-gray-200 text-[#141414]' 
                : 'bg-gray-50 text-gray-300 cursor-not-allowed opacity-50'
            }`}
          >
            Agrupar
          </button>
          <button 
            onClick={() => {
              if (activeOrder) {
                const printWindow = window.open('', '_blank');
                if (printWindow) {
                  const tableType = isComandaSelected ? 'Comanda' : 'Mesa';
                  const tableId = targetId;
                  const waiterName = waiters.find((w: any) => w.id === activeOrder.waiterId)?.name || 'N/A';
                  const total = (activeOrder.items || []).filter((i: any) => !i.removed).reduce((acc: number, i: any) => acc + i.price, 0);
                  
                  const _pw = (printerConfig.paperWidth || '80mm') === '50mm' ? '192px' : '304px';
                  const _fs = (printerConfig.paperWidth || '80mm') === '50mm' ? '10px' : printerConfig.itemFontSize;
                  const html = `
                    <html>
                      <head>
                        <title>Resumo ${tableType} ${tableId}</title>
                        <style>
                          body { font-family: monospace; padding: 12px; width: ${_pw}; margin: 0 auto; color: #141414; font-size: ${_fs}; }
                          .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
                          .items { margin-bottom: 8px; }
                          .item {
                            display: flex;
                            justify-content: space-between;
                            margin-bottom: 4px;
                            font-size: ${_fs};
                            font-weight: ${printerConfig.boldItems ? 'bold' : 'normal'};
                          }
                          .footer { border-top: 1px dashed #000; padding-top: 8px; text-align: right; }
                          .establishment { font-weight: bold; font-size: ${(printerConfig.paperWidth || '80mm') === '50mm' ? '11px' : '14px'}; text-transform: uppercase; }
                          @media print { body { width: 100%; margin: 0; } }
                        </style>
                      </head>
                      <body>
                        <div class="header">
                          <div class="establishment">${printerConfig.establishmentName}</div>
                          <div>${printerConfig.address}</div>
                          <div>Tel: ${printerConfig.phone}</div>
                          <div style="margin-top: 8px; font-weight: bold;">*** CONFERÊNCIA DE MESA ***</div>
                        </div>
                        <div class="info">
                          <div>${tableType}: ${tableId}</div>
                          <div>Garçom: ${waiterName}</div>
                          <div>Data: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                        <div style="border-bottom: 1px dashed #000; margin: 8px 0;"></div>
                        <div class="items">
                          ${(activeOrder.items || []).filter((i: any) => !i.removed).map((item: any) => `
                            <div class="item">
                              <span>${item.quantity}x ${item.name}</span>
                              <span>R$ ${item.price.toFixed(2)}</span>
                            </div>
                          `).join('')}
                        </div>
                        <div class="footer">
                          <div style="font-weight: bold;">TOTAL: R$ ${total.toFixed(2)}</div>
                        </div>
                        <div style="text-align: center; margin-top: 16px; font-size: 9px; opacity: 0.7;">
                          ${printerConfig.receiptFooter}
                        </div>
                        <script>window.onload = () => { window.print(); window.close(); }</script>
                      </body>
                    </html>
                  `;
                  printWindow.document.write(html);
                  printWindow.document.close();
                }
              }
            }}
            disabled={!hasItems}
            className={`px-2 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase transition-colors ${
              hasItems 
                ? 'bg-blue-50 hover:bg-blue-100 text-blue-700' 
                : 'bg-gray-50 text-gray-300 cursor-not-allowed opacity-50'
            }`}
          >
            <Printer size={10} className="inline mr-1" />
            Resumo
          </button>
          <button 
            onClick={() => hasItems && setIsTransferModalOpen(true)}
            disabled={!hasItems}
            className={`px-2 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase transition-colors ${
              hasItems 
                ? 'bg-gray-100 hover:bg-gray-200 text-[#141414]' 
                : 'bg-gray-50 text-gray-300 cursor-not-allowed opacity-50'
            }`}
          >
            Transferir
          </button>
          {activeOrder?.status === 'aguardando_baixa' ? (
            <button
              onClick={() => setIsBaixaModalOpen(true)}
              className="px-3 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase shadow-sm bg-purple-600 hover:bg-purple-700 text-white flex items-center space-x-1 animate-pulse"
            >
              <CheckCircle size={10} />
              <span>Dar Baixa</span>
            </button>
          ) : (
            <button
              onClick={() => hasItems && pendingAmount > 0.01 && setIsPaymentModalOpen(true)}
              disabled={!hasItems || pendingAmount <= 0.01}
              className={`px-3 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase shadow-sm transition-colors flex items-center space-x-1 ${
                hasItems && pendingAmount > 0.01
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Wallet size={10} />
              <span>Pagar</span>
            </button>
          )}
        </div>
      </h3>
      <div className="bg-white rounded-2xl border-2 border-[#141414] shadow-xl flex flex-col h-full min-h-0 overflow-hidden">
      <div className="p-6 pb-2 shrink-0">
        <div className="flex justify-between items-center mb-4">
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <h4 className="text-2xl font-bold">{isComandaSelected ? 'Comanda' : 'Mesa'} {targetId ?? ''}</h4>
              <button 
                onClick={() => {
                  if (!isCashRegisterOpen) {
                    toast.error('O caixa está fechado. Abra o caixa para adicionar itens.');
                    return;
                  }
                  setIsAddItemModalOpen(true);
                }}
                className="text-[#141414] opacity-30 hover:opacity-100 transition-opacity"
                title="Adicionar Pedido (ADM)"
              >
                <PlusCircle size={20} />
              </button>
            </div>
            {waiter && (
              <span className="text-xs opacity-50 italic">Garçom: {waiter.name}</span>
            )}
          </div>
          <div className="flex flex-col items-end space-y-2">
            <button
              onClick={() => setIsHistoryModalOpen(true)}
              className={`transition-opacity ${hasHistory ? 'text-green-600 opacity-100 hover:opacity-80' : 'text-[#141414] opacity-30 hover:opacity-100'}`}
              title="Histórico de Vendas"
            >
              <History size={20} />
            </button>
            <span className={`text-xs px-2 py-1 rounded-full font-bold uppercase ${
              currentItem?.status === 'free' ? 'bg-gray-100' : 'bg-[#141414] text-[#E4E3E0]'
            }`}>
              {currentItem?.status === 'occupied' ? 'ocupada' : 
               currentItem?.status === 'free' ? 'livre' : 
               currentItem?.status}
            </span>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 pt-0 scrollbar-hide">
        {activeOrder ? (
          <div className="space-y-4">
            <div className="border-b pb-2 space-y-1 pr-1">
              {(activeOrder.items || []).map((item: any) => (
                <div key={item.id} className={`flex justify-between items-start text-sm gap-3 ${item.removed ? 'opacity-30 line-through' : ''} ${item.paid ? 'bg-green-50/50 px-2 py-1 rounded-md border border-green-100/50 mb-1' : ''}`}>
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-bold ${item.paid ? 'text-green-700' : ''}`}>
                        {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                      </span>
                      {!item.removed && !item.paid && (item.type === 'pizzas' || item.type === 'lanches') && !item.deliveredAt && (
                        <OrderTimer
                          timestamp={item.timestamp}
                          urgent={
                            pizzariaConfig?.enabled &&
                            !!item.timestamp &&
                            (Date.now() - new Date(item.timestamp).getTime()) / 60000 >= pizzariaConfig.redMinutes
                          }
                        />
                      )}
                    </div>
                    {!item.removed && !item.paid && item.deliveredAt && (
                      <span className="text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded inline-flex items-center gap-1 mt-1 self-start">
                        <CheckCircle size={10} />
                        Entregue{item.deliveredBy ? ` · ${item.deliveredBy}` : ''}
                      </span>
                    )}
                    {item.observations && <span className="text-[11px] text-blue-700 italic opacity-70 mt-0.5 leading-none">Obs: {item.observations}</span>}
                    {item.waiterName && <span className="text-[11px] text-[#141414] opacity-30 mt-0.5 leading-none">por {item.waiterName.split(' ')[0]}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-mono font-bold whitespace-nowrap ${item.paid ? 'text-green-700' : ''}`}>
                      R$ {(() => {
                        let price = item.price;
                        if (item.discount) {
                          if (item.discountType === 'percentage') price *= (1 - item.discount / 100);
                          else price = Math.max(0, price - item.discount);
                        }
                        return price.toFixed(2);
                      })()}
                    </span>
                    {!item.removed && !item.paid && !activeOrder.paymentLog?.some((p: any) => p.type === 'partial') && (
                      <button
                        onClick={() => handleRemoveItem(activeOrder.id, item)}
                        className="text-red-500 opacity-20 hover:opacity-100 transition-opacity p-1"
                        title="Remover Item (ADM)"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {activeOrder.observations && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                  <p className="text-xs uppercase font-bold text-blue-800 opacity-50 mb-1">Observações da Comanda</p>
                  <p className="text-sm text-blue-700 italic">{activeOrder.observations}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-base opacity-50 italic">Nenhum pedido ativo para esta {isComandaSelected ? 'comanda' : 'mesa'}.</p>
          </div>
        )}
      </div>

      <div className="p-6 pt-2 border-t border-[#141414]/10 bg-gray-50/50 shrink-0">
        {activeOrder ? (
          <>
            <div className="space-y-1">
              <div className="flex justify-between items-center opacity-50">
                <span className="text-xs uppercase font-bold">Total Consumido</span>
                <span className="text-base font-bold">
                  R$ {activeOrder.items.filter((i: any) => !i.removed).reduce((acc: number, i: any) => {
                    let price = i.price;
                    if (i.discount && !i.paid) {
                      if (i.discountType === 'percentage') price *= (1 - i.discount / 100);
                      else price = Math.max(0, price - i.discount);
                    }
                    return acc + price;
                  }, 0).toFixed(2)}
                </span>
              </div>
              {activeOrder.discount && (
                <div className="flex justify-between items-center text-green-600">
                  <span className="text-xs uppercase font-bold">Desconto no Total</span>
                  <span className="text-base font-bold">
                    - {activeOrder.discountType === 'percentage' ? `${activeOrder.discount}%` : `R$ ${activeOrder.discount.toFixed(2)}`}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center pt-1 border-t border-[#141414]/5">
                <span className="text-xs uppercase font-bold opacity-70">Total Líquido</span>
                <span className="text-base font-bold">
                  R$ {(() => {
                    const total = activeOrder.items.filter((i: any) => !i.removed).reduce((acc: number, i: any) => {
                      let price = Number(i.price) || 0;
                      if (i.discount) {
                        if (i.discountType === 'percentage') price *= (1 - i.discount / 100);
                        else price = Math.max(0, price - i.discount);
                      }
                      return acc + price;
                    }, 0);
                    
                    let finalTotal = total;
                    if (activeOrder.discount) {
                      if (activeOrder.discountType === 'percentage') finalTotal *= (1 - activeOrder.discount / 100);
                      else finalTotal = Math.max(0, finalTotal - activeOrder.discount);
                    }
                    return finalTotal.toFixed(2);
                  })()}
                </span>
              </div>
              <div className="flex justify-between items-center text-blue-600">
                <span className="text-xs uppercase font-bold">
                  Já Pago {activeOrder.paymentLog && activeOrder.paymentLog.length > 0 ? '(Registrado)' : ''}
                </span>
                <span className="text-base font-bold">
                  - R$ {(() => {
                    const totalPaidFromLog = (activeOrder.paymentLog || []).reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);
                    return totalPaidFromLog.toFixed(2);
                  })()}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-dashed border-[#141414]/10">
                <span className="text-sm uppercase font-bold">Restante a Pagar</span>
                <span className="text-2xl font-bold">
                  R$ {(() => {
                    const total = activeOrder.items.filter((i: any) => !i.removed).reduce((acc: number, i: any) => {
                      let price = Number(i.price) || 0;
                      if (i.discount) {
                        if (i.discountType === 'percentage') price *= (1 - i.discount / 100);
                        else price = Math.max(0, price - i.discount);
                      }
                      return acc + price;
                    }, 0);
                    
                    let finalTotal = total;
                    if (activeOrder.discount) {
                      if (activeOrder.discountType === 'percentage') finalTotal *= (1 - activeOrder.discount / 100);
                      else finalTotal = Math.max(0, finalTotal - activeOrder.discount);
                    }
                    
                    const paid = (activeOrder.paymentLog || []).reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);
                    
                    return Math.max(0, finalTotal - paid).toFixed(2);
                  })()}
                </span>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  </div>
  );
};

export default function Dashboard({
  tables,
  comandas,
  orders,
  waiters,
  stock,
  stockLog,
  menu,
  pizzaFlavors,
  pizzaCrusts,
  activeTab,
  setActiveTab,
  isCashRegisterOpen,
  toggleCashRegister,
  printerConfig,
  setPrinterConfig,
  pizzariaConfig,
  updatePizzeriaConfig,
}: DashboardProps) {
  const { updateTableStatusLocal } = useFirebase();
  const [videoAnalysis, setVideoAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [selectedComandaId, setSelectedComandaId] = useState<number | null>(null);
  const [isComandaSelected, setIsComandaSelected] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isBaixaModalOpen, setIsBaixaModalOpen] = useState(false);
  const [printOnBaixa, setPrintOnBaixa] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [isRemovalModalOpen, setIsRemovalModalOpen] = useState(false);
  const [itemToRemove, setItemToRemove] = useState<{orderId: number | string, item: any} | null>(null);
  const [removalQuantity, setRemovalQuantity] = useState(1);
  const [removalReason, setRemovalReason] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'pizzas' | 'lanches' | 'bebidas'>('pizzas');
  const [isFlavorModalOpen, setIsFlavorModalOpen] = useState(false);
  const [selectedPizzaItem, setSelectedPizzaItem] = useState<any>(null);
  const [selectedFlavors, setSelectedFlavors] = useState<any[]>([]);
  const [maxFlavors, setMaxFlavors] = useState(1);
  const [selectionStep, setSelectionStep] = useState<'flavors' | 'crust'>('flavors');
  const [selectedCrust, setSelectedCrust] = useState<string | null>(null);
  const [pizzaObservations, setPizzaObservations] = useState('');
  const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
  const [selectedQuantityItem, setSelectedQuantityItem] = useState<any>(null);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemObservations, setItemObservations] = useState('');
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [targetTableId, setTargetTableId] = useState<number | null>(null);
  const [transferReason, setTransferReason] = useState('');
  const [transferMode, setTransferMode] = useState<'all' | 'items'>('all');
  const [transferSelectedItemIds, setTransferSelectedItemIds] = useState<Record<string, boolean>>({});
  const [isMergeConfirmOpen, setIsMergeConfirmOpen] = useState(false);
  const [overviewTab, setOverviewTab] = useState<'tables' | 'comandas'>('tables');
  const [showingRecentOrders, setShowingRecentOrders] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportStartDate, setReportStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportEndDate, setReportEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportSelectedItem, setReportSelectedItem] = useState<string>('');
  const [reportSelectedCategory, setReportSelectedCategory] = useState<string>('todos');
  const [showItemSuggestions, setShowItemSuggestions] = useState(false);
  const [reportSelectedPaymentMethod, setReportSelectedPaymentMethod] = useState<string>('todos');
  const [reportSelectedWaiter, setReportSelectedWaiter] = useState<string>('todos');
  const [currentReportView, setCurrentReportView] = useState<'items_specific' | 'items_all' | 'sales_by_day' | 'sales_by_payment' | 'waiter_performance' | 'table_sales' | null>(null);
  const [reportSelectedTable, setReportSelectedTable] = useState<string>('todas');
  const [snoozeMap, setSnoozeMap] = useState<Record<string, number>>({});
  const [inactivityPopup, setInactivityPopup] = useState<{ tableId: number; isComanda: boolean; minutes: number } | null>(null);
  const [, forceInactivityUpdate] = useState(0);
  const prevActivityRef = useRef<Record<string, number>>({});

  // Pizzaria mode: local state for config editing
  const [localYellow, setLocalYellow] = useState(pizzariaConfig.yellowMinutes);
  const [localOrange, setLocalOrange] = useState(pizzariaConfig.orangeMinutes);
  const [localRed, setLocalRed] = useState(pizzariaConfig.redMinutes);
  const [localInactivity, setLocalInactivity] = useState(pizzariaConfig.inactivityMinutes ?? 30);
  useEffect(() => {
    setLocalYellow(pizzariaConfig.yellowMinutes);
    setLocalOrange(pizzariaConfig.orangeMinutes);
    setLocalRed(pizzariaConfig.redMinutes);
    setLocalInactivity(pizzariaConfig.inactivityMinutes ?? 30);
  }, [pizzariaConfig.yellowMinutes, pizzariaConfig.orangeMinutes, pizzariaConfig.redMinutes, pizzariaConfig.inactivityMinutes]);

  // Tick every 30s to re-compute pizzaria table colors
  const [, setPizzeriaColorTick] = useState(0);
  useEffect(() => {
    if (!pizzariaConfig.enabled) return;
    const id = setInterval(() => setPizzeriaColorTick(n => n + 1), 1_000);
    return () => clearInterval(id);
  }, [pizzariaConfig.enabled]);

  const getPizzeriaTableColor = (tableId: number | string, isComanda: boolean): 'green' | 'yellow' | 'orange' | 'red' | null => {
    if (!pizzariaConfig.enabled) return null;
    const tableObj = (isComanda ? comandas : tables).find((t: any) => String(t.id) === String(tableId));
    if (!tableObj || tableObj.status === 'free') return null;
    const order = orders.find((o: any) =>
      tableObj.currentOrder && String(o.id) === String(tableObj.currentOrder) && o.status !== 'finalizada'
    );
    if (!order) return null;
    const pending = (order.items || []).filter(
      (i: any) => !i.removed && !i.paid && !i.deliveredAt && (i.type === 'pizzas' || i.type === 'lanches')
    );
    if (pending.length === 0) return null;
    const now = Date.now();
    let oldest = Infinity;
    for (const i of pending) {
      if (i.timestamp) {
        const t = new Date(i.timestamp).getTime();
        if (t < oldest) oldest = t;
      }
    }
    if (oldest === Infinity) return 'green';
    const elapsed = (now - oldest) / 60000;
    if (elapsed >= pizzariaConfig.redMinutes) return 'red';
    if (elapsed >= pizzariaConfig.orangeMinutes) return 'orange';
    if (elapsed >= pizzariaConfig.yellowMinutes) return 'yellow';
    return 'green';
  };
  const [isEditProductModalOpen, setIsEditProductModalOpen] = useState(false);
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isAddCategoryPopupOpen, setIsAddCategoryPopupOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{oldName: string, name: string, type: 'pizzas' | 'lanches' | 'bebidas'} | null>(null);
  const [newCategoryData, setNewCategoryData] = useState({ name: '', type: 'lanches' as const });
  const [newProductCategory, setNewProductCategory] = useState<string | null>(null);
  const [newProductData, setNewProductData] = useState({ name: '', price: 0, ingredients: '' });
  const [isEditFlavorModalOpen, setIsEditFlavorModalOpen] = useState(false);
  const [isAddFlavorModalOpen, setIsAddFlavorModalOpen] = useState(false);
  const [editingFlavor, setEditingFlavor] = useState<any>(null);
  const [newFlavorData, setNewFlavorData] = useState({ name: '', ingredients: '' });
  const [editingProduct, setEditingProduct] = useState<{categoryName: string, item: MenuItem} | null>(null);

  const [stockEdits, setStockEdits] = useState<Record<string, { quantity: string; minQuantity: string; unit: string }>>({});
  const [isStockHistoryModalOpen, setIsStockHistoryModalOpen] = useState(false);
  const [stockAdjustPending, setStockAdjustPending] = useState<{ menuItemId: string; quantity: number; minQuantity: number; unit: string; itemName: string; change: number } | null>(null);
  const [stockAdjustReason, setStockAdjustReason] = useState('');
  const [stockHistoryStart, setStockHistoryStart] = useState(new Date().toISOString().split('T')[0]);
  const [stockHistoryEnd, setStockHistoryEnd] = useState(new Date().toISOString().split('T')[0]);

  const importFileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{ menu: any[]; stock: any[]; printerConfig?: any; fileName: string } | null>(null);

  const [isSeedModalOpen, setIsSeedModalOpen] = useState(false);
  const [seedSteps, setSeedSteps] = useState<string[]>([]);
  const [isSeedComplete, setIsSeedComplete] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeedDatabase = async () => {
    setIsSeedModalOpen(true);
    setIsSeeding(true);
    setSeedSteps([]);
    setIsSeedComplete(false);

    try {
      await seedDatabase((step) => {
        setSeedSteps(prev => [...prev, step]);
      });

      // Reset server in-memory state immediately (free all tables/comandas, clear orders)
      setSeedSteps(prev => [...prev, 'Liberando mesas e zerando pedidos...']);
      socket.emit('reset_system');

      setSeedSteps(prev => [...prev, 'Concluído!']);
      setIsSeedComplete(true);
      setIsSeeding(false);
    } catch (error: any) {
      console.error('Seed process failed:', error);
      setIsSeeding(false);
      toast.error('Erro na inicialização');
    }
  };

  const handleTestPrinter = (printerName: string) => {
    if (!printerName || printerName === 'none') {
      toast.info('Nenhuma impressora configurada para este canal.');
      return;
    }
    const printer = (printerConfig.registeredPrinters || []).find((p: any) => p.name === printerName);
    const now = new Date();
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const _testPw = (printerConfig.paperWidth || '80mm') === '50mm' ? '192px' : '304px';
      const _bigFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '20px' : '28px';
      printWindow.document.write(`<html><head><title>Teste de Impressora</title><style>
        body{font-family:monospace;padding:12px;width:${_testPw};margin:0 auto;color:#000}
        .center{text-align:center}.big{font-size:${_bigFs};font-weight:bold;border:3px solid #000;padding:6px;margin:8px 0}
        .sep{border-top:1px dashed #000;margin:6px 0}.small{font-size:9px;opacity:.6}
        @media print{body{width:100%;margin:0}}
      </style></head><body>
        <div class="center">
          <div style="font-size:11px;font-weight:bold;text-transform:uppercase">${printerConfig.establishmentName}</div>
          <div class="sep"></div>
          <div class="big">TESTE OK</div>
          <div style="font-size:13px;font-weight:bold">${printerName}</div>
          ${printer ? `<div class="small">IP: ${printer.ip}</div>` : ''}
          <div class="sep"></div>
          <div class="small">${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR')}</div>
          <div class="small">FechaConta PDV</div>
        </div>
      </body></html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
    toast.success(`Página de teste aberta para ${printerName}`);
  };

  const openPrint = (title: string, body: string) => {
    const w = window.open('', '_blank');
    if (!w) return;
    const _now = new Date();
    const _printedAt = `${_now.toLocaleDateString('pt-BR')} às ${_now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    w.document.write(`<html><head><title>${title}</title><style>
      *{box-sizing:border-box}
      body{font-family:sans-serif;padding:24px;color:#141414;font-size:13px;margin:0}
      h2{margin:0 0 2px;font-size:20px}
      .sub{margin:0 0 20px;color:#666;font-size:12px}
      .print-ts{font-size:10px;color:#999;text-align:right;margin:0 0 16px}
      table{width:100%;border-collapse:collapse}
      th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#888;padding:8px 12px;border-bottom:2px solid #141414}
      td{padding:7px 12px;border-bottom:1px solid #e5e5e5;font-size:12px}
      .tr-total td{background:#f5f5f5;font-weight:900;border-top:2px solid #141414;border-bottom:none}
      .tr-date td{background:#f9f9f9;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-top:1px solid #ccc;border-bottom:1px solid #ddd}
      .block{margin-bottom:20px;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;page-break-inside:avoid}
      .block-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#141414;color:#fff}
      .block-head-name{font-weight:700;font-size:14px}
      .block-head-val{font-family:monospace;font-size:13px}
      .cards{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap}
      .card{flex:1;min-width:120px;border:1px solid #e5e5e5;border-radius:8px;padding:12px 16px}
      .card-label{font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.05em}
      .card-value{font-size:20px;font-weight:900;font-family:monospace;margin-top:4px}
      @media print{body{padding:0}}
    </style></head><body><p class="print-ts">Impresso em: ${_printedAt}</p>${body}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const handlePrintReport = () => {
    const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR');
    const period = reportStartDate === reportEndDate
      ? fmtDate(reportStartDate)
      : `${fmtDate(reportStartDate)} até ${fmtDate(reportEndDate)}`;

    const filteredOrders = orders.filter(o => {
      const d = (o.timestamp || '').split('T')[0];
      return d >= reportStartDate && d <= reportEndDate;
    });

    if (currentReportView === 'items_all') {
      const stats: Record<string, { qty: number; total: number }> = {};
      filteredOrders.forEach(o => o.items.filter((i: any) => !i.removed).forEach((i: any) => {
        if (!stats[i.name]) stats[i.name] = { qty: 0, total: 0 };
        stats[i.name].qty += i.quantity || 1;
        stats[i.name].total += i.price;
      }));
      const rows = Object.entries(stats).sort((a, b) => b[1].total - a[1].total);
      if (rows.length === 0) { toast.error('Nenhum dado no período.'); return; }
      const totalQty = rows.reduce((a, [, v]) => a + v.qty, 0);
      const totalAmt = rows.reduce((a, [, v]) => a + v.total, 0);
      const trs = rows.map(([name, d]) =>
        `<tr><td>${name}</td><td style="font-family:monospace">R$ ${(d.total/d.qty).toFixed(2)}</td><td style="text-align:center;font-family:monospace">${d.qty}</td><td style="text-align:right;font-family:monospace;color:#16a34a">R$ ${d.total.toFixed(2)}</td></tr>`
      ).join('') + `<tr class="tr-total"><td>TOTAIS</td><td style="font-size:10px;color:#888">Ticket médio: R$ ${(totalAmt/totalQty).toFixed(2)}</td><td style="text-align:center;font-family:monospace">${totalQty}</td><td style="text-align:right;font-family:monospace">R$ ${totalAmt.toFixed(2)}</td></tr>`;
      openPrint('Geral de Itens', `<h2>Geral de Itens</h2><p class="sub">Período: ${period} · ${rows.length} produto(s)</p>
        <table><thead><tr><th>Item</th><th>Preço Médio</th><th style="text-align:center">Qtd.</th><th style="text-align:right">Faturamento</th></tr></thead><tbody>${trs}</tbody></table>`);
    }

    else if (currentReportView === 'items_specific') {
      const itemStats: Record<string, Record<string, { qty: number; total: number }>> = {};
      let grandQty = 0; let grandAmt = 0;
      filteredOrders.forEach(o => {
        const date = (o.timestamp || '').split('T')[0];
        o.items.filter((i: any) => {
          if (i.removed) return false;
          const matchName = reportSelectedItem === '' || i.name.toLowerCase().includes(reportSelectedItem.toLowerCase());
          let matchCat = true;
          if (reportSelectedCategory !== 'todos') {
            const cat = menu.find((c: any) => c.name === reportSelectedCategory);
            matchCat = cat?.items.some((mi: any) => mi.name === i.name) || false;
          }
          return matchName && matchCat;
        }).forEach((i: any) => {
          if (!itemStats[i.name]) itemStats[i.name] = {};
          if (!itemStats[i.name][date]) itemStats[i.name][date] = { qty: 0, total: 0 };
          const qty = i.quantity || 1;
          itemStats[i.name][date].qty += qty;
          itemStats[i.name][date].total += i.price;
          grandQty += qty; grandAmt += i.price;
        });
      });
      const itemNames = Object.keys(itemStats).sort();
      if (itemNames.length === 0) { toast.error('Nenhum dado para o filtro selecionado.'); return; }
      const filterLabel = reportSelectedItem ? `Item: "${reportSelectedItem}"` : reportSelectedCategory !== 'todos' ? `Categoria: ${reportSelectedCategory}` : 'Todos os itens';
      const blocks = itemNames.map(name => {
        const tqs = Object.entries(itemStats[name]).sort((a,b)=>a[0].localeCompare(b[0]));
        const iQty = tqs.reduce((a,[,v])=>a+v.qty,0);
        const iAmt = tqs.reduce((a,[,v])=>a+v.total,0);
        const rows = tqs.map(([d,v]) => `<tr><td>${d.split('-').reverse().join('/')}</td><td style="text-align:center;font-family:monospace">${v.qty}</td><td style="text-align:right;font-family:monospace">R$ ${v.total.toFixed(2)}</td></tr>`).join('');
        return `<div class="block"><div class="block-head"><span class="block-head-name">${name}</span><span class="block-head-val">${iQty} un. · R$ ${iAmt.toFixed(2)}</span></div>
          <table><thead><tr><th>Data</th><th style="text-align:center">Qtd.</th><th style="text-align:right">Valor</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }).join('');
      openPrint('Itens Específicos', `<h2>Itens Específicos</h2><p class="sub">Filtro: ${filterLabel} · Período: ${period}</p>${blocks}
        <div style="border-top:2px solid #141414;margin-top:16px;padding-top:12px;display:flex;justify-content:space-between">
          <span style="font-weight:700">Total Geral</span>
          <span style="font-family:monospace;font-weight:900">${grandQty} un. · R$ ${grandAmt.toFixed(2)}</span></div>`);
    }

    else if (currentReportView === 'sales_by_day') {
      const stats: Record<string, Record<string, { total: number; count: number }>> = {};
      filteredOrders.forEach(o => {
        const date = (o.timestamp || '').split('T')[0];
        const label = `${o.isComanda ? 'Com.' : 'Mesa'} ${o.tableId}`;
        if (!stats[date]) stats[date] = {};
        if (!stats[date][label]) stats[date][label] = { total: 0, count: 0 };
        stats[date][label].total += (o.paymentLog || []).reduce((a: number, p: any) => a + p.amount, 0);
        stats[date][label].count += 1;
      });
      const days = Object.entries(stats).sort((a,b) => b[0].localeCompare(a[0]));
      if (days.length === 0) { toast.error('Nenhuma venda no período.'); return; }
      let grandTotal = 0;
      const rows = days.map(([date, tablesData]) => {
        const dayTotal = Object.values(tablesData).reduce((a,v) => a+v.total, 0);
        grandTotal += dayTotal;
        const sub = Object.entries(tablesData).sort((a,b)=>a[0].localeCompare(b[0])).map(([lbl,d]) =>
          `<tr><td></td><td>${lbl}</td><td style="text-align:center;font-family:monospace">${d.count}</td><td style="text-align:right;font-family:monospace;color:#16a34a">R$ ${d.total.toFixed(2)}</td></tr>`
        ).join('');
        return `<tr class="tr-date"><td colspan="4">${date.split('-').reverse().join('/')} — R$ ${dayTotal.toFixed(2)}</td></tr>${sub}`;
      }).join('');
      openPrint('Vendas por Período', `<h2>Vendas por Período</h2><p class="sub">Período: ${period}</p>
        <table><thead><tr><th>Data</th><th>Local</th><th style="text-align:center">Pedidos</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${rows}<tr class="tr-total"><td colspan="3">TOTAL GERAL</td><td style="text-align:right;font-family:monospace">R$ ${grandTotal.toFixed(2)}</td></tr></tbody></table>`);
    }

    else if (currentReportView === 'sales_by_payment') {
      const methods = ['Dinheiro', 'PIX', 'Crédito', 'Débito'];
      const methodTotals: Record<string, number> = {};
      const logs: any[] = [];
      filteredOrders.forEach(o => (o.paymentLog || []).forEach((p: any) => {
        if (reportSelectedPaymentMethod === 'todos' || p.method === reportSelectedPaymentMethod) {
          if (!methodTotals[p.method]) methodTotals[p.method] = 0;
          methodTotals[p.method] += p.amount;
          logs.push({ ...p, orderId: o.id });
        }
      }));
      if (logs.length === 0) { toast.error('Nenhum pagamento no período.'); return; }
      logs.sort((a,b) => b.timestamp.localeCompare(a.timestamp));
      const grandTotal = logs.reduce((a,l)=>a+l.amount, 0);
      const cards = methods.filter(m => reportSelectedPaymentMethod === 'todos' || reportSelectedPaymentMethod === m)
        .map(m => `<div class="card"><div class="card-label">${m}</div><div class="card-value">R$ ${(methodTotals[m]||0).toFixed(2)}</div></div>`).join('');
      const methodLabel = reportSelectedPaymentMethod !== 'todos' ? ` · Método: ${reportSelectedPaymentMethod}` : '';
      const trs = logs.map(l => {
        const d = new Date(l.timestamp);
        return `<tr><td style="font-family:monospace">#${l.orderId}</td><td>${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td><td><b>${l.method}</b></td><td>${l.payer||'—'}</td><td style="text-align:right;font-family:monospace">R$ ${l.amount.toFixed(2)}</td></tr>`;
      }).join('') + `<tr class="tr-total"><td colspan="4">TOTAL</td><td style="text-align:right;font-family:monospace">R$ ${grandTotal.toFixed(2)}</td></tr>`;
      openPrint('Meios de Pagamento', `<h2>Meios de Pagamento</h2><p class="sub">Período: ${period}${methodLabel} · ${logs.length} transação(ões)</p>
        <div class="cards">${cards}</div>
        <table><thead><tr><th>Pedido</th><th>Data/Hora</th><th>Método</th><th>Pagador</th><th style="text-align:right">Valor</th></tr></thead><tbody>${trs}</tbody></table>`);
    }

    else if (currentReportView === 'table_sales') {
      let tableOrders = filteredOrders.filter(o => (o.paymentLog || []).length > 0);
      if (reportSelectedTable !== 'todas') {
        const isComanda = reportSelectedTable.startsWith('comanda_');
        const tableId = reportSelectedTable.split('_')[1];
        tableOrders = tableOrders.filter(o => String(o.tableId) === tableId && !!o.isComanda === isComanda);
      }
      if (tableOrders.length === 0) { toast.error('Nenhuma venda no período.'); return; }
      const tableGroups: Record<string, any[]> = {};
      tableOrders.forEach(o => {
        const key = `${o.isComanda ? 'comanda' : 'mesa'}_${o.tableId}`;
        if (!tableGroups[key]) tableGroups[key] = [];
        tableGroups[key].push(o);
      });
      const tableFilterLabel = reportSelectedTable !== 'todas' ? ` · ${reportSelectedTable.startsWith('comanda_') ? 'Comanda' : 'Mesa'} ${reportSelectedTable.split('_')[1]}` : '';
      let grandTotal = 0;
      const blocks = Object.entries(tableGroups).sort((a,b)=>a[0].localeCompare(b[0])).map(([key, tOrders]) => {
        const isCom = key.startsWith('comanda_');
        const tId = key.split('_')[1];
        const tLabel = `${isCom ? 'Comanda' : 'Mesa'} ${tId}`;
        const tTotal = tOrders.reduce((a, o) => a + (o.paymentLog || []).reduce((s: number, p: any) => s + p.amount, 0), 0);
        grandTotal += tTotal;
        const orderRows = tOrders.sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||'')).map(o => {
          const oTotal = (o.paymentLog || []).reduce((a: number, p: any) => a + p.amount, 0);
          const oDate = new Date(o.timestamp);
          const items = (o.items || []).filter((i: any) => !i.removed).map((i: any) =>
            `<tr><td style="padding:4px 12px 4px 24px;font-size:11px">${i.quantity||1}× ${i.name}</td><td style="padding:4px 12px;font-size:11px;color:#888">${i.waiterName||'—'}</td><td style="padding:4px 12px;text-align:right;font-family:monospace;font-size:11px">R$ ${i.price.toFixed(2)}</td></tr>`
          ).join('');
          const payLog = o.paymentLog || [];
          const payments = payLog.length > 0
            ? `<tr><td colspan="3" style="padding:3px 12px 3px 20px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;opacity:.5;background:#f0fdf4;border-top:1px solid #dcfce7">Pagamentos</td></tr>` +
              payLog.map((p: any) => {
                const mc = p.method==='Dinheiro'?'#16a34a':p.method==='PIX'?'#2563eb':p.method==='Crédito'?'#7c3aed':'#ea580c';
                const partial = p.type==='partial' ? `<span style="margin-left:6px;font-size:8px;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:3px;font-weight:700">PARCIAL</span>` : '';
                const payer = p.payer ? `<span style="margin-left:8px;font-size:11px;font-weight:700;color:#374151">${p.payer}</span>` : '';
                const pTime = new Date(p.timestamp).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
                return `<tr style="background:#f0fdf4;border-top:1px solid #dcfce7"><td style="padding:3px 12px 3px 24px;font-size:11px"><span style="color:${mc};font-weight:700">${p.method}</span>${partial}${payer}</td><td style="padding:3px 12px;font-size:10px;color:#888">${pTime}</td><td style="padding:3px 12px;text-align:right;font-family:monospace;font-size:11px;font-weight:700;color:#16a34a">R$ ${p.amount.toFixed(2)}</td></tr>`;
              }).join('')
            : '';
          return `<tr style="background:#f9f9f9;border-top:1px solid #ddd"><td colspan="2" style="padding:6px 12px;font-size:11px;font-weight:700">#${o.id} &nbsp; ${oDate.toLocaleDateString('pt-BR')} ${oDate.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td><td style="padding:6px 12px;text-align:right;font-family:monospace;font-size:12px;font-weight:700;color:#16a34a">R$ ${oTotal.toFixed(2)}</td></tr>${items}${payments}`;
        }).join('');
        return `<div class="block"><div class="block-head"><span class="block-head-name">${tLabel}</span><span class="block-head-val">R$ ${tTotal.toFixed(2)}</span></div><table style="width:100%"><thead><tr><th>Pedido / Item</th><th>Garçom</th><th style="text-align:right">Valor</th></tr></thead><tbody>${orderRows}</tbody></table></div>`;
      }).join('');
      openPrint('Relatório por Mesas', `<h2>Relatório por Mesas</h2><p class="sub">Período: ${period}${tableFilterLabel} · ${Object.keys(tableGroups).length} mesa(s)</p>${blocks}<div style="border-top:2px solid #141414;margin-top:16px;padding-top:12px;display:flex;justify-content:space-between"><span style="font-weight:700">Total Geral</span><span style="font-family:monospace;font-weight:900">R$ ${grandTotal.toFixed(2)}</span></div>`);
    }

    else if (currentReportView === 'waiter_performance') {
      const waiterStats: Record<string, { total: number; itemsCount: number; items: Record<string, { qty: number; total: number }> }> = {};
      filteredOrders.forEach(o => o.items.filter((i: any) => !i.removed).forEach((i: any) => {
        const name = i.waiterName || 'Desconhecido';
        if (reportSelectedWaiter !== 'todos' && name !== reportSelectedWaiter) return;
        if (!waiterStats[name]) waiterStats[name] = { total: 0, itemsCount: 0, items: {} };
        const qty = i.quantity || 1;
        waiterStats[name].total += i.price; waiterStats[name].itemsCount += qty;
        if (!waiterStats[name].items[i.name]) waiterStats[name].items[i.name] = { qty: 0, total: 0 };
        waiterStats[name].items[i.name].qty += qty; waiterStats[name].items[i.name].total += i.price;
      }));
      const waitersList = Object.entries(waiterStats).sort((a,b)=>b[1].total-a[1].total);
      if (waitersList.length === 0) { toast.error('Nenhum dado no período.'); return; }
      const waiterLabel = reportSelectedWaiter !== 'todos' ? ` · Garçom: ${reportSelectedWaiter}` : '';
      const blocks = waitersList.map(([waiter, stats]) => {
        const rows = Object.entries(stats.items).sort((a,b)=>b[1].qty-a[1].qty).map(([item, d]) =>
          `<tr><td>${item}</td><td style="text-align:center;color:#2563eb;font-family:monospace;font-weight:700">${d.qty}</td><td style="text-align:right;font-family:monospace;font-weight:700">R$ ${d.total.toFixed(2)}</td></tr>`
        ).join('');
        return `<div class="block"><div class="block-head" style="display:flex;gap:12px;align-items:center">
          <div style="width:34px;height:34px;background:#fff;color:#141414;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0">${waiter[0].toUpperCase()}</div>
          <div style="flex:1"><div style="font-weight:700">${waiter}</div><div style="font-size:10px;opacity:.6;text-transform:uppercase">${stats.itemsCount} itens lançados</div></div>
          <div style="font-family:monospace;font-size:18px;font-weight:900;color:#4ade80">R$ ${stats.total.toFixed(2)}</div></div>
          <table><thead><tr><th>Item</th><th style="text-align:center">Qtd.</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }).join('');
      openPrint('Performance Garçons', `<h2>Performance Garçons</h2><p class="sub">Período: ${period}${waiterLabel} · ${waitersList.length} colaborador(es)</p>${blocks}`);
    }
  };

  useEffect(() => {
    if (!isAddItemModalOpen) {
      setSearchTerm('');
      setSelectedCategory('pizzas');
    }
  }, [isAddItemModalOpen]);

  const handleSavePrinters = () => {
    (setPrinterConfig as any)((latest: any) => {
      try {
        localStorage.setItem('printerConfig', JSON.stringify(latest));
        toast.success('Configurações salvas!', {
          description: 'Direcionamento e detalhes do cupom persistidos no dispositivo.'
        });
      } catch {
        toast.error('Erro ao salvar configurações.');
      }
      return latest;
    });
  };

  const printOrderToPrinters = (orderItems: any[], tableId?: number | string, isComanda?: boolean) => {
    const targetId = tableId || (isComandaSelected ? selectedComandaId : selectedTableId);
    const tableType = isComanda !== undefined ? (isComanda ? 'Comanda' : 'Mesa') : (isComandaSelected ? 'Comanda' : 'Mesa');

    if (!targetId) return;

    orderItems.forEach(item => {
      let targetPrinterName = '';
      let shouldPrint = false;

      if (item.type === 'pizzas') {
        targetPrinterName = printerConfig.pizzas || printerConfig.kitchen;
        shouldPrint = printerConfig.autoPrintPizzas ?? true;
      } else if (item.type === 'bebidas') {
        targetPrinterName = printerConfig.drinks || printerConfig.kitchen;
        shouldPrint = printerConfig.autoPrintDrinks ?? false;
      } else if (item.type === 'lanches') {
        targetPrinterName = printerConfig.kitchen;
        shouldPrint = printerConfig.autoPrintKitchen ?? true;
      }

      if (shouldPrint && targetPrinterName && targetPrinterName !== 'none') {
        const printFrame = document.createElement('iframe');
        printFrame.style.position = 'fixed';
        printFrame.style.right = '0';
        printFrame.style.bottom = '0';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = '0';
        document.body.appendChild(printFrame);

        const now = new Date();
        const dateStr = now.toLocaleDateString('pt-BR');
        const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        
        const _pw = (printerConfig.paperWidth || '80mm') === '50mm' ? '192px' : '304px';
        const _tblFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '24px' : '36px';
        const _itemFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '14px' : '20px';
        const _obsFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '11px' : '16px';
        const html = `
          <html>
            <head>
              <style>
                body { font-family: monospace; padding: 8px; width: ${_pw}; margin: 0 auto; color: #000; }
                .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
                .table-info { font-size: ${_tblFs}; font-weight: bold; margin: 4px 0; border: 3px solid #000; padding: 6px; text-align: center; }
                .item-detail { font-size: ${_itemFs}; font-weight: bold; text-transform: uppercase; margin-bottom: 8px; }
                .observation { background: #000; color: #fff; padding: 6px; font-weight: bold; font-size: ${_obsFs}; margin-top: 4px; }
                .footer { font-size: 9px; margin-top: 16px; border-top: 1px solid #000; padding-top: 4px; line-height: 1.4; }
                @media print { body { width: 100%; margin: 0; } }
              </style>
            </head>
            <body>
              <div class="header">
                <div style="font-size: 11px; font-weight: bold;">VIA PRODUÇÃO: ${targetPrinterName.toUpperCase()}</div>
                <div class="table-info">${tableType.toUpperCase()} ${targetId}</div>
                <div style="font-size: 11px; font-weight: bold; margin-top: 4px;">${dateStr} &nbsp; ${timeStr}</div>
              </div>
              <div class="item-detail">
                ${item.quantity || 1}x ${item.name}
              </div>
              ${item.flavors && item.flavors.length > 1 ? `<div style="font-size: ${_obsFs}; font-weight: bold;">SABORES: ${item.flavors.join(' / ')}</div>` : ''}
              ${item.crust ? `<div style="font-size: ${_obsFs};">BORDA: ${item.crust}</div>` : ''}
              ${item.observations ? `<div class="observation">OBS: ${item.observations.toUpperCase()}</div>` : ''}
              <div class="footer">
                <div>Operador: ${item.waiterName || 'SISTEMA'}</div>
              </div>
            </body>
          </html>
        `;

        if (printFrame.contentWindow) {
          printFrame.contentWindow.document.open();
          printFrame.contentWindow.document.write(html);
          printFrame.contentWindow.document.close();
          
          setTimeout(() => {
            printFrame.contentWindow?.focus();
            printFrame.contentWindow?.print();
            document.body.removeChild(printFrame);
          }, 300);
        }
      }
    });
  };

  useEffect(() => {
    const handleKitchenOrder = (data: any) => {
      const items = data?.items;
      if (items?.length > 0) {
        printOrderToPrinters(items, data.tableId, data.isComanda);
      }
    };

    socket.on('kitchen_new_order', handleKitchenOrder);
    return () => {
      socket.off('kitchen_new_order', handleKitchenOrder);
    };
  }, [printerConfig.autoPrintKitchen, printerConfig.autoPrintPizzas, printerConfig.autoPrintDrinks, printerConfig.kitchen, printerConfig.drinks, printerConfig.pizzas]);

  const printReceiptToPrinter = (orderId: number | string, amount: number) => {
    const targetPrinterName = printerConfig.receipts;
    if (targetPrinterName) {
      const printer = (printerConfig.registeredPrinters || []).find((p: any) => p.name === targetPrinterName);
      if (printer) {
        toast.info(`Imprimindo comprovante em ${targetPrinterName}`, {
          description: `Total: R$ ${amount.toFixed(2)}`,
          icon: <FileText size={16} />
        });
      }
    }
  };

  const handlePaymentComplete = (orderId: number | string, selectedItems: Record<string, number>, partialAmount?: number, paymentMethod?: string, payerName?: string) => {
    socket.emit('pay_items', {
      orderId,
      selectedItems,
      partialAmount,
      paymentMethod,
      payerName
    });

    // Handle receipt printing
    const order = orders.find(o => orderId && o.id && String(o.id) === String(orderId));
    if (order) {
      const totalToPrint = partialAmount || Object.entries(selectedItems).reduce((acc, [itemId, qty]) => {
        const item = (order.items || []).find(i => i.id === itemId);
        return acc + (item ? item.price * qty : 0);
      }, 0);
      
      printReceiptToPrinter(orderId, totalToPrint);
    }
  };

  const handleApplyDiscount = (orderId: number | string, itemId: string | null, discount: number, discountType: 'percentage' | 'value') => {
    socket.emit('apply_discount', { orderId, itemId, discount, discountType });
    toast.success('Desconto aplicado!');
  };

  const handleLinkTables = () => {
    const sourceTableId = isComandaSelected ? selectedComandaId : selectedTableId;
    if (sourceTableId && targetTableId) {
      socket.emit('link_tables', { 
        sourceTableId, 
        targetTableId,
        isComanda: isComandaSelected
      });
      setIsLinkModalOpen(false);
      setTargetTableId(null);
      toast.success(`${isComandaSelected ? 'Comanda' : 'Mesa'} ${sourceTableId} vinculada à ${isComandaSelected ? 'Comanda' : 'Mesa'} ${targetTableId}`);
    }
  };

  const closeTransferModal = () => {
    setIsTransferModalOpen(false);
    setIsMergeConfirmOpen(false);
    setTargetTableId(null);
    setTransferReason('');
    setTransferMode('all');
    setTransferSelectedItemIds({});
  };

  const handleTransferTable = () => {
    const sourceTableId = isComandaSelected ? selectedComandaId : selectedTableId;
    const destId = targetTableId; // save before closeTransferModal nulls it
    if (sourceTableId && destId) {
      socket.emit('transfer_table', {
        sourceTableId,
        targetTableId: destId,
        isComanda: isComandaSelected,
        reason: transferReason
      });
      closeTransferModal();
      // Navigate to destination so the user sees the merged account
      if (isComandaSelected) setSelectedComandaId(destId);
      else setSelectedTableId(destId);
      toast.success(`Conta da ${isComandaSelected ? 'Comanda' : 'Mesa'} ${sourceTableId} transferida para ${isComandaSelected ? 'Comanda' : 'Mesa'} ${destId}`);
    }
  };

  const handleTransferItems = () => {
    const sourceId = isComandaSelected ? selectedComandaId : selectedTableId;
    const destId = targetTableId; // save before closeTransferModal nulls it
    const selectedIds = Object.entries(transferSelectedItemIds).filter(([,v]) => v).map(([k]) => k);
    if (!sourceId || !destId || selectedIds.length === 0) return;

    socket.emit('transfer_items', {
      sourceTableId: sourceId,
      targetTableId: destId,
      isComanda: isComandaSelected,
      itemIds: selectedIds
    });

    closeTransferModal();

    // Navigate to the destination table so the user sees the transferred items
    if (isComandaSelected) {
      setSelectedComandaId(destId);
    } else {
      setSelectedTableId(destId);
    }

    toast.success(`${selectedIds.length} item(s) transferido(s) para ${isComandaSelected ? 'Comanda' : 'Mesa'} ${destId}`);
  };

  useEffect(() => {
    if (selectedTableId || selectedComandaId) {
      // Small delay to ensure the content is rendered before scrolling
      setTimeout(() => {
        detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [selectedTableId, selectedComandaId, isComandaSelected]);

  // Ticker: re-renderiza a cada 60s para atualizar ícones de inatividade
  useEffect(() => {
    const id = setInterval(() => forceInactivityUpdate(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Detecta novo item adicionado e apaga o snooze da mesa correspondente
  useEffect(() => {
    const check = (entities: typeof tables, isComandaType: boolean) => {
      entities.forEach(entity => {
        if (entity.status === 'free' || !entity.currentOrder) return;
        const key = `${isComandaType ? 'c' : 't'}_${entity.id}`;
        const order = orders.find(o => String(o.id) === String(entity.currentOrder));
        if (!order) return;
        const activeItems = (order.items || []).filter(i => !i.removed);
        const ts = activeItems.filter(i => i.timestamp).map(i => new Date(i.timestamp!).getTime());
        const lastActivity = ts.length > 0 ? Math.max(...ts) : new Date(order.timestamp).getTime();
        const prev = prevActivityRef.current[key];
        if (prev !== undefined && lastActivity > prev) {
          setSnoozeMap(m => { const n = { ...m }; delete n[key]; return n; });
        }
        prevActivityRef.current[key] = lastActivity;
      });
    };
    check(tables, false);
    check(comandas, true);
  }, [orders, tables, comandas]);

  const getLastActivityMs = (id: number, isComanda: boolean): number | null => {
    const list = isComanda ? comandas : tables;
    const entity = list.find(e => e.id === id);
    if (!entity || entity.status === 'free' || !entity.currentOrder) return null;
    const order = orders.find(o => String(o.id) === String(entity.currentOrder));
    if (!order) return null;
    const activeItems = (order.items || []).filter(i => !i.removed);
    const ts = activeItems.filter(i => i.timestamp).map(i => new Date(i.timestamp!).getTime());
    return ts.length > 0 ? Math.max(...ts) : new Date(order.timestamp).getTime();
  };

  const getInactivityMinutes = (id: number, isComanda: boolean): number => {
    const last = getLastActivityMs(id, isComanda);
    if (last === null) return 0;
    return Math.floor((Date.now() - last) / 60_000);
  };

  const shouldShowInactivityIcon = (id: number, isComanda: boolean): boolean => {
    const list = isComanda ? comandas : tables;
    const entity = list.find(e => e.id === id);
    if (!entity || entity.status === 'free' || !entity.currentOrder) return false;
    if (getInactivityMinutes(id, isComanda) < (pizzariaConfig?.inactivityMinutes ?? 30)) return false;
    const key = `${isComanda ? 'c' : 't'}_${id}`;
    return Date.now() > (snoozeMap[key] ?? 0);
  };

  const handleRemoveItem = (orderId: number | string, item: any) => {
    if (item.paid) {
      toast.error('Não é possível remover um item já pago!');
      return;
    }
    const order = orders.find((o: any) => String(o.id) === String(orderId));
    if (order?.paymentLog?.some((p: any) => p.type === 'partial')) {
      toast.error('Não é possível remover itens de uma comanda com pagamento parcial registrado.');
      return;
    }
    setItemToRemove({ orderId, item });
    setRemovalQuantity(1);
    setRemovalReason('');
    setIsRemovalModalOpen(true);
  };

  const confirmRemoval = () => {
    if (!itemToRemove) return;
    
    socket.emit('remove_item', {
      orderId: itemToRemove.orderId,
      itemId: itemToRemove.item.id,
      quantity: removalQuantity,
      removedBy: 'ADM',
      reason: removalReason || 'Removido pelo Administrador'
    });
    
    setIsRemovalModalOpen(false);
    setItemToRemove(null);
    setRemovalQuantity(1);
    setRemovalReason('');
    toast.success('Item removido pelo ADM');
  };

  const getMaxFlavors = (itemName: string) => {
    const name = itemName.toUpperCase();
    if (name.includes('METRO') && !name.includes('MEIO')) return 4;
    if (name.includes('GRANDE') || name.includes('GG') || name.includes('MEIO METRO')) return 3;
    if (name.includes('MINI') || name.includes('PEQUENA') || name.includes('MÉDIA')) return 2;
    return 1;
  };

  const handleAddItem = (tableId: number, item: any) => {
    if (!isCashRegisterOpen) {
      toast.error('O caixa está fechado. Abra o caixa para adicionar itens.');
      return;
    }
    const activeOrder = orders.filter(o => 
      tableId && o.tableId && 
      String(o.tableId) === String(tableId) && 
      !!o.isComanda === !!isComandaSelected && 
      o.status !== 'finalizada'
    ).sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())[0];
    
    // Check if it's a pizza
    const category = menu.find(cat => cat.items?.some(i => i.id === item.id || i.name === item.name));
    const isPizza = category?.type === 'pizzas' || item.type === 'pizzas';
    const isSnackOrDrink = category?.type === 'lanches' || category?.type === 'bebidas' || item.type === 'lanches' || item.type === 'bebidas';
    
    if (isPizza && !isFlavorModalOpen) {
      setSelectedPizzaItem(item);
      setMaxFlavors(getMaxFlavors(item.name));
      setSelectedFlavors([]);
      setSelectedCrust(null);
      setPizzaObservations('');
      setSelectionStep('flavors');
      setIsFlavorModalOpen(true);
      setIsAddItemModalOpen(false);
      return;
    }

    if (isSnackOrDrink && !isQuantityModalOpen) {
      setSelectedQuantityItem(item);
      setItemQuantity(1);
      setItemObservations('');
      setIsQuantityModalOpen(true);
      setIsAddItemModalOpen(false);
      return;
    }

    const newItem = {
      id: Math.random().toString(36).substr(2, 9),
      menuItemId: item.id,
      name: item.name,
      type: item.type || category?.type,
      flavors: item.flavors || [item.name],
      size: item.size || 'G',
      crust: item.crust,
      extras: [],
      observations: item.observations || '',
      price: item.price,
      waiterName: 'ADM',
      ingredients: item.ingredients
    };

    if (activeOrder) {
      socket.emit('add_item_to_order', {
        orderId: activeOrder.id,
        item: newItem
      });
    } else {
      updateTableStatusLocal(tableId, isComandaSelected, 'occupied');
      socket.emit('new_order', {
        tableId,
        isComanda: isComandaSelected,
        items: [newItem],
        waiterId: 'ADM',
        waiterName: 'ADM'
      });
    }
    printOrderToPrinters([newItem]);
    setIsAddItemModalOpen(false);
    setIsFlavorModalOpen(false);
    toast.success('Item adicionado pelo ADM');
  };

  const confirmQuantitySelection = () => {
    if (!isCashRegisterOpen) {
      toast.error('O caixa está fechado. Abra o caixa para adicionar itens.');
      return;
    }
    const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
    if (!selectedQuantityItem || !targetId) return;

    const category = menu.find(cat => cat.items?.some(i => i.name === selectedQuantityItem.name));

    const newItem = {
      id: Math.random().toString(36).substr(2, 9),
      menuItemId: selectedQuantityItem.id,
      name: selectedQuantityItem.name,
      type: selectedQuantityItem.type || category?.type,
      flavors: [selectedQuantityItem.name],
      size: 'G',
      extras: [],
      observations: itemObservations,
      price: selectedQuantityItem.price * itemQuantity,
      quantity: itemQuantity,
      waiterName: 'ADM',
      ingredients: selectedQuantityItem.ingredients
    };

    const activeOrder = orders.filter(o => 
      targetId && o.tableId && 
      String(o.tableId) === String(targetId) && 
      !!o.isComanda === !!isComandaSelected && 
      o.status !== 'finalizada'
    ).sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())[0];

    if (activeOrder) {
      socket.emit('add_item_to_order', {
        orderId: activeOrder.id,
        item: newItem
      });
    } else {
      updateTableStatusLocal(targetId, isComandaSelected, 'occupied');
      socket.emit('new_order', {
        tableId: targetId,
        isComanda: isComandaSelected,
        items: [newItem],
        waiterId: 'ADM',
        waiterName: 'ADM'
      });
    }
    printOrderToPrinters([newItem]);
    setIsQuantityModalOpen(false);
    setSelectedQuantityItem(null);
    toast.success('Item adicionado pelo ADM');
  };

  const confirmFlavorSelection = () => {
    if (selectedFlavors.length === 0) {
      toast.error('Selecione pelo menos um sabor');
      return;
    }
    setSelectionStep('crust');
  };

  const confirmPizzaSelection = () => {
    const flavorNames = selectedFlavors.map(f => f.name).join(' / ');
    const flavorIngredients = selectedFlavors.map(f => f.ingredients).join(' + ');
    
    const itemWithDetails = {
      ...selectedPizzaItem,
      name: `${selectedPizzaItem.name} (${flavorNames})${selectedCrust ? ` + ${selectedCrust}` : ''}`,
      type: 'pizzas',
      flavors: selectedFlavors.map(f => f.name),
      ingredients: flavorIngredients,
      crust: selectedCrust,
      observations: pizzaObservations
    };

    const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
    handleAddItem(targetId!, itemWithDetails);
  };

  const safeWaiters = Array.isArray(waiters) ? waiters : [];
  const pendingWaiters = safeWaiters.filter(w => String(w.status).toLowerCase() === 'pending');
  const activeWaiters = safeWaiters.filter(w => String(w.status).toLowerCase() === 'approved');
  const inactiveWaiters = safeWaiters.filter(w => {
    const s = String(w.status).toLowerCase();
    return s === 'inactive' || s === 'rejected';
  });
  const lowStockItems = stock.filter(item => item.quantity <= item.minQuantity);
  const waiterUrl = `${window.location.origin}/waiter`;

  const approveWaiter = (id: string) => {
    socket.emit('admin_approve_waiter', id);
    toast.success('Garçom aprovado!');
    // Persistência no Firestore em segundo plano (não bloqueia a operação)
    import('../lib/firebaseService').then(({ updateDocument }) =>
      updateDocument('waiters', id, { status: 'approved' })
    ).catch(() => {});
  };

  const denyWaiter = (id: string) => {
    socket.emit('toggle_waiter_status', { waiterId: id, status: 'rejected' });
    toast.success('Solicitação recusada!');
    import('../lib/firebaseService').then(({ updateDocument }) =>
      updateDocument('waiters', id, { status: 'rejected' })
    ).catch(() => {});
  };

  const analyzeKitchenVideo = async () => {
    setIsAnalyzing(true);
    try {
      const genAI = new GoogleGenAI({ apiKey: "AIzaSyBNfSi4znBYkDd3reBTLq-XQwZzb-plzv4" });
      
      // Mocking video analysis for the demo as we don't have a real video stream here
      // In a real app, we'd capture a frame or send a video file
      const prompt = "Analise o fluxo da cozinha de uma pizzaria. O que pode ser otimizado?";
      const result = await genAI.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt
      });
      setVideoAnalysis(result.text || "Sem resposta da IA.");
    } catch (error) {
      console.error("AI Analysis failed:", error);
      setVideoAnalysis("Erro ao conectar com a IA. Verifique sua chave de API.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden relative">
      {/* Seed Progress Modal */}
      <AnimatePresence>
        {isSeedModalOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#E4E3E0]/80 backdrop-blur-sm"
              onClick={() => !isSeeding && setIsSeedModalOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl border border-[#141414]/10 shadow-2xl p-6 overflow-hidden"
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-[#141414] rounded-full flex items-center justify-center mb-6">
                  {isSeedComplete ? (
                    <CheckCircle className="text-[#E4E3E0] w-8 h-8" />
                  ) : (
                    <RefreshCcw className={`text-[#E4E3E0] w-8 h-8 ${isSeeding ? 'animate-spin' : ''}`} />
                  )}
                </div>
                
                <h2 className="font-serif italic text-2xl mb-2">
                  {isSeedComplete ? 'Tarefa Completa!' : 'Inicializando Banco'}
                </h2>
                <p className="text-gray-500 text-sm mb-6">
                  {isSeedComplete 
                    ? 'Seu sistema está pronto para uso com os dados padrão.'
                    : 'Estamos configurando suas mesas, comandas e menu.'}
                </p>

                <div className="w-full bg-gray-50 rounded-2xl p-4 mb-6 max-h-48 overflow-y-auto text-left space-y-2 border border-[#141414]/5">
                  {seedSteps.map((step, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center space-x-2"
                    >
                      <div className="w-1 h-1 rounded-full bg-[#141414]/30" />
                      <span className={`text-xs font-mono ${i === seedSteps.length - 1 ? 'font-bold text-[#141414]' : 'text-gray-400'}`}>
                        {step}
                      </span>
                    </motion.div>
                  ))}
                  {seedSteps.length === 0 && (
                    <div className="text-xs text-gray-400 italic font-mono">Iniciando processo...</div>
                  )}
                </div>

                {isSeedComplete && (
                  <button 
                    onClick={() => setIsSeedModalOpen(false)}
                    className="w-full bg-[#141414] text-white py-4 rounded-xl font-bold hover:opacity-90 transition-opacity active:scale-95"
                  >
                    OK, Começar a Usar
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.div 
        initial={false}
        animate={{ x: isSidebarOpen ? 0 : -256 }}
        transition={{ type: 'spring', damping: 20, stiffness: 100 }}
        className={`fixed w-64 h-full bg-[#E4E3E0] border-r border-[#141414] flex flex-col p-6 space-y-8 z-50`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-[#141414] rounded-full flex items-center justify-center">
              <ShoppingCart className="text-[#E4E3E0] w-4 h-4" />
            </div>
            <h1 className="font-serif italic text-xl font-bold">FechaConta</h1>
          </div>
          <button onClick={() => setIsSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="flex flex-col space-y-2">
          <button 
            onClick={() => { setActiveTab('overview'); setIsSidebarOpen(false); }}
            className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeTab === 'overview' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <LayoutDashboard size={20} />
            <span className="text-sm font-medium">Visão Geral</span>
          </button>
          <button 
            onClick={() => { setActiveTab('waiters'); setIsSidebarOpen(false); }}
            className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeTab === 'waiters' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <Users size={20} />
            <span className="text-sm font-medium">Garçons</span>
            {pendingWaiters.length > 0 && (
              <span className="ml-auto bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {pendingWaiters.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => { setActiveTab('stock'); setIsSidebarOpen(false); }}
            className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeTab === 'stock' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <Package size={20} />
            <span className="text-sm font-medium">Estoque</span>
            {lowStockItems.length > 0 && (
              <span className="ml-auto bg-yellow-500 text-[#141414] text-[10px] px-1.5 py-0.5 rounded-full">
                {lowStockItems.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => { setActiveTab('products'); setIsSidebarOpen(false); }}
            className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeTab === 'products' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <ShoppingCart size={20} />
            <span className="text-sm font-medium">Produtos</span>
          </button>
          <button 
            onClick={() => { setActiveTab('ai'); setIsSidebarOpen(false); }}
            className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeTab === 'ai' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <Video size={20} />
            <span className="text-sm font-medium">IA Vision</span>
          </button>
          <button 
            onClick={() => { setActiveTab('reports'); setCurrentReportView(null); setIsSidebarOpen(false); }}
            className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeTab === 'reports' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <FileText size={20} />
            <span className="text-sm font-medium">Relatórios</span>
          </button>
          <button 
            onClick={() => { setActiveTab('settings'); setIsSidebarOpen(false); }}
            className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeTab === 'settings' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/10'}`}
          >
            <Settings size={20} />
            <span className="text-sm font-medium">Configurações</span>
          </button>
        </nav>
      </motion.div>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden p-4 lg:p-6 bg-[#F5F5F3] flex flex-col">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-4 gap-3 shrink-0">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 bg-white rounded-lg shadow-sm border border-[#141414]/10 lg:hidden"
            >
              <Menu size={20} />
            </button>
            <header className="flex items-center space-x-2 overflow-hidden">
              <h2 className="font-serif italic text-2xl lg:text-3xl shrink-0">Painel</h2>
              <div className="flex items-center bg-white/50 border border-[#141414]/10 p-0.5 rounded-xl shadow-sm overflow-x-auto scrollbar-hide">
                <button 
                  onClick={() => setActiveTab('overview')}
                  className={`p-1.5 rounded-lg transition-all shrink-0 ${activeTab === 'overview' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Visão Geral"
                >
                  <LayoutDashboard size={16} />
                </button>
                <button 
                  onClick={() => setActiveTab('waiters')}
                  className={`p-1.5 rounded-lg transition-all relative shrink-0 ${activeTab === 'waiters' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Garçons"
                >
                  <Users size={16} />
                  {pendingWaiters.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full border border-white" />
                  )}
                </button>
                <button 
                  onClick={() => setActiveTab('stock')}
                  className={`p-1.5 rounded-lg transition-all relative shrink-0 ${activeTab === 'stock' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Estoque"
                >
                  <Package size={16} />
                  {lowStockItems.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-yellow-500 rounded-full border border-white" />
                  )}
                </button>
                <button 
                  onClick={() => setActiveTab('products')}
                  className={`p-1.5 rounded-lg transition-all shrink-0 ${activeTab === 'products' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Produtos"
                >
                  <ShoppingCart size={16} />
                </button>
                <button 
                  onClick={() => setActiveTab('ai')}
                  className={`p-1.5 rounded-lg transition-all shrink-0 ${activeTab === 'ai' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="IA Vision"
                >
                  <Video size={16} />
                </button>
                <button 
                  onClick={() => { setActiveTab('reports'); setCurrentReportView(null); }}
                  className={`p-1.5 rounded-lg transition-all shrink-0 ${activeTab === 'reports' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Relatórios"
                >
                  <FileText size={16} />
                </button>
                <button 
                  onClick={() => setActiveTab('settings')}
                  className={`p-1.5 rounded-lg transition-all shrink-0 ${activeTab === 'settings' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Configurações"
                >
                  <Settings size={16} />
                </button>
              </div>
            </header>
          </div>

          {activeTab === 'overview' && (
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
              <button 
                onClick={() => {
                  if (!isCashRegisterOpen) {
                    toggleCashRegister(true);
                    socket.emit('toggle_cash_register', true);
                  } else {
                    const activeTables = tables.find(t => t.status !== "free");
                    const activeComandas = comandas.find(c => c.status !== "free");
                    
                    if (activeTables || activeComandas) {
                      toast.error("Não é possível fechar o caixa com mesas ou comandas ocupadas.");
                    } else {
                      toggleCashRegister(false);
                      socket.emit('toggle_cash_register', false);
                    }
                  }
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition-all shadow-sm shrink-0 ${
                  isCashRegisterOpen 
                    ? 'bg-red-500 text-white hover:bg-red-600' 
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                <Wallet size={14} />
                <span>{isCashRegisterOpen ? 'Fechar' : 'Abrir'}</span>
              </button>
              <StatCard title="Mesas" value={tables.filter(t => t.status !== 'free').length} total={tables.length} icon={Users} />
              <StatCard title="Pend." value={orders.filter(o => o.status === 'pending').length} icon={Clock} />
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div 
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 min-h-0 pt-2 lg:pt-4"
            >
              <section className="grid grid-cols-1 md:grid-cols-5 gap-4 h-full">
                {/* Column 1 (Left): Tables/Comandas & Recent Orders */}
                <div className="md:col-span-2 md:col-start-1 md:row-start-1 h-full flex flex-col min-h-0 space-y-3 order-2 md:order-1">
                  <div className="flex items-center space-x-2 shrink-0">
                    <div className="flex items-center space-x-1 bg-white p-0.5 rounded-xl border border-[#141414]/10">
                      <button
                        onClick={() => setOverviewTab('tables')}
                        className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${overviewTab === 'tables' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/50 hover:bg-[#141414]/5'}`}
                      >
                        Mesas
                      </button>
                      <button
                        onClick={() => setOverviewTab('comandas')}
                        className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${overviewTab === 'comandas' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/50 hover:bg-[#141414]/5'}`}
                      >
                        Comandas
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        setShowingRecentOrders(prev => !prev);
                        setSelectedTableId(null);
                        setSelectedComandaId(null);
                      }}
                      title="Pedidos recentes"
                      className={`p-1.5 rounded-lg border transition-all ${showingRecentOrders ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'bg-white text-[#141414]/40 border-[#141414]/10 hover:text-[#141414] hover:border-[#141414]/30'}`}
                    >
                      <History size={12} />
                    </button>
                  </div>

                  <div className="flex-1 min-h-0">
                    <AnimatePresence mode="wait">
                      {overviewTab === 'tables' ? (
                        <motion.div 
                          key="tables-grid"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          transition={{ duration: 0.2 }}
                          className="h-full overflow-y-auto scrollbar-hide pr-1"
                        >
                          <div className="grid grid-cols-5 gap-1.5 pb-2">
                            {[...tables].sort((a, b) => a.id - b.id).map(table => (
                              <button
                                key={table.id}
                                onClick={() => {
                                  setSelectedTableId(table.id);
                                  setIsComandaSelected(false);
                                  setShowingRecentOrders(false);
                                  if (shouldShowInactivityIcon(table.id, false)) {
                                    setInactivityPopup({ tableId: table.id, isComanda: false, minutes: getInactivityMinutes(table.id, false) });
                                  }
                                }}
                                className={`p-1.5 rounded-lg border transition-all text-left w-full ${
                                  selectedTableId === table.id && !isComandaSelected ? 'ring-2 ring-[#141414]/20' : ''
                                } ${(() => {
                                  const pc = getPizzeriaTableColor(table.id, false);
                                  if (pc === 'green') return 'border-green-500 bg-green-500 text-white';
                                  if (pc === 'yellow') return 'border-yellow-400 bg-yellow-400 text-[#141414]';
                                  if (pc === 'orange') return 'border-orange-500 bg-orange-500 text-white';
                                  if (pc === 'red') return 'border-red-500 bg-red-500 text-white animate-pulse';
                                  if (table.status === 'free') return 'border-[#141414]/10 bg-white/50';
                                  if (table.status === 'occupied') return 'border-[#141414] bg-[#141414] text-[#E4E3E0]';
                                  if (table.status === 'aguardando_baixa') return 'border-purple-500 bg-purple-600 text-white animate-pulse';
                                  if (table.status === 'linked') return 'border-blue-500 bg-blue-50 text-blue-700';
                                  return 'border-yellow-500 bg-yellow-50 animate-pulse';
                                })()}`}
                              >
                                <p className="text-[6px] uppercase tracking-widest opacity-50">Mesa</p>
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-bold">{table.id}</p>
                                  <div className="flex items-center space-x-0.5">
                                    {table.status === 'linked' && <LinkIcon size={8} className="text-blue-500" />}
                                    {shouldShowInactivityIcon(table.id, false) && <Clock size={8} className="text-amber-400 animate-pulse" />}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div 
                          key="comandas-grid"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.2 }}
                          className="h-full overflow-y-auto scrollbar-hide pr-1"
                        >
                          <div className="grid grid-cols-5 gap-1.5 pb-2">
                            {[...comandas].sort((a, b) => a.id - b.id).map(comanda => (
                              <button
                                key={comanda.id}
                                onClick={() => {
                                  setSelectedComandaId(comanda.id);
                                  setIsComandaSelected(true);
                                  setShowingRecentOrders(false);
                                  if (shouldShowInactivityIcon(comanda.id, true)) {
                                    setInactivityPopup({ tableId: comanda.id, isComanda: true, minutes: getInactivityMinutes(comanda.id, true) });
                                  }
                                }}
                                className={`p-1.5 rounded-lg border transition-all text-left w-full ${
                                  selectedComandaId === comanda.id && isComandaSelected ? 'ring-2 ring-[#141414]/20' : ''
                                } ${(() => {
                                  const pc = getPizzeriaTableColor(comanda.id, true);
                                  if (pc === 'green') return 'border-green-500 bg-green-500 text-white';
                                  if (pc === 'yellow') return 'border-yellow-400 bg-yellow-400 text-[#141414]';
                                  if (pc === 'orange') return 'border-orange-500 bg-orange-500 text-white';
                                  if (pc === 'red') return 'border-red-500 bg-red-500 text-white animate-pulse';
                                  if (comanda.status === 'free') return 'border-[#141414]/10 bg-white/50';
                                  if (comanda.status === 'occupied') return 'border-[#141414] bg-[#141414] text-[#E4E3E0]';
                                  if (comanda.status === 'aguardando_baixa') return 'border-purple-500 bg-purple-600 text-white animate-pulse';
                                  if (comanda.status === 'linked') return 'border-blue-500 bg-blue-50 text-blue-700';
                                  return 'border-yellow-500 bg-yellow-50 animate-pulse';
                                })()}`}
                              >
                                <p className="text-[6px] uppercase tracking-widest opacity-50">Com.</p>
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-bold">{comanda.id}</p>
                                  <div className="flex items-center space-x-0.5">
                                    {comanda.status === 'linked' && <LinkIcon size={8} className="text-blue-500" />}
                                    {shouldShowInactivityIcon(comanda.id, true) && <Clock size={8} className="text-amber-400 animate-pulse" />}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                </div>

                {/* Column 2 (Right): Order Details or Recent Orders */}
                <div ref={detailsRef} className="md:col-span-3 md:col-start-3 md:row-start-1 h-full flex flex-col min-h-0 order-1 md:order-2">
                  <AnimatePresence mode="wait">
                    {showingRecentOrders ? (
                      <motion.div
                        key="recent-orders"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.2 }}
                        className="flex flex-col h-full min-h-0"
                      >
                        <div className="flex items-center justify-between mb-3 shrink-0">
                          <h3 className="font-serif italic text-xl flex items-center space-x-2">
                            <History size={16} className="opacity-40" />
                            <span>Pedidos Recentes</span>
                          </h3>
                          <span className="text-[9px] uppercase font-bold opacity-30">{orders.length} registro{orders.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-2 pr-1">
                          {[...orders].reverse().map(order => {
                            const waiter = waiters.find((w: any) => w.id === order.waiterId);
                            const activeItems = (order.items || []).filter((i: any) => !i.removed);
                            const total = activeItems.reduce((acc: number, i: any) => acc + (Number(i.price) || 0), 0);
                            const paid = (order.paymentLog || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
                            const pending = Math.max(0, total - paid);
                            const time = order.timestamp ? new Date(order.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                            return (
                              <button
                                key={order.id}
                                onClick={() => {
                                  if (order.isComanda) {
                                    setSelectedComandaId(order.tableId);
                                    setIsComandaSelected(true);
                                  } else {
                                    setSelectedTableId(order.tableId);
                                    setIsComandaSelected(false);
                                  }
                                  setShowingRecentOrders(false);
                                }}
                                className="w-full bg-white/60 hover:bg-white border border-[#141414]/8 hover:border-[#141414]/20 rounded-xl p-3 text-left transition-all group"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center space-x-2 min-w-0">
                                    <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold bg-[#141414]/6 text-[#141414]">
                                      {order.isComanda ? 'C' : 'M'}{order.tableId}
                                    </span>
                                    <div className="min-w-0">
                                      <p className="text-[11px] font-bold truncate">{waiter?.name?.split(' ')[0] || '—'}</p>
                                      <p className="text-[9px] opacity-40">{activeItems.length} iten{activeItems.length !== 1 ? 's' : ''} · {time}</p>
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-xs font-bold font-mono">R$ {total.toFixed(2)}</p>
                                    {pending > 0.01 && order.status !== 'finalizada' ? (
                                      <p className="text-[9px] text-amber-600 font-bold">Pend. R$ {pending.toFixed(2)}</p>
                                    ) : (
                                      <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                        order.status === 'finalizada' ? 'bg-green-50 text-green-600' :
                                        order.status === 'preparing' ? 'bg-blue-50 text-blue-600' :
                                        'bg-orange-50 text-orange-600'
                                      }`}>
                                        {order.status === 'finalizada' ? 'Pago' : order.status === 'preparing' ? 'Preparo' : 'Aberto'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {(() => {
                                  const payers = [...new Set(
                                    (order.paymentLog || [])
                                      .filter((p: any) => p.payer && String(p.payer).trim())
                                      .map((p: any) => String(p.payer).trim())
                                  )];
                                  if (payers.length === 0) return null;
                                  return (
                                    <div className="mt-2 pt-2 border-t border-[#141414]/6 flex flex-wrap gap-1">
                                      {payers.map((payer: string, idx: number) => (
                                        <span key={idx} className="inline-flex items-center gap-1 text-[9px] font-bold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                                          <span className="opacity-50">Pagou:</span> {payer}
                                        </span>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </button>
                            );
                          })}
                          {orders.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full opacity-30">
                              <History size={32} className="mb-2" />
                              <p className="text-sm">Nenhum pedido registrado.</p>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="order-details"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="h-full flex flex-col min-h-0"
                      >
                        <OrderDetails
                          isComandaSelected={isComandaSelected}
                          selectedComandaId={selectedComandaId}
                          selectedTableId={selectedTableId}
                          comandas={comandas}
                          tables={tables}
                          orders={orders}
                          waiters={waiters}
                          isCashRegisterOpen={isCashRegisterOpen}
                          setIsAddItemModalOpen={setIsAddItemModalOpen}
                          setIsHistoryModalOpen={setIsHistoryModalOpen}
                          setIsLinkModalOpen={setIsLinkModalOpen}
                          setIsTransferModalOpen={setIsTransferModalOpen}
                          setIsPaymentModalOpen={setIsPaymentModalOpen}
                          setIsBaixaModalOpen={setIsBaixaModalOpen}
                          handleRemoveItem={handleRemoveItem}
                          printerConfig={printerConfig}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'waiters' && (
            <motion.div
              key="waiters"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-6 lg:space-y-10 pr-1 pt-2"
            >
              <header>
                <h2 className="font-serif italic text-3xl lg:text-4xl mb-1 lg:mb-2">Gestão de Equipe</h2>
                <p className="text-xs lg:text-sm opacity-60">Controle de acessos e performance da equipe.</p>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Column 1: Onboarding with QR Code (Primary Highlight, Dark Cosmic Theme) */}
                <div className="lg:col-span-4 bg-[#141414] text-[#E4E3E0] p-6 rounded-2xl border-2 border-[#141414] shadow-lg flex flex-col items-center justify-center text-center space-y-4 hover:shadow-xl transition-shadow lg:sticky lg:top-24">
                  <span className="bg-[#E4E3E0]/15 text-[#E4E3E0] text-[9px] tracking-wider uppercase font-bold px-2.5 py-1 rounded-full">
                    Acesso & Onboarding
                  </span>
                  <h3 className="font-serif italic text-xl">Cadastro de Garçom</h3>
                  <p className="text-[11px] opacity-70 max-w-[240px]">
                    Escaneie o QR Code abaixo ou envie o link direto para realizar o auto-cadastro de novos garçons.
                  </p>
                  <div className="bg-white p-3 rounded-xl flex items-center justify-center shadow-md border-4 border-white">
                    <QRCodeSVG 
                      value={waiterUrl} 
                      size={150}
                      fgColor="#141414"
                      bgColor="#ffffff"
                      className="mx-auto block"
                    />
                  </div>
                  <div className="space-y-2 w-full text-left bg-white/5 p-3 rounded-xl border border-white/10">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] uppercase tracking-widest font-bold opacity-40">Link do Terminal</p>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(waiterUrl);
                          toast.success('Link copiado!');
                        }}
                        className="text-[10px] font-bold underline text-white hover:text-gray-300 transition-colors"
                      >
                        Copiar Link
                      </button>
                    </div>
                    <p className="text-[10px] font-mono bg-[#141414] px-2.5 py-1.5 rounded border border-white/5 break-all text-[#E4E3E0]/80">{waiterUrl}</p>
                  </div>
                </div>

                {/* Column 2: Pending and Inactive Waiters */}
                <div className="lg:col-span-4 space-y-6">
                  <section className="bg-white border-2 border-[#141414] rounded-2xl p-4 lg:p-6 shadow-sm">
                    <h3 className="font-serif italic text-base lg:text-lg mb-4 flex items-center justify-between">
                      <span className="flex items-center"><Users className="mr-2" size={18} /> Solicitações Pendentes</span>
                      <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-bold">{pendingWaiters.length}</span>
                    </h3>
                    <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                      {pendingWaiters.length > 0 ? (
                        pendingWaiters.map(waiter => (
                          <div key={waiter.id || waiter.cpf} className="flex flex-col p-3 border border-[#141414]/10 rounded-xl hover:bg-gray-50 transition-colors gap-2">
                            <div className="min-w-0">
                              <p className="font-bold text-sm truncate">{waiter.name}</p>
                              <div className="flex flex-wrap gap-x-2 text-[10px] opacity-50 mt-0.5">
                                {waiter.phone && <span>Tel: {waiter.phone}</span>}
                                {waiter.cpf && <span>CPF: {waiter.cpf}</span>}
                                {waiter.birthDate && <span>Nasc: {new Date(waiter.birthDate).toLocaleDateString()}</span>}
                              </div>
                            </div>
                            <div className="flex space-x-2 w-full mt-1">
                              <button 
                                onClick={() => approveWaiter(waiter.id || waiter.cpf!)}
                                className="flex-1 bg-[#141414] text-[#E4E3E0] px-2 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center hover:bg-black transition-colors"
                              >
                                <CheckCircle size={12} className="mr-1" /> Aprovar
                              </button>
                              <button 
                                onClick={() => denyWaiter(waiter.id || waiter.cpf!)}
                                className="flex-1 border border-red-500 text-red-500 px-2 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center hover:bg-red-50 transition-colors"
                              >
                                <XCircle size={12} className="mr-1" /> Negar
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 border border-dashed border-[#141414]/10 rounded-xl">
                          <p className="text-xs opacity-40">Nenhuma solicitação pendente.</p>
                        </div>
                      )}
                    </div>
                  </section>

                  {inactiveWaiters.length > 0 && (
                    <section className="bg-white border border-dashed border-[#141414]/20 rounded-2xl p-4 lg:p-6 shadow-sm">
                      <h3 className="font-serif italic text-base lg:text-lg mb-4 text-gray-400">Equipe Inativa ({inactiveWaiters.length})</h3>
                      <div className="max-h-[220px] overflow-y-auto pr-1">
                        <div className="space-y-3">
                          {inactiveWaiters.map(waiter => (
                            <div key={waiter.id || waiter.cpf} className="bg-gray-50 p-3 rounded-xl border border-[#141414]/5 flex items-center justify-between gap-2 opacity-75 hover:opacity-100 transition-opacity">
                              <div className="flex items-center space-x-2.5 min-w-0">
                                <div className="w-8 h-8 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                                  {waiter.name ? waiter.name[0] : '?'}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold text-xs text-gray-600 truncate">{waiter.name}</p>
                                  <p className="text-[9px] opacity-50 truncate">{waiter.phone}</p>
                                </div>
                              </div>
                              <button 
                                onClick={() => approveWaiter(waiter.id || waiter.cpf!)}
                                className="bg-green-50 text-green-600 px-2 py-1 rounded-lg hover:bg-green-100 transition-colors text-[10px] font-bold shrink-0"
                                title="Ativar Garçom"
                              >
                                Reativar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}
                </div>

                {/* Column 3: Active Waiters */}
                <div className="lg:col-span-4">
                  <section className="bg-white border border-[#141414]/10 rounded-2xl p-4 lg:p-6 shadow-sm">
                    <h3 className="font-serif italic text-base lg:text-lg mb-4 flex items-center justify-between">
                      <span>Equipe Ativa</span>
                      <span className="bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full font-bold">{activeWaiters.length}</span>
                    </h3>
                    <div className="max-h-[480px] overflow-y-auto pr-1">
                      {activeWaiters.length > 0 ? (
                        <div className="space-y-3">
                          {activeWaiters.map(waiter => (
                            <div key={waiter.id || waiter.cpf} className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm flex items-center justify-between gap-2 hover:border-[#141414]/20 transition-all">
                              <div className="flex items-center space-x-3 min-w-0">
                                <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center font-bold text-xs shrink-0">
                                  {waiter.name[0]}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold text-xs truncate">{waiter.name}</p>
                                  <p className="text-[9px] opacity-50 truncate">{waiter.phone}</p>
                                  <p className="text-[9px] uppercase text-green-600 font-bold mt-0.5">Ativo</p>
                                </div>
                              </div>
                              <button 
                                onClick={async () => {
                                  try {
                                    const { updateDocument } = await import('../lib/firebaseService');
                                    await updateDocument('waiters', waiter.id || waiter.cpf!, { status: 'inactive' });
                                    socket.emit('toggle_waiter_status', { waiterId: waiter.id || waiter.cpf, status: 'inactive' });
                                    toast.success('Garçom inativado');
                                  } catch (error) {
                                    toast.error('Erro ao inativar garçom');
                                  }
                                }}
                                className="bg-red-50 text-red-600 p-2 rounded-lg hover:bg-red-100 transition-colors shrink-0"
                                title="Inativar Garçom"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-10 border border-dashed border-[#141414]/10 rounded-xl">
                          <p className="text-xs opacity-40">Nenhum garçom ativo no momento.</p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'stock' && (
            <motion.div
              key="stock"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6 lg:space-y-8 pt-6 flex-1 overflow-y-auto pr-1 scrollbar-hide"
            >
              <header className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h2 className="font-serif italic text-3xl lg:text-4xl mb-1 lg:mb-2">Gestão de Insumos</h2>
                  <p className="text-xs lg:text-sm opacity-60">
                    Controle de estoque dos produtos do cardápio. Ative o rastreamento na aba{' '}
                    <button onClick={() => setActiveTab('products')} className="underline hover:opacity-80">Produtos</button>.
                  </p>
                </div>
                <button
                  onClick={() => setIsStockHistoryModalOpen(true)}
                  className="flex items-center space-x-2 px-4 py-2.5 bg-white border border-[#141414]/10 rounded-2xl text-sm font-bold hover:bg-[#141414] hover:text-[#E4E3E0] transition-all shadow-sm shrink-0"
                >
                  <History size={16} />
                  <span>Histórico</span>
                  {stockLog.length > 0 && (
                    <span className="bg-[#141414] text-[#E4E3E0] text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                      {stockLog.length}
                    </span>
                  )}
                </button>
              </header>

              {stock.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-[#141414]/10 rounded-3xl p-16 text-center">
                  <Package size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="font-bold text-lg opacity-30 mb-2">Nenhum item rastreado</p>
                  <p className="text-sm opacity-40 mb-6">Ative o rastreamento de estoque nos produtos desejados.</p>
                  <button
                    onClick={() => setActiveTab('products')}
                    className="bg-[#141414] text-[#E4E3E0] px-6 py-3 rounded-2xl text-sm font-bold hover:opacity-90 transition-opacity"
                  >
                    Ir para Produtos
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-[#141414]/10 rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto scrollbar-hide">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#141414] text-[#E4E3E0]">
                          <th className="p-3 lg:p-4 text-[8px] lg:text-[10px] uppercase tracking-widest whitespace-nowrap">Produto</th>
                          <th className="p-3 lg:p-4 text-[8px] lg:text-[10px] uppercase tracking-widest whitespace-nowrap">Qtd. Atual</th>
                          <th className="p-3 lg:p-4 text-[8px] lg:text-[10px] uppercase tracking-widest whitespace-nowrap">Mínimo</th>
                          <th className="p-3 lg:p-4 text-[8px] lg:text-[10px] uppercase tracking-widest whitespace-nowrap">Unidade</th>
                          <th className="p-3 lg:p-4 text-[8px] lg:text-[10px] uppercase tracking-widest whitespace-nowrap">Status</th>
                          <th className="p-3 lg:p-4 text-[8px] lg:text-[10px] uppercase tracking-widest whitespace-nowrap"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {stock.map((item: any) => {
                          const edit = stockEdits[item.menuItemId] ?? { quantity: String(item.quantity), minQuantity: String(item.minQuantity), unit: item.unit };
                          const isDirty = stockEdits[item.menuItemId] !== undefined;
                          const isLow = item.quantity <= item.minQuantity;
                          return (
                            <tr key={item.id} className={`border-b border-[#141414]/10 transition-colors ${isLow ? 'bg-red-50/40' : 'hover:bg-gray-50'}`}>
                              <td className="p-3 lg:p-4 font-bold text-sm whitespace-nowrap">{item.name}</td>
                              <td className="p-3 lg:p-4">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={edit.quantity}
                                  onFocus={e => e.target.select()}
                                  onChange={e => setStockEdits(prev => ({ ...prev, [item.menuItemId]: { ...edit, quantity: e.target.value } }))}
                                  className="w-20 border border-[#141414]/20 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:border-[#141414]"
                                />
                              </td>
                              <td className="p-3 lg:p-4">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={edit.minQuantity}
                                  onFocus={e => e.target.select()}
                                  onChange={e => setStockEdits(prev => ({ ...prev, [item.menuItemId]: { ...edit, minQuantity: e.target.value } }))}
                                  className="w-20 border border-[#141414]/20 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:border-[#141414]"
                                />
                              </td>
                              <td className="p-3 lg:p-4">
                                <select
                                  value={edit.unit}
                                  onChange={e => setStockEdits(prev => ({ ...prev, [item.menuItemId]: { ...edit, unit: e.target.value } }))}
                                  className="border border-[#141414]/20 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#141414] bg-white"
                                >
                                  {['un', 'kg', 'g', 'L', 'ml', 'cx', 'pct'].map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </td>
                              <td className="p-3 lg:p-4 whitespace-nowrap">
                                {isLow ? (
                                  <span className="flex items-center text-red-600 text-[10px] font-bold uppercase">
                                    <AlertTriangle size={12} className="mr-1 shrink-0" /> Repor
                                  </span>
                                ) : (
                                  <span className="text-green-600 text-[10px] font-bold uppercase">Estável</span>
                                )}
                              </td>
                              <td className="p-3 lg:p-4">
                                {isDirty && (
                                  <button
                                    onClick={() => {
                                      const newQty = parseFloat(edit.quantity) || 0;
                                      const currentQty = item.quantity ?? 0;
                                      if (newQty < currentQty) {
                                        setStockAdjustReason('');
                                        setStockAdjustPending({
                                          menuItemId: item.menuItemId,
                                          quantity: newQty,
                                          minQuantity: parseFloat(edit.minQuantity) || 0,
                                          unit: edit.unit,
                                          itemName: item.name,
                                          change: newQty - currentQty,
                                        });
                                      } else {
                                        socket.emit('update_stock_item', {
                                          menuItemId: item.menuItemId,
                                          quantity: newQty,
                                          minQuantity: parseFloat(edit.minQuantity) || 0,
                                          unit: edit.unit,
                                        });
                                        setStockEdits(prev => { const n = { ...prev }; delete n[item.menuItemId]; return n; });
                                        toast.success('Estoque atualizado!');
                                      }
                                    }}
                                    className="px-3 py-1 bg-[#141414] text-[#E4E3E0] rounded-lg text-[10px] font-bold uppercase hover:opacity-80 transition-opacity"
                                  >
                                    Salvar
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </motion.div>
          )}

          {activeTab === 'ai' && (
            <motion.div 
              key="ai"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6 lg:space-y-10 pt-6"
            >
              <header>
                <h2 className="font-serif italic text-3xl lg:text-4xl mb-1 lg:mb-2">IA Vision Analysis</h2>
                <p className="text-xs lg:text-sm opacity-60">Análise inteligente do fluxo com Gemini 3.1 Pro.</p>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10">
                <div className="bg-[#141414] rounded-2xl aspect-video flex flex-col items-center justify-center text-[#E4E3E0] p-6 lg:p-10 text-center space-y-4 lg:space-y-6">
                  <Video size={48} className="opacity-20 lg:size-16" />
                  <div>
                    <h4 className="text-lg lg:text-xl font-bold mb-1 lg:mb-2">Monitoramento da Cozinha</h4>
                    <p className="text-xs lg:text-sm opacity-50">Conecte uma câmera para análise de produtividade.</p>
                  </div>
                  <button 
                    onClick={analyzeKitchenVideo}
                    disabled={isAnalyzing}
                    className="bg-[#E4E3E0] text-[#141414] px-6 py-2.5 lg:px-8 lg:py-3 rounded-full font-bold hover:scale-105 transition-transform disabled:opacity-50 text-sm"
                  >
                    {isAnalyzing ? "Analisando..." : "Iniciar Análise"}
                  </button>
                </div>

                <div className="bg-white border-2 border-[#141414] rounded-2xl p-4 lg:p-8 overflow-y-auto max-h-[400px] lg:max-h-[500px] scrollbar-hide">
                  <h3 className="font-serif italic text-lg lg:text-xl mb-4 lg:mb-6">Insights de Otimização</h3>
                  {videoAnalysis ? (
                    <div className="prose prose-sm font-mono text-[10px] lg:text-xs leading-relaxed">
                      {videoAnalysis.split('\n').map((line, i) => (
                        <p key={i} className="mb-2">{line}</p>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full opacity-30 text-center py-10">
                      <ChefHat size={40} className="mb-3 lg:size-12" />
                      <p className="text-xs lg:text-sm uppercase font-bold tracking-widest">Aguardando dados...</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'products' && (
            <motion.div 
              key="products"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 overflow-y-auto space-y-10 pr-2 scrollbar-hide pt-6"
            >
              <header className="sticky top-0 z-30 bg-[#F5F5F3]/90 backdrop-blur-md py-6 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-[#141414]/5 space-y-4 md:space-y-0">
                <div className="flex items-center space-x-6 w-full md:w-auto overflow-hidden">
                  <div>
                    <h2 className="font-serif italic text-3xl">Produtos</h2>
                    <p className="text-[10px] uppercase tracking-widest opacity-50">Cardápio Digital</p>
                  </div>
                  <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide flex-1">
                    {menu.map(category => (
                      <button
                        key={category.name}
                        onClick={() => {
                          const element = document.getElementById(`category-${category.name}`);
                          element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all whitespace-nowrap"
                      >
                        {category.name}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        const element = document.getElementById(`category-sabores-pizzas`);
                        element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all whitespace-nowrap"
                    >
                      Sabores Pizzas
                    </button>
                    <button
                      onClick={() => {
                        const element = document.getElementById(`category-bordas`);
                        element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all whitespace-nowrap"
                    >
                      Bordas
                    </button>
                  </div>
                </div>
                <button 
                  onClick={() => setIsCategoryModalOpen(true)}
                  className="bg-[#141414] text-[#E4E3E0] px-6 py-3 rounded-2xl text-sm font-bold hover:scale-105 transition-transform flex items-center space-x-2 shadow-lg w-full md:w-auto justify-center"
                >
                  <Settings size={20} />
                  <span>Categorias</span>
                </button>
              </header>

              <div className="space-y-12 pb-20">
                {menu.map(category => (
                  <div key={category.name} id={`category-${category.name}`} className="bg-white rounded-3xl border border-[#141414]/10 shadow-sm overflow-hidden scroll-mt-48 md:scroll-mt-32">
                    <div className="bg-gray-50 px-8 py-4 border-b border-[#141414]/10 flex justify-between items-center">
                      <div className="flex items-center space-x-4">
                        <h3 className="font-serif italic text-xl">{category.name}</h3>
                        <span className="text-[10px] uppercase tracking-widest font-bold opacity-50 bg-white px-3 py-1 rounded-full border border-[#141414]/10">
                          {category.items.length} itens
                        </span>
                      </div>
                      <button 
                        onClick={() => {
                          setNewProductCategory(category.name);
                          setNewProductData({ name: '', price: 0, ingredients: '' });
                          setIsAddProductModalOpen(true);
                        }}
                        className="flex items-center space-x-2 bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-xl text-xs font-bold hover:scale-105 transition-transform"
                      >
                        <PlusCircle size={16} />
                        <span>Adicionar Item</span>
                      </button>
                    </div>
                    <div className="divide-y divide-[#141414]/5">
                      {category.items.map(item => (
                        <div key={item.id} className="px-8 py-6 flex justify-between items-center hover:bg-gray-50/50 transition-colors">
                          <div className="space-y-1">
                            <p className="font-bold text-lg">{item.name}</p>
                            <p className="text-sm opacity-60 max-w-xl">{item.ingredients}</p>
                          </div>
                          <div className="flex items-center space-x-4">
                            <p className="font-mono font-bold text-xl mr-4">R$ {item.price.toFixed(2)}</p>

                            {/* Toggle rastrear estoque */}
                            <div className="flex flex-col items-center space-y-1">
                              <span className="text-[7px] uppercase font-bold opacity-40 tracking-widest">Estoque</span>
                              <button
                                onClick={() => {
                                  const enabled = !(item as any).trackStock;
                                  socket.emit('toggle_stock_tracking', {
                                    menuItemId: item.id,
                                    categoryName: category.name,
                                    enabled,
                                  });
                                  toast.success(enabled ? `"${item.name}" adicionado ao estoque` : `"${item.name}" removido do estoque`);
                                }}
                                className={`relative w-10 h-5 rounded-full transition-colors focus:outline-none ${
                                  (item as any).trackStock ? 'bg-green-500' : 'bg-gray-200'
                                }`}
                                title={(item as any).trackStock ? 'Desativar rastreamento de estoque' : 'Ativar rastreamento de estoque'}
                              >
                                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                  (item as any).trackStock ? 'translate-x-5' : 'translate-x-0.5'
                                }`} />
                              </button>
                            </div>

                            <button
                              onClick={() => {
                                setEditingProduct({ categoryName: category.name, item: { ...item } });
                                setIsEditProductModalOpen(true);
                              }}
                              className="p-3 rounded-xl border border-[#141414]/10 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all text-blue-600"
                            >
                              <Edit size={18} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Deseja realmente excluir o produto "${item.name}"?`)) {
                                  socket.emit('delete_product', { categoryName: category.name, productId: item.id });
                                  toast.success('Produto excluído com sucesso!');
                                }
                              }}
                              className="p-3 rounded-xl border border-[#141414]/10 hover:bg-red-600 hover:text-white transition-all text-red-600"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Pizza Flavors Section */}
                <div id="category-sabores-pizzas" className="bg-white rounded-3xl border border-[#141414]/10 shadow-sm overflow-hidden scroll-mt-48 md:scroll-mt-32">
                  <div className="bg-gray-50 px-8 py-4 border-b border-[#141414]/10 flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                      <h3 className="font-serif italic text-xl">Sabores das Pizzas</h3>
                      <span className="text-[10px] uppercase tracking-widest font-bold opacity-50 bg-white px-3 py-1 rounded-full border border-[#141414]/10">
                        {pizzaFlavors.length} sabores
                      </span>
                    </div>
                    <button 
                      onClick={() => {
                        setNewFlavorData({ name: '', ingredients: '' });
                        setIsAddFlavorModalOpen(true);
                      }}
                      className="flex items-center space-x-2 bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-xl text-xs font-bold hover:scale-105 transition-transform"
                    >
                      <PlusCircle size={16} />
                      <span>Adicionar Sabor</span>
                    </button>
                  </div>
                  <div className="divide-y divide-[#141414]/5">
                    {pizzaFlavors.map((flavor, idx) => (
                      <div key={idx} className="px-8 py-6 flex justify-between items-center hover:bg-gray-50/50 transition-colors">
                        <div className="space-y-1">
                          <p className="font-bold text-lg">{flavor.name}</p>
                          <p className="text-sm opacity-60 max-w-xl">{flavor.ingredients}</p>
                        </div>
                        <div className="flex items-center space-x-4">
                          <button 
                            onClick={() => {
                              setEditingFlavor({ ...flavor });
                              setIsEditFlavorModalOpen(true);
                            }}
                            className="p-3 rounded-xl border border-[#141414]/10 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                          >
                            <Edit size={18} />
                          </button>
                          <button 
                            onClick={() => {
                              if (confirm(`Deseja realmente excluir o sabor ${flavor.name}?`)) {
                                socket.emit('delete_pizza_flavor', flavor.name);
                                toast.success('Sabor excluído com sucesso!');
                              }
                            }}
                            className="p-3 rounded-xl border border-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pizza Crusts Section */}
                <div id="category-bordas" className="bg-white rounded-3xl border border-[#141414]/10 shadow-sm overflow-hidden scroll-mt-48 md:scroll-mt-32">
                  <div className="bg-gray-50 px-8 py-4 border-b border-[#141414]/10 flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                      <h3 className="font-serif italic text-xl">Bordas das Pizzas</h3>
                      <span className="text-[10px] uppercase tracking-widest font-bold opacity-50 bg-white px-3 py-1 rounded-full border border-[#141414]/10">
                        {pizzaCrusts.length} itens
                      </span>
                    </div>
                    <button 
                      onClick={() => {
                        const name = prompt('Nome da nova borda:');
                        if (name) {
                          socket.emit('add_pizza_crust', name);
                          toast.success('Borda adicionada com sucesso!');
                        }
                      }}
                      className="flex items-center space-x-2 bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-xl text-xs font-bold hover:scale-105 transition-transform"
                    >
                      <PlusCircle size={16} />
                      <span>Adicionar Borda</span>
                    </button>
                  </div>
                  <div className="divide-y divide-[#141414]/5">
                    {pizzaCrusts.map((crust, idx) => (
                      <div key={idx} className="px-8 py-6 flex justify-between items-center hover:bg-gray-50/50 transition-colors">
                        <div className="space-y-1">
                          <p className="font-bold text-lg">{crust}</p>
                        </div>
                        <div className="flex items-center space-x-4">
                          <button 
                            onClick={() => {
                              const newName = prompt('Novo nome da borda:', crust);
                              if (newName && newName !== crust) {
                                socket.emit('update_pizza_crust', { oldName: crust, newName });
                                toast.success('Borda atualizada com sucesso!');
                              }
                            }}
                            className="p-3 rounded-xl border border-[#141414]/10 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                          >
                            <Edit size={18} />
                          </button>
                          <button 
                            onClick={() => {
                              if (confirm(`Deseja realmente excluir a borda ${crust}?`)) {
                                socket.emit('delete_pizza_crust', crust);
                                toast.success('Borda excluída com sucesso!');
                              }
                            }}
                            className="p-3 rounded-xl border border-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div
              key="reports"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-8 pr-1 pt-2"
            >
              {!currentReportView ? (
                <>
                  <header className="flex justify-between items-center">
                    <div>
                      <h2 className="font-serif italic text-2xl mb-1">Relatórios Financeiros</h2>
                      <p className="text-xs opacity-60">Análise de faturamento e desempenho.</p>
                    </div>
                    <div className="flex items-center space-x-2 bg-white p-1 rounded-xl border border-[#141414]/10">
                      <Calendar size={14} className="opacity-40 ml-2" />
                      <input 
                        type="date" 
                        value={reportDate}
                        onChange={(e) => setReportDate(e.target.value)}
                        className="bg-transparent border-none font-bold outline-none text-xs p-1"
                      />
                    </div>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-[#141414] text-[#E4E3E0] p-4 lg:p-6 rounded-2xl shadow-lg space-y-2">
                      <p className="text-[9px] lg:text-[10px] uppercase font-bold opacity-50 tracking-widest">Faturamento do Dia</p>
                      <p className="text-2xl lg:text-3xl font-bold font-mono">
                        R$ {orders
                          .filter(o => o.timestamp.startsWith(reportDate))
                          .reduce((acc, o) => {
                            const payments = (o.paymentLog || []).reduce((pAcc, p) => pAcc + p.amount, 0);
                            return acc + payments;
                          }, 0)
                          .toFixed(2)}
                      </p>
                      <div className="pt-2 flex items-center space-x-2 opacity-60">
                        <BarChart3 size={14} />
                        <span className="text-[10px]">{orders.filter(o => o.status === 'finalizada' && o.timestamp.startsWith(reportDate)).length} pedidos finalizados</span>
                      </div>
                    </div>

                    <div className="bg-white p-4 lg:p-6 rounded-2xl border border-[#141414]/10 shadow-sm space-y-2">
                      <p className="text-[9px] lg:text-[10px] uppercase font-bold opacity-50 tracking-widest">Ticket Médio</p>
                      <p className="text-2xl lg:text-3xl font-bold font-mono">
                        {(() => {
                          const dayOrders = orders.filter(o => o.status === 'finalizada' && o.timestamp.startsWith(reportDate));
                          if (dayOrders.length === 0) return 'R$ 0,00';
                          const total = dayOrders.reduce((acc, o) => {
                            const payments = (o.paymentLog || []).reduce((pAcc, p) => pAcc + p.amount, 0);
                            return acc + payments;
                          }, 0);
                          return `R$ ${(total / dayOrders.length).toFixed(2)}`;
                        })()}
                      </p>
                      <div className="pt-2 flex items-center space-x-2 text-green-600">
                        <TrendingUp size={14} />
                        <span className="text-[10px]">Baseado em fechamentos</span>
                      </div>
                    </div>

                    <div className="bg-white p-4 lg:p-6 rounded-2xl border border-[#141414]/10 shadow-sm space-y-2">
                      <p className="text-[9px] lg:text-[10px] uppercase font-bold opacity-50 tracking-widest">Itens Lançados</p>
                      <p className="text-2xl lg:text-3xl font-bold font-mono">
                        {orders
                          .filter(o => o.timestamp.startsWith(reportDate))
                          .reduce((acc, o) => acc + (o.items || []).filter(i => !i.removed).length, 0)}
                      </p>
                      <div className="pt-2 flex items-center space-x-2 opacity-40">
                        <Package size={14} />
                        <span className="text-[10px]">Lançamentos de hoje</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-serif italic text-xl">Gerar Relatórios</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      <button 
                        onClick={() => setCurrentReportView('items_specific')}
                        className="p-3 bg-white border border-[#141414]/10 rounded-xl hover:border-[#141414] hover:shadow-md transition-all text-left group"
                      >
                        <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <Search size={16} />
                        </div>
                        <h4 className="font-bold text-[10px] uppercase mb-0.5">Busca Específica</h4>
                        <p className="text-[8px] opacity-50 leading-tight">Filtrar por item ou categoria.</p>
                      </button>

                      <button 
                        onClick={() => setCurrentReportView('items_all')}
                        className="p-3 bg-white border border-[#141414]/10 rounded-xl hover:border-[#141414] hover:shadow-md transition-all text-left group"
                      >
                        <div className="w-8 h-8 bg-[#141414]/5 text-[#141414] rounded-lg flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <Package size={16} />
                        </div>
                        <h4 className="font-bold text-[10px] uppercase mb-0.5">Geral de Itens</h4>
                        <p className="text-[8px] opacity-50 leading-tight">Total vendido por produto.</p>
                      </button>

                      <button 
                        onClick={() => setCurrentReportView('sales_by_day')}
                        className="p-3 bg-white border border-[#141414]/10 rounded-xl hover:border-[#141414] hover:shadow-md transition-all text-left group"
                      >
                        <div className="w-8 h-8 bg-orange-50 text-orange-600 rounded-lg flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <TrendingUp size={16} />
                        </div>
                        <h4 className="font-bold text-[10px] uppercase mb-0.5">Vendas</h4>
                        <p className="text-[8px] opacity-50 leading-tight">Agrupado por dia/mesa.</p>
                      </button>

                      <button 
                        onClick={() => setCurrentReportView('sales_by_payment')}
                        className="p-3 bg-white border border-[#141414]/10 rounded-xl hover:border-[#141414] hover:shadow-md transition-all text-left group"
                      >
                        <div className="w-8 h-8 bg-green-50 text-green-600 rounded-lg flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <PieChart size={16} />
                        </div>
                        <h4 className="font-bold text-[10px] uppercase mb-0.5">Pagamento</h4>
                        <p className="text-[8px] opacity-50 leading-tight">Análise por tipo.</p>
                      </button>

                      <button
                        onClick={() => setCurrentReportView('waiter_performance')}
                        className="p-3 bg-white border border-[#141414]/10 rounded-xl hover:border-[#141414] hover:shadow-md transition-all text-left group"
                      >
                        <div className="w-8 h-8 bg-yellow-50 text-yellow-600 rounded-lg flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <Users size={16} />
                        </div>
                        <h4 className="font-bold text-[10px] uppercase mb-0.5">Garçons</h4>
                        <p className="text-[8px] opacity-50 leading-tight">Desempenho e valores.</p>
                      </button>

                      <button
                        onClick={() => setCurrentReportView('table_sales')}
                        className="p-3 bg-white border border-[#141414]/10 rounded-xl hover:border-[#141414] hover:shadow-md transition-all text-left group"
                      >
                        <div className="w-8 h-8 bg-purple-50 text-purple-600 rounded-lg flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <LayoutDashboard size={16} />
                        </div>
                        <h4 className="font-bold text-[10px] uppercase mb-0.5">Por Mesa</h4>
                        <p className="text-[8px] opacity-50 leading-tight">Vendas detalhadas por mesa.</p>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <header className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <button 
                        onClick={() => setCurrentReportView(null)}
                        className="p-2 bg-white border border-[#141414]/10 rounded-xl hover:bg-gray-50 transition-colors"
                      >
                        <ArrowLeft size={14} />
                      </button>
                      <div>
                        <h2 className="font-serif italic text-lg leading-none">
                          {currentReportView === 'items_specific' && 'Itens Específicos'}
                          {currentReportView === 'items_all' && 'Geral de Itens'}
                          {currentReportView === 'sales_by_day' && 'Vendas por Período'}
                          {currentReportView === 'sales_by_payment' && 'Meios de Pagamento'}
                          {currentReportView === 'waiter_performance' && 'Performance Garçons'}
                          {currentReportView === 'table_sales' && 'Relatório por Mesas'}
                        </h2>
                        <p className="text-[9px] opacity-60">Filtre para gerar o relatório.</p>
                      </div>
                    </div>
                  </header>

                  <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm">
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 items-end">
                      <div>
                        <label className="text-[8px] uppercase font-bold opacity-50 mb-1 block">Início</label>
                        <input 
                          type="date" 
                          value={reportStartDate}
                          onChange={(e) => setReportStartDate(e.target.value)}
                          className="w-full bg-[#141414]/5 border-none rounded-lg py-1.5 px-2 font-bold text-[10px] focus:ring-2 focus:ring-[#141414] outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] uppercase font-bold opacity-50 mb-1 block">Fim</label>
                        <input 
                          type="date" 
                          value={reportEndDate}
                          onChange={(e) => setReportEndDate(e.target.value)}
                          className="w-full bg-[#141414]/5 border-none rounded-lg py-1.5 px-2 font-bold text-[10px] focus:ring-2 focus:ring-[#141414] outline-none"
                        />
                      </div>
                      
                      {currentReportView === 'sales_by_payment' && (
                        <div>
                          <label className="text-[8px] uppercase font-bold opacity-50 mb-1 block">Pagamento</label>
                          <select 
                            value={reportSelectedPaymentMethod}
                            onChange={(e) => setReportSelectedPaymentMethod(e.target.value)}
                            className="w-full bg-[#141414]/5 border-none rounded-lg py-1.5 px-2 font-bold text-[10px] focus:ring-2 focus:ring-[#141414] outline-none appearance-none"
                          >
                            <option value="todos">Todos</option>
                            <option value="Dinheiro">Dinheiro</option>
                            <option value="PIX">PIX</option>
                            <option value="Crédito">Crédito</option>
                            <option value="Débito">Débito</option>
                          </select>
                        </div>
                      )}

                      {currentReportView === 'waiter_performance' && (
                        <div>
                          <label className="text-[8px] uppercase font-bold opacity-50 mb-1 block">Garçom</label>
                          <select
                            value={reportSelectedWaiter}
                            onChange={(e) => setReportSelectedWaiter(e.target.value)}
                            className="w-full bg-[#141414]/5 border-none rounded-lg py-1.5 px-2 font-bold text-[10px] focus:ring-2 focus:ring-[#141414] outline-none appearance-none"
                          >
                            <option value="todos">Todos</option>
                            {waiters.filter(w => w.status === 'approved').map(w => (
                              <option key={w.id} value={w.name}>{w.name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {currentReportView === 'table_sales' && (
                        <div>
                          <label className="text-[8px] uppercase font-bold opacity-50 mb-1 block">Mesa</label>
                          <select
                            value={reportSelectedTable}
                            onChange={(e) => setReportSelectedTable(e.target.value)}
                            className="w-full bg-[#141414]/5 border-none rounded-lg py-1.5 px-2 font-bold text-[10px] focus:ring-2 focus:ring-[#141414] outline-none appearance-none"
                          >
                            <option value="todas">Todas as Mesas</option>
                            {Array.from(new Set(
                              orders
                                .filter(o => {
                                  const d = (o.timestamp || '').split('T')[0];
                                  return d >= reportStartDate && d <= reportEndDate && (o.paymentLog || []).length > 0;
                                })
                                .map(o => `${o.isComanda ? 'comanda' : 'mesa'}_${o.tableId}`)
                            )).sort((a,b) => {
                              const [ta, na] = a.split('_');
                              const [tb, nb] = b.split('_');
                              if (ta !== tb) return ta.localeCompare(tb);
                              return Number(na) - Number(nb);
                            }).map(key => {
                              const isCom = key.startsWith('comanda_');
                              const tId = key.split('_')[1];
                              return <option key={key} value={key}>{isCom ? 'Comanda' : 'Mesa'} {tId}</option>;
                            })}
                          </select>
                        </div>
                      )}

                      {currentReportView === 'items_specific' && (
                        <>
                          <div>
                            <label className="text-[8px] uppercase font-bold opacity-50 mb-1 block">Categoria</label>
                            <select 
                              value={reportSelectedCategory}
                              onChange={(e) => setReportSelectedCategory(e.target.value)}
                              className="w-full bg-[#141414]/5 border-none rounded-lg py-1.5 px-2 font-bold text-[10px] focus:ring-2 focus:ring-[#141414] outline-none appearance-none"
                            >
                              <option value="todos">Todas</option>
                              {menu.map(cat => (
                                <option key={cat.name} value={cat.name}>{cat.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="relative">
                            <label className="text-[8px] uppercase font-bold opacity-50 mb-1 block">Item</label>
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 opacity-30" size={10} />
                              <input 
                                type="text" 
                                placeholder="Filtrar..."
                                value={reportSelectedItem}
                                onChange={(e) => {
                                  setReportSelectedItem(e.target.value);
                                  setShowItemSuggestions(e.target.value.length >= 3);
                                }}
                                className="w-full bg-[#141414]/5 border-none rounded-lg py-1.5 pl-6 pr-2 font-bold text-[10px] focus:ring-2 focus:ring-[#141414] outline-none"
                              />
                            </div>
                          </div>
                        </>
                      )}
                      
                      <button
                        onClick={handlePrintReport}
                        className="bg-[#141414] text-[#E4E3E0] py-1.5 px-3 rounded-lg font-bold text-[10px] flex items-center justify-center space-x-1.5 hover:opacity-90 transition-opacity"
                      >
                        <Download size={12} />
                        <span>Imprimir</span>
                      </button>
                    </div>
                  </div>

                    <div className="pt-6 border-t border-[#141414]/10">
                      {currentReportView === 'items_specific' && (
                        <div className="space-y-6">
                          <div className="flex justify-between items-center px-4 py-2 bg-[#141414]/5 rounded-xl">
                            <div className="flex flex-col text-left">
                              <span className="text-[10px] uppercase font-bold opacity-40">Filtro Ativo</span>
                              <span className="text-sm font-bold uppercase tracking-wider">
                                {reportSelectedItem ? `Item: ${reportSelectedItem}` : 'Todos os itens'} 
                                {reportSelectedCategory !== 'todos' && ` | Categoria: ${reportSelectedCategory}`}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] uppercase font-bold opacity-40 block">Período</span>
                              <span className="font-mono font-bold text-sm">{reportStartDate.split('-').reverse().join('/')} até {reportEndDate.split('-').reverse().join('/')}</span>
                            </div>
                          </div>

                          <div id="printable-report" className="space-y-6 bg-white p-4 rounded-xl">
                            {(() => {
                              const itemStats: Record<string, Record<string, { qty: number, total: number }>> = {};
                              let grandTotalQty = 0;
                              let grandTotalAmount = 0;

                              orders
                                .filter(o => o.timestamp.split('T')[0] >= reportStartDate && o.timestamp.split('T')[0] <= reportEndDate)
                                .forEach(o => {
                                  const date = o.timestamp.split('T')[0];
                                  o.items.filter(i => {
                                    if (i.removed) return false;
                                    const matchName = reportSelectedItem === '' || i.name.toLowerCase().includes(reportSelectedItem.toLowerCase());
                                    let matchCategory = true;
                                    if (reportSelectedCategory !== 'todos') {
                                      const category = menu.find(cat => cat.name === reportSelectedCategory);
                                      matchCategory = category?.items.some(mi => mi.name === i.name) || false;
                                    }
                                    return matchName && matchCategory;
                                  }).forEach(i => {
                                    if (!itemStats[i.name]) itemStats[i.name] = {};
                                    if (!itemStats[i.name][date]) itemStats[i.name][date] = { qty: 0, total: 0 };
                                    
                                    const qty = i.quantity || 1;
                                    const total = qty * i.price;
                                    
                                    itemStats[i.name][date].qty += qty;
                                    itemStats[i.name][date].total += total;
                                    grandTotalQty += qty;
                                    grandTotalAmount += total;
                                  });
                                });

                              const itemNames = Object.keys(itemStats).sort();

                              if (itemNames.length === 0) {
                                return (
                                  <div className="bg-[#141414]/5 p-10 rounded-3xl text-center">
                                    <p className="opacity-50">Nenhum dado encontrado para o período e filtros selecionados.</p>
                                  </div>
                                );
                              }

                              return (
                                <div className="space-y-8">
                                  {itemNames.map(itemName => (
                                    <div key={itemName} className="border border-[#141414]/10 rounded-2xl overflow-hidden bg-white shadow-sm">
                                      <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                                        <h3 className="font-bold text-lg">{itemName}</h3>
                                        <div className="text-right">
                                          <span className="text-[10px] uppercase opacity-60 block">Total Item</span>
                                          <span className="font-mono font-bold whitespace-nowrap">
                                            {Object.values(itemStats[itemName]).reduce((a, b) => a + b.qty, 0)} un. | R$ {Object.values(itemStats[itemName]).reduce((a, b) => a + b.total, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-left">
                                          <thead className="bg-[#141414]/5 text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10">
                                            <tr>
                                              <th className="p-4">Data</th>
                                              <th className="p-4 text-center">Quantidade</th>
                                              <th className="p-4 text-right">Valor Total</th>
                                            </tr>
                                          </thead>
                                          <tbody className="text-[10px]">
                                            {Object.keys(itemStats[itemName]).sort().map(date => (
                                              <tr key={date} className="border-b border-[#141414]/5 last:border-0 hover:bg-[#141414]/2 transition-colors">
                                                <td className="p-4 font-medium">{date.split('-').reverse().join('/')}</td>
                                                <td className="p-4 text-center font-mono">{itemStats[itemName][date].qty}</td>
                                                <td className="p-4 text-right font-mono whitespace-nowrap">R$ {itemStats[itemName][date].total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  ))}

                                  <div className="bg-[#141414] p-8 rounded-3xl text-[#E4E3E0] flex flex-col md:flex-row justify-between items-center gap-6">
                                    <div className="text-center md:text-left">
                                      <p className="text-sm uppercase font-bold opacity-50">Resumo Geral do Relatório</p>
                                      <div className="flex items-baseline gap-2">
                                        <span className="text-4xl font-bold font-mono text-[#EAB308]">{grandTotalQty}</span>
                                        <span className="text-lg opacity-60 font-medium lowercase">itens vendidos</span>
                                      </div>
                                    </div>
                                    <div className="text-center md:text-right">
                                      <p className="text-sm uppercase font-bold opacity-50">Valor Total Acumulado</p>
                                      <p className="text-5xl font-bold font-mono text-[#22C55E] whitespace-nowrap">R$ {grandTotalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                    </div>
                                  </div>
                                  
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {currentReportView === 'items_all' && (
                        <div className="border rounded-xl overflow-hidden shadow-sm bg-white">
                          <table className="w-full text-left">
                            <thead className="bg-[#141414]/5 text-[8px] uppercase font-bold opacity-50 border-b">
                              <tr>
                                <th className="py-1.5 px-3">Item</th>
                                <th className="py-1.5 px-3">Preço Médio</th>
                                <th className="py-1.5 px-3 text-center">Qtd.</th>
                                <th className="py-1.5 px-3 text-right">Fat.</th>
                              </tr>
                            </thead>
                            <tbody className="text-[10px]">
                              {(() => {
                                const stats: Record<string, { qty: number, total: number, price: number }> = {};
                                orders
                                  .filter(o => {
                                    const date = o.timestamp.split('T')[0];
                                    return date >= reportStartDate && date <= reportEndDate;
                                  })
                                  .forEach(o => {
                                    o.items.filter(i => !i.removed).forEach(i => {
                                      if (!stats[i.name]) stats[i.name] = { qty: 0, total: 0, price: i.price };
                                      const qty = i.quantity || 1;
                                      stats[i.name].qty += qty;
                                      stats[i.name].total += i.price;
                                    });
                                  });
                                  
                                const itemsCountTotal = Object.values(stats).reduce((acc, cur) => acc + cur.qty, 0);
                                const amountTotal = Object.values(stats).reduce((acc, cur) => acc + cur.total, 0);
                                const items = Object.entries(stats).sort((a, b) => b[1].total - a[1].total);
                                
                                if (items.length === 0) return <tr><td colSpan={4} className="p-10 text-center opacity-30 italic font-serif">Nenhuma venda encontrada no período.</td></tr>;

                                return (
                                  <>
                                    {items.map(([name, data]) => (
                                      <tr key={name} className="border-t border-[#141414]/5 hover:bg-[#141414]/5 transition-colors">
                                        <td className="py-1.5 px-3 font-bold">{name}</td>
                                        <td className="py-1.5 px-3 font-mono opacity-60 text-[8px] whitespace-nowrap">R$ {(data.total / data.qty).toFixed(2)}</td>
                                        <td className="py-1.5 px-3 text-center font-mono">{data.qty}</td>
                                        <td className="py-1.5 px-3 text-right font-bold text-green-600 font-mono whitespace-nowrap">R$ {data.total.toFixed(2)}</td>
                                      </tr>
                                    ))}
                                    <tr className="bg-[#141414]/5 border-t border-[#141414]">
                                      <td className="py-1.5 px-3 font-bold uppercase text-[8px]">Totais</td>
                                      <td className="py-1.5 px-3 text-[8px] opacity-40 whitespace-nowrap">Ticket Médio: R$ {items.length > 0 ? (amountTotal / itemsCountTotal).toFixed(2) : '0.00'}</td>
                                      <td className="py-1.5 px-3 text-center font-bold font-mono">
                                        {itemsCountTotal}
                                      </td>
                                      <td className="py-1.5 px-3 text-right font-black text-xs font-mono whitespace-nowrap">
                                        R$ {amountTotal.toFixed(2)}
                                      </td>
                                    </tr>
                                  </>
                                );
                              })()}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {currentReportView === 'sales_by_day' && (
                        <div className="border rounded-2xl overflow-hidden">
                          <table className="w-full text-left">
                            <thead className="bg-[#141414]/5 text-[10px] uppercase font-bold opacity-50">
                              <tr>
                                <th className="p-4">Data</th>
                                <th className="p-4">Local (Mesa/Com.)</th>
                                <th className="p-4 text-center">Pedidos</th>
                                <th className="p-4 text-right">Total das Vendas</th>
                              </tr>
                            </thead>
                            <tbody className="text-sm">
                              {(() => {
                                const stats: Record<string, Record<string, { total: number, count: number }>> = {};
                                orders
                                  .filter(o => o.timestamp >= reportStartDate && o.timestamp.split('T')[0] <= reportEndDate)
                                  .forEach(o => {
                                    const date = o.timestamp.split('T')[0];
                                    const label = `${o.isComanda ? 'Com.' : 'Mesa'} ${o.tableId}`;
                                    if (!stats[date]) stats[date] = {};
                                    if (!stats[date][label]) stats[date][label] = { total: 0, count: 0 };
                                    
                                    const payments = (o.paymentLog || []).reduce((pAcc, p) => pAcc + p.amount, 0);
                                    stats[date][label].total += payments;
                                    stats[date][label].count += 1;
                                  });
                                  
                                const days = Object.entries(stats).sort((a, b) => b[0].localeCompare(a[0]));
                                if (days.length === 0) return <tr><td colSpan={4} className="p-10 text-center opacity-30 italic">Nenhuma venda encontrada no período.</td></tr>;

                                return days.map(([date, tablesData]) => {
                                  const tables = Object.entries(tablesData).sort((a,b) => a[0].localeCompare(b[0]));
                                  return (
                                    <React.Fragment key={date}>
                                      <tr className="bg-gray-50 border-t border-[#141414]/10">
                                        <td colSpan={4} className="px-4 py-2 font-black text-xs uppercase opacity-70 border-b border-[#141414]/5">{date}</td>
                                      </tr>
                                      {tables.map(([label, data]) => (
                                        <tr key={`${date}-${label}`} className="border-t border-[#141414]/5 hover:bg-[#141414]/5 transition-colors">
                                          <td className="p-4 opacity-0">{date}</td>
                                          <td className="p-4 font-bold">{label}</td>
                                          <td className="p-4 text-center font-mono opacity-60">{data.count}</td>
                                          <td className="p-4 text-right font-bold text-green-600 font-mono whitespace-nowrap">R$ {data.total.toFixed(2)}</td>
                                        </tr>
                                      ))}
                                    </React.Fragment>
                                  );
                                });
                              })()}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {currentReportView === 'sales_by_payment' && (
                        <div className="space-y-6">
                           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                             {['Dinheiro', 'PIX', 'Crédito', 'Débito'].map(method => {
                               if (reportSelectedPaymentMethod !== 'todos' && reportSelectedPaymentMethod !== method) return null;
                               
                               const methodTotal = orders
                                 .filter(o => o.timestamp >= reportStartDate && o.timestamp.split('T')[0] <= reportEndDate)
                                 .reduce((acc, o) => {
                                   const payments = (o.paymentLog || [])
                                     .filter(p => p.method === method)
                                     .reduce((pAcc, p) => pAcc + p.amount, 0);
                                   return acc + payments;
                                 }, 0);

                               return (
                                 <div key={method} className="bg-white p-6 rounded-2xl border-2 border-[#141414]/10 space-y-2">
                                   <p className="text-[10px] uppercase font-bold opacity-50 tracking-widest">{method}</p>
                                   <p className="text-3xl font-bold font-mono whitespace-nowrap">R$ {methodTotal.toFixed(2)}</p>
                                 </div>
                               );
                             })}
                           </div>

                           <div className="border rounded-2xl overflow-hidden mt-8">
                             <table className="w-full text-left">
                               <thead className="bg-[#141414]/5 text-[10px] uppercase font-bold opacity-50">
                                 <tr>
                                   <th className="p-4">Pedido</th>
                                   <th className="p-4">Data/Hora</th>
                                   <th className="p-4">Método</th>
                                   <th className="p-4">Pagador</th>
                                   <th className="p-4 text-right">Valor Pago</th>
                                 </tr>
                               </thead>
                               <tbody className="text-sm">
                                 {(() => {
                                   const logs: any[] = [];
                                   orders
                                     .filter(o => o.timestamp >= reportStartDate && o.timestamp.split('T')[0] <= reportEndDate)
                                     .forEach(o => {
                                       (o.paymentLog || []).forEach(p => {
                                         if (reportSelectedPaymentMethod === 'todos' || p.method === reportSelectedPaymentMethod) {
                                           logs.push({ ...p, orderId: o.id });
                                         }
                                       });
                                     });
                                   
                                   const sortedLogs = logs.sort((a,b) => b.timestamp.localeCompare(a.timestamp));
                                   if (sortedLogs.length === 0) return <tr><td colSpan={4} className="p-10 text-center opacity-30 italic">Nenhum pagamento encontrado.</td></tr>;

                                   return sortedLogs.map((log, idx) => (
                                     <tr key={idx} className="border-t border-[#141414]/5 hover:bg-[#141414]/5 transition-colors">
                                       <td className="p-4 font-mono font-bold">#{log.orderId}</td>
                                       <td className="p-4 opacity-60">{new Date(log.timestamp).toLocaleString()}</td>
                                       <td className="p-4">
                                         <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                           log.method === 'Dinheiro' ? 'bg-green-100 text-green-700' :
                                           log.method === 'PIX' ? 'bg-blue-100 text-blue-700' :
                                           'bg-purple-100 text-purple-700'
                                         }`}>
                                           {log.method}
                                         </span>
                                       </td>
                                       <td className="p-4 text-xs font-medium opacity-70">{log.payer || '—'}</td>
                                       <td className="p-4 text-right font-bold font-mono whitespace-nowrap">R$ {log.amount.toFixed(2)}</td>
                                     </tr>
                                   ));
                                 })()}
                               </tbody>
                             </table>
                           </div>
                        </div>
                      )}

                        {currentReportView === 'table_sales' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                          {(() => {
                            let tableOrders = orders.filter(o => {
                              const d = (o.timestamp || '').split('T')[0];
                              return d >= reportStartDate && d <= reportEndDate && (o.paymentLog || []).length > 0;
                            });
                            if (reportSelectedTable !== 'todas') {
                              const isCom = reportSelectedTable.startsWith('comanda_');
                              const tId = reportSelectedTable.split('_')[1];
                              tableOrders = tableOrders.filter(o => String(o.tableId) === tId && !!o.isComanda === isCom);
                            }
                            if (tableOrders.length === 0) return (
                              <div className="p-20 text-center bg-white rounded-3xl border border-dashed border-[#141414]/10">
                                <p className="text-gray-400 italic font-serif">Nenhuma venda encontrada para o período.</p>
                              </div>
                            );
                            const tableGroups: Record<string, any[]> = {};
                            tableOrders.forEach(o => {
                              const key = `${o.isComanda ? 'comanda' : 'mesa'}_${o.tableId}`;
                              if (!tableGroups[key]) tableGroups[key] = [];
                              tableGroups[key].push(o);
                            });
                            const grandTotal = tableOrders.reduce((a, o) => a + (o.paymentLog || []).reduce((s: number, p: any) => s + p.amount, 0), 0);
                            return (
                              <>
                                {Object.entries(tableGroups).sort((a,b)=>{
                                  const [ta,na]=a[0].split('_'); const [tb,nb]=b[0].split('_');
                                  if(ta!==tb) return ta.localeCompare(tb); return Number(na)-Number(nb);
                                }).map(([key, tOrders]) => {
                                  const isCom = key.startsWith('comanda_');
                                  const tId = key.split('_')[1];
                                  const tLabel = `${isCom ? 'Comanda' : 'Mesa'} ${tId}`;
                                  const tTotal = tOrders.reduce((a, o) => a + (o.paymentLog || []).reduce((s: number, p: any) => s + p.amount, 0), 0);
                                  return (
                                    <div key={key} className="bg-white border border-[#141414]/10 rounded-xl overflow-hidden shadow-sm">
                                      <div className="bg-[#141414] text-[#E4E3E0] p-3 flex justify-between items-center">
                                        <h3 className="font-bold text-sm">{tLabel}</h3>
                                        <span className="font-mono font-bold text-green-400 whitespace-nowrap">R$ {tTotal.toFixed(2)}</span>
                                      </div>
                                      <div className="divide-y divide-[#141414]/5">
                                        {tOrders.sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||'')).map(o => {
                                          const oDate = new Date(o.timestamp);
                                          const oTotal = (o.paymentLog || []).reduce((a: number, p: any) => a + p.amount, 0);
                                          return (
                                            <div key={o.id}>
                                              <div className="px-3 py-2 bg-[#141414]/3 flex justify-between items-center">
                                                <span className="text-[10px] font-bold opacity-70">#{o.id} &nbsp; {oDate.toLocaleDateString('pt-BR')} {oDate.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
                                                <span className="font-mono text-xs font-bold text-green-600 whitespace-nowrap">R$ {oTotal.toFixed(2)}</span>
                                              </div>
                                              <table className="w-full text-left">
                                                <tbody>
                                                  {(o.items || []).filter((i: any) => !i.removed).map((i: any, idx: number) => (
                                                    <tr key={idx} className="border-t border-[#141414]/5 hover:bg-[#141414]/2">
                                                      <td className="py-1 pl-6 pr-3 text-[11px] font-medium">{i.quantity||1}× {i.name}</td>
                                                      <td className="py-1 px-3 text-[10px] opacity-40">{i.waiterName||'—'}</td>
                                                      <td className="py-1 px-3 text-right font-mono text-[11px] whitespace-nowrap">R$ {i.price.toFixed(2)}</td>
                                                    </tr>
                                                  ))}
                                                  {(o.paymentLog || []).length > 0 && <>
                                                    <tr className="border-t border-green-200 bg-green-50">
                                                      <td colSpan={3} className="py-1 pl-6 pr-3 text-[9px] font-bold uppercase tracking-widest text-green-700 opacity-60">Pagamentos</td>
                                                    </tr>
                                                    {(o.paymentLog || []).map((p: any, pidx: number) => (
                                                      <tr key={pidx} className="border-t border-green-100 bg-green-50/40">
                                                        <td className="py-1 pl-6 pr-3 text-[11px]">
                                                          <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold mr-1.5 ${
                                                            p.method==='Dinheiro'?'bg-green-100 text-green-700':
                                                            p.method==='PIX'?'bg-blue-100 text-blue-700':
                                                            p.method==='Crédito'?'bg-purple-100 text-purple-700':
                                                            'bg-orange-100 text-orange-700'
                                                          }`}>{p.method}</span>
                                                          {p.type==='partial' && <span className="inline-block px-1 py-0.5 rounded text-[8px] font-bold bg-amber-100 text-amber-700 mr-1.5">PARCIAL</span>}
                                                          {p.payer && <span className="text-[10px] opacity-40">{p.payer}</span>}
                                                        </td>
                                                        <td className="py-1 px-3 text-[10px] opacity-40">{new Date(p.timestamp).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td>
                                                        <td className="py-1 px-3 text-right font-mono text-[11px] font-bold text-green-700 whitespace-nowrap">R$ {p.amount.toFixed(2)}</td>
                                                      </tr>
                                                    ))}
                                                  </>}
                                                </tbody>
                                              </table>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                                <div className="bg-[#141414] p-6 rounded-2xl text-[#E4E3E0] flex justify-between items-center">
                                  <span className="font-bold uppercase text-sm opacity-60">Total Geral</span>
                                  <span className="font-mono font-black text-2xl text-green-400 whitespace-nowrap">R$ {grandTotal.toFixed(2)}</span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}

                        {currentReportView === 'waiter_performance' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                          {(() => {
                            const waiterStats: Record<string, { total: number, itemsCount: number, items: Record<string, { qty: number, total: number }> }> = {};
                            
                            // Use all orders that had items launched
                            orders.forEach(o => {
                              const orderDate = (o.timestamp || '').split('T')[0];
                              if (orderDate >= reportStartDate && orderDate <= reportEndDate) {
                                o.items.filter(i => !i.removed).forEach(i => {
                                  const waiterName = i.waiterName || 'Desconhecido';
                                  if (reportSelectedWaiter !== 'todos' && waiterName !== reportSelectedWaiter) return;
                                  if (!waiterStats[waiterName]) waiterStats[waiterName] = { total: 0, itemsCount: 0, items: {} };

                                  const qty = i.quantity || 1;
                                  waiterStats[waiterName].total += i.price;
                                  waiterStats[waiterName].itemsCount += qty;

                                  if (!waiterStats[waiterName].items[i.name]) waiterStats[waiterName].items[i.name] = { qty: 0, total: 0 };
                                  waiterStats[waiterName].items[i.name].qty += qty;
                                  waiterStats[waiterName].items[i.name].total += i.price;
                                });
                              }
                            });

                            const waitersList = Object.entries(waiterStats);
                            if (waitersList.length === 0) {
                              return (
                                <div className="p-20 text-center bg-white rounded-3xl border border-dashed border-[#141414]/10">
                                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Users size={32} className="text-gray-300" />
                                  </div>
                                  <p className="text-gray-400 italic font-serif">Nenhum lançamento encontrado para o período.</p>
                                </div>
                              );
                            }

                            return waitersList
                              .sort((a, b) => b[1].total - a[1].total)
                              .map(([waiter, stats]) => (
                                  <div key={waiter} className="bg-white border border-[#141414]/10 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                                    <div className="bg-[#141414]/2 p-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[#141414]/10">
                                      <div className="flex items-center space-x-3">
                                        <div className="w-8 h-8 bg-[#141414] text-[#E4E3E0] rounded-xl flex items-center justify-center font-bold text-sm shadow-sm">
                                          {waiter[0].toUpperCase()}
                                        </div>
                                        <div>
                                          <h4 className="font-bold text-sm leading-none">{waiter}</h4>
                                          <p className="text-[7px] uppercase font-bold opacity-30 tracking-widest flex items-center gap-1 mt-1">
                                            <Users size={8} /> Colaborador
                                          </p>
                                        </div>
                                      </div>
                                      <div className="text-left sm:text-right bg-white py-1.5 px-3 rounded-lg border border-[#141414]/5">
                                        <p className="text-[8px] uppercase font-bold opacity-40 mb-0.5 leading-none">Total Lançado</p>
                                        <p className="text-lg font-black font-mono text-green-600 leading-none whitespace-nowrap">R$ {stats.total.toFixed(2)}</p>
                                      </div>
                                    </div>

                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                      <thead className="bg-[#141414]/2 text-[8px] uppercase font-bold opacity-30">
                                        <tr>
                                          <th className="py-1 px-3 border-b">Item Lançado</th>
                                          <th className="py-1 px-3 text-center border-b">Quantidade</th>
                                          <th className="py-1 px-3 text-right border-b">Subtotal</th>
                                        </tr>
                                       </thead>
                                       <tbody className="text-sm">
                                         {Object.entries(stats.items)
                                           .sort((a, b) => b[1].qty - a[1].qty)
                                           .map(([itemName, itemData]) => (
                                             <tr key={itemName} className="border-t border-[#141414]/5 hover:bg-gray-50 transition-colors">
                                               <td className="py-1.5 px-3 font-medium">{itemName}</td>
                                               <td className="py-1.5 px-3 text-center font-mono font-bold text-blue-600/70">{itemData.qty}</td>
                                               <td className="py-1.5 px-3 text-right font-mono font-bold whitespace-nowrap">R$ {itemData.total.toFixed(2)}</td>
                                             </tr>
                                           ))}
                                       </tbody>
                                     </table>
                                   </div>
                                 </div>
                               ));
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="h-full flex flex-col space-y-2"
            >
              <header className="flex items-center justify-between shrink-0">
                <div>
                  <h2 className="font-serif italic text-xl mb-0.5">Configurações</h2>
                  <p className="text-[9px] opacity-60 leading-none">Gerenciamento de periféricos e comportamento do sistema.</p>
                </div>
              </header>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 pb-4">
                {/* Column 1: Printers and Tests */}
                <div className="space-y-2.5">
                  {/* Card: Impressoras Cadastradas */}
                  <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col">
                    <div className="flex items-center space-x-2 mb-1.5 shrink-0">
                      <Printer className="text-[#141414]" size={12} />
                      <h3 className="font-serif italic text-sm leading-none">Impressoras</h3>
                    </div>
                    <div className="space-y-1 mb-1.5 max-h-[140px] overflow-y-auto pr-0.5 scrollbar-hide">
                      {(printerConfig.registeredPrinters || []).map((p: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-1">
                          <input
                            type="text"
                            value={p.name}
                            onChange={(e) => {
                              const name = e.target.value;
                              (setPrinterConfig as any)((prev: any) => {
                                const updated = [...prev.registeredPrinters];
                                updated[idx] = { ...updated[idx], name };
                                return { ...prev, registeredPrinters: updated };
                              });
                            }}
                            placeholder="Nome"
                            className="flex-1 min-w-0 bg-[#141414]/5 border-none rounded-lg py-1 px-1.5 font-bold text-[8px] focus:ring-1 focus:ring-[#141414] outline-none"
                          />
                          <input
                            type="text"
                            value={p.ip}
                            onChange={(e) => {
                              const ip = e.target.value;
                              (setPrinterConfig as any)((prev: any) => {
                                const updated = [...prev.registeredPrinters];
                                updated[idx] = { ...updated[idx], ip };
                                return { ...prev, registeredPrinters: updated };
                              });
                            }}
                            placeholder="IP"
                            className="w-24 bg-[#141414]/5 border-none rounded-lg py-1 px-1.5 font-bold text-[8px] focus:ring-1 focus:ring-[#141414] outline-none font-mono"
                          />
                          <button
                            onClick={() => handleTestPrinter(p.name)}
                            className="text-[6px] bg-[#141414] text-white px-1.5 py-1 rounded-lg font-bold uppercase shrink-0"
                          >
                            Testar
                          </button>
                          <button
                            onClick={() => (setPrinterConfig as any)((prev: any) => ({
                              ...prev,
                              registeredPrinters: prev.registeredPrinters.filter((_: any, i: number) => i !== idx)
                            }))}
                            className="text-red-400 hover:text-red-600 shrink-0"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => (setPrinterConfig as any)((prev: any) => ({
                        ...prev,
                        registeredPrinters: [...(prev.registeredPrinters || []), { name: '', ip: '' }]
                      }))}
                      className="w-full border border-dashed border-[#141414]/20 text-[#141414]/50 py-1 rounded-lg text-[7px] font-bold uppercase hover:border-[#141414]/40 hover:text-[#141414]/70 transition-colors mb-1.5"
                    >
                      + Adicionar Impressora
                    </button>
                    <button
                      onClick={handleSavePrinters}
                      className="w-full bg-[#141414] text-[#E4E3E0] py-1.5 rounded-lg font-bold hover:opacity-90 transition-opacity text-[8px] uppercase shrink-0"
                    >
                      Salvar Impressoras
                    </button>
                  </div>

                  {/* Card: Direcionamento */}
                  <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col">
                    <div className="flex items-center space-x-2 mb-1.5 shrink-0">
                      <Printer className="text-[#141414]" size={12} />
                      <h3 className="font-serif italic text-sm leading-none">Direcionamento</h3>
                    </div>
                    <div className="space-y-1.5 mb-2">
                      {([
                        { key: 'pizzas',   autoKey: 'autoPrintPizzas',   label: 'Pizzas',   icon: <Pizza size={9} /> },
                        { key: 'drinks',   autoKey: 'autoPrintDrinks',   label: 'Bebidas',  icon: <Beer size={9} /> },
                        { key: 'kitchen',  autoKey: 'autoPrintKitchen',  label: 'Lanches', icon: <ChefHat size={9} /> },
                        { key: 'receipts', autoKey: 'autoPrintReceipts', label: 'Recibos',  icon: <FileText size={9} /> },
                      ] as const).map(({ key, autoKey, label, icon }) => (
                        <div key={key} className="flex items-center gap-1.5">
                          <span className="opacity-40 shrink-0">{icon}</span>
                          <span className="text-[8px] font-bold uppercase opacity-60 w-12 shrink-0 leading-none">{label}</span>
                          <select
                            value={(printerConfig as any)[key] || 'none'}
                            onChange={(e) => { const v = e.target.value; (setPrinterConfig as any)((prev: any) => ({ ...prev, [key]: v })); }}
                            className="flex-1 min-w-0 bg-[#141414]/5 border-none rounded-lg py-1 px-1.5 font-bold text-[8px] focus:ring-1 focus:ring-[#141414] outline-none appearance-none cursor-pointer"
                          >
                            <option value="none">Sem impressora</option>
                            {(printerConfig.registeredPrinters || []).filter((p: any) => p.name).map((p: any, i: number) => (
                              <option key={i} value={p.name}>{p.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => (setPrinterConfig as any)((prev: any) => ({ ...prev, [autoKey]: !prev[autoKey] }))}
                            title="Impressão automática ao enviar"
                            className={`shrink-0 px-1.5 py-1 rounded-lg text-[6.5px] font-bold uppercase border transition-all ${(printerConfig as any)[autoKey] ? 'bg-green-500 text-white border-green-500' : 'border-[#141414]/20 text-[#141414]/40'}`}
                          >
                            Auto
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={handleSavePrinters}
                      className="w-full bg-[#141414] text-[#E4E3E0] py-1.5 rounded-lg font-bold hover:opacity-90 transition-opacity text-[8px] uppercase shrink-0"
                    >
                      Salvar Direcionamento
                    </button>
                  </div>
                  {/* Modo Pizzaria */}
                  <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-2 shrink-0">
                      <div className="flex items-center space-x-2">
                        <Pizza className="text-[#141414]" size={12} />
                        <h3 className="font-serif italic text-sm leading-none">Modo Pizzaria</h3>
                      </div>
                      <button
                        onClick={() => updatePizzeriaConfig({ ...pizzariaConfig, enabled: !pizzariaConfig.enabled })}
                        className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${pizzariaConfig.enabled ? 'bg-green-500' : 'bg-[#141414]/20'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${pizzariaConfig.enabled ? 'translate-x-4' : ''}`} />
                      </button>
                    </div>
                    {pizzariaConfig.enabled ? (
                      <div className="space-y-1.5">
                        <p className="text-[7px] uppercase font-bold opacity-40 leading-none">Alertas de tempo de entrega</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          <div>
                            <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">🟡 Amarelo (min)</label>
                            <input
                              type="number"
                              min={1}
                              value={localYellow}
                              onChange={(e) => setLocalYellow(Math.max(1, Number(e.target.value)))}
                              className="w-full bg-yellow-50 border border-yellow-200 rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-yellow-400 outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">🟠 Laranja (min)</label>
                            <input
                              type="number"
                              min={1}
                              value={localOrange}
                              onChange={(e) => setLocalOrange(Math.max(1, Number(e.target.value)))}
                              className="w-full bg-orange-50 border border-orange-200 rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-orange-400 outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">🔴 Vermelho (min)</label>
                            <input
                              type="number"
                              min={1}
                              value={localRed}
                              onChange={(e) => setLocalRed(Math.max(1, Number(e.target.value)))}
                              className="w-full bg-red-50 border border-red-200 rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-red-400 outline-none"
                            />
                          </div>
                        </div>
                        <div className="border-t border-[#141414]/5 pt-1.5">
                          <p className="text-[7px] uppercase font-bold opacity-40 leading-none mb-1">Alerta de inatividade da mesa</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">⏰ Inatividade (min)</label>
                              <input
                                type="number"
                                min={1}
                                value={localInactivity}
                                onChange={(e) => setLocalInactivity(Math.max(1, Number(e.target.value)))}
                                className="w-full bg-amber-50 border border-amber-200 rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-amber-400 outline-none"
                              />
                            </div>
                            <p className="text-[6px] opacity-40 leading-tight flex-1">
                              Avisa quando a mesa está sem novos pedidos por este tempo.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => { updatePizzeriaConfig({ ...pizzariaConfig, yellowMinutes: localYellow, orangeMinutes: localOrange, redMinutes: localRed, inactivityMinutes: localInactivity }); toast.success('Configurações do Modo Pizzaria salvas!'); }}
                          className="w-full bg-[#141414] text-[#E4E3E0] py-1.5 rounded-lg font-bold hover:opacity-90 transition-opacity text-[8px] uppercase"
                        >
                          Salvar Configurações
                        </button>
                        <p className="text-[6px] opacity-40 leading-tight text-center">
                          Verde • Amarelo {pizzariaConfig.yellowMinutes}min • Laranja {pizzariaConfig.orangeMinutes}min • Vermelho {pizzariaConfig.redMinutes}min • Inativo {pizzariaConfig.inactivityMinutes ?? 30}min
                        </p>
                        <div className="border-t border-[#141414]/10 pt-1.5 mt-0.5">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[7px] uppercase font-bold opacity-70 leading-none">Interagir com KDS</p>
                              <p className="text-[6px] opacity-40 leading-tight mt-0.5">
                                {(pizzariaConfig.kdsEnabled ?? true)
                                  ? 'Garçom entrega após cozinha marcar "Pronto" no KDS.'
                                  : 'Botão de entrega aparece direto no app, sem depender do KDS.'}
                              </p>
                            </div>
                            <button
                              onClick={() => updatePizzeriaConfig({ ...pizzariaConfig, kdsEnabled: !(pizzariaConfig.kdsEnabled ?? true) })}
                              className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ml-2 ${(pizzariaConfig.kdsEnabled ?? true) ? 'bg-green-500' : 'bg-[#141414]/20'}`}
                            >
                              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(pizzariaConfig.kdsEnabled ?? true) ? 'translate-x-4' : ''}`} />
                            </button>
                          </div>
                        </div>
                        <div className="border-t border-[#141414]/10 pt-1.5 mt-0.5">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[7px] uppercase font-bold opacity-70 leading-none">Garçom pode pagar?</p>
                              <p className="text-[6px] opacity-40 leading-tight mt-0.5">
                                {(pizzariaConfig.waiterCanPay ?? true)
                                  ? 'Botão "Pagar" visível no app do garçom.'
                                  : 'Pagamento somente pelo caixa (ADM).'}
                              </p>
                            </div>
                            <button
                              onClick={() => updatePizzeriaConfig({ ...pizzariaConfig, waiterCanPay: !(pizzariaConfig.waiterCanPay ?? true) })}
                              className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ml-2 ${(pizzariaConfig.waiterCanPay ?? true) ? 'bg-green-500' : 'bg-[#141414]/20'}`}
                            >
                              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(pizzariaConfig.waiterCanPay ?? true) ? 'translate-x-4' : ''}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[7px] opacity-40 leading-tight">
                        Mesas mudam de cor conforme o tempo de espera de pizzas e lanches. Garçom marca como entregue para voltar ao normal.
                      </p>
                    )}
                  </div>
                </div>

                {/* Column 2: Receipt Layout and Data */}
                <div className="space-y-2.5">
                  <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col">
                    <div className="flex items-center space-x-2 mb-1.5 shrink-0">
                      <FileText className="text-[#141414]" size={12} />
                      <h3 className="font-serif italic text-sm leading-none">Detalhes do Cupom</h3>
                    </div>

                    <div className="grid grid-cols-1 gap-1.5 pr-1 shrink-0">
                      <div>
                        <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Nome do Estabelecimento</label>
                        <input 
                          type="text"
                          value={printerConfig.establishmentName}
                          onChange={(e) => setPrinterConfig({...printerConfig, establishmentName: e.target.value})}
                          className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none"
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Endereço Completo</label>
                          <input 
                            type="text"
                            value={printerConfig.address}
                            onChange={(e) => setPrinterConfig({...printerConfig, address: e.target.value})}
                            className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Telefone para Contato</label>
                          <input 
                            type="text"
                            value={printerConfig.phone}
                            onChange={(e) => setPrinterConfig({...printerConfig, phone: e.target.value})}
                            className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Mensagem de Rodapé</label>
                        <input 
                          type="text"
                          value={printerConfig.receiptFooter}
                          onChange={(e) => setPrinterConfig({...printerConfig, receiptFooter: e.target.value})}
                          className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 pt-1">
                        <div className="col-span-3 flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[7px] uppercase font-bold opacity-45 shrink-0 leading-none">Papel</span>
                          <div className="flex bg-[#141414]/5 p-0.5 rounded-lg flex-1 max-w-[120px]">
                            {['50mm', '80mm'].map((pw) => (
                              <button
                                key={pw}
                                onClick={() => setPrinterConfig({...printerConfig, paperWidth: pw})}
                                className={`flex-1 py-0.5 text-[7px] font-bold rounded transition-all ${(printerConfig.paperWidth || '80mm') === pw ? 'bg-white shadow-sm' : 'opacity-40'}`}
                              >
                                {pw}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="col-span-3 flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[7px] uppercase font-bold opacity-45 shrink-0 leading-none">Fonte (Itens)</span>
                          <div className="flex bg-[#141414]/5 p-0.5 rounded-lg flex-1 max-w-[120px]">
                            {['10px', '12px', '14px', '16px'].map((size) => (
                              <button
                                key={size}
                                onClick={() => setPrinterConfig({...printerConfig, itemFontSize: size})}
                                className={`flex-1 py-0.5 text-[7px] font-bold rounded transition-all ${printerConfig.itemFontSize === size ? 'bg-white shadow-sm' : 'opacity-40'}`}
                              >
                                {size === '10px' ? 'P' : size === '12px' ? 'M' : size === '14px' ? 'G' : 'XG'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button 
                          onClick={() => setPrinterConfig({...printerConfig, boldItems: !printerConfig.boldItems})}
                          className={`flex flex-col items-center justify-center p-1 rounded-lg border transition-all gap-0.5 ${printerConfig.boldItems ? 'border-[#141414] bg-[#141414]/5 text-[#141414]' : 'border-[#141414]/10 opacity-40 text-[#141414]'}`}
                        >
                          <span className="text-[7px] font-bold uppercase truncate leading-none">Negrito</span>
                          <span className="text-[6px] opacity-60 leading-none">Itens</span>
                        </button>

                        <button 
                          onClick={() => setPrinterConfig({...printerConfig, showWaiter: !printerConfig.showWaiter})}
                          className={`flex flex-col items-center justify-center p-1 rounded-lg border transition-all gap-0.5 ${printerConfig.showWaiter ? 'border-[#141414] bg-[#141414]/5 text-[#141414]' : 'border-[#141414]/10 opacity-40 text-[#141414]'}`}
                        >
                          <span className="text-[7px] font-bold uppercase truncate leading-none">Garçom</span>
                          <span className="text-[6px] opacity-60 leading-none">Mostrar</span>
                        </button>

                        <button 
                          onClick={() => setPrinterConfig({...printerConfig, autoPrintKitchen: !printerConfig.autoPrintKitchen})}
                          className={`flex flex-col items-center justify-center p-1 rounded-lg border transition-all gap-0.5 ${printerConfig.autoPrintKitchen ? 'border-[#141414] bg-[#141414]/5 text-[#141414]' : 'border-[#141414]/10 opacity-40 text-[#141414]'}`}
                        >
                          <span className="text-[7px] font-bold uppercase truncate leading-none">Auto</span>
                          <span className="text-[6px] opacity-60 leading-none">Imprimir</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col">
                    <div className="flex items-center space-x-2 mb-1.5 shrink-0">
                      <Lock className="text-[#141414]" size={12} />
                      <h3 className="font-serif italic text-sm leading-none">Dados</h3>
                    </div>

                    {/* Painel de confirmação de import */}
                    <AnimatePresence>
                      {pendingImport && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden mb-2"
                        >
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 space-y-1.5">
                            <p className="text-[8px] font-bold uppercase text-orange-700 leading-none">Confirmar importação</p>
                            <p className="text-[7px] text-orange-600 leading-tight truncate">{pendingImport.fileName}</p>
                            <div className="flex gap-1.5 text-[6px]">
                              <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">{pendingImport.menu.length} categorias</span>
                              <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">{pendingImport.stock.length} insumos</span>
                              {pendingImport.printerConfig && (
                                <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">config impressora</span>
                              )}
                            </div>
                            <p className="text-[6.5px] text-orange-500 leading-tight">O cardápio e estoque atuais serão substituídos.</p>
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  socket.emit('bulk_import', { menu: pendingImport.menu, stock: pendingImport.stock });
                                  if (pendingImport.printerConfig) {
                                    try { localStorage.setItem('printerConfig', JSON.stringify(pendingImport.printerConfig)); } catch {}
                                  }
                                  socket.once('import_complete', (result: any) => {
                                    toast.success('Importação concluída!', {
                                      description: `${result.menuCategories} categorias e ${result.stockItems} insumos restaurados.`
                                    });
                                  });
                                  setPendingImport(null);
                                }}
                                className="flex-1 py-1 bg-orange-600 text-white rounded text-[7px] font-bold uppercase hover:bg-orange-700 transition-colors"
                              >
                                Confirmar
                              </button>
                              <button
                                onClick={() => setPendingImport(null)}
                                className="flex-1 py-1 bg-white border border-orange-200 text-orange-600 rounded text-[7px] font-bold uppercase hover:bg-orange-50 transition-colors"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Input oculto para seleção de arquivo */}
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          try {
                            const parsed = JSON.parse(ev.target?.result as string);
                            if (!parsed.menu && !parsed.stock) {
                              toast.error('Arquivo inválido.', { description: 'O arquivo não contém dados de cardápio ou estoque.' });
                              return;
                            }
                            setPendingImport({
                              menu: parsed.menu ?? [],
                              stock: parsed.stock ?? [],
                              printerConfig: parsed.printerConfig ?? null,
                              fileName: file.name,
                            });
                          } catch {
                            toast.error('Erro ao ler o arquivo.', { description: 'Verifique se é um JSON válido exportado pelo sistema.' });
                          }
                        };
                        reader.readAsText(file);
                        e.target.value = '';
                      }}
                    />

                    <div className="grid grid-cols-3 gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          try {
                            const data = {
                              menu,
                              stock,
                              printerConfig,
                              exportedAt: new Date().toISOString(),
                              version: '1.0',
                            };
                            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `fechaconta_backup_${new Date().toISOString().split('T')[0]}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                            const totalItems = menu.reduce((acc, cat) => acc + (cat.items?.length ?? 0), 0);
                            toast.success('Backup exportado!', {
                              description: `${menu.length} categorias · ${totalItems} produtos · ${stock.length} insumos`
                            });
                          } catch { toast.error('Erro ao exportar dados.'); }
                        }}
                        className="flex items-center justify-center space-x-1 py-1 bg-blue-50 text-blue-700 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors">
                        <Download size={10} />
                        <span className="text-[7px] font-bold uppercase">Exportar</span>
                      </button>
                      <button
                        onClick={() => importFileRef.current?.click()}
                        className="flex items-center justify-center space-x-1 py-1 bg-orange-50 text-orange-700 rounded-lg border border-orange-100 hover:bg-orange-100 transition-colors">
                        <RefreshCcw size={10} />
                        <span className="text-[7px] font-bold uppercase">Importar</span>
                      </button>
                      <button
                        onClick={handleSeedDatabase}
                        className="flex items-center justify-center space-x-1 py-1 bg-red-50 text-red-700 rounded-lg border border-red-100 hover:bg-red-100 transition-all active:scale-95"
                      >
                        <Database size={10} />
                        <span className="text-[7px] font-bold uppercase">Seed DB</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Column 3: Preview */}
                <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col md:col-span-2 xl:col-span-1">
                  <div className="flex items-center space-x-2 mb-2 shrink-0">
                    <FileText className="text-[#141414]" size={12} />
                    <h3 className="font-serif italic text-sm leading-none">Preview Cupom</h3>
                  </div>

                  <div className="bg-gray-50 p-2 rounded-lg border border-dashed border-[#141414]/10 flex justify-center">
                    <div className="bg-white w-full max-w-[155px] shadow-sm p-2.5 text-[#141414] font-mono text-[7px] space-y-2 leading-tight overflow-hidden select-none">
                      <div className="text-center space-y-0.5">
                        <p className="font-bold text-[8.5px] uppercase truncate">{printerConfig.establishmentName}</p>
                        <p className="opacity-70 text-[5.5px] truncate">{printerConfig.address}</p>
                      </div>
                      
                      <div className="border-t border-dashed border-[#141414]/20 pt-1 space-y-0.5">
                        <div className="flex justify-between">
                          <span>Mesa: 12</span>
                          <span>#1024</span>
                        </div>
                        {printerConfig.showWaiter && <div>Garçom: Ricardo</div>}
                      </div>

                      <div className="border-t border-b border-dashed border-[#141414]/20 py-1 space-y-1">
                        <div className="flex justify-between items-start gap-2" style={{ fontSize: printerConfig.itemFontSize, fontWeight: printerConfig.boldItems ? 'bold' : 'normal' }}>
                          <span className="flex-1 leading-tight text-left">1x Pizza G Calabresa Especial com Bordas</span>
                          <span className="shrink-0">R$ 85</span>
                        </div>
                        <div className="flex justify-between items-start gap-2" style={{ fontSize: printerConfig.itemFontSize, fontWeight: printerConfig.boldItems ? 'bold' : 'normal' }}>
                          <span className="flex-1 leading-tight text-left">2x Soda Italiana Sabor Morango</span>
                          <span className="shrink-0">R$ 24</span>
                        </div>
                      </div>

                      <div className="flex justify-between font-bold pt-1">
                        <span>TOTAL:</span>
                        <span>R$ 109,00</span>
                      </div>

                      <div className="pt-1 text-center opacity-70 italic text-[5.5px] truncate">
                        {printerConfig.receiptFooter}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              </div>
              </motion.div>
            )}
        </AnimatePresence>
      </main>

      {/* Modal Motivo do Ajuste de Estoque */}
      <AnimatePresence>
        {stockAdjustPending && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setStockAdjustPending(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 z-10"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-serif italic text-xl">Motivo do Ajuste</h3>
                  <p className="text-[10px] uppercase tracking-widest opacity-40 mt-0.5">Registro obrigatório para reduções</p>
                </div>
                <button onClick={() => setStockAdjustPending(null)} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Resumo do ajuste */}
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4 flex items-center justify-between">
                <span className="text-sm font-bold">{stockAdjustPending.itemName}</span>
                <span className="text-red-600 font-mono font-bold text-sm">{stockAdjustPending.change} {(() => { const s = stock.find((s: any) => s.menuItemId === stockAdjustPending.menuItemId); return s?.unit || ''; })()}</span>
              </div>

              {/* Opções rápidas */}
              <p className="text-[9px] uppercase font-bold opacity-40 mb-2 tracking-widest">Selecione ou descreva o motivo</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {['Perda / Vencimento', 'Uso interno', 'Correção de inventário', 'Furto / Quebra'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setStockAdjustReason(opt)}
                    className={`px-3 py-2 rounded-xl border text-[11px] font-bold text-left transition-all ${
                      stockAdjustReason === opt
                        ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                        : 'bg-white border-[#141414]/10 hover:border-[#141414]/30 text-[#141414]'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              {/* Campo livre */}
              <input
                type="text"
                value={stockAdjustReason}
                onChange={e => setStockAdjustReason(e.target.value)}
                placeholder="Ou descreva o motivo livremente..."
                className="w-full border border-[#141414]/15 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#141414] mb-4"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && stockAdjustReason.trim()) {
                    socket.emit('update_stock_item', { ...stockAdjustPending, reason: stockAdjustReason.trim() });
                    setStockEdits(prev => { const n = { ...prev }; delete n[stockAdjustPending.menuItemId]; return n; });
                    setStockAdjustPending(null);
                    toast.success('Estoque atualizado!');
                  }
                }}
              />

              <div className="flex space-x-3">
                <button
                  onClick={() => setStockAdjustPending(null)}
                  className="flex-1 py-3 border border-[#141414]/15 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  disabled={!stockAdjustReason.trim()}
                  onClick={() => {
                    socket.emit('update_stock_item', { ...stockAdjustPending, reason: stockAdjustReason.trim() });
                    setStockEdits(prev => { const n = { ...prev }; delete n[stockAdjustPending.menuItemId]; return n; });
                    setStockAdjustPending(null);
                    toast.success('Estoque atualizado!');
                  }}
                  className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] rounded-xl text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  Confirmar Ajuste
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Histórico de Estoque */}
      <AnimatePresence>
        {isStockHistoryModalOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setIsStockHistoryModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-2 border-[#141414] flex flex-col max-h-[90vh]"
            >
              {/* Header do modal */}
              <div className="flex items-center justify-between p-6 border-b border-[#141414]/10 shrink-0">
                <div>
                  <h3 className="font-serif italic text-2xl">Histórico de Movimentações</h3>
                  <p className="text-[10px] uppercase tracking-widest opacity-40 mt-0.5">Estoque de insumos</p>
                </div>
                <button onClick={() => setIsStockHistoryModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>

              {/* Filtro de período */}
              <div className="px-6 py-4 bg-gray-50/50 border-b border-[#141414]/5 shrink-0">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <span className="text-[10px] uppercase font-bold opacity-50 tracking-widest shrink-0">Período:</span>
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="date"
                      value={stockHistoryStart}
                      onChange={e => setStockHistoryStart(e.target.value)}
                      className="border border-[#141414]/20 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#141414] bg-white"
                    />
                    <span className="text-sm opacity-40">até</span>
                    <input
                      type="date"
                      value={stockHistoryEnd}
                      onChange={e => setStockHistoryEnd(e.target.value)}
                      className="border border-[#141414]/20 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#141414] bg-white"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const start = new Date(stockHistoryStart + 'T00:00:00');
                      const end = new Date(stockHistoryEnd + 'T23:59:59');
                      const filtered = stockLog.filter((e: any) => {
                        const t = new Date(e.timestamp);
                        return t >= start && t <= end;
                      });
                      if (filtered.length === 0) {
                        toast.error('Nenhuma movimentação no período selecionado.');
                        return;
                      }
                      const rows = filtered.map((e: any) => {
                        const d = new Date(e.timestamp);
                        const changeStr = (e.change > 0 ? '+' : '') + e.change;
                        const changeColor = e.change < 0 ? '#dc2626' : '#16a34a';
                        return `
                          <tr>
                            <td>${e.itemName}</td>
                            <td style="color:${changeColor};font-weight:bold;font-family:monospace">${changeStr}</td>
                            <td>${e.reason}</td>
                            <td>${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                          </tr>`;
                      }).join('');
                      const periodLabel = stockHistoryStart === stockHistoryEnd
                        ? new Date(stockHistoryStart + 'T12:00:00').toLocaleDateString('pt-BR')
                        : `${new Date(stockHistoryStart + 'T12:00:00').toLocaleDateString('pt-BR')} até ${new Date(stockHistoryEnd + 'T12:00:00').toLocaleDateString('pt-BR')}`;
                      const printWindow = window.open('', '_blank');
                      if (printWindow) {
                        printWindow.document.write(`
                          <html>
                            <head>
                              <title>Histórico de Estoque</title>
                              <style>
                                body { font-family: sans-serif; padding: 24px; color: #141414; font-size: 13px; }
                                h2 { margin: 0 0 4px; font-size: 18px; }
                                p { margin: 0 0 16px; color: #666; font-size: 12px; }
                                table { width: 100%; border-collapse: collapse; }
                                th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; padding: 8px 10px; border-bottom: 2px solid #141414; }
                                td { padding: 8px 10px; border-bottom: 1px solid #e5e5e5; font-size: 12px; }
                                tr:last-child td { border-bottom: none; }
                                @media print { body { padding: 0; } }
                              </style>
                            </head>
                            <body>
                              <h2>Histórico de Movimentação de Estoque</h2>
                              <p>Período: ${periodLabel} &nbsp;·&nbsp; ${filtered.length} registro(s) &nbsp;·&nbsp; Impresso em: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                              <table>
                                <thead>
                                  <tr>
                                    <th>Produto</th>
                                    <th>Variação</th>
                                    <th>Motivo</th>
                                    <th>Data / Hora</th>
                                  </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                              </table>
                            </body>
                          </html>`);
                        printWindow.document.close();
                        printWindow.focus();
                        printWindow.print();
                      }
                    }}
                    className="flex items-center space-x-1.5 px-4 py-2 bg-[#141414] text-[#E4E3E0] rounded-xl text-xs font-bold hover:opacity-80 transition-opacity shrink-0"
                  >
                    <Download size={14} />
                    <span>Imprimir</span>
                  </button>
                </div>
              </div>

              {/* Tabela de histórico */}
              <div className="flex-1 overflow-y-auto scrollbar-hide">
                {(() => {
                  const start = new Date(stockHistoryStart + 'T00:00:00');
                  const end = new Date(stockHistoryEnd + 'T23:59:59');
                  const filtered = stockLog.filter((e: any) => {
                    const t = new Date(e.timestamp);
                    return t >= start && t <= end;
                  });
                  if (filtered.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-20 opacity-30">
                        <History size={40} className="mb-3" />
                        <p className="text-sm font-bold uppercase tracking-widest">Sem movimentações no período</p>
                      </div>
                    );
                  }
                  return (
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-white border-b border-[#141414]/10">
                        <tr>
                          <th className="p-3 lg:p-4 text-[8px] uppercase tracking-widest opacity-50">Produto</th>
                          <th className="p-3 lg:p-4 text-[8px] uppercase tracking-widest opacity-50">Variação</th>
                          <th className="p-3 lg:p-4 text-[8px] uppercase tracking-widest opacity-50">Motivo</th>
                          <th className="p-3 lg:p-4 text-[8px] uppercase tracking-widest opacity-50">Data / Hora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((entry: any) => (
                          <tr key={entry.id} className="border-b border-[#141414]/5 hover:bg-gray-50 transition-colors">
                            <td className="p-3 lg:p-4 text-xs font-bold">{entry.itemName}</td>
                            <td className="p-3 lg:p-4">
                              <span className={`text-xs font-mono font-bold ${entry.change < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {entry.change > 0 ? '+' : ''}{entry.change}
                              </span>
                            </td>
                            <td className="p-3 lg:p-4 text-[10px] opacity-60 uppercase font-bold">{entry.reason}</td>
                            <td className="p-3 lg:p-4 text-[10px] font-mono opacity-50 whitespace-nowrap">
                              {new Date(entry.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                              {' '}
                              {new Date(entry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>

              <div className="px-6 py-3 border-t border-[#141414]/5 shrink-0 text-[10px] opacity-40 text-right">
                {stockLog.length} registro(s) total · exibindo período selecionado
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {(() => {
        const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
        const activeOrder = orders.find(o => targetId && o.tableId && String(o.tableId) === String(targetId) && !!o.isComanda === !!isComandaSelected && o.status !== 'finalizada');
        return activeOrder && (
          <PaymentModal
            isOpen={isPaymentModalOpen}
            onClose={() => setIsPaymentModalOpen(false)}
            order={activeOrder}
            onPaymentComplete={(selectedItems, partialAmount, paymentMethod, payerName) => handlePaymentComplete(activeOrder.id, selectedItems, partialAmount, paymentMethod, payerName)}
            onApplyDiscount={handleApplyDiscount}
          />
        );
      })()}

      {/* Link Tables Modal */}
      <AnimatePresence>
        {isLinkModalOpen && (
          <div className="fixed inset-0 bg-black/50 z-[120] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-2 border-[#141414] space-y-6"
            >
              <div className="text-center">
                <h3 className="font-serif italic text-2xl">Agrupar {isComandaSelected ? 'Comandas' : 'Mesas'}</h3>
                <p className="text-sm opacity-50">Selecione a {isComandaSelected ? 'comanda' : 'mesa'} de destino para o agrupamento.</p>
              </div>

              <div className="grid grid-cols-5 gap-2 max-h-60 overflow-y-auto p-2">
                {(isComandaSelected ? comandas : tables)
                  .filter(t => t.id && String(t.id) !== String(isComandaSelected ? selectedComandaId : selectedTableId) && t.status !== 'linked')
                  .map(target => (
                    <button 
                      key={target.id}
                      onClick={() => setTargetTableId(target.id)}
                      className={`p-2 rounded-lg border-2 transition-all ${
                        targetTableId && target.id && String(targetTableId) === String(target.id) ? 'border-[#141414] bg-[#141414] text-white' : 'border-[#141414]/10 hover:border-[#141414]/30'
                      }`}
                    >
                      <span className="text-xs font-bold">{target.id}</span>
                    </button>
                  ))}
              </div>

              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => setIsLinkModalOpen(false)}
                  className="flex-1 py-3 rounded-xl font-bold text-sm border border-[#141414]/10"
                >
                  Cancelar
                </button>
                <button 
                  disabled={!targetTableId}
                  onClick={handleLinkTables}
                  className="flex-1 bg-[#141414] text-[#E4E3E0] py-3 rounded-xl font-bold text-sm disabled:opacity-30"
                >
                  Confirmar Vínculo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transfer Table Modal */}
      <AnimatePresence>
        {isTransferModalOpen && (
          <div className="fixed inset-0 bg-black/50 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border-2 border-[#141414] space-y-5 max-h-[90vh] flex flex-col"
            >
              {!targetTableId ? (
                /* ── STEP 1: pick destination ── */
                <>
                  <div className="text-center">
                    <h3 className="font-serif italic text-2xl">Transferir {isComandaSelected ? 'Comanda' : 'Mesa'}</h3>
                    <p className="text-sm opacity-50">Para qual {isComandaSelected ? 'comanda' : 'mesa'} deseja transferir?</p>
                  </div>
                  <div className="grid grid-cols-5 gap-2 overflow-y-auto max-h-64 p-1 flex-1">
                    {(isComandaSelected ? comandas : tables)
                      .filter(t => t.id !== (isComandaSelected ? selectedComandaId : selectedTableId))
                      .map(target => (
                        <button
                          key={target.id}
                          onClick={() => { setTargetTableId(target.id); setTransferMode('all'); setTransferSelectedItemIds({}); }}
                          className={`p-2 rounded-lg border-2 transition-all ${
                            target.status === 'occupied' || target.status === 'bill_requested'
                              ? 'border-orange-200 bg-orange-50 text-orange-700'
                              : 'border-[#141414]/10 hover:border-[#141414]/30 text-[#141414]'
                          }`}
                        >
                          <span className="text-xs font-bold">{target.id}</span>
                        </button>
                      ))}
                  </div>
                  <button onClick={closeTransferModal} className="w-full py-3 rounded-xl font-bold text-sm border border-[#141414]/10">
                    Cancelar
                  </button>
                </>
              ) : (
                /* ── STEP 2: mode + confirm ── */
                (() => {
                  const sourceId = isComandaSelected ? selectedComandaId : selectedTableId;
                  const sourceTable = (isComandaSelected ? comandas : tables).find(t => t.id && String(t.id) === String(sourceId));
                  const sourceOrder = sourceTable?.currentOrder ? orders.find(o => String(o.id) === String(sourceTable.currentOrder)) : null;
                  const transferableItems = (sourceOrder?.items || []).filter((i: any) => !i.removed && !i.paid);
                  const paidItemsCount = (sourceOrder?.items || []).filter((i: any) => !i.removed && i.paid).length;

                  const targetTable = (isComandaSelected ? comandas : tables).find(t => targetTableId && t.id && String(t.id) === String(targetTableId));
                  const targetOrder = targetTable?.currentOrder ? orders.find(o => String(o.id) === String(targetTable.currentOrder)) : null;
                  const isTargetOccupied = !!(targetOrder && (targetOrder.items || []).some((i: any) => !i.removed));

                  const hasOrderPartialPayment = (sourceOrder?.paymentLog || []).some((p: any) => p.type === 'partial');
                  const selectedCount = Object.values(transferSelectedItemIds).filter(Boolean).length;
                  const transferBlocked = hasOrderPartialPayment;

                  return (
                    <>
                      <div>
                        <h3 className="font-serif italic text-xl leading-none">Transferência</h3>
                        <p className="text-xs opacity-50 mt-0.5">
                          {isComandaSelected ? 'Comanda' : 'Mesa'} {sourceId} → {isComandaSelected ? 'Comanda' : 'Mesa'} {targetTableId}
                          {isTargetOccupied && <span className="ml-2 text-orange-600 font-bold">· Destino ocupado</span>}
                        </p>
                      </div>

                      {transferBlocked && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                          <span className="text-red-500 text-base leading-none mt-0.5">⚠</span>
                          <p className="text-xs text-red-700 font-medium">
                            Esta {isComandaSelected ? 'comanda' : 'mesa'} possui pagamento parcial registrado. Finalize ou cancele o pagamento antes de transferir itens.
                          </p>
                        </div>
                      )}

                      {!transferBlocked && paidItemsCount > 0 && transferMode === 'items' && (
                        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                          {paidItemsCount} item(s) já pago(s) não aparecem na lista e não podem ser transferidos.
                        </p>
                      )}

                      {/* Mode toggle */}
                      <div className="flex rounded-xl overflow-hidden border border-[#141414]/15">
                        <button
                          onClick={() => setTransferMode('all')}
                          className={`flex-1 py-2 text-xs font-bold transition-colors ${transferMode === 'all' ? 'bg-[#141414] text-white' : 'bg-white text-[#141414]/50 hover:text-[#141414]'}`}
                        >
                          Mesa Completa
                        </button>
                        <button
                          onClick={() => setTransferMode('items')}
                          className={`flex-1 py-2 text-xs font-bold transition-colors ${transferMode === 'items' ? 'bg-[#141414] text-white' : 'bg-white text-[#141414]/50 hover:text-[#141414]'}`}
                        >
                          Itens Específicos
                        </button>
                      </div>

                      {transferMode === 'items' ? (
                        /* ── Item checklist ── */
                        <div className="flex-1 overflow-y-auto space-y-1.5 max-h-64">
                          {transferableItems.length === 0 ? (
                            <p className="text-center text-sm opacity-40 italic py-6">Nenhum item disponível para transferência.</p>
                          ) : (
                            <>
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] uppercase font-bold opacity-40">Selecione os itens</span>
                                <button
                                  onClick={() => {
                                    const allSelected = transferableItems.every((i: any) => transferSelectedItemIds[i.id]);
                                    const next: Record<string, boolean> = {};
                                    if (!allSelected) transferableItems.forEach((i: any) => { next[i.id] = true; });
                                    setTransferSelectedItemIds(next);
                                  }}
                                  className="text-[10px] font-bold underline opacity-50 hover:opacity-100"
                                >
                                  {transferableItems.every((i: any) => transferSelectedItemIds[i.id]) ? 'Desmarcar tudo' : 'Marcar tudo'}
                                </button>
                              </div>
                              {transferableItems.map((item: any) => (
                                <label
                                  key={item.id}
                                  className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${
                                    transferSelectedItemIds[item.id]
                                      ? 'border-[#141414] bg-[#141414]/5'
                                      : 'border-[#141414]/10 hover:border-[#141414]/30'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!transferSelectedItemIds[item.id]}
                                    onChange={() => setTransferSelectedItemIds(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                                    className="accent-[#141414] w-4 h-4 flex-shrink-0"
                                  />
                                  <span className="flex-1 text-sm font-medium">{item.quantity || 1}× {item.name}</span>
                                  {item.waiterName && <span className="text-[10px] opacity-40">{item.waiterName}</span>}
                                  <span className="text-sm font-mono opacity-60">R$ {item.price.toFixed(2)}</span>
                                </label>
                              ))}
                            </>
                          )}
                        </div>
                      ) : (
                        /* ── Whole-table confirm ── */
                        isTargetOccupied ? (
                          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 space-y-2">
                            <p className="text-xs font-bold text-orange-800 uppercase">Destino Ocupado — Itens serão mesclados</p>
                            <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                              {(targetOrder?.items || []).filter((i: any) => !i.removed).map((item: any) => (
                                <div key={item.id} className="text-[10px] flex justify-between opacity-70">
                                  <span>{item.quantity || 1}× {item.name}</span>
                                  <span>R$ {item.price.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold uppercase opacity-50">Motivo da Troca (Obrigatório)</p>
                            <textarea
                              value={transferReason}
                              onChange={(e) => setTransferReason(e.target.value)}
                              placeholder="Informe o motivo da troca de mesa..."
                              className="w-full h-20 p-3 bg-gray-50 border border-[#141414]/10 rounded-xl focus:outline-none focus:border-[#141414] transition-colors text-sm resize-none"
                              autoFocus
                            />
                          </div>
                        )
                      )}

                      {/* Footer */}
                      <div className="flex gap-3">
                        <button
                          onClick={() => { setTargetTableId(null); setTransferReason(''); setTransferMode('all'); setTransferSelectedItemIds({}); }}
                          className="flex-1 py-2.5 rounded-xl font-bold text-sm border border-[#141414]/10"
                        >
                          Voltar
                        </button>
                        {transferMode === 'items' ? (
                          <button
                            disabled={transferBlocked || selectedCount === 0}
                            onClick={handleTransferItems}
                            className="flex-1 bg-[#141414] text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-30"
                          >
                            Transferir {selectedCount > 0 ? `${selectedCount} item(s)` : 'Itens'}
                          </button>
                        ) : (
                          <button
                            disabled={transferBlocked || (!isTargetOccupied && !transferReason.trim())}
                            onClick={handleTransferTable}
                            className="flex-1 bg-orange-600 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-30"
                          >
                            {isTargetOccupied ? 'Mesclar Mesas' : 'Confirmar Transferência'}
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isHistoryModalOpen && (selectedTableId || selectedComandaId) && (
          <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl border-2 border-[#141414] flex flex-col max-h-[90vh]"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-serif italic text-2xl">
                  Histórico de Hoje - {isComandaSelected ? `Comanda ${selectedComandaId}` : `Mesa ${selectedTableId}`}
                </h3>
                <button onClick={() => setIsHistoryModalOpen(false)}><X size={24} /></button>
              </div>

              <div className="overflow-y-auto pr-2 flex-1 space-y-6 scrollbar-hide">
                {(() => {
                  const today = new Date().toISOString().split('T')[0];
                  const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
                  const tableHistory = orders.filter(o => 
                    o.tableId === targetId && 
                    o.isComanda === isComandaSelected && 
                    o.timestamp.startsWith(today)
                  ).reverse();

                  if (tableHistory.length === 0) {
                    return (
                      <div className="text-center py-20 opacity-30">
                        <Clock size={48} className="mx-auto mb-4" />
                        <p>Nenhum pedido encontrado para hoje.</p>
                      </div>
                    );
                  }

                  return tableHistory.map(order => (
                    <div key={order.id} className="border border-[#141414]/10 rounded-2xl p-6 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] uppercase font-bold opacity-30">Pedido #{order.id}</p>
                          <p className="text-xs font-mono opacity-50">{new Date(order.timestamp).toLocaleTimeString()}</p>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-[8px] uppercase font-bold ${
                          order.status === 'finalizada' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {order.status}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {(order.items || []).map((item, idx) => (
                          <div key={idx} className={`flex flex-col space-y-0.5 pb-1.5 border-b border-[#141414]/5 last:border-0 ${item.removed ? 'opacity-40' : ''}`}>
                            <div className="flex justify-between items-start text-sm gap-2">
                              <div className="flex-1 min-w-0">
                                <span className={item.removed ? 'line-through' : ''}>
                                  {item.quantity || 1}× {item.name}
                                </span>
                                {item.waiterName && (
                                  <span className="ml-1.5 text-[9px] bg-[#141414]/8 px-1.5 py-0.5 rounded font-semibold opacity-60">{item.waiterName}</span>
                                )}
                                {item.observations && (
                                  <p className="text-[10px] text-blue-600 mt-0.5">Obs: {item.observations}</p>
                                )}
                              </div>
                              <div className="flex flex-col items-end shrink-0">
                                {item.discount && (
                                  <span className="text-[10px] line-through opacity-40 font-mono">
                                    R$ {item.price.toFixed(2)}
                                  </span>
                                )}
                                <span className="font-mono font-bold">
                                  R$ {(() => {
                                    let price = item.price;
                                    if (item.discount) {
                                      if (item.discountType === 'percentage') price *= (1 - item.discount / 100);
                                      else price = Math.max(0, price - item.discount);
                                    }
                                    return price.toFixed(2);
                                  })()}
                                </span>
                              </div>
                            </div>
                            {item.discount && (
                              <span className="text-[8px] text-green-600 font-bold uppercase text-right">
                                Desconto: -{item.discountType === 'percentage' ? `${item.discount}%` : `R$ ${item.discount.toFixed(2)}`}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="pt-4 border-t border-dashed space-y-1">
                        {order.discount && (
                          <div className="flex justify-between items-center text-green-600 text-[10px] font-bold uppercase">
                            <span>Desconto no Total</span>
                            <span>- {order.discountType === 'percentage' ? `${order.discount}%` : `R$ ${order.discount.toFixed(2)}`}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase font-bold opacity-30">Total do Pedido</span>
                          <span className="font-bold">
                            R$ {(() => {
                              const total = (order.items || []).filter(i => !i.removed).reduce((acc, i) => {
                                let price = i.price;
                                if (i.discount) {
                                  if (i.discountType === 'percentage') price *= (1 - i.discount / 100);
                                  else price = Math.max(0, price - i.discount);
                                }
                                return acc + price;
                              }, 0);
                              
                              let finalTotal = total;
                              if (order.discount) {
                                if (order.discountType === 'percentage') finalTotal *= (1 - order.discount / 100);
                                else finalTotal = Math.max(0, finalTotal - order.discount);
                              }
                              return finalTotal.toFixed(2);
                            })()}
                          </span>
                        </div>

                         {order.paymentLog && order.paymentLog.length > 0 && (
                          <div className="pt-3 border-t border-dashed border-[#141414]/10 space-y-1.5">
                            <p className="text-[9px] uppercase font-bold opacity-40">Pagamentos</p>
                            {order.paymentLog.map((p, pIdx) => {
                              const methodColor =
                                p.method === 'Dinheiro' ? 'bg-green-50 border-green-200' :
                                p.method === 'PIX'      ? 'bg-blue-50 border-blue-200' :
                                p.method === 'Crédito'  ? 'bg-purple-50 border-purple-200' :
                                                          'bg-orange-50 border-orange-200';
                              const dotColor =
                                p.method === 'Dinheiro' ? 'bg-green-500' :
                                p.method === 'PIX'      ? 'bg-blue-500' :
                                p.method === 'Crédito'  ? 'bg-purple-500' :
                                                          'bg-orange-500';
                              return (
                              <div key={pIdx} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${methodColor}`}>
                                <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-xs">{p.method}</span>
                                    {p.type === 'partial' && (
                                      <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase">Parcial</span>
                                    )}
                                  </div>
                                  {p.payer && (
                                    <p className="text-[11px] font-bold text-[#141414]/80 mt-0.5">{p.payer}</p>
                                  )}
                                  <span className="text-[9px] opacity-40">{new Date(p.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <span className="font-mono font-black text-sm shrink-0">R$ {p.amount.toFixed(2)}</span>
                              </div>
                              );
                            })}
                            
                            <div className="pt-2 border-t border-[#141414]/5 space-y-1">
                              {/* Total de Pagamentos */}
                              <div className="flex justify-between items-center text-xs font-bold">
                                <span className="uppercase text-[9px] opacity-50">Total de Pagamentos</span>
                                <span className="text-green-700 font-mono">
                                  R$ {order.paymentLog.reduce((acc, p) => acc + p.amount, 0).toFixed(2)}
                                </span>
                              </div>

                              {/* Informação sobre Desconto se houver */}
                              {(order.discount || order.items.some(i => i.discount)) && (
                                <div className="flex justify-between items-center text-[10px] text-orange-600 font-bold uppercase">
                                  <span>Descontos Aplicados</span>
                                  <span>
                                    - R$ {(() => {
                                      const itemDiscounts = order.items.filter(i => !i.removed).reduce((acc, i) => {
                                        if (!i.discount) return acc;
                                        let dVal = 0;
                                        if (i.discountType === 'percentage') dVal = i.price * (i.discount / 100);
                                        else dVal = i.discount;
                                        return acc + dVal;
                                      }, 0);
                                      
                                      const subtotalAfterItemDiscounts = order.items.filter(i => !i.removed).reduce((acc, i) => {
                                        let price = i.price;
                                        if (i.discount) {
                                          if (i.discountType === 'percentage') price *= (1 - i.discount / 100);
                                          else price = Math.max(0, price - i.discount);
                                        }
                                        return acc + price;
                                      }, 0);

                                      let orderDiscount = 0;
                                      if (order.discount) {
                                        if (order.discountType === 'percentage') orderDiscount = subtotalAfterItemDiscounts * (order.discount / 100);
                                        else orderDiscount = order.discount;
                                      }

                                      return (itemDiscounts + orderDiscount).toFixed(2);
                                    })()}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Inactivity Alert Popup */}
      <AnimatePresence>
        {inactivityPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 10 }}
              className="bg-white rounded-3xl p-8 w-full max-w-xs shadow-2xl text-center space-y-5 border border-amber-100"
            >
              <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto border-2 border-amber-200">
                <Clock size={28} className="text-amber-500" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold tracking-widest text-amber-500 mb-1">
                  Atenção
                </p>
                <h3 className="font-bold text-xl text-[#141414]">
                  {inactivityPopup.isComanda ? 'Comanda' : 'Mesa'} {inactivityPopup.tableId}
                </h3>
                <p className="text-sm text-[#141414]/60 mt-2 leading-relaxed">
                  Esta {inactivityPopup.isComanda ? 'comanda' : 'mesa'} está há{' '}
                  <span className="font-bold text-amber-600">{inactivityPopup.minutes} min</span>{' '}
                  sem registrar pedido.
                </p>
              </div>
              <button
                onClick={() => {
                  const key = `${inactivityPopup.isComanda ? 'c' : 't'}_${inactivityPopup.tableId}`;
                  setSnoozeMap(m => ({ ...m, [key]: Date.now() + 10 * 60_000 }));
                  setInactivityPopup(null);
                }}
                className="w-full bg-[#141414] text-[#E4E3E0] py-3 rounded-2xl font-bold text-sm active:scale-95 transition-transform"
              >
                OK
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Item Modal (ADM) */}
      <AnimatePresence>
        {isAddItemModalOpen && (selectedTableId || selectedComandaId) && (
          <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl border-2 border-[#141414] flex flex-col max-h-[90vh]"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-serif italic text-2xl">Adicionar Ítem</h3>
                <button onClick={() => setIsAddItemModalOpen(false)}><X size={24} /></button>
              </div>

              {/* Search and Categories */}
              <div className="space-y-4 mb-6">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/30" size={20} />
                  <input 
                    type="text"
                    placeholder="Pesquisar item..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 rounded-xl border border-[#141414]/10 focus:outline-none focus:ring-2 focus:ring-[#141414]/20"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 mb-6">
                  <button 
                    onClick={() => setSelectedCategory('pizzas')}
                    className={`flex flex-col sm:flex-row items-center justify-center space-y-1 sm:space-y-0 sm:space-x-2 px-2 sm:px-4 py-3 rounded-xl text-sm font-bold transition-all ${selectedCategory === 'pizzas' && !searchTerm ? 'bg-[#141414] text-[#E4E3E0] shadow-lg scale-[1.02]' : 'bg-gray-100 hover:bg-gray-200 opacity-60'}`}
                  >
                    <Pizza size={18} />
                    <span className="text-[10px] sm:text-sm">Pizzas</span>
                  </button>
                  <button 
                    onClick={() => setSelectedCategory('lanches')}
                    className={`flex flex-col sm:flex-row items-center justify-center space-y-1 sm:space-y-0 sm:space-x-2 px-2 sm:px-4 py-3 rounded-xl text-sm font-bold transition-all ${selectedCategory === 'lanches' && !searchTerm ? 'bg-[#141414] text-[#E4E3E0] shadow-lg scale-[1.02]' : 'bg-gray-100 hover:bg-gray-200 opacity-60'}`}
                  >
                    <Sandwich size={18} />
                    <span className="text-[10px] sm:text-sm">Lanches</span>
                  </button>
                  <button 
                    onClick={() => setSelectedCategory('bebidas')}
                    className={`flex flex-col sm:flex-row items-center justify-center space-y-1 sm:space-y-0 sm:space-x-2 px-2 sm:px-4 py-3 rounded-xl text-sm font-bold transition-all ${selectedCategory === 'bebidas' && !searchTerm ? 'bg-[#141414] text-[#E4E3E0] shadow-lg scale-[1.02]' : 'bg-gray-100 hover:bg-gray-200 opacity-60'}`}
                  >
                    <Beer size={18} />
                    <span className="text-[10px] sm:text-sm">Bebidas</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto pr-2 flex-1">
                {menu
                  .filter(cat => searchTerm.length > 0 || cat.type === selectedCategory)
                  .flatMap(cat => cat.items)
                  .filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((item, idx) => (
                    <button 
                      key={idx}
                      onClick={() => handleAddItem((isComandaSelected ? selectedComandaId : selectedTableId)!, item)}
                      className="flex justify-between items-center p-4 rounded-xl border border-[#141414]/10 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0 mr-4">
                        <p className="font-bold">{item.name}</p>
                        <p className="text-[10px] opacity-50 uppercase">{item.ingredients}</p>
                      </div>
                      <span className="font-mono font-bold whitespace-nowrap">R$ {item.price.toFixed(2)}</span>
                    </button>
                  ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

        {isFlavorModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-[#E4E3E0] rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-bold">{selectedPizzaItem?.name}</h3>
                  <p className="text-sm opacity-60">
                    {selectionStep === 'flavors' 
                      ? `Selecione até ${maxFlavors} sabores` 
                      : 'Escolha a borda (opcional)'}
                  </p>
                </div>
                <button 
                  onClick={() => setIsFlavorModalOpen(false)}
                  className="p-2 hover:bg-black/5 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 mb-6">
                {selectionStep === 'flavors' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {pizzaFlavors.map((flavor, idx) => {
                      const isSelected = selectedFlavors.some(f => f.name === flavor.name);
                      return (
                        <button 
                          key={idx}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedFlavors(selectedFlavors.filter(f => f.name !== flavor.name));
                            } else if (selectedFlavors.length < maxFlavors) {
                              setSelectedFlavors([...selectedFlavors, flavor]);
                            } else {
                              toast.error(`Limite de ${maxFlavors} sabores atingido`);
                            }
                          }}
                          className={`flex flex-col p-4 rounded-xl border transition-all text-left ${
                            isSelected 
                              ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' 
                              : 'border-[#141414]/10 hover:bg-gray-50'
                          }`}
                        >
                          <p className="font-bold">{flavor.name}</p>
                          <p className={`text-[10px] uppercase ${isSelected ? 'opacity-70' : 'opacity-50'}`}>
                            {flavor.ingredients}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {pizzaCrusts.map((crust, idx) => {
                        const isSelected = selectedCrust === crust;
                        return (
                          <button 
                            key={idx}
                            onClick={() => setSelectedCrust(isSelected ? null : crust)}
                            className={`p-4 rounded-xl border transition-all text-left font-bold ${
                              isSelected 
                                ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' 
                                : 'border-[#141414]/10 hover:bg-gray-50'
                            }`}
                          >
                            {crust}
                          </button>
                        );
                      })}
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-bold opacity-60 uppercase tracking-wider">Observações</label>
                      <textarea 
                        value={pizzaObservations}
                        onChange={(e) => setPizzaObservations(e.target.value)}
                        placeholder="Ex: Sem cebola, bem passado..."
                        className="w-full h-32 p-4 bg-white border border-[#141414]/10 rounded-2xl focus:outline-none focus:border-[#141414] transition-colors text-sm resize-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex space-x-3">
                {selectionStep === 'crust' && (
                  <button 
                    onClick={() => setSelectionStep('flavors')}
                    className="flex-1 py-4 rounded-2xl border border-[#141414] font-bold hover:bg-black/5 transition-colors"
                  >
                    Voltar
                  </button>
                )}
                <button 
                  onClick={selectionStep === 'flavors' ? confirmFlavorSelection : confirmPizzaSelection}
                  disabled={selectionStep === 'flavors' && selectedFlavors.length === 0}
                  className="flex-1 py-4 rounded-2xl bg-[#141414] text-[#E4E3E0] font-bold hover:bg-black/90 transition-colors disabled:opacity-50"
                >
                  {selectionStep === 'flavors' 
                    ? `Próximo (${selectedFlavors.length}/${maxFlavors})` 
                    : 'Finalizar Item'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Quantity Modal */}
        <AnimatePresence>
          {isQuantityModalOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl border-2 border-[#141414] space-y-6"
              >
                <div className="text-center">
                  <h3 className="text-2xl font-bold mb-1">{selectedQuantityItem?.name}</h3>
                  <p className="text-sm opacity-50 uppercase tracking-widest">Selecione a quantidade</p>
                </div>

                <div className="flex items-center justify-center space-x-8">
                  <button 
                    onClick={() => setItemQuantity(Math.max(1, itemQuantity - 1))}
                    className="w-12 h-12 rounded-full border-2 border-[#141414] flex items-center justify-center text-2xl font-bold hover:bg-gray-50 transition-colors"
                  >
                    -
                  </button>
                  <span className="text-4xl font-bold w-12 text-center">{itemQuantity}</span>
                  <button 
                    onClick={() => setItemQuantity(itemQuantity + 1)}
                    className="w-12 h-12 rounded-full border-2 border-[#141414] flex items-center justify-center text-2xl font-bold hover:bg-gray-50 transition-colors"
                  >
                    +
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold opacity-40 block px-1">Observações</label>
                  <textarea 
                    value={itemObservations}
                    onChange={(e) => setItemObservations(e.target.value)}
                    placeholder="Ex: Sem cebola, gelo e limão..."
                    className="w-full p-4 bg-gray-50 border border-[#141414]/10 rounded-2xl focus:outline-none focus:border-[#141414] transition-colors text-sm resize-none"
                    rows={2}
                  />
                </div>

                <div className="pt-4 border-t border-[#141414]/10">
                  <div className="flex justify-between items-center mb-6">
                    <span className="text-sm font-bold opacity-50 uppercase">Total do Item</span>
                    <span className="text-2xl font-bold">R$ {( (selectedQuantityItem?.price || 0) * itemQuantity).toFixed(2)}</span>
                  </div>
                  <div className="flex space-x-3">
                    <button 
                      onClick={() => {
                        setIsQuantityModalOpen(false);
                        setIsAddItemModalOpen(true);
                      }}
                      className="flex-1 py-4 rounded-2xl border border-[#141414] font-bold hover:bg-black/5 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={confirmQuantitySelection}
                      className="flex-1 py-4 rounded-2xl bg-[#141414] text-[#E4E3E0] font-bold hover:bg-black/90 transition-colors"
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      {/* Removal Modal */}
      <AnimatePresence>
        {isRemovalModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4 border-2 border-[#141414]"
            >
              <div className="flex justify-between items-center">
                <h3 className="font-serif italic text-xl">Remover este Ítem?</h3>
                <button onClick={() => setIsRemovalModalOpen(false)} className="opacity-50">
                  <X size={20} />
                </button>
              </div>
              
              {itemToRemove?.item?.quantity > 1 && (
                <div className="space-y-2 py-2 border-y border-[#141414]/10">
                  <p className="text-xs font-bold uppercase opacity-50">Quantidade para remover</p>
                  <div className="flex items-center justify-center space-x-6">
                    <button 
                      onClick={() => setRemovalQuantity(Math.max(1, removalQuantity - 1))}
                      className="w-10 h-10 rounded-full border border-[#141414]/20 flex items-center justify-center text-xl font-bold"
                    >
                      -
                    </button>
                    <span className="text-2xl font-bold w-8 text-center">{removalQuantity}</span>
                    <button 
                      onClick={() => setRemovalQuantity(Math.min(itemToRemove.item.quantity, removalQuantity + 1))}
                      className="w-10 h-10 rounded-full border border-[#141414]/20 flex items-center justify-center text-xl font-bold"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-[10px] text-center opacity-40">Total de {itemToRemove.item.quantity} unidades disponíveis</p>
                </div>
              )}

              <p className="text-sm opacity-50 font-bold text-red-600">O motivo da remoção é obrigatório para prosseguir.</p>
              <textarea 
                value={removalReason}
                onChange={(e) => setRemovalReason(e.target.value)}
                placeholder="Motivo da remoção..."
                className="w-full h-24 p-4 bg-gray-50 border border-[#141414]/10 rounded-2xl focus:outline-none focus:border-[#141414] transition-colors text-sm resize-none"
                autoFocus
              />
              <div className="flex space-x-2">
                <button 
                  onClick={() => setIsRemovalModalOpen(false)}
                  className="flex-1 py-3 rounded-xl font-bold text-sm border border-[#141414]/10"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmRemoval}
                  disabled={!removalReason.trim()}
                  className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {/* Edit Product Modal */}
        {isEditProductModalOpen && editingProduct && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white w-full max-w-md rounded-3xl p-8 space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <h3 className="font-serif italic text-2xl">Editar Produto</h3>
                <button onClick={() => setIsEditProductModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Nome do Produto</label>
                  <input 
                    type="text"
                    value={editingProduct.item.name}
                    onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, name: e.target.value } })}
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Preço (R$)</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={editingProduct.item.price}
                    onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, price: parseFloat(e.target.value) } })}
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Ingredientes / Descrição</label>
                  <textarea 
                    value={editingProduct.item.ingredients}
                    onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, ingredients: e.target.value } })}
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] h-32 resize-none"
                  />
                </div>
              </div>

              <button 
                onClick={() => {
                  socket.emit('update_product', {
                    categoryName: editingProduct.categoryName,
                    productId: editingProduct.item.id,
                    updatedData: {
                      name: editingProduct.item.name,
                      price: editingProduct.item.price,
                      ingredients: editingProduct.item.ingredients
                    }
                  });
                  setIsEditProductModalOpen(false);
                  toast.success('Produto atualizado com sucesso!');
                }}
                className="w-full bg-[#141414] text-[#E4E3E0] p-4 rounded-xl font-bold flex items-center justify-center space-x-2 hover:opacity-90 transition-opacity"
              >
                <Save size={20} />
                <span>Salvar Alterações</span>
              </button>
            </motion.div>
          </motion.div>
        )}

        {/* Add Product Modal */}
        {isAddProductModalOpen && newProductCategory && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white w-full max-w-md rounded-3xl p-8 space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-serif italic text-2xl">Novo Produto</h3>
                </div>
                <button onClick={() => setIsAddProductModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Categoria</label>
                  <select 
                    value={newProductCategory}
                    onChange={(e) => setNewProductCategory(e.target.value)}
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] appearance-none cursor-pointer"
                  >
                    {menu.map(cat => (
                      <option key={cat.name} value={cat.name}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Nome do Produto</label>
                  <input 
                    type="text"
                    value={newProductData.name}
                    onChange={(e) => setNewProductData({ ...newProductData, name: e.target.value })}
                    placeholder="Ex: Pizza de Calabresa"
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Preço (R$)</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={newProductData.price || ''}
                    onChange={(e) => setNewProductData({ ...newProductData, price: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Ingredientes / Descrição</label>
                  <textarea 
                    value={newProductData.ingredients}
                    onChange={(e) => setNewProductData({ ...newProductData, ingredients: e.target.value })}
                    placeholder="Ex: Mussarela, molho de tomate..."
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] h-32 resize-none"
                  />
                </div>
              </div>

              <button 
                onClick={() => {
                  if (!newProductData.name || !newProductData.price) {
                    toast.error('Por favor, preencha o nome e o preço.');
                    return;
                  }
                  socket.emit('add_product', {
                    categoryName: newProductCategory,
                    productData: newProductData
                  });
                  setIsAddProductModalOpen(false);
                  toast.success('Produto adicionado com sucesso!');
                }}
                className="w-full bg-[#141414] text-[#E4E3E0] p-4 rounded-xl font-bold flex items-center justify-center space-x-2 hover:opacity-90 transition-opacity"
              >
                <PlusCircle size={20} />
                <span>Adicionar ao Cardápio</span>
              </button>
            </motion.div>
          </motion.div>
        )}

        {/* Edit Flavor Modal */}
        {isEditFlavorModalOpen && editingFlavor && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white w-full max-w-md rounded-3xl p-8 space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <h3 className="font-serif italic text-2xl">Editar Sabor</h3>
                <button onClick={() => setIsEditFlavorModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Nome do Sabor</label>
                  <input 
                    type="text"
                    value={editingFlavor.name}
                    onChange={(e) => setEditingFlavor({ ...editingFlavor, name: e.target.value })}
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Ingredientes</label>
                  <textarea 
                    value={editingFlavor.ingredients}
                    onChange={(e) => setEditingFlavor({ ...editingFlavor, ingredients: e.target.value })}
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] h-32 resize-none"
                  />
                </div>
              </div>

              <button 
                onClick={() => {
                  socket.emit('update_pizza_flavor', {
                    flavorName: editingFlavor.name,
                    updatedData: {
                      name: editingFlavor.name,
                      ingredients: editingFlavor.ingredients
                    }
                  });
                  setIsEditFlavorModalOpen(false);
                  toast.success('Sabor atualizado com sucesso!');
                }}
                className="w-full bg-[#141414] text-[#E4E3E0] p-4 rounded-xl font-bold flex items-center justify-center space-x-2 hover:opacity-90 transition-opacity"
              >
                <Save size={20} />
                <span>Salvar Alterações</span>
              </button>
            </motion.div>
          </motion.div>
        )}

        {/* Add Flavor Modal */}
        {isAddFlavorModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white w-full max-w-md rounded-3xl p-8 space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <h3 className="font-serif italic text-2xl">Novo Sabor</h3>
                <button onClick={() => setIsAddFlavorModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Nome do Sabor</label>
                  <input 
                    type="text"
                    value={newFlavorData.name}
                    onChange={(e) => setNewFlavorData({ ...newFlavorData, name: e.target.value })}
                    placeholder="Ex: Portuguesa"
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Ingredientes</label>
                  <textarea 
                    value={newFlavorData.ingredients}
                    onChange={(e) => setNewFlavorData({ ...newFlavorData, ingredients: e.target.value })}
                    placeholder="Ex: Mussarela, presunto, ovos..."
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] h-32 resize-none"
                  />
                </div>
              </div>

              <button 
                onClick={() => {
                  if (!newFlavorData.name) {
                    toast.error('Por favor, preencha o nome do sabor.');
                    return;
                  }
                  socket.emit('add_pizza_flavor', newFlavorData);
                  setIsAddFlavorModalOpen(false);
                  toast.success('Sabor adicionado com sucesso!');
                }}
                className="w-full bg-[#141414] text-[#E4E3E0] p-4 rounded-xl font-bold flex items-center justify-center space-x-2 hover:opacity-90 transition-opacity"
              >
                <PlusCircle size={20} />
                <span>Adicionar Sabor</span>
              </button>
            </motion.div>
          </motion.div>
        )}
        {/* Category Management Modal */}
        {isCategoryModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white w-full max-w-2xl rounded-3xl p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center">
                <h3 className="font-serif italic text-2xl">Gerenciar Categorias</h3>
                <button onClick={() => setIsCategoryModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                {/* Create Category Button */}
                <button 
                  onClick={() => setIsAddCategoryPopupOpen(true)}
                  className="w-full bg-[#141414] text-[#E4E3E0] p-4 rounded-2xl font-bold flex items-center justify-center space-x-2 hover:scale-[1.02] transition-transform shadow-md"
                >
                  <PlusCircle size={20} />
                  <span>Criar Nova Categoria</span>
                </button>

                {/* List of Categories */}
                <div className="space-y-3">
                  <h4 className="font-bold text-sm uppercase tracking-widest opacity-50">Categorias Existentes</h4>
                  {menu.map(cat => (
                    <div key={cat.name} className="flex items-center justify-between p-4 bg-white border border-[#141414]/10 rounded-2xl">
                      {editingCategory?.oldName === cat.name ? (
                        <div className="flex-1 flex space-x-2 mr-4">
                          <input 
                            type="text"
                            value={editingCategory.name}
                            onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                            className="flex-1 bg-gray-50 border border-[#141414]/10 rounded-lg px-3 py-1 font-bold outline-none"
                          />
                          <select 
                            value={editingCategory.type}
                            onChange={(e) => setEditingCategory({ ...editingCategory, type: e.target.value as any })}
                            className="bg-gray-50 border border-[#141414]/10 rounded-lg px-3 py-1 font-bold outline-none"
                          >
                            <option value="pizzas">Pizzas</option>
                            <option value="lanches">Lanches</option>
                            <option value="bebidas">Bebidas</option>
                          </select>
                          <button 
                            onClick={() => {
                              socket.emit('update_category', { oldName: editingCategory.oldName, updatedData: { name: editingCategory.name, type: editingCategory.type } });
                              setEditingCategory(null);
                              toast.success("Categoria atualizada!");
                            }}
                            className="p-2 bg-green-500 text-white rounded-lg"
                          >
                            <Save size={18} />
                          </button>
                          <button onClick={() => setEditingCategory(null)} className="p-2 bg-gray-200 rounded-lg">
                            <X size={18} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div>
                            <p className="font-bold">{cat.name}</p>
                            <p className="text-[10px] uppercase opacity-50">{cat.type}</p>
                          </div>
                          <div className="flex space-x-2">
                            <button 
                              onClick={() => setEditingCategory({ oldName: cat.name, name: cat.name, type: cat.type })}
                              className="p-2 hover:bg-gray-100 rounded-lg text-blue-500"
                            >
                              <Edit size={18} />
                            </button>
                            <button 
                              onClick={() => {
                                if (confirm(`Excluir a categoria "${cat.name}" e todos os seus produtos?`)) {
                                  socket.emit('delete_category', cat.name);
                                  toast.success("Categoria excluída!");
                                }
                              }}
                              className="p-2 hover:bg-gray-100 rounded-lg text-red-500"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
        {/* Confirmar Baixa Modal */}
        {isBaixaModalOpen && (() => {
          const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
          const activeOrder = orders.find((o: any) => targetId && o.tableId && String(o.tableId) === String(targetId) && !!o.isComanda === !!isComandaSelected && o.status !== 'finalizada');
          if (!activeOrder) return null;
          return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
            onClick={() => setIsBaixaModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="bg-white w-full max-w-xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
              onClick={e => e.stopPropagation()}
            >
              {/* Header fixo */}
              <div className="bg-purple-600 px-6 py-4 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-purple-200 text-[10px] uppercase font-bold tracking-widest">Confirmar Baixa</p>
                  <h3 className="text-white font-serif italic text-xl leading-tight">
                    {activeOrder.isComanda ? 'Comanda' : 'Mesa'} {activeOrder.tableId}
                    {activeOrder.waiterName && (
                      <span className="ml-2 text-purple-200 font-sans not-italic text-sm font-normal">— {activeOrder.waiterName}</span>
                    )}
                  </h3>
                  <p className="text-purple-300 text-[10px] mt-0.5">
                    {new Date(activeOrder.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button onClick={() => setIsBaixaModalOpen(false)} className="text-purple-200 hover:text-white p-1">
                  <X size={20} />
                </button>
              </div>

              {/* Corpo rolável */}
              <div className="overflow-y-auto flex-1 min-h-0">

                {/* Itens lançados */}
                <div className="px-6 pt-5 pb-3">
                  <p className="text-[10px] uppercase font-bold opacity-40 tracking-widest mb-3">Itens Lançados</p>
                  {(() => {
                    const activeItems = (activeOrder.items || []).filter((i: any) => !i.removed);
                    const removedItems = (activeOrder.items || []).filter((i: any) => i.removed);

                    if (activeItems.length === 0 && removedItems.length === 0) {
                      return <p className="text-sm opacity-50 italic text-center py-3">Nenhum item registrado</p>;
                    }

                    const itemRow = (item: any, removed = false) => {
                      let price = Number(item.price || 0);
                      if (item.discount) {
                        price = item.discountType === 'percentage'
                          ? price * (1 - item.discount / 100)
                          : Math.max(0, price - item.discount);
                      }
                      const qty = item.quantity || 1;
                      return (
                        <div key={item.id} className={`flex items-start gap-3 py-2.5 border-b border-[#141414]/5 last:border-0 ${removed ? 'opacity-40' : ''}`}>
                          <div className="w-6 h-6 rounded-full bg-[#141414]/8 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-[10px] font-black">{qty}×</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-bold text-sm leading-snug ${removed ? 'line-through' : ''}`}>{item.name}</p>
                            {item.flavors?.length > 0 && (
                              <p className="text-[10px] opacity-50 leading-tight">{item.flavors.join(', ')}</p>
                            )}
                            {item.observations && (
                              <p className="text-[10px] text-blue-600 font-semibold mt-0.5">Obs: {item.observations}</p>
                            )}
                            {removed && item.removalReason && (
                              <p className="text-[10px] text-red-500 mt-0.5">Removido: {item.removalReason}</p>
                            )}
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {item.waiterName && (
                                <span className="text-[9px] bg-[#141414]/8 px-1.5 py-0.5 rounded font-semibold opacity-60">{item.waiterName}</span>
                              )}
                              {item.timestamp && (
                                <span className="text-[9px] opacity-40">
                                  {new Date(item.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                              {item.discount > 0 && (
                                <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                                  -{item.discountType === 'percentage' ? `${item.discount}%` : `R$${item.discount}`}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className={`font-black font-mono text-sm shrink-0 ${removed ? 'line-through' : ''}`}>
                            R$ {(price * qty).toFixed(2)}
                          </span>
                        </div>
                      );
                    };

                    const subtotal = activeItems.reduce((acc: number, i: any) => {
                      let p = Number(i.price || 0);
                      if (i.discount) p = i.discountType === 'percentage' ? p * (1 - i.discount / 100) : Math.max(0, p - i.discount);
                      return acc + p * (i.quantity || 1);
                    }, 0);

                    return (
                      <div>
                        {activeItems.map((i: any) => itemRow(i, false))}
                        {removedItems.length > 0 && (
                          <div className="mt-2">
                            <p className="text-[9px] uppercase font-bold text-red-400 tracking-widest mb-1">Itens Removidos</p>
                            {removedItems.map((i: any) => itemRow(i, true))}
                          </div>
                        )}
                        <div className="flex justify-between items-center pt-3 mt-1 border-t border-[#141414]/10">
                          <span className="text-xs font-bold uppercase opacity-50">Subtotal</span>
                          <span className="font-black font-mono">R$ {subtotal.toFixed(2)}</span>
                        </div>
                        {activeOrder.discount > 0 && (
                          <div className="flex justify-between items-center text-amber-600">
                            <span className="text-xs font-bold uppercase opacity-70">Desconto</span>
                            <span className="font-bold font-mono text-sm">
                              -{activeOrder.discountType === 'percentage' ? `${activeOrder.discount}%` : `R$ ${Number(activeOrder.discount).toFixed(2)}`}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Pagamentos */}
                <div className="px-6 pb-5 border-t border-[#141414]/8 pt-4">
                  <p className="text-[10px] uppercase font-bold opacity-40 tracking-widest mb-3">Pagamentos Registrados</p>
                  {(() => {
                    const log = activeOrder.paymentLog || [];
                    if (log.length === 0) {
                      return <p className="text-sm opacity-50 italic text-center py-3">Nenhum pagamento registrado</p>;
                    }

                    const methodColors: Record<string, string> = {
                      'Dinheiro': 'bg-green-50 border-green-200 text-green-800',
                      'PIX':      'bg-blue-50 border-blue-200 text-blue-800',
                      'Crédito':  'bg-purple-50 border-purple-200 text-purple-800',
                      'Débito':   'bg-orange-50 border-orange-200 text-orange-800',
                    };
                    const methodDot: Record<string, string> = {
                      'Dinheiro': 'bg-green-500',
                      'PIX':      'bg-blue-500',
                      'Crédito':  'bg-purple-500',
                      'Débito':   'bg-orange-500',
                    };

                    const total = log.reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);

                    return (
                      <div className="space-y-2">
                        {log.map((p: any, idx: number) => (
                          <div key={idx} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${methodColors[p.method] || 'bg-gray-50 border-gray-200 text-gray-800'}`}>
                            <span className={`w-2 h-2 rounded-full shrink-0 ${methodDot[p.method] || 'bg-gray-400'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">{p.method}</span>
                                {p.type === 'partial' && (
                                  <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase">Parcial</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {p.payer && (
                                  <span className="text-[10px] font-semibold opacity-70">{p.payer}</span>
                                )}
                                {p.timestamp && (
                                  <span className="text-[9px] opacity-40">
                                    {new Date(p.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="font-black font-mono text-sm shrink-0">R$ {Number(p.amount).toFixed(2)}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-[#141414] text-white mt-2">
                          <span className="font-bold text-sm uppercase tracking-wide">Total Pago</span>
                          <span className="font-black font-mono text-lg">R$ {total.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Rodapé fixo com ações */}
              <div className="px-6 py-4 border-t border-[#141414]/10 space-y-3 shrink-0">
                {/* Toggle imprimir */}
                <button
                  onClick={() => setPrintOnBaixa(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl border-2 transition-colors hover:bg-gray-50"
                  style={{ borderColor: printOnBaixa ? '#7c3aed' : '#e5e7eb' }}
                >
                  <div className="flex items-center gap-2">
                    <FileText size={15} className={printOnBaixa ? 'text-purple-600' : 'text-gray-400'} />
                    <span className={`font-bold text-sm ${printOnBaixa ? 'text-purple-700' : 'text-gray-400'}`}>
                      Imprimir comprovante
                    </span>
                  </div>
                  <div className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${printOnBaixa ? 'bg-purple-500' : 'bg-gray-200'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${printOnBaixa ? 'translate-x-4' : ''}`} />
                  </div>
                </button>

                <div className="flex gap-3">
                  <button
                    onClick={() => setIsBaixaModalOpen(false)}
                    className="flex-1 py-3.5 rounded-2xl font-bold text-sm border-2 border-[#141414]/10 hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      socket.emit('confirm_baixa', { orderId: activeOrder.id });
                      toast.success('Baixa confirmada! Mesa liberada.');
                      setIsBaixaModalOpen(false);
                      if (printOnBaixa) {
                        const tableType = activeOrder.isComanda ? 'Comanda' : 'Mesa';
                        const tableLabel = `${tableType} ${activeOrder.tableId}`;
                        const waiterName = activeOrder.waiterName || '—';
                        const openedAt = new Date(activeOrder.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                        const closedAt = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

                        const activeItems = (activeOrder.items || []).filter((i: any) => !i.removed);
                        const removedItems = (activeOrder.items || []).filter((i: any) => i.removed);

                        const calcPrice = (i: any) => {
                          let p = Number(i.price || 0);
                          if (i.discount) p = i.discountType === 'percentage' ? p * (1 - i.discount / 100) : Math.max(0, p - i.discount);
                          return p * (i.quantity || 1);
                        };
                        const subtotal = activeItems.reduce((acc: number, i: any) => acc + calcPrice(i), 0);
                        const totalPaid = (activeOrder.paymentLog || []).reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);

                        const itemsHtml = activeItems.map((i: any) => {
                          const price = calcPrice(i);
                          const obs = i.observations ? `<div style="font-size:10px;color:#666;margin-top:1px">Obs: ${i.observations}</div>` : '';
                          const waiter = i.waiterName ? `<span style="font-size:9px;background:#f0f0f0;padding:1px 5px;border-radius:3px">${i.waiterName}</span>` : '';
                          return `<tr>
                            <td style="padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top">
                              <div style="font-weight:700">${i.quantity || 1}× ${i.name}</div>
                              ${i.flavors?.length ? `<div style="font-size:10px;color:#888">${i.flavors.join(', ')}</div>` : ''}
                              ${obs}
                              ${waiter}
                            </td>
                            <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:700;vertical-align:top;white-space:nowrap">R$ ${price.toFixed(2)}</td>
                          </tr>`;
                        }).join('');

                        const removedHtml = removedItems.length > 0
                          ? `<tr><td colspan="2" style="padding:6px 8px 2px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#dc2626;background:#fff5f5">Itens Removidos</td></tr>` +
                            removedItems.map((i: any) => `<tr style="opacity:.5"><td style="padding:4px 8px;border-bottom:1px dashed #eee;text-decoration:line-through;font-size:11px">${i.quantity || 1}× ${i.name}${i.removalReason ? ` — ${i.removalReason}` : ''}</td><td style="padding:4px 8px;border-bottom:1px dashed #eee;text-align:right;font-family:monospace;font-size:11px;text-decoration:line-through;white-space:nowrap">R$ ${Number(i.price || 0).toFixed(2)}</td></tr>`).join('')
                          : '';

                        const discountHtml = activeOrder.discount > 0
                          ? `<tr><td style="padding:5px 8px;color:#d97706;font-size:11px">Desconto</td><td style="padding:5px 8px;text-align:right;font-family:monospace;color:#d97706;font-size:11px;white-space:nowrap">-${activeOrder.discountType === 'percentage' ? `${activeOrder.discount}%` : `R$ ${Number(activeOrder.discount).toFixed(2)}`}</td></tr>`
                          : '';

                        const methodColors: Record<string, string> = { 'Dinheiro': '#16a34a', 'PIX': '#2563eb', 'Crédito': '#7c3aed', 'Débito': '#ea580c' };
                        const paymentsHtml = (activeOrder.paymentLog || []).map((p: any) => {
                          const color = methodColors[p.method] || '#555';
                          const payer = p.payer ? ` — ${p.payer}` : '';
                          const partial = p.type === 'partial' ? ` <span style="font-size:8px;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:3px;font-weight:700">PARCIAL</span>` : '';
                          return `<tr>
                            <td style="padding:5px 8px;border-bottom:1px solid #eee">
                              <span style="color:${color};font-weight:700">${p.method}</span>${partial}${payer ? `<span style="font-size:10px;color:#888">${payer}</span>` : ''}
                            </td>
                            <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:700;color:${color};white-space:nowrap">R$ ${Number(p.amount).toFixed(2)}</td>
                          </tr>`;
                        }).join('');

                        const _rcptPw = (printerConfig.paperWidth || '80mm') === '50mm' ? '192px' : '304px';
                        const _rcptFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '11px' : '13px';
                        const _rcptHdFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '13px' : '15px';
                        const _rcptTotalFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '13px' : '16px';
                        const w = window.open('', '_blank');
                        if (w) {
                          w.document.write(`<html><head><title>Comprovante — ${tableLabel}</title><style>
                            *{box-sizing:border-box}
                            body{font-family:sans-serif;padding:12px;max-width:${_rcptPw};margin:0 auto;color:#141414;font-size:${_rcptFs}}
                            .center{text-align:center}
                            .sep{border-top:1px dashed #ccc;margin:8px 0}
                            table{width:100%;border-collapse:collapse}
                            @media print{body{padding:6px;max-width:100%}}
                          </style></head><body>
                            <div class="center" style="margin-bottom:10px">
                              <div style="font-weight:900;font-size:${_rcptHdFs};text-transform:uppercase">${printerConfig.establishmentName || ''}</div>
                              ${printerConfig.address ? `<div style="font-size:9px;color:#666">${printerConfig.address}</div>` : ''}
                              ${printerConfig.phone ? `<div style="font-size:9px;color:#666">Tel: ${printerConfig.phone}</div>` : ''}
                            </div>
                            <div class="sep"></div>
                            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                              <span style="font-weight:700;font-size:${_rcptHdFs}">${tableLabel}</span>
                              <span style="font-size:9px;color:#666">Garçom: ${waiterName}</span>
                            </div>
                            <div style="font-size:9px;color:#888;margin-bottom:2px">Abertura: ${openedAt}</div>
                            <div style="font-size:9px;color:#888;margin-bottom:10px">Fechamento: ${closedAt}</div>
                            <div class="sep"></div>
                            <table>${itemsHtml}${removedHtml}</table>
                            <div class="sep"></div>
                            <table>
                              <tr><td style="padding:3px 6px;font-size:${_rcptFs};font-weight:700">Subtotal</td><td style="padding:3px 6px;text-align:right;font-family:monospace;font-weight:700;white-space:nowrap">R$ ${subtotal.toFixed(2)}</td></tr>
                              ${discountHtml}
                            </table>
                            <div style="background:#141414;color:#fff;padding:8px 10px;border-radius:4px;display:flex;justify-content:space-between;margin:6px 0 10px">
                              <span style="font-weight:700;font-size:${_rcptFs};text-transform:uppercase">Total Pago</span>
                              <span style="font-family:monospace;font-weight:900;font-size:${_rcptTotalFs}">R$ ${totalPaid.toFixed(2)}</span>
                            </div>
                            <table style="margin-bottom:10px">${paymentsHtml}</table>
                            <div class="sep"></div>
                            <div class="center" style="font-size:9px;color:#999;margin-top:6px">${printerConfig.receiptFooter || ''}</div>
                            <script>window.onload=()=>{window.print();window.close()}</script>
                          </body></html>`);
                          w.document.close();
                        }
                      }
                    }}
                    className="flex-1 py-3.5 rounded-2xl font-bold text-sm bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center gap-2 transition-colors"
                  >
                    <CheckCircle size={16} />
                    Confirmar Baixa
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
          );
        })()}

        {/* Add Category Popup */}
        {isAddCategoryPopupOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white w-full max-w-md rounded-3xl p-8 space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <h3 className="font-serif italic text-2xl">Nova Categoria</h3>
                <button onClick={() => setIsAddCategoryPopupOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Nome da Categoria</label>
                  <input 
                    type="text"
                    placeholder="Ex: Porções"
                    value={newCategoryData.name}
                    onChange={(e) => setNewCategoryData({ ...newCategoryData, name: e.target.value })}
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Tipo de Categoria</label>
                  <select 
                    value={newCategoryData.type}
                    onChange={(e) => setNewCategoryData({ ...newCategoryData, type: e.target.value as any })}
                    className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] appearance-none cursor-pointer"
                  >
                    <option value="pizzas">Pizzas</option>
                    <option value="lanches">Lanches</option>
                    <option value="bebidas">Bebidas</option>
                  </select>
                </div>
              </div>

              <div className="flex space-x-3">
                <button 
                  onClick={() => setIsAddCategoryPopupOpen(false)}
                  className="flex-1 bg-gray-100 text-[#141414] p-4 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => {
                    if (!newCategoryData.name) return toast.error("Nome obrigatório");
                    socket.emit('add_category', newCategoryData);
                    setNewCategoryData({ name: '', type: 'lanches' });
                    setIsAddCategoryPopupOpen(false);
                    toast.success("Categoria adicionada!");
                  }}
                  className="flex-1 bg-[#141414] text-[#E4E3E0] p-4 rounded-xl font-bold hover:opacity-90 transition-opacity"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({ title, value, total, icon: Icon }: { title: string, value: string | number, total?: number, icon?: any }) {
  return (
    <div className="flex items-center space-x-3 bg-white/50 px-3 py-1.5 rounded-full border border-[#141414]/5">
      {Icon && <Icon size={12} className="opacity-40" />}
      <div className="flex items-center space-x-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-40 whitespace-nowrap">{title}:</span>
        <span className="text-sm font-bold">{value}</span>
        {total && <span className="text-[10px] opacity-20">/ {total}</span>}
      </div>
    </div>
  );
}
