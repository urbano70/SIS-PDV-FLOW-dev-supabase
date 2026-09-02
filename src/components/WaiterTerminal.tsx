import React, { useState, useEffect, useRef } from 'react';
import { Table, PizzaItem, Order, MenuCategory, MenuSubcategory, PizzeriaConfig } from '../types';
import socket from '../lib/socket';
import { Plus, Send, ShoppingBasket, ChevronLeft, ChevronRight, X, Pizza, Sandwich, Beer, Wallet, Link, Clock, AlertCircle, Download, Users, UserPlus } from 'lucide-react';
import { usePWA } from '../hooks/usePWA';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
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
  shiftStartedAt?: string;
  clockOffset?: number;
}

export default function WaiterTerminal({ tables, comandas, orders, menu, pizzaFlavors, pizzaCrusts, isCashRegisterOpen, printerConfig, pizzariaConfig, shiftStartedAt, clockOffset = 0 }: WaiterTerminalProps) {
  const { canInstall, install } = usePWA('waiter');

  // Client-side first-seen tracking — avoids relying on potentially stale DB timestamps.
  // Key = item.id, value = ms when THIS client first received the item.
  // Key = "order:<orderId>", value = ms when this client first received ANY item for that order.
  const firstSeenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const now = Date.now();
    orders.forEach((o: any) => {
      const orderKey = `order:${o.id}`;
      (o.items || []).forEach((item: any) => {
        const itemKey = String(item.id);
        if (itemKey && !firstSeenRef.current.has(itemKey)) {
          firstSeenRef.current.set(itemKey, now);
          // Mark order as active from the first time we see any of its items
          if (!firstSeenRef.current.has(orderKey)) {
            firstSeenRef.current.set(orderKey, now);
          }
        }
      });
    });
  }, [orders]);

  const [selectionType, setSelectionType] = useState<'tables' | 'comandas'>('tables');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isComandaSelected, setIsComandaSelected] = useState(false);
  const [cart, setCart] = useState<PizzaItem[]>([]);
  const [activeCategory, setActiveCategory] = useState(() => menu.find(c => c.visible !== false)?.name || menu[0]?.name || '');
  const [activeSubcategoryId, setActiveSubcategoryId] = useState<string | null>(null);
  const [isAddingItems, setIsAddingItems] = useState(false);
  const [isObservationModalOpen, setIsObservationModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [cartObservations, setCartObservations] = useState('');

  const [isCartExpanded, setIsCartExpanded] = useState(false);
  const [isCartPopupOpen, setIsCartPopupOpen] = useState(false);

  const maxTables = pizzariaConfig?.numTables ?? 40;
  const comandasEnabled = pizzariaConfig?.comandasEnabled ?? false;
  const visibleTables = [...tables].filter(t => t.id <= maxTables).sort((a, b) => a.id - b.id);
  const visibleComandas = [...comandas].sort((a, b) => a.id - b.id);

  const currentList = selectionType === 'tables' ? visibleTables : visibleComandas;
  const tableData = currentList.find(t => selectedId && t.id && String(t.id) === String(selectedId));
  const currentOrder = orders.find(o => tableData?.currentOrder && o.id && String(o.id) === String(tableData.currentOrder));

  const visibleCategories = menu.filter(cat => cat.visible !== false);
  const selectedCat = visibleCategories.find(c => c.name === activeCategory) || visibleCategories[0];
  const filteredSubcategories = (selectedCat?.subcategories || []).filter(s => s.visible !== false);

  const [, forceInactivityUpdate] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceInactivityUpdate(n => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const [, setPizzeriaColorTick] = useState(0);
  useEffect(() => {
    if (!pizzariaConfig?.enabled) return;
    const id = setInterval(() => setPizzeriaColorTick(n => n + 1), 1_000);
    return () => clearInterval(id);
  }, [pizzariaConfig?.enabled]);

  const itemShouldTrackTime = (item: any): boolean => {
    if (item.type === 'pizzas' || item.type === 'lanches') return true;
    const cat = menu.find((c: any) => {
      if (c.items?.some((i: any) => i.id === item.menuItemId || i.name === item.name)) return true;
      return (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.id === item.menuItemId || i.name === item.name));
    });
    if (!cat) return false;
    if (cat.trackTime) return true;
    const sub = (cat.subcategories || []).find((s: any) => s.items?.some((i: any) => i.id === item.menuItemId || i.name === item.name));
    return !!sub?.trackTime;
  };

  const getPizzeriaTableColor = (tableItem: Table): 'green' | 'yellow' | 'orange' | 'red' | null => {
    if (!pizzariaConfig?.enabled || tableItem.status === 'free') return null;
    const order = orders.find((o: any) =>
      tableItem.currentOrder && String(o.id) === String(tableItem.currentOrder) && o.status !== 'finalizada'
    );
    if (!order) return null;
    const pending = (order.items || []).filter(
      (i: any) => !i.removed && !i.paid && !i.deliveredAt && itemShouldTrackTime(i)
    );
    if (pending.length === 0) return null;
    const now = Date.now() - clockOffset;
    const shiftMs = shiftStartedAt ? new Date(shiftStartedAt).getTime() : 0;
    let oldest = Infinity;
    for (const i of pending) {
      const rawMs = i.timestamp ? new Date(i.timestamp).getTime() : 0;
      if (rawMs === 0) continue; // sem timestamp = sem contagem
      const startMs = shiftMs > 0 ? Math.max(rawMs, shiftMs) : rawMs;
      if (startMs < oldest) oldest = startMs;
    }
    if (!isFinite(oldest)) return 'green'; // sem timestamps válidos = verde (recém-iniciado)
    const elapsed = (now - oldest) / 60000;
    if (elapsed >= pizzariaConfig.redMinutes) return 'red';
    if (elapsed >= pizzariaConfig.orangeMinutes) return 'orange';
    if (elapsed >= pizzariaConfig.yellowMinutes) return 'yellow';
    return 'green';
  };

  const getInactivityMinutes = (tableItem: Table): number | null => {
    if (!pizzariaConfig?.enabled) return null;
    if (!isCashRegisterOpen) return null;
    if (tableItem.status === 'free' || !tableItem.currentOrder) return null;
    const order = orders.find(o => String(o.id) === String(tableItem.currentOrder));
    if (!order) return null;
    const activeItems = (order.items || []).filter((i: any) => !i.removed);
    if (activeItems.length === 0) return null;
    // Only count items added in the current shift. No timestamp = no timer.
    const shiftMs = shiftStartedAt ? new Date(shiftStartedAt).getTime() : 0;
    let latestMs = 0;
    for (const item of activeItems) {
      const ts = item.timestamp ? new Date(item.timestamp).getTime() : 0;
      if (ts > 0 && (shiftMs === 0 || ts >= shiftMs) && ts > latestMs) latestMs = ts;
    }
    if (latestMs === 0) return null;
    return Math.floor(((Date.now() - clockOffset) - latestMs) / 60_000);
  };

  const formatInactivity = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };
  
  // Sync guests from current order (clear when switching to a table with no guests)
  useEffect(() => {
    setGuestList(currentOrder?.guests ?? []);
  }, [currentOrder?.id]);

  // Keep activeCategory valid when menu changes
  useEffect(() => {
    const visible = menu.filter(c => c.visible !== false);
    if (visible.length > 0 && !visible.find(c => c.name === activeCategory)) {
      setActiveCategory(visible[0].name);
      setActiveSubcategoryId(null);
    }
  }, [menu]);
  
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

  // Guest mode state
  const [guestModeActive, setGuestModeActive] = useState(false);
  const [guestList, setGuestList] = useState<string[]>([]);
  const [newGuestName, setNewGuestName] = useState('');
  const [selectedGuestForItem, setSelectedGuestForItem] = useState<string>('');
  const [guestFilterForPayment, setGuestFilterForPayment] = useState<string>('');
  // Inline new guest input inside item modals
  const [modalNewGuest, setModalNewGuest] = useState('');
  // Item-level guest assignment (for already-added items)
  const [assigningGuestToItemId, setAssigningGuestToItemId] = useState<string | null>(null);
  const [assignGuestInput, setAssignGuestInput] = useState('');

  const addGuestToList = (name: string, orderId?: number | string) => {
    const trimmed = name.trim();
    if (!trimmed || guestList.includes(trimmed)) return trimmed ? trimmed : null;
    const updated = [...guestList, trimmed];
    setGuestList(updated);
    if (orderId) socket.emit('set_order_guests', { orderId, guests: updated });
    else if (currentOrder) socket.emit('set_order_guests', { orderId: currentOrder.id, guests: updated });
    return trimmed;
  };

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
    const isSnackOrDrink = !isPizza;

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
      ingredients: pizza.ingredients,
      guestName: guestModeActive && pizza.guestName ? pizza.guestName : undefined,
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
      quantity: itemQuantity,
      guestName: guestModeActive && selectedGuestForItem ? selectedGuestForItem : undefined,
    };

    addToCart(itemToAdd);
    setIsQuantityModalOpen(false);
    setSelectedQuantityItem(null);
    setSelectedGuestForItem('');
    setModalNewGuest('');
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
      observations: pizzaObservations,
      guestName: guestModeActive && selectedGuestForItem ? selectedGuestForItem : undefined,
    };

    addToCart(itemWithDetails);
    setSelectedGuestForItem('');
    setModalNewGuest('');
  };

  const submitOrder = async () => {
    if (!isCashRegisterOpen) {
      toast.error('O caixa está fechado. Peça ao gerente para abrir o caixa.');
      return;
    }
    const selectedItem = (isComandaSelected ? comandas : tables).find(t => t.id === selectedId);
    if (selectedItem?.status === 'aguardando_baixa') {
      toast.error('Esta mesa está aguardando baixa. O gerente precisa liberar antes de adicionar itens.');
      return;
    }
    if (selectedId === null || cart.length === 0) return;
    
    let waiterName = '';
    try {
      const saved = localStorage.getItem('waiter_credentials');
      if (saved) waiterName = JSON.parse(saved).name || '';
    } catch {}
    if (!waiterName) waiterName = 'Garçom';

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
        observations: cartObservations.trim(),
        waiterName,
        guests: guestModeActive && guestList.length > 0 ? guestList : undefined,
      });
    }
    if (guestModeActive && guestList.length > 0 && activeOrder) {
      socket.emit('set_order_guests', { orderId: activeOrder.id, guests: guestList });
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
        <div className="flex items-center space-x-3">
          {canInstall && (
            <button
              onClick={install}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg transition-colors"
              title="Instalar app na tela inicial"
            >
              <Download size={12} />
              Instalar app
            </button>
          )}
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[10px] uppercase tracking-widest font-bold">Online</span>
          </div>
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

      <main className="flex-1 overflow-hidden p-3 flex flex-col min-h-0">
        {selectedId === null ? (
          <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
            <div className="flex bg-white p-1 rounded-2xl border border-[#141414]/10">
              <button
                onClick={() => setSelectionType('tables')}
                className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all ${selectionType === 'tables' ? 'bg-[#141414] text-white shadow-lg' : 'text-[#141414]/50'}`}
              >
                Mesas ({visibleTables.length})
              </button>
              {comandasEnabled && (
                <button
                  onClick={() => setSelectionType('comandas')}
                  className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all ${selectionType === 'comandas' ? 'bg-[#141414] text-white shadow-lg' : 'text-[#141414]/50'}`}
                >
                  Comandas
                </button>
              )}
            </div>

            <div className="grid grid-cols-5 gap-4">
              {currentList.map(item => (
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
                    if (item.status === 'aguardando_baixa') return 'border-purple-500 bg-gradient-to-b from-purple-500 to-purple-600 text-white animate-pulse';
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
                          : 'opacity-40'
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
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between shrink-0 mb-3">
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

            {/* Guest Mode Section */}
            <div className="mb-3 shrink-0">
              <button
                onClick={() => setGuestModeActive(v => !v)}
                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border-2 font-bold text-sm transition-all ${
                  guestModeActive
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-[#141414]/15 text-[#141414]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Users size={16} />
                  <span>Modo Convidados</span>
                  {guestModeActive && guestList.length > 0 && (
                    <span className="bg-white/25 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{guestList.length}</span>
                  )}
                </div>
                <span className="text-[10px] uppercase opacity-60">{guestModeActive ? 'Ativo' : 'Inativo'}</span>
              </button>
              {guestModeActive && (
                <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {guestList.map(g => (
                      <span key={g} className="flex items-center gap-1 bg-indigo-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                        {g}
                        <button onClick={() => setGuestList(prev => prev.filter(x => x !== g))} className="opacity-70 hover:opacity-100">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                    {guestList.length === 0 && (
                      <p className="text-xs text-indigo-500 italic">Nenhum convidado adicionado.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newGuestName}
                      onChange={e => setNewGuestName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newGuestName.trim()) {
                          const name = newGuestName.trim();
                          if (!guestList.includes(name)) {
                            const updated = [...guestList, name];
                            setGuestList(updated);
                            if (currentOrder) socket.emit('set_order_guests', { orderId: currentOrder.id, guests: updated });
                          }
                          setNewGuestName('');
                        }
                      }}
                      placeholder="Nome do convidado..."
                      className="flex-1 text-sm px-3 py-2 border border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={() => {
                        const name = newGuestName.trim();
                        if (name && !guestList.includes(name)) {
                          const updated = [...guestList, name];
                          setGuestList(updated);
                          if (currentOrder) socket.emit('set_order_guests', { orderId: currentOrder.id, guests: updated });
                        }
                        setNewGuestName('');
                      }}
                      className="bg-indigo-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-indigo-700 transition-colors"
                    >
                      <UserPlus size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto min-h-0">
            {tableData?.status !== 'free' && currentOrder ? (
              <div className="bg-white rounded-2xl border border-[#141414]/10 p-4 space-y-4">
                  <h3 className="font-bold text-base border-b pb-2">Pedidos em Aberto</h3>
                  <div className="space-y-3">
                    {currentOrder.items.map((item) => {
                      const kdsEnabled = pizzariaConfig?.kdsEnabled ?? false;
                      const pendingDelivery = !item.removed && !item.paid && !item.deliveredAt &&
                        itemShouldTrackTime(item) &&
                        (kdsEnabled ? (item as any).kitchenStatus === 'ready' : true);
                      return (
                      <div key={item.id} className={`flex justify-between items-start text-sm rounded-xl transition-colors ${item.removed ? 'opacity-40' : ''} ${item.paid ? 'bg-green-50 p-3 border border-green-100' : ''} ${pendingDelivery ? 'bg-green-50 p-3 border-2 border-green-400' : (item as any).kitchenStatus === 'preparing' ? 'bg-amber-50 p-3 border border-amber-200' : ''}`}>
                        <div className="flex-1 pr-4">
                          <div className="flex items-center space-x-2">
                            <p className={`font-medium ${item.removed ? 'line-through' : ''} ${item.paid ? 'text-green-700 font-bold' : ''}`}>
                              {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                            </p>
                            {!item.removed && !item.paid && itemShouldTrackTime(item) && (
                              item.deliveredAt ? (
                                <span className="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ml-1 shrink-0">
                                  ✓ Entregue{(item as any).deliveredBy ? ` · ${(item as any).deliveredBy}` : ''}
                                </span>
                              ) : (
                                <>
                                  {item.timestamp && <OrderTimer timestamp={item.timestamp} clockOffset={clockOffset} />}
                                  {(pizzariaConfig?.kdsEnabled ?? false) && (
                                    (item as any).kitchenStatus === 'ready' ? (
                                      <span className="text-[9px] bg-green-600 text-white px-2 py-0.5 rounded-full font-bold animate-pulse ml-1 shrink-0">
                                        ✓ Pronto — Retirar
                                      </span>
                                    ) : (item as any).kitchenStatus === 'oven' ? (
                                      <span className="text-[9px] bg-orange-600 text-white px-2 py-0.5 rounded-full font-bold ml-1 shrink-0">
                                        No Forno...
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
                                </>
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
                            {!item.removed && !item.paid && guestModeActive && (
                              assigningGuestToItemId === item.id ? (
                                <div className="flex items-center gap-1 ml-1" onClick={e => e.stopPropagation()}>
                                  <select
                                    autoFocus
                                    value={assignGuestInput}
                                    onChange={e => setAssignGuestInput(e.target.value)}
                                    className="text-[10px] border border-indigo-300 rounded px-1 py-0.5 bg-white text-indigo-700 font-bold focus:outline-none"
                                  >
                                    <option value="">Nenhum</option>
                                    {guestList.map(g => <option key={g} value={g}>{g}</option>)}
                                    <option value="__new__">+ Novo...</option>
                                  </select>
                                  {assignGuestInput === '__new__' ? (
                                    <input
                                      autoFocus
                                      placeholder="Nome..."
                                      className="text-[10px] border border-indigo-300 rounded px-1 py-0.5 w-20 focus:outline-none"
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                          const val = (e.target as HTMLInputElement).value.trim();
                                          if (val) {
                                            addGuestToList(val);
                                            socket.emit('set_item_guest', { orderId: currentOrder!.id, itemId: item.id, guestName: val });
                                          }
                                          setAssigningGuestToItemId(null);
                                          setAssignGuestInput('');
                                        }
                                      }}
                                    />
                                  ) : (
                                    <button
                                      onClick={() => {
                                        socket.emit('set_item_guest', { orderId: currentOrder!.id, itemId: item.id, guestName: assignGuestInput || null });
                                        setAssigningGuestToItemId(null);
                                        setAssignGuestInput('');
                                      }}
                                      className="text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-bold"
                                    >
                                      OK
                                    </button>
                                  )}
                                  <button onClick={() => { setAssigningGuestToItemId(null); setAssignGuestInput(''); }} className="text-red-400"><X size={10} /></button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setAssigningGuestToItemId(item.id); setAssignGuestInput((item as any).guestName || ''); }}
                                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-bold text-[9px] ml-1 transition-colors ${(item as any).guestName ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600'}`}
                                >
                                  <Users size={8} />
                                  {(item as any).guestName || 'Vincular'}
                                </button>
                              )
                            )}
                            {(item.removed || item.paid) && (item as any).guestName && (
                              <span className="flex items-center gap-0.5 bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-bold text-[9px] ml-1">
                                <Users size={8} />{(item as any).guestName}
                              </span>
                            )}
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
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full border-2 border-[#141414]/10 flex items-center justify-center mx-auto mb-3">
                  <Pizza size={28} className="opacity-20" />
                </div>
                <p className="text-sm font-bold opacity-30 uppercase tracking-widest">Mesa Livre</p>
                <p className="text-xs opacity-20 italic">Nenhum pedido em aberto</p>
              </div>
            )}

            {tableData?.status === 'aguardando_baixa' && (
              <div className="mt-3 bg-purple-50 border-2 border-purple-300 rounded-2xl p-4 text-center space-y-1">
                <p className="text-purple-700 font-black text-sm uppercase tracking-wide">Aguardando Baixa no Caixa</p>
                <p className="text-purple-500 text-xs">Pagamento registrado. O caixa precisa dar baixa para liberar a mesa.</p>
              </div>
            )}
            </div>{/* end scrollable content */}

            {/* Sticky footer — always visible */}
            <div className="shrink-0 pt-3 space-y-3">
              {tableData?.status !== 'free' && currentOrder && (
                <div className="bg-[#141414] text-[#E4E3E0] p-4 rounded-2xl space-y-2 shadow-xl">
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
              )}

              {tableData?.status === 'free' ? (
                <button
                  onClick={() => setIsAddingItems(true)}
                  disabled={!isCashRegisterOpen}
                  className="w-full py-5 bg-[#141414] text-[#E4E3E0] rounded-3xl font-bold text-base flex items-center justify-center space-x-2 active:scale-95 transition-transform disabled:opacity-40"
                >
                  <Plus size={20} />
                  <span>Iniciar Nova Comanda</span>
                </button>
              ) : tableData?.status === 'aguardando_baixa' ? null : (
                <div className="flex space-x-3">
                  <button
                    onClick={() => setIsAddingItems(true)}
                    disabled={!isCashRegisterOpen}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] rounded-3xl font-bold text-base flex items-center justify-center space-x-2 active:scale-95 transition-transform disabled:opacity-40"
                  >
                    <Plus size={20} />
                    <span>Adicionar Item</span>
                  </button>
                  {(pizzariaConfig?.waiterCanPay ?? true) && (
                    <button
                      onClick={() => setIsPaymentModalOpen(true)}
                      disabled={!currentOrder || pendingAmount <= 0.01}
                      className="flex-1 py-4 bg-[#141414] rounded-3xl font-bold text-base flex items-center justify-center space-x-2 active:scale-95 transition-transform disabled:opacity-40"
                    >
                      <Wallet size={20} className="text-green-400" />
                      <span className="text-green-400">Pagar</span>
                    </button>
                  )}
                </div>
              )}
            </div>{/* end sticky footer */}
          </div>
        ) : (
          /* ── ITEM SELECTION ── */
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            <div className="flex items-center justify-between shrink-0">
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

            {/* Dynamic category buttons — grid 4 por linha */}
            <div className="grid grid-cols-4 gap-2 shrink-0">
              {visibleCategories.map(cat => (
                <button
                  key={cat.name}
                  onClick={() => { setActiveCategory(cat.name); setActiveSubcategoryId(null); setSelectedFlavors([]); }}
                  className={`rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all border-2 px-2 py-3 text-center leading-tight min-h-[52px] flex items-center justify-center ${
                    selectedCat?.name === cat.name
                      ? 'bg-[#141414] text-[#E4E3E0] border-[#141414] shadow-md'
                      : 'bg-white border-[#141414]/20 text-[#141414] hover:border-[#141414]/50'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {/* Subcategory pills — sem "Todos" */}
            {filteredSubcategories.length > 0 && (
              <div className="flex flex-wrap gap-2 shrink-0">
                {filteredSubcategories.map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setActiveSubcategoryId(activeSubcategoryId === sub.id ? null : sub.id)}
                    className={`shrink-0 px-4 py-2 rounded-lg text-xs font-extrabold tracking-wide transition-colors ${
                      activeSubcategoryId === sub.id ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-white border-2 border-[#141414]/20 text-[#141414]'
                    }`}
                  >
                    {sub.name}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col pb-2 divide-y divide-[#141414]/8">
              {(() => {
                if (!selectedCat) return [] as any[];
                if (activeSubcategoryId) {
                  const sub = filteredSubcategories.find(s => s.id === activeSubcategoryId);
                  return (sub?.items || []).map((i: any) => ({ ...i, _fromSubcategory: true }));
                }
                const direct = (selectedCat.items || []) as any[];
                const subItems = filteredSubcategories.flatMap(s => s.items.map((i: any) => ({ ...i, _fromSubcategory: true })));
                return [...direct, ...subItems];
              })().map((item, idx) => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className={`w-full px-3 py-2 transition-all flex justify-between items-center active:scale-[0.99] ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-[#F5F4F1]'
                    }`}
                  >
                    <div className="text-left flex-1 min-w-0 mr-3">
                      <p className="font-extrabold text-lg leading-tight tracking-tight">{item.name}</p>
                      {item.ingredients && (
                        <p className="text-base opacity-55 leading-tight truncate">{item.ingredients}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-lg font-extrabold font-mono">R$ {item.price.toFixed(2)}</span>
                      <Plus size={18} className="opacity-40" />
                    </div>
                  </button>
                ))}
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
                        disabled={(isComandaSelected ? comandas : tables).find(t => t.id === selectedId)?.status === 'aguardando_baixa'}
                        className="flex-1 bg-[#141414] text-[#E4E3E0] py-2.5 rounded-2xl font-bold text-base flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
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
                        className="w-full h-24 p-4 bg-white border border-[#141414]/10 rounded-2xl focus:outline-none focus:border-[#141414] transition-colors text-sm resize-none"
                      />
                    </div>
                    {guestModeActive && (
                      <div className="space-y-2">
                        <label className="text-sm font-bold opacity-60 uppercase tracking-wider">Vincular a Convidado</label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setSelectedGuestForItem('')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${!selectedGuestForItem ? 'bg-[#141414] text-white border-[#141414]' : 'border-[#141414]/20 text-[#141414]'}`}
                          >
                            Nenhum
                          </button>
                          {guestList.map(g => (
                            <button
                              key={g}
                              onClick={() => setSelectedGuestForItem(g)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${selectedGuestForItem === g ? 'bg-indigo-600 text-white border-indigo-600' : 'border-indigo-200 text-indigo-700 bg-indigo-50'}`}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            value={modalNewGuest}
                            onChange={e => setModalNewGuest(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && modalNewGuest.trim()) {
                                const name = addGuestToList(modalNewGuest) || modalNewGuest.trim();
                                setSelectedGuestForItem(name);
                                setModalNewGuest('');
                              }
                            }}
                            placeholder="Novo convidado..."
                            className="flex-1 text-xs px-3 py-2 border border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-indigo-50"
                          />
                          <button
                            onClick={() => {
                              if (!modalNewGuest.trim()) return;
                              const name = addGuestToList(modalNewGuest) || modalNewGuest.trim();
                              setSelectedGuestForItem(name);
                              setModalNewGuest('');
                            }}
                            className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-indigo-700 transition-colors flex items-center gap-1"
                          >
                            <UserPlus size={13} /> Adicionar
                          </button>
                        </div>
                      </div>
                    )}
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

                {guestModeActive && (
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold opacity-40 block px-1">Vincular a Convidado</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setSelectedGuestForItem('')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${!selectedGuestForItem ? 'bg-[#141414] text-white border-[#141414]' : 'border-[#141414]/20 text-[#141414]'}`}
                      >
                        Nenhum
                      </button>
                      {guestList.map(g => (
                        <button
                          key={g}
                          onClick={() => setSelectedGuestForItem(g)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${selectedGuestForItem === g ? 'bg-indigo-600 text-white border-indigo-600' : 'border-indigo-200 text-indigo-700 bg-indigo-50'}`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <input
                        value={modalNewGuest}
                        onChange={e => setModalNewGuest(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && modalNewGuest.trim()) {
                            const name = addGuestToList(modalNewGuest) || modalNewGuest.trim();
                            setSelectedGuestForItem(name);
                            setModalNewGuest('');
                          }
                        }}
                        placeholder="Novo convidado..."
                        className="flex-1 text-xs px-3 py-2 border border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-indigo-50"
                      />
                      <button
                        onClick={() => {
                          if (!modalNewGuest.trim()) return;
                          const name = addGuestToList(modalNewGuest) || modalNewGuest.trim();
                          setSelectedGuestForItem(name);
                          setModalNewGuest('');
                        }}
                        className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-indigo-700 transition-colors flex items-center gap-1"
                      >
                        <UserPlus size={13} /> Adicionar
                      </button>
                    </div>
                  </div>
                )}

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
