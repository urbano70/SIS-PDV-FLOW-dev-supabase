import React, { useState, useEffect } from 'react';
import { Table, PizzaItem, Order, MenuCategory, PizzeriaConfig } from '../types';
import socket from '../lib/socket';
import { Plus, Send, ShoppingBasket, ChevronLeft, ChevronRight, X, Pizza, Sandwich, Beer, Wallet, Link, Clock, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { auth } from '../lib/firebase';
import PaymentModal from './PaymentModal';
import { OrderTimer } from './OrderTimer';

interface WaiterTerminalProps {
  tables: Table[];
  comandas: Table[];
  orders: Order[];
  menu: MenuCategory[];
  pizzaFlavors: any[];
  pizzaCrusts: string[];
  isCashRegisterOpen: boolean;
  printerConfig: any;
  pizzariaConfig: PizzeriaConfig;
}

export default function WaiterTerminal({ tables, comandas, orders, menu, pizzaFlavors, pizzaCrusts, isCashRegisterOpen, printerConfig, pizzariaConfig }: WaiterTerminalProps) {
  const [selectionType, setSelectionType] = useState<'tables' | 'comandas'>('tables');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isComandaSelected, setIsComandaSelected] = useState(false);
  const [cart, setCart] = useState<PizzaItem[]>([]);
  const [activeType, setActiveType] = useState<'pizzas' | 'lanches' | 'bebidas'>('pizzas');
  const [activeCategory, setActiveCategory] = useState(menu[0]?.name || '');
  const [isAddingItems, setIsAddingItems] = useState(false);
  const [isObservationModalOpen, setIsObservationModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [cartObservations, setCartObservations] = useState('');

  const [isCartExpanded, setIsCartExpanded] = useState(false);
  const [isCartPopupOpen, setIsCartPopupOpen] = useState(false);

  const currentList = selectionType === 'tables' ? tables : comandas;
  const tableData = currentList.find(t => selectedId && t.id && String(t.id) === String(selectedId));
  const currentOrder = orders.find(o => tableData?.currentOrder && o.id && String(o.id) === String(tableData.currentOrder));

  const filteredCategories = menu.filter(cat => cat.type === activeType);

  const [, forceInactivityUpdate] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceInactivityUpdate(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const [, setPizzeriaColorTick] = useState(0);
  useEffect(() => {
    if (!pizzariaConfig?.enabled) return;
    const id = setInterval(() => setPizzeriaColorTick(n => n + 1), 1_000);
    return () => clearInterval(id);
  }, [pizzariaConfig?.enabled]);

  const getPizzeriaTableColor = (tableItem: Table): 'green' | 'yellow' | 'orange' | 'red' | null => {
    if (!pizzariaConfig?.enabled || tableItem.status === 'free') return null;
    const order = orders.find((o: any) =>
      tableItem.currentOrder && String(o.id) === String(tableItem.currentOrder) && o.status !== 'finalizada'
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

  const getInactivityMinutes = (tableItem: Table): number | null => {
    if (tableItem.status === 'free' || !tableItem.currentOrder) return null;
    const order = orders.find(o => String(o.id) === String(tableItem.currentOrder));
    if (!order) return null;
    const activeItems = (order.items || []).filter((i: any) => !i.removed);
    const timestamps = activeItems.filter((i: any) => i.timestamp).map((i: any) => new Date(i.timestamp).getTime());
    const lastMs = timestamps.length > 0 ? Math.max(...timestamps) : new Date(order.timestamp).getTime();
    return Math.floor((Date.now() - lastMs) / 60_000);
  };

  const formatInactivity = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };
  
  // Update active category when type changes
  useEffect(() => {
    const firstCat = menu.find(cat => cat.type === activeType);
    if (firstCat) setActiveCategory(firstCat.name);
  }, [activeType, menu]);
  
  // Multi-flavor selection state
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

  const getMaxFlavors = (itemName: string) => {
    const name = itemName.toUpperCase();
    if (name.includes('METRO') && !name.includes('MEIO')) return 4;
    if (name.includes('GRANDE') || name.includes('GG') || name.includes('MEIO METRO')) return 3;
    if (name.includes('MINI') || name.includes('PEQUENA') || name.includes('MÉDIA')) return 2;
    return 1;
  };

  const addToCart = (pizza: any) => {
    // Check if it's a pizza category
    const category = menu.find(cat => cat.items?.some(i => i.id === pizza.id || i.name === pizza.name));
    const isPizza = category?.type === 'pizzas' || pizza.type === 'pizzas';
    const isSnackOrDrink = category?.type === 'lanches' || category?.type === 'bebidas' || pizza.type === 'lanches' || pizza.type === 'bebidas';

    if (isPizza && !isFlavorModalOpen) {
      setSelectedPizzaItem(pizza);
      setMaxFlavors(getMaxFlavors(pizza.name));
      setSelectedFlavors([]);
      setSelectedCrust(null);
      setPizzaObservations('');
      setSelectionStep('flavors');
      setIsFlavorModalOpen(true);
      return;
    }

    if (isSnackOrDrink && !isQuantityModalOpen) {
      setSelectedQuantityItem(pizza);
      setItemQuantity(1);
      setItemObservations('');
      setIsQuantityModalOpen(true);
      return;
    }

    const qty = pizza.quantity || 1;
    const newItem: PizzaItem = {
      id: Math.random().toString(36).substr(2, 9),
      menuItemId: pizza.id,
      name: pizza.name,
      type: pizza.type || category?.type,
      flavors: pizza.flavors || [pizza.name],
      size: 'G',
      crust: pizza.crust,
      extras: [],
      observations: (pizza.observations || '').trim(),
      price: pizza.price * qty,
      quantity: qty,
      ingredients: pizza.ingredients
    };

    // Merge existing items in cart if identical
    setCart(prevCart => {
      const existingItemIndex = prevCart.findIndex(item => 
        item.name === newItem.name && 
        item.crust === newItem.crust && 
        JSON.stringify(item.flavors) === JSON.stringify(newItem.flavors) &&
        item.observations === newItem.observations
      );

      if (existingItemIndex !== -1) {
        const updatedCart = [...prevCart];
        const existingItem = updatedCart[existingItemIndex];
        const newQty = (existingItem.quantity || 1) + (newItem.quantity || 1);
        const unitPrice = existingItem.price / (existingItem.quantity || 1);
        
        updatedCart[existingItemIndex] = {
          ...existingItem,
          quantity: newQty,
          price: unitPrice * newQty
        };
        return updatedCart;
      }
      return [...prevCart, newItem];
    });

    setIsFlavorModalOpen(false);
  };

  const confirmQuantitySelection = () => {
    if (!selectedQuantityItem) return;

    const category = menu.find(cat => cat.items?.some(i => i.name === selectedQuantityItem.name));

    const itemToAdd = {
      ...selectedQuantityItem,
      type: selectedQuantityItem.type || category?.type,
      observations: itemObservations,
      quantity: itemQuantity
    };

    addToCart(itemToAdd);
    setIsQuantityModalOpen(false);
    setSelectedQuantityItem(null);
  };

  const confirmFlavorSelection = () => {
    if (selectedFlavors.length === 0) return;
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

    addToCart(itemWithDetails);
  };

  const submitOrder = async () => {
    if (!isCashRegisterOpen) {
      toast.error('O caixa está fechado. Peça ao gerente para abrir o caixa.');
      return;
    }
    if (selectedId === null || cart.length === 0) return;
    
    const waiterName = auth.currentUser?.displayName || 'Garçom';
    const waiterId = auth.currentUser?.uid || 'unknown';
    
    // Check if there's already an active order for this table/comanda
    const activeOrder = orders.find(o => 
      selectedId && o.tableId && String(o.tableId) === String(selectedId) && 
      o.isComanda === isComandaSelected && 
      o.status !== 'finalizada'
    );

    // Send order to socket (for production/alerts)
    if (activeOrder) {
      // Append items to existing order via socket
      cart.forEach(item => {
        socket.emit('add_item_to_order', {
          orderId: activeOrder.id,
          item: {
            ...item,
            waiterName: waiterName
          }
        });
      });
    } else {
      socket.emit('new_order', {
        tableId: selectedId,
        isComanda: isComandaSelected,
        items: cart,
        observations: cartObservations.trim()
      });
    }

    toast.success('Pedido enviado com sucesso!');

    setCart([]);
    setCartObservations('');
    setIsAddingItems(false);
  };

  const handlePaymentComplete = (selectedItems: Record<string, number>, partialAmount?: number, paymentMethod?: string, payerName?: string) => {
    if (!currentOrder) return;
    socket.emit('pay_items', {
      orderId: currentOrder.id,
      selectedItems,
      partialAmount,
      paymentMethod,
      payerName
    });
  };

  const handleApplyDiscount = (orderId: number | string, itemId: string | null, discount: number, discountType: 'percentage' | 'value') => {
    socket.emit('apply_discount', { orderId, itemId, discount, discountType });
  };

  const orderTotal = currentOrder?.items
    .filter(i => !i.removed)
    .reduce((acc, i) => acc + i.price, 0) || 0;

  const pendingAmount = React.useMemo(() => {
    if (!currentOrder) return 0;
    const activeItems = (currentOrder.items || []).filter((i: any) => !i.removed && !i.paid);
    const itemsTotal = activeItems.reduce((acc: number, i: any) => {
      let price = i.price;
      if (i.discount) {
        if (i.discountType === 'percentage') price *= (1 - i.discount / 100);
        else price = Math.max(0, price - i.discount);
      }
      return acc + price;
    }, 0);
    let finalTotal = itemsTotal;
    if (currentOrder.discount) {
      if ((currentOrder as any).discountType === 'percentage') finalTotal *= (1 - (currentOrder as any).discount / 100);
      else finalTotal = Math.max(0, finalTotal - (currentOrder as any).discount);
    }
    const existingPartialPaid = (currentOrder.paymentLog || [])
      .filter((p: any) => p.type === 'partial')
      .reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);
    return Math.max(0, finalTotal - existingPartialPaid);
  }, [currentOrder]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-[#141414] text-[#E4E3E0] p-3 flex justify-between items-center shrink-0">
        <h1 className="font-serif italic text-xl">Terminal Garçom</h1>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-[10px] uppercase tracking-widest font-bold">Online</span>
        </div>
      </header>

      {!isCashRegisterOpen && (
        <div className="bg-red-50 border-b border-red-200 p-3 text-center">
          <p className="text-xs text-red-600 font-bold flex items-center justify-center">
            <AlertCircle size={14} className="mr-2" />
            O caixa está fechado. Operações de pedido desativadas.
          </p>
        </div>
      )}

      <main className="flex-1 overflow-hidden p-4 flex flex-col min-h-0">
        {selectedId === null ? (
          <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
            <div className="flex bg-white p-1 rounded-2xl border border-[#141414]/10">
              <button
                onClick={() => setSelectionType('tables')}
                className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all ${selectionType === 'tables' ? 'bg-[#141414] text-white shadow-lg' : 'text-[#141414]/50'}`}
              >
                Mesas
              </button>
              <button
                onClick={() => setSelectionType('comandas')}
                className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all ${selectionType === 'comandas' ? 'bg-[#141414] text-white shadow-lg' : 'text-[#141414]/50'}`}
              >
                Comandas
              </button>
            </div>

            <div className="grid grid-cols-5 gap-4">
              {[...currentList].sort((a, b) => a.id - b.id).map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setIsComandaSelected(selectionType === 'comandas');
                    setIsAddingItems(false);
                  }}
                  className={`aspect-square rounded-2xl border-2 flex flex-col items-center justify-center transition-all relative ${(() => {
                    const pc = getPizzeriaTableColor(item);
                    if (pc === 'green') return 'border-green-500 bg-green-500 text-white';
                    if (pc === 'yellow') return 'border-yellow-400 bg-yellow-400 text-[#141414]';
                    if (pc === 'orange') return 'border-orange-500 bg-orange-500 text-white';
                    if (pc === 'red') return 'border-red-500 bg-red-500 text-white';
                    if (item.status === 'free') return 'border-[#141414]/10 bg-white';
                    if (item.status === 'linked') return 'border-blue-500 bg-blue-50 text-blue-700';
                    return 'border-[#141414] bg-[#141414] text-[#E4E3E0]';
                  })()}`}
                >
                  {item.status === 'linked' && (
                    <div className="absolute top-2 right-2">
                      <Link size={12} />
                    </div>
                  )}
                  <span className="text-[10px] uppercase opacity-50">{selectionType === 'tables' ? 'Mesa' : 'Comanda'}</span>
                  <div className="flex items-center space-x-1">
                    <span className="text-2xl font-bold">{item.id}</span>
                    {item.status === 'linked' && (
                      <span className="text-[10px] font-bold">→ {item.linkedTo}</span>
                    )}
                  </div>
                  {item.status !== 'free' && (() => {
                    const mins = getInactivityMinutes(item);
                    if (mins === null) return null;
                    return (
                      <div className={`flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full ${
                        mins >= (pizzariaConfig?.inactivityMinutes ?? 30)
                          ? 'bg-amber-500 text-white animate-pulse'
                          : 'text-[#141414]/40'
                      }`}>
                        <Clock size={mins >= (pizzariaConfig?.inactivityMinutes ?? 30) ? 11 : 9} />
                        <span className={`font-bold ${mins >= (pizzariaConfig?.inactivityMinutes ?? 30) ? 'text-[11px]' : 'text-[9px]'}`}>{formatInactivity(mins)}</span>
                      </div>
                    );
                  })()}
                </button>
              ))}
            </div>
          </div>
        ) : !isAddingItems ? (
          /* ── TABLE OVERVIEW: shows order (if occupied) or empty state (if free) + "Adicionar Item" button ── */
          <div className="flex flex-col flex-1 min-h-0 space-y-4">
            <div className="flex items-center justify-between">
              <button onClick={() => { setSelectedId(null); setIsComandaSelected(false); }} className="flex items-center gap-1 bg-[#141414] text-[#E4E3E0] px-4 py-2.5 rounded-xl font-bold text-sm">
                <ChevronLeft size={18} /> Voltar
              </button>
              <h2 className="font-serif italic text-2xl">{isComandaSelected ? 'Comanda' : 'Mesa'} {selectedId}</h2>
              <div className="flex flex-col items-end space-y-1">
                <span className={`text-[9px] uppercase font-bold px-2 py-1 rounded-full ${
                  tableData?.status === 'free' ? 'bg-gray-100 text-gray-500'
                  : tableData?.status === 'aguardando_baixa' ? 'bg-purple-100 text-purple-700 animate-pulse'
                  : 'bg-amber-100 text-amber-700'
                }`}>
                  {tableData?.status === 'free' ? 'Livre'
                    : tableData?.status === 'aguardando_baixa' ? 'Ag. Baixa no Caixa'
                    : 'Ocupada'}
                </span>
                {tableData && (() => {
                  const mins = getInactivityMinutes(tableData);
                  if (mins === null) return null;
                  return (
                    <div className={`flex items-center space-x-1 ${mins >= (pizzariaConfig?.inactivityMinutes ?? 30) ? 'text-amber-500' : 'text-[#141414]/30'}`}>
                      <Clock size={10} />
                      <span className="text-[9px] font-bold">{formatInactivity(mins)} sem pedido</span>
                    </div>
                  );
                })()}
              </div>
            </div>

            {tableData?.status !== 'free' && currentOrder ? (
              <>
                <div className="flex-1 overflow-y-auto min-h-0 bg-white rounded-2xl border border-[#141414]/10 p-4 space-y-4">
                  <h3 className="font-bold text-base border-b pb-2">Pedidos em Aberto</h3>
                  <div className="space-y-3">
                    {currentOrder.items.map((item) => {
                      const kdsEnabled = pizzariaConfig?.kdsEnabled ?? true;
                      const pendingDelivery = !item.removed && !item.paid && !item.deliveredAt &&
                        (item.type === 'pizzas' || item.type === 'lanches') &&
                        (kdsEnabled ? (item as any).kitchenStatus === 'ready' : true);
                      return (
                      <div key={item.id} className={`flex justify-between items-start text-sm rounded-xl transition-colors ${item.removed ? 'opacity-40' : ''} ${item.paid ? 'bg-green-50 p-3 border border-green-100' : ''} ${pendingDelivery ? 'bg-green-50 p-3 border-2 border-green-400' : (item as any).kitchenStatus === 'preparing' ? 'bg-amber-50 p-3 border border-amber-200' : ''}`}>
                        <div className="flex-1 pr-4">
                          <div className="flex items-center space-x-2">
                            <p className={`font-medium ${item.removed ? 'line-through' : ''} ${item.paid ? 'text-green-700 font-bold' : ''}`}>
                              {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                            </p>
                            {!item.removed && !item.paid && (item.type === 'pizzas' || item.type === 'lanches') && (
                              item.deliveredAt ? (
                                <span className="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ml-1 shrink-0">
                                  ✓ Entregue{(item as any).deliveredBy ? ` · ${(item as any).deliveredBy}` : ''}
                                </span>
                              ) : !(pizzariaConfig?.kdsEnabled ?? true) ? (
                                <OrderTimer timestamp={item.timestamp} />
                              ) : (item as any).kitchenStatus === 'ready' ? (
                                <span className="text-[9px] bg-green-600 text-white px-2 py-0.5 rounded-full font-bold animate-pulse ml-1 shrink-0">
                                  ✓ Pronto — Retirar
                                </span>
                              ) : (item as any).kitchenStatus === 'preparing' ? (
                                <span className="text-[9px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold ml-1 shrink-0">
                                  Em preparo...
                                </span>
                              ) : (
                                <span className="text-[9px] bg-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full font-bold ml-1 shrink-0">
                                  Na fila
                                </span>
                              )
                            )}
                            {item.paid && <span className="text-[8px] bg-green-600 text-white px-1 rounded uppercase font-bold">pago</span>}
                          </div>
                          <div className="flex flex-wrap gap-x-2 text-[10px] opacity-70 font-medium mt-1">
                            {item.type === 'pizzas' ? (
                              item.observations && <span className="uppercase font-bold text-blue-700 italic">{item.observations}</span>
                            ) : (
                              <>
                                {item.ingredients && <span className="uppercase font-bold text-[#141414] opacity-60">{item.ingredients}</span>}
                                <span>{item.flavors.join(' / ')}</span>
                              </>
                            )}
                            <span>•</span>
                            <span>Garçom: {item.waiterName || 'Desconhecido'}</span>
                          </div>
                          {item.removed && (
                            <p className="text-[10px] text-red-600 font-bold mt-1">
                              Removido por: {item.removedBy}
                              {item.removalReason && <span className="block italic opacity-90 font-bold">Motivo: {item.removalReason}</span>}
                            </p>
                          )}
                          {pendingDelivery && (
                            <button
                              onClick={() => socket.emit('deliver_item', { orderId: currentOrder?.id, itemId: item.id })}
                              className="mt-2 w-full flex items-center justify-center gap-2 bg-orange-500 active:bg-orange-600 text-white py-2 rounded-xl font-bold text-xs uppercase tracking-wide active:scale-95 transition-transform"
                            >
                              <span className="w-2 h-2 bg-white rounded-full animate-pulse shrink-0" />
                              Confirmar Entrega
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col items-end space-y-1">
                          <span className={`font-mono font-bold ${item.removed ? 'line-through' : ''} ${item.paid ? 'text-green-700' : ''}`}>
                            R$ {item.price.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      );
                    })}
                    {currentOrder.observations && (
                      <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                        <p className="text-[10px] uppercase font-bold text-blue-800 opacity-50 mb-1">Observações Gerais</p>
                        <p className="text-xs text-blue-700 italic">{currentOrder.observations}</p>
                      </div>
                    )}
                    {currentOrder.items.length === 0 && (
                      <p className="text-center py-10 opacity-30 italic text-sm">Nenhum item registrado.</p>
                    )}
                  </div>
                </div>

                <div className="bg-[#141414] text-[#E4E3E0] p-5 rounded-2xl space-y-2 shadow-xl shrink-0">
                  <div className="flex justify-between items-center opacity-50 text-[10px] font-bold uppercase tracking-widest">
                    <span>Total Consumido</span>
                    <span>R$ {(currentOrder.items || []).filter(i => !i.removed).reduce((acc, i) => acc + i.price, 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-green-400 text-[10px] font-bold uppercase tracking-widest">
                    <span>Já Pago</span>
                    <span>- R$ {(currentOrder.paymentLog || []).reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0).toFixed(2)}</span>
                  </div>
                  <div className="pt-2 border-t border-white/10 flex justify-between items-center">
                    <span className="font-bold uppercase text-[10px] tracking-widest opacity-50">Restante a Pagar</span>
                    <span className="text-2xl font-bold text-white">R$ {(() => {
                      const itemsTotal = (currentOrder.items || []).filter(i => !i.removed).reduce((acc, i) => {
                        let price = i.price;
                        if (i.discount) {
                          if (i.discountType === 'percentage') price *= (1 - i.discount / 100);
                          else price = Math.max(0, price - i.discount);
                        }
                        return acc + price;
                      }, 0);
                      let finalTotal = itemsTotal;
                      if (currentOrder.discount) {
                        if (currentOrder.discountType === 'percentage') finalTotal *= (1 - currentOrder.discount / 100);
                        else finalTotal = Math.max(0, finalTotal - currentOrder.discount);
                      }
                      const paid = (currentOrder.paymentLog || []).reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);
                      return Math.max(0, finalTotal - paid).toFixed(2);
                    })()}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <div className="w-16 h-16 rounded-full border-2 border-[#141414]/10 flex items-center justify-center mx-auto">
                    <Pizza size={28} className="opacity-20" />
                  </div>
                  <p className="text-sm font-bold opacity-30 uppercase tracking-widest">Mesa Livre</p>
                  <p className="text-xs opacity-20 italic">Nenhum pedido em aberto</p>
                </div>
              </div>
            )}

            {tableData?.status === 'aguardando_baixa' && (
              <div className="shrink-0 bg-purple-50 border-2 border-purple-300 rounded-2xl p-4 text-center space-y-1">
                <p className="text-purple-700 font-black text-sm uppercase tracking-wide">Aguardando Baixa no Caixa</p>
                <p className="text-purple-500 text-xs">Pagamento registrado. O caixa precisa dar baixa para liberar a mesa.</p>
              </div>
            )}

            {tableData?.status === 'free' ? (
              <button
                onClick={() => setIsAddingItems(true)}
                disabled={!isCashRegisterOpen}
                className="w-full py-5 bg-[#141414] text-[#E4E3E0] rounded-3xl font-bold text-base flex items-center justify-center space-x-2 active:scale-95 transition-transform disabled:opacity-40 shrink-0"
              >
                <Plus size={20} />
                <span>Iniciar Nova Comanda</span>
              </button>
            ) : tableData?.status === 'aguardando_baixa' ? null : (
              <div className="flex space-x-3 shrink-0">
                <button
                  onClick={() => setIsAddingItems(true)}
                  disabled={!isCashRegisterOpen}
                  className="flex-1 py-5 bg-[#141414] text-[#E4E3E0] rounded-3xl font-bold text-base flex items-center justify-center space-x-2 active:scale-95 transition-transform disabled:opacity-40"
                >
                  <Plus size={20} />
                  <span>Adicionar Item</span>
                </button>
                {(pizzariaConfig?.waiterCanPay ?? true) && (
                  <button
                    onClick={() => setIsPaymentModalOpen(true)}
                    disabled={!currentOrder || pendingAmount <= 0.01}
                    className="flex-1 py-5 bg-[#141414] rounded-3xl font-bold text-base flex items-center justify-center space-x-2 active:scale-95 transition-transform disabled:opacity-40"
                  >
                    <Wallet size={20} className="text-green-400" />
                    <span className="text-green-400">Pagar</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ── ITEM SELECTION ── */
          <div className="flex flex-col flex-1 min-h-0 space-y-4">
            <div className="flex items-center justify-between">
              <button onClick={() => { setIsAddingItems(false); setCart([]); }} className="flex items-center gap-1 bg-[#141414] text-[#E4E3E0] px-4 py-2.5 rounded-xl font-bold text-sm">
                <ChevronLeft size={18} /> Voltar
              </button>
              <h2 className="font-serif italic text-2xl">{isComandaSelected ? 'Comanda' : 'Mesa'} {selectedId}</h2>
              <div className="w-10" />
            </div>

            {false && cart.length > 0 && (
              <div className="max-h-32 overflow-y-auto min-h-0 bg-amber-50 rounded-xl border border-amber-200 p-3 shrink-0">
                <p className="text-[9px] font-bold uppercase text-amber-600 mb-2">Itens a Enviar · {cart.length}</p>
                <div className="space-y-1.5">
                  {cart.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-[10px]">
                      <span className="flex-1 pr-2 font-medium">
                        {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-bold">R$ {item.price.toFixed(2)}</span>
                        <button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 transition-colors">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex space-x-2 shrink-0">
              {[
                { id: 'pizzas', label: 'Pizzas', icon: Pizza },
                { id: 'lanches', label: 'Lanches', icon: Sandwich },
                { id: 'bebidas', label: 'Bebidas', icon: Beer }
              ].map(type => (
                <button
                  key={type.id}
                  onClick={() => {
                    setActiveType(type.id as any);
                    setSelectedFlavors([]);
                  }}
                  className={`flex-1 rounded-2xl text-[10px] font-bold uppercase transition-all border-2 flex items-center justify-center gap-1.5 ${
                    cart.length > 0 ? 'py-2' : 'py-3 flex-col space-y-1'
                  } ${
                    activeType === type.id ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'bg-white border-[#141414]/10'
                  }`}
                >
                  <type.icon size={cart.length > 0 ? 13 : 16} />
                  <span>{type.label}</span>
                </button>
              ))}
            </div>

            <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
              {filteredCategories.map(cat => {
                const displayName = cat.name;
                return (
                  <button
                    key={cat.name}
                    onClick={() => setActiveCategory(cat.name)}
                    className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors ${
                      activeCategory === cat.name ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-white border border-[#141414]/10'
                    }`}
                  >
                    {displayName}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 grid grid-cols-1 gap-3 pb-2">
              {menu.find(c => c.name === activeCategory)?.items?.map(pizza => {
                return (
                  <button
                    key={pizza.id}
                    onClick={() => addToCart(pizza)}
                    className="bg-white p-4 rounded-2xl border border-[#141414]/10 transition-all flex justify-between items-center active:scale-95"
                  >
                    <div className="text-left">
                      <p className="font-bold">{pizza.name}</p>
                      <p className="text-[10px] opacity-50 mb-1">{pizza.ingredients}</p>
                      <p className="text-xs font-bold">R$ {pizza.price.toFixed(2)}</p>
                    </div>
                    <Plus className="opacity-30" />
                  </button>
                );
              })}
            </div>

            {/* Cart bar — inline, no overlap */}
            <AnimatePresence>
              {cart.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  className="shrink-0 bg-white border-t-2 border-[#141414] rounded-2xl shadow-lg"
                >
                  <div className="p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-2">
                        <ShoppingBasket size={16} />
                        <span className="font-bold text-sm">{cart.reduce((acc, i) => acc + (i.quantity || 1), 0)} {cart.reduce((acc, i) => acc + (i.quantity || 1), 0) === 1 ? 'item' : 'itens'}</span>
                        {cartObservations && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">Com Obs</span>
                        )}
                      </div>
                      <button
                        onClick={() => setIsCartPopupOpen(true)}
                        className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-black text-sm px-4 py-1.5 rounded-xl transition-all shadow-md"
                      >
                        Ver Itens
                      </button>
                      <span className="text-xl font-bold">R$ {cart.reduce((acc, i) => acc + i.price, 0).toFixed(2)}</span>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setIsObservationModalOpen(true)}
                        className="px-4 py-2.5 bg-gray-100 text-[#141414] rounded-2xl font-bold text-xs flex items-center justify-center hover:bg-gray-200 transition-colors"
                      >
                        Observação
                      </button>
                      <button
                        onClick={submitOrder}
                        className="flex-1 bg-[#141414] text-[#E4E3E0] py-2.5 rounded-2xl font-bold text-base flex items-center justify-center active:scale-95 transition-transform"
                      >
                        Enviar Pedido <Send size={16} className="ml-2" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>

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
                  <div className="grid grid-cols-1 gap-3">
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
                            }
                          }}
                          className={`flex flex-col p-4 rounded-xl border transition-all text-left ${
                            isSelected 
                              ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' 
                              : 'border-[#141414]/10 hover:bg-white'
                          }`}
                        >
                          <p className="font-bold text-sm">{flavor.name}</p>
                          <p className={`text-[10px] uppercase ${isSelected ? 'opacity-70' : 'opacity-50'}`}>
                            {flavor.ingredients}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-3">
                      {pizzaCrusts.map((crust, idx) => {
                        const isSelected = selectedCrust === crust;
                        return (
                          <button 
                            key={idx}
                            onClick={() => setSelectedCrust(isSelected ? null : crust)}
                            className={`p-4 rounded-xl border transition-all text-left font-bold ${
                              isSelected 
                                ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' 
                                : 'border-[#141414]/10 hover:bg-white'
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
                        setSelectedQuantityItem(null);
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


      {/* Cart Popup */}
      <AnimatePresence>
        {isCartPopupOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setIsCartPopupOpen(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-3xl shadow-2xl border-2 border-[#141414] overflow-hidden"
            >
              <div className="bg-[#141414] px-5 py-4 flex items-center gap-3">
                <button
                  onClick={() => setIsCartPopupOpen(false)}
                  className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 active:scale-95 text-white font-black text-sm px-4 py-2 rounded-xl transition-all"
                >
                  <ChevronLeft size={16} /> Voltar
                </button>
                <h3 className="font-serif italic text-xl text-white flex-1 text-center pr-16">Itens a Enviar</h3>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {cart.map((item, idx) => (
                  <div key={idx} className={`flex justify-between items-center px-5 py-3 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <span className="flex-1 pr-3 font-medium text-sm">
                      {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono font-bold text-sm">R$ {item.price.toFixed(2)}</span>
                      <button
                        onClick={() => { setCart(cart.filter((_, i) => i !== idx)); if (cart.length === 1) setIsCartPopupOpen(false); }}
                        className="text-red-400 hover:text-red-600 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-4 border-t-2 border-[#141414]/10 flex justify-between items-center bg-gray-50">
                <span className="text-xs font-bold uppercase tracking-widest opacity-50">Total</span>
                <span className="text-2xl font-bold">R$ {cart.reduce((acc, i) => acc + i.price, 0).toFixed(2)}</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Observation Modal */}
      <AnimatePresence>
        {isObservationModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4"
            >
              <div className="flex justify-between items-center">
                <h3 className="font-serif italic text-xl">Adicionar Observação</h3>
                <button onClick={() => setIsObservationModalOpen(false)} className="opacity-50">
                  <X size={20} />
                </button>
              </div>
              <textarea 
                value={cartObservations}
                onChange={(e) => setCartObservations(e.target.value)}
                placeholder="Ex: Sem cebola, bem passado..."
                className="w-full h-32 p-4 bg-gray-50 border border-[#141414]/10 rounded-2xl focus:outline-none focus:border-[#141414] transition-colors text-sm resize-none"
                autoFocus
              />
              <div className="flex space-x-2">
                <button 
                  onClick={() => {
                    setCartObservations('');
                    setIsObservationModalOpen(false);
                  }}
                  className="flex-1 py-3 rounded-xl font-bold text-sm border border-[#141414]/10"
                >
                  Limpar
                </button>
                <button 
                  onClick={() => setIsObservationModalOpen(false)}
                  className="flex-1 bg-[#141414] text-[#E4E3E0] py-3 rounded-xl font-bold text-sm"
                >
                  OK
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payment Modal */}
      {currentOrder && (
        <PaymentModal 
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          order={currentOrder}
          onPaymentComplete={handlePaymentComplete}
          onApplyDiscount={handleApplyDiscount}
        />
      )}
    </div>
  );
}
