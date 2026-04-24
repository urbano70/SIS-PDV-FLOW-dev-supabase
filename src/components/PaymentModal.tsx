import React, { useState, useEffect } from 'react';
import { PizzaItem, Order } from '../types';
import { X, Check, CreditCard, Banknote, QrCode, Wallet } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  onPaymentComplete: (selectedItems: Record<string, number>, partialAmount?: number, paymentMethod?: string) => void;
  onApplyDiscount: (orderId: number | string, itemId: string | null, discount: number, discountType: 'percentage' | 'value') => void;
}

type PaymentMethod = 'Crédito' | 'Débito' | 'PIX' | 'Dinheiro';

interface PaymentState {
  method: PaymentMethod;
  enabled: boolean;
  amount: number;
  received?: number;
}

export default function PaymentModal({ isOpen, onClose, order, onPaymentComplete, onApplyDiscount }: PaymentModalProps) {
  const [step, setStep] = useState<'selection' | 'methods'>('selection');
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [isConfirming, setIsConfirming] = useState(false);
  const [isQuantitySelectOpen, setIsQuantitySelectOpen] = useState(false);
  const [itemToSelectQuantity, setItemToSelectQuantity] = useState<PizzaItem | null>(null);
  const [tempQuantity, setTempQuantity] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  const [discountTarget, setDiscountTarget] = useState<{ itemId: string | null, name: string } | null>(null);
  const [discountValue, setDiscountValue] = useState(0);
  const [discountType, setDiscountType] = useState<'percentage' | 'value'>('percentage');

  const [payments, setPayments] = useState<Record<PaymentMethod, PaymentState>>({
    'Crédito': { method: 'Crédito', enabled: false, amount: 0 },
    'Débito': { method: 'Débito', enabled: false, amount: 0 },
    'PIX': { method: 'PIX', enabled: false, amount: 0 },
    'Dinheiro': { method: 'Dinheiro', enabled: false, amount: 0, received: 0 },
  });

  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [splitPeople, setSplitPeople] = useState(2);
  const [splitCustomAmount, setSplitCustomAmount] = useState(0);

  useEffect(() => {
    if (isSplitModalOpen) {
      setSplitCustomAmount(0);
      setSplitPeople(2);
    }
  }, [isSplitModalOpen]);

  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitAmount, setSplitAmount] = useState(0);

  const existingPartialPaid = (order.partialPayments || []).reduce((acc, p) => acc + p.amount, 0);
  const activeItems = order.items.filter(i => !i.removed && !i.paid);
  
  const calculateItemPrice = (item: PizzaItem) => {
    let price = item.price;
    if (item.discount) {
      if (item.discountType === 'percentage') {
        price = price * (1 - item.discount / 100);
      } else {
        price = Math.max(0, price - item.discount);
      }
    }
    return price;
  };

  const orderTotal = activeItems.reduce((acc, i) => acc + calculateItemPrice(i), 0);
  
  const applyOrderDiscount = (total: number) => {
    if (order.discount) {
      if (order.discountType === 'percentage') {
        return total * (1 - order.discount / 100);
      } else {
        return Math.max(0, total - order.discount);
      }
    }
    return total;
  };

  const finalOrderTotal = applyOrderDiscount(orderTotal);
  const remainingOrderTotal = Math.max(0, finalOrderTotal - existingPartialPaid);

  const selectedTotal = isSplitPayment 
    ? splitAmount 
    : order.items
        .filter(i => selectedItems[i.id] !== undefined)
        .reduce((acc, i) => {
          const qty = selectedItems[i.id] || 0;
          const unitPrice = calculateItemPrice(i) / (i.quantity || 1);
          return acc + (unitPrice * qty);
        }, 0);

  const finalSelectedTotal = isSplitPayment ? splitAmount : applyOrderDiscount(selectedTotal);

  const totalPaid = (Object.values(payments) as PaymentState[])
    .filter(p => p.enabled)
    .reduce((acc, p) => acc + p.amount, 0);

  const remaining = Math.max(0, finalSelectedTotal - (isSplitPayment ? 0 : existingPartialPaid) - totalPaid);

  useEffect(() => {
    if (isOpen) {
      setStep('selection');
      setIsSplitPayment(false);
      setSplitAmount(0);
      const initialSelected: Record<string, number> = {};
      activeItems.forEach(i => {
        initialSelected[i.id] = i.quantity || 1;
      });
      setSelectedItems(initialSelected);
      setPayments({
        'Crédito': { method: 'Crédito', enabled: false, amount: 0 },
        'Débito': { method: 'Débito', enabled: false, amount: 0 },
        'PIX': { method: 'PIX', enabled: false, amount: 0 },
        'Dinheiro': { method: 'Dinheiro', enabled: false, amount: 0, received: 0 },
      });
      setIsConfirming(false);
    }
  }, [isOpen]);

  const toggleItem = (item: PizzaItem) => {
    if (existingPartialPaid > 0) return; // Forced selection when partial payment exists
    if (selectedItems[item.id] !== undefined) {
      setSelectedItems(prev => {
        const newState = { ...prev };
        delete newState[item.id];
        return newState;
      });
    } else {
      if (item.quantity && item.quantity > 1) {
        setItemToSelectQuantity(item);
        setTempQuantity(item.quantity);
        setIsQuantitySelectOpen(true);
      } else {
        setSelectedItems(prev => ({ ...prev, [item.id]: 1 }));
      }
    }
  };

  const confirmItemQuantity = () => {
    if (itemToSelectQuantity) {
      setSelectedItems(prev => ({ ...prev, [itemToSelectQuantity.id]: tempQuantity }));
      setIsQuantitySelectOpen(false);
      setItemToSelectQuantity(null);
    }
  };

  const toggleAll = () => {
    if (existingPartialPaid > 0) return; // Forced selection when partial payment exists
    if (Object.keys(selectedItems).length === activeItems.length) {
      setSelectedItems({});
    } else {
      const allSelected: Record<string, number> = {};
      activeItems.forEach(i => {
        allSelected[i.id] = i.quantity || 1;
      });
      setSelectedItems(allSelected);
    }
  };

  const handlePaymentToggle = (method: PaymentMethod) => {
    setPayments(prev => {
      const isEnabling = !prev[method].enabled;
      const newState = { 
        ...prev,
        [method]: { ...prev[method], enabled: isEnabling }
      };
      
      if (isEnabling) {
        // Pre-fill with the REMAINING balance
        const amountToFill = Math.max(0, remaining);
        
        newState[method] = { 
          ...newState[method], 
          amount: Number(amountToFill.toFixed(2)),
          received: method === 'Dinheiro' ? Number(amountToFill.toFixed(2)) : newState[method].received
        };
      } else {
        newState[method] = { ...newState[method], amount: 0 };
      }
      return newState;
    });
  };

  const handleAmountChange = (method: PaymentMethod, val: number) => {
    setPayments(prev => ({
      ...prev,
      [method]: { ...prev[method], amount: val }
    }));
  };

  const handleReceivedChange = (val: number) => {
    setPayments(prev => ({
      ...prev,
      'Dinheiro': { ...prev['Dinheiro'], received: val }
    }));
  };

  const handleSplitEqually = (people: number) => {
    setSelectedItems({});
    setIsSplitPayment(true);
    setSplitAmount(remainingOrderTotal / people);
    setIsSplitModalOpen(false);
    setStep('methods');
  };

  const handleSplitByAmount = (amount: number) => {
    setSelectedItems({});
    setIsSplitPayment(true);
    setSplitAmount(amount);
    setIsSplitModalOpen(false);
    setStep('methods');
  };

  const handleFinishPayment = () => {
    const method = (Object.keys(payments) as PaymentMethod[]).find(m => payments[m].enabled && payments[m].amount > 0);

    if (isSplitPayment) {
      if (remaining > 0.01 && totalPaid > 0) {
        // Partial of the partial? Let's just use totalPaid
        confirmFinal();
        return;
      }
      if (Math.abs(remaining) > 0.01 && totalPaid === 0) {
        setErrorMessage('Informe o valor pago para finalizar.');
        setTimeout(() => setErrorMessage(null), 3000);
        return;
      }
      setIsConfirming(true);
      return;
    }

    // If we have a remaining balance, we adjust the selection to match what was actually paid
    if (remaining > 0.01 && totalPaid > 0) {
      // Partial payment of the selection
      const adjustedSelected: Record<string, number> = {};
      let amountToCover = totalPaid;

      // We iterate through currently selected items and reduce their quantity to match totalPaid
      const selectedItemIds = Object.keys(selectedItems);
      for (const id of selectedItemIds) {
        if (amountToCover <= 0) break;
        
        const item = activeItems.find(i => i.id === id);
        if (!item) continue;

        const selectedQty = selectedItems[id];
        const unitPrice = item.price / (item.quantity || 1);
        const itemSelectedTotal = unitPrice * selectedQty;

        if (amountToCover >= itemSelectedTotal) {
          adjustedSelected[id] = selectedQty;
          amountToCover -= itemSelectedTotal;
        } else {
          adjustedSelected[id] = amountToCover / unitPrice;
          amountToCover = 0;
        }
      }
      
      onPaymentComplete(adjustedSelected, totalPaid, method);
      onClose();
      setIsConfirming(false);
      return;
    }

    if (Math.abs(remaining) > 0.01 && totalPaid === 0) {
      setErrorMessage('Informe o valor pago para finalizar.');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }
    
    setIsConfirming(true);
  };

  const handleApplyDiscount = () => {
    onApplyDiscount(order.id, discountTarget?.itemId || null, discountValue, discountType);
    setIsDiscountModalOpen(false);
    setDiscountValue(0);
  };

  const openDiscountModal = (itemId: string | null, name: string) => {
    setDiscountTarget({ itemId, name });
    if (itemId) {
      const item = activeItems.find(i => i.id === itemId);
      if (item) {
        setDiscountValue(item.discount || 0);
        setDiscountType(item.discountType || 'percentage');
      }
    } else {
      setDiscountValue(order.discount || 0);
      setDiscountType(order.discountType || 'percentage');
    }
    setIsDiscountModalOpen(true);
  };

  const confirmFinal = () => {
    const method = (Object.keys(payments) as PaymentMethod[]).find(m => payments[m].enabled && payments[m].amount > 0);
    
    if (isSplitPayment) {
      onPaymentComplete({}, totalPaid, method);
    } else {
      onPaymentComplete(selectedItems, totalPaid, method);
    }
    onClose();
    setIsConfirming(false);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-2 bg-black/60 backdrop-blur-md"
      >
        <motion.div 
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          className="bg-[#E4E3E0] w-full max-w-4xl rounded-[2rem] overflow-hidden shadow-2xl flex flex-col max-h-[95vh]"
        >
          <header className="px-6 py-3 bg-[#141414] text-[#E4E3E0] flex justify-between items-center shrink-0">
            <div>
              <h2 className="font-serif italic text-2xl leading-none">Pagamento</h2>
              <p className="text-[10px] uppercase tracking-widest opacity-50 mt-1">Mesa {order.tableId} • Comanda #{order.id}</p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
              <X size={20} />
            </button>
          </header>

          {/* Quantity Selection Modal for Payment */}
          <AnimatePresence>
            {isQuantitySelectOpen && (
              <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl border-2 border-[#141414] space-y-6"
                >
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-1">{itemToSelectQuantity?.name}</h3>
                    <p className="text-sm opacity-50 uppercase tracking-widest">Pagar quantas unidades?</p>
                  </div>

                  <div className="flex items-center justify-center space-x-8">
                    <button 
                      onClick={() => setTempQuantity(Math.max(1, tempQuantity - 1))}
                      className="w-12 h-12 rounded-full border-2 border-[#141414] flex items-center justify-center text-2xl font-bold"
                    >
                      -
                    </button>
                    <span className="text-4xl font-bold w-12 text-center">{tempQuantity}</span>
                    <button 
                      onClick={() => setTempQuantity(Math.min(itemToSelectQuantity?.quantity || 1, tempQuantity + 1))}
                      className="w-12 h-12 rounded-full border-2 border-[#141414] flex items-center justify-center text-2xl font-bold"
                    >
                      +
                    </button>
                  </div>

                  <div className="pt-4 border-t border-[#141414]/10">
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-sm font-bold opacity-50 uppercase">Subtotal</span>
                      <span className="text-2xl font-bold">
                        R$ {((itemToSelectQuantity?.price || 0) / (itemToSelectQuantity?.quantity || 1) * tempQuantity).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex space-x-3">
                      <button 
                        onClick={() => setIsQuantitySelectOpen(false)}
                        className="flex-1 py-4 rounded-2xl border border-[#141414] font-bold"
                      >
                        Cancelar
                      </button>
                      <button 
                        onClick={confirmItemQuantity}
                        className="flex-1 py-4 rounded-2xl bg-[#141414] text-[#E4E3E0] font-bold"
                      >
                        Confirmar
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Discount Modal */}
          <AnimatePresence>
            {isDiscountModalOpen && (() => {
              const targetItem = discountTarget?.itemId ? activeItems.find(i => i.id === discountTarget.itemId) : null;
              const baseValue = targetItem ? targetItem.price : selectedTotal;
              const discountAmount = discountType === 'percentage' 
                ? (baseValue * (discountValue / 100)) 
                : discountValue;
              const finalValue = Math.max(0, baseValue - discountAmount);

              return (
                <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl border-2 border-[#141414] space-y-6"
                  >
                    <div className="text-center">
                      <h3 className="text-2xl font-bold mb-1">Aplicar Desconto</h3>
                      <p className="text-sm opacity-50 uppercase tracking-widest">
                        {discountTarget?.itemId ? `Item: ${discountTarget.name}` : 'Desconto no Total'}
                      </p>
                    </div>

                    <div className="bg-gray-50 rounded-2xl p-4 border border-[#141414]/5 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] uppercase font-bold opacity-40">
                          {targetItem ? 'Valor do Item' : 'Total Selecionado'}
                        </span>
                        <span className="font-bold">R$ {baseValue.toFixed(2)}</span>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="flex bg-gray-200/50 p-1 rounded-xl">
                          <button 
                            onClick={() => setDiscountType('percentage')}
                            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${discountType === 'percentage' ? 'bg-white shadow-sm' : 'opacity-50'}`}
                          >
                            Porcentagem (%)
                          </button>
                          <button 
                            onClick={() => setDiscountType('value')}
                            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${discountType === 'value' ? 'bg-white shadow-sm' : 'opacity-50'}`}
                          >
                            Valor Fixo (R$)
                          </button>
                        </div>

                        <div className="flex items-center bg-white border border-[#141414]/20 rounded-xl px-4 py-3 focus-within:border-[#141414] transition-colors">
                          <span className="opacity-40 mr-2 font-bold">{discountType === 'percentage' ? '%' : 'R$'}</span>
                          <input 
                            type="number"
                            value={discountValue || ''}
                            onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                            placeholder="0,00"
                            className="w-full font-bold focus:outline-none text-xl"
                            autoFocus
                          />
                        </div>
                      </div>

                      <div className="pt-3 border-t border-[#141414]/10 flex justify-between items-center">
                        <span className="text-[10px] uppercase font-bold text-green-600">Valor com Desconto</span>
                        <span className="text-xl font-bold text-green-600">R$ {finalValue.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex space-x-3 pt-2">
                      <button 
                        onClick={() => setIsDiscountModalOpen(false)}
                        className="flex-1 py-4 rounded-2xl border border-[#141414] font-bold text-sm"
                      >
                        Cancelar
                      </button>
                      <button 
                        onClick={handleApplyDiscount}
                        className="flex-1 py-4 rounded-2xl bg-[#141414] text-[#E4E3E0] font-bold text-sm"
                      >
                        Aplicar
                      </button>
                    </div>
                  </motion.div>
                </div>
              );
            })()}
          </AnimatePresence>

          <AnimatePresence>
            {isSplitModalOpen && (
              <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl border-2 border-[#141414] space-y-6"
                >
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-1">PAGAMENTO PARCIAL</h3>
                    <div className="mb-4 p-3 bg-blue-50 rounded-2xl border border-blue-100">
                      <p className="text-[10px] font-bold uppercase text-blue-600 opacity-70">Valor Restante do Pedido</p>
                      <p className="text-2xl font-black text-blue-900">R$ {remainingOrderTotal.toFixed(2)}</p>
                    </div>
                    <p className="text-sm opacity-50 uppercase tracking-widest">Como deseja dividir a conta?</p>
                  </div>

                  <div className="space-y-6">
                    <div className="p-4 bg-gray-50 rounded-2xl border border-[#141414]/5">
                      <p className="text-[10px] font-bold uppercase opacity-50 mb-3">Dividir igualmente</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <button 
                            onClick={() => setSplitPeople(Math.max(2, splitPeople - 1))}
                            className="w-10 h-10 rounded-full border border-[#141414] flex items-center justify-center font-bold"
                          >
                            -
                          </button>
                          <span className="text-xl font-bold w-8 text-center">{splitPeople}</span>
                          <button 
                            onClick={() => setSplitPeople(splitPeople + 1)}
                            className="w-10 h-10 rounded-full border border-[#141414] flex items-center justify-center font-bold"
                          >
                            +
                          </button>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase opacity-40">Cada parte</p>
                          <p className="text-xl font-bold">R$ {(remainingOrderTotal / splitPeople).toFixed(2)}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleSplitEqually(splitPeople)}
                        className="w-full mt-4 py-3 bg-[#141414] text-white rounded-xl font-bold text-sm"
                      >
                        Selecionar 1 parte
                      </button>
                    </div>

                    <div className="p-4 bg-gray-50 rounded-2xl border border-[#141414]/5">
                      <p className="text-[10px] font-bold uppercase opacity-50 mb-3">Valor avulso</p>
                      <div className="flex items-center space-x-3">
                        <div className="flex-1 flex items-center bg-white border border-[#141414]/20 rounded-xl px-3 py-2">
                          <span className="opacity-40 mr-2">R$</span>
                          <input 
                            type="number"
                            value={splitCustomAmount || ''}
                            onChange={(e) => setSplitCustomAmount(parseFloat(e.target.value) || 0)}
                            placeholder="0,00"
                            className="w-full font-bold focus:outline-none"
                            autoFocus
                          />
                        </div>
                        <button 
                          disabled={!splitCustomAmount || splitCustomAmount > remainingOrderTotal}
                          onClick={() => handleSplitByAmount(splitCustomAmount)}
                          className="px-6 py-3 bg-[#141414] text-white rounded-xl font-bold text-sm disabled:opacity-30"
                        >
                          Ok
                        </button>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => setIsSplitModalOpen(false)}
                    className="w-full py-3 text-sm font-bold opacity-50 uppercase tracking-widest"
                  >
                    Fechar
                  </button>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          <div className="flex-1 overflow-hidden flex flex-col p-3 md:p-4">
            {step === 'selection' ? (
              <div className="flex flex-col flex-1 min-h-0 space-y-4">
                <div className="flex justify-between items-end shrink-0">
                  <div className="flex flex-col">
                    <h3 className="text-xl font-bold leading-tight">
                      {isSplitPayment ? 'Pagamento Parcial Ativo' : 'Selecione os itens'}
                    </h3>
                    <div className="flex items-center space-x-3 mt-1">
                      <button 
                        onClick={() => setIsSplitModalOpen(true)}
                        className="text-[10px] font-bold uppercase tracking-widest text-blue-600 flex items-center hover:underline"
                      >
                        <Wallet size={12} className="mr-1" /> PAGAMENTO PARCIAL
                      </button>
                      {isSplitPayment && (
                        <button 
                          onClick={() => {
                            setIsSplitPayment(false);
                            setSplitAmount(0);
                            setSelectedItems({});
                          }}
                          className="text-[10px] font-bold uppercase tracking-widest text-red-600 flex items-center hover:underline"
                        >
                          <X size={12} className="mr-1" /> Cancelar Pagamento Parcial
                        </button>
                      )}
                    </div>
                  </div>
                  {!isSplitPayment && existingPartialPaid <= 0 && (
                    <button 
                      onClick={toggleAll}
                      className="text-[10px] font-bold uppercase tracking-widest border-b border-[#141414] pb-0.5"
                    >
                      {Object.keys(selectedItems).length === activeItems.length ? 'Desmarcar Todos' : 'Marcar Todos'}
                    </button>
                  )}
                  {existingPartialPaid > 0 && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
                      Itens bloqueados (Pagamento Parcial)
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 content-start">
                  {isSplitPayment ? (
                    <div className="col-span-full bg-blue-50 border border-blue-100 rounded-3xl p-8 text-center space-y-4">
                      <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto shadow-lg">
                        <Wallet size={32} />
                      </div>
                      <div>
                        <h4 className="text-xl font-bold text-blue-900">Pagamento Parcial Ativo</h4>
                        <p className="text-sm text-blue-700 opacity-70">Você está pagando uma parte do total da conta.</p>
                      </div>
                      <div className="text-4xl font-bold text-blue-900">
                        R$ {splitAmount.toFixed(2)}
                      </div>
                    </div>
                  ) : activeItems.map(item => {
                    const isSelected = selectedItems[item.id] !== undefined;
                    const selectedQty = selectedItems[item.id] || 0;
                    const unitPrice = calculateItemPrice(item) / (item.quantity || 1);
                    const displayPrice = isSelected ? unitPrice * selectedQty : calculateItemPrice(item);

                    return (
                      <div key={item.id} className="relative group">
                        <button 
                          onClick={() => toggleItem(item)}
                          disabled={existingPartialPaid > 0}
                          className={`w-full p-4 rounded-2xl border-2 transition-all flex justify-between items-center text-left ${
                            isSelected 
                              ? 'border-[#141414] bg-white shadow-md' 
                              : 'border-[#141414]/10 bg-white/50 opacity-60'
                          } ${existingPartialPaid > 0 ? 'cursor-default' : ''}`}
                        >
                          <div className="flex items-center space-x-3">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                              isSelected ? 'bg-[#141414] border-[#141414]' : 'border-[#141414]/20'
                            }`}>
                              {isSelected && <Check size={12} className="text-white" />}
                            </div>
                            <div>
                              <p className="font-bold text-sm">
                                {isSelected && item.quantity && item.quantity > 1 ? `${selectedQty}/${item.quantity}x ` : (item.quantity && item.quantity > 1 ? `${item.quantity}x ` : '')}
                                {item.name}
                              </p>
                              <p className="text-[9px] opacity-50 uppercase tracking-tighter">Garçom: {item.waiterName}</p>
                              {item.observations && <p className="text-[9px] text-blue-700 italic font-bold">Obs: {item.observations}</p>}
                              {item.discount ? (
                                <div className="flex items-center space-x-2 mt-0.5">
                                  <p className="text-[9px] text-green-600 font-bold uppercase">
                                    Desconto: {item.discountType === 'percentage' ? `${item.discount}%` : `R$ ${item.discount.toFixed(2)}`}
                                  </p>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openDiscountModal(item.id, item.name);
                                    }}
                                    className="text-[8px] font-bold uppercase text-blue-600 hover:underline"
                                  >
                                    Editar
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onApplyDiscount(order.id, item.id, 0, 'value');
                                    }}
                                    className="text-[8px] font-bold uppercase text-red-600 hover:underline"
                                  >
                                    Remover
                                  </button>
                                </div>
                              ) : (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDiscountModal(item.id, item.name);
                                  }}
                                  className="text-[8px] font-bold uppercase text-blue-600 hover:underline mt-0.5"
                                >
                                  Adicionar Desconto
                                </button>
                              )}
                            </div>
                          </div>
                          <span className="font-mono font-bold text-base">R$ {displayPrice.toFixed(2)}</span>
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            openDiscountModal(item.id, item.name);
                          }}
                          className="absolute -bottom-2 right-4 bg-white border border-[#141414] rounded-full px-2 py-0.5 text-[8px] font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        >
                          Desconto
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-4 border-t border-[#141414]/10 flex justify-between items-center shrink-0">
                  <div className="flex flex-col">
                    <p className="text-[10px] uppercase font-bold opacity-50">
                      {existingPartialPaid > 0 ? 'Resumo do Pagamento' : 'Total Selecionado'}
                    </p>
                    
                    {existingPartialPaid > 0 && !isSplitPayment ? (
                      <div className="space-y-1 mt-1">
                        <div className="flex justify-between items-center space-x-4">
                          <span className="text-[10px] uppercase opacity-40">Total da Venda:</span>
                          <span className="text-xs font-bold">R$ {finalSelectedTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center space-x-4 text-blue-600">
                          <span className="text-[10px] uppercase opacity-60 font-bold">Total pago:</span>
                          <span className="text-xs font-bold">- R$ {existingPartialPaid.toFixed(2)}</span>
                        </div>
                        {order.partialPayments && order.partialPayments.length > 0 && (
                          <div className="space-y-0.5 pl-4 border-l border-blue-200 ml-1">
                            {order.partialPayments.map((p, idx) => (
                              <div key={idx} className="flex justify-between items-center text-[9px] text-blue-500/70 italic">
                                <span>parcial ({p.method}):</span>
                                <span>- R$ {p.amount.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex justify-between items-center space-x-4 pt-1 border-t border-[#141414]/5">
                          <span className="text-[10px] uppercase font-bold text-green-600">Restante:</span>
                          <span className="text-2xl font-bold text-green-600">R$ {Math.max(0, finalSelectedTotal - existingPartialPaid).toFixed(2)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-baseline space-x-3">
                        {order.discount ? (
                          <>
                            <p className="text-xl font-bold leading-none line-through opacity-30">R$ {selectedTotal.toFixed(2)}</p>
                            <p className="text-3xl font-bold leading-none text-green-600">R$ {finalSelectedTotal.toFixed(2)}</p>
                          </>
                        ) : (
                          <p className="text-3xl font-bold leading-none">R$ {selectedTotal.toFixed(2)}</p>
                        )}
                      </div>
                    )}

                    {order.discount && (existingPartialPaid <= 0 || isSplitPayment) ? (
                      <div className="flex items-center space-x-2 mt-1">
                        <p className="text-[10px] text-green-600 font-bold uppercase">
                          Desconto no Total: {order.discountType === 'percentage' ? `${order.discount}%` : `R$ ${order.discount.toFixed(2)}`}
                        </p>
                        <button 
                          onClick={() => openDiscountModal(null, 'Total')}
                          className="text-[8px] font-bold uppercase text-blue-600 hover:underline"
                        >
                          Editar
                        </button>
                        <button 
                          onClick={() => onApplyDiscount(order.id, null, 0, 'value')}
                          className="text-[8px] font-bold uppercase text-red-600 hover:underline"
                        >
                          Remover
                        </button>
                      </div>
                    ) : (!order.discount && (existingPartialPaid <= 0 || isSplitPayment)) ? (
                      <button 
                        onClick={() => openDiscountModal(null, 'Total')}
                        className="text-[10px] font-bold uppercase text-green-600 hover:underline mt-1"
                      >
                        Aplicar Desconto Total
                      </button>
                    ) : null}
                  </div>
                  <button 
                    disabled={Object.keys(selectedItems).length === 0}
                    onClick={() => setStep('methods')}
                    className="bg-[#141414] text-[#E4E3E0] px-8 py-3 rounded-2xl font-bold text-base shadow-lg disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all"
                  >
                    Pagar Agora
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col flex-1 min-h-0 space-y-4">
                <div className="flex justify-between items-start shrink-0">
                  <button onClick={() => setStep('selection')} className="text-xs font-bold flex items-center opacity-50 hover:opacity-100">
                    <X size={14} className="mr-1 rotate-45" /> Voltar para seleção
                  </button>
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-bold opacity-50">
                      {existingPartialPaid > 0 && !isSplitPayment ? 'Restante a Pagar' : 'Valor a Pagar'}
                    </p>
                    <div className="flex items-baseline justify-end space-x-3">
                      {existingPartialPaid > 0 && !isSplitPayment ? (
                        <p className="text-3xl font-bold leading-none text-green-600">R$ {Math.max(0, finalSelectedTotal - existingPartialPaid).toFixed(2)}</p>
                      ) : order.discount ? (
                        <>
                          <p className="text-xl font-bold leading-none line-through opacity-30">R$ {selectedTotal.toFixed(2)}</p>
                          <p className="text-3xl font-bold leading-none text-green-600">R$ {finalSelectedTotal.toFixed(2)}</p>
                        </>
                      ) : (
                        <p className="text-3xl font-bold leading-none">R$ {finalSelectedTotal.toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex-1 bg-white rounded-3xl border border-[#141414]/10 p-3 md:p-4 flex flex-col shadow-sm overflow-hidden min-h-0">
                  <div className="flex justify-between items-center pb-3 border-b border-[#141414]/5 shrink-0">
                    <span className="font-serif italic text-lg">Formas de Pagamento</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] uppercase font-bold opacity-40">Restante:</span>
                      <span className={`text-base md:text-lg font-bold ${remaining > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
                        R$ {Math.abs(remaining).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto pr-1 md:pr-2 py-2 grid grid-cols-2 md:grid-cols-4 gap-2 content-start">
                    {(['Crédito', 'Débito', 'PIX', 'Dinheiro'] as PaymentMethod[]).map(method => {
                      const Icon = method === 'Crédito' || method === 'Débito' ? CreditCard : method === 'PIX' ? QrCode : Banknote;
                      const state = payments[method];
                      
                      return (
                        <div 
                          key={method} 
                          className={`p-2.5 rounded-xl border-2 transition-all select-none flex flex-col ${
                            state.enabled ? 'border-[#141414] bg-white shadow-sm' : 'border-[#141414]/5 bg-white/50 opacity-60'
                          }`}
                        >
                          <div className="flex flex-col h-full space-y-2">
                             <button 
                              type="button"
                              onClick={() => handlePaymentToggle(method)}
                              className={`flex items-center space-x-2 text-left hover:opacity-70 transition-opacity group ${state.enabled ? '' : 'flex-1 justify-center min-h-[40px]'}`}
                            >
                              <div 
                                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                                  state.enabled ? 'bg-[#141414] text-white' : 'bg-white border border-[#141414]/10 text-[#141414]/30 group-hover:border-[#141414]/30'
                                }`}
                              >
                                {state.enabled ? <Check size={14} /> : <Icon size={14} />}
                              </div>
                              <span className={`font-bold text-xs truncate ${state.enabled ? 'text-[#141414]' : 'text-[#141414]/40 group-hover:text-[#141414]/60'}`}>{method}</span>
                            </button>

                            {state.enabled && (
                              <div className="space-y-2 pt-2 border-t border-[#141414]/5" onClick={e => e.stopPropagation()}>
                                <div className="space-y-1">
                                  <span className="text-[8px] uppercase font-bold opacity-40">Valor</span>
                                  <div className="flex items-center bg-white border border-[#141414]/20 rounded-lg px-2 py-0.5 focus-within:border-[#141414] transition-colors">
                                    <span className="text-[10px] mr-1 opacity-50">R$</span>
                                    <input 
                                      type="number"
                                      step="0.01"
                                      value={state.amount || ''}
                                      onChange={(e) => handleAmountChange(method, parseFloat(e.target.value) || 0)}
                                      className="w-full font-mono font-bold focus:outline-none text-right text-xs bg-transparent"
                                      autoFocus
                                    />
                                  </div>
                                </div>

                                {method === 'Dinheiro' && (
                                  <>
                                    <div className="space-y-1 pt-1">
                                      <span className="text-[8px] uppercase font-bold opacity-40">Recebido</span>
                                      <div className="flex items-center bg-white border border-[#141414]/20 rounded-lg px-2 py-0.5 focus-within:border-[#141414] transition-colors">
                                        <span className="text-[10px] mr-1 opacity-50">R$</span>
                                        <input 
                                          type="number"
                                          step="0.01"
                                          value={state.received || ''}
                                          onChange={(e) => handleReceivedChange(parseFloat(e.target.value) || 0)}
                                          className="w-full font-mono font-bold focus:outline-none text-right text-xs bg-transparent"
                                        />
                                      </div>
                                    </div>
                                    <div className="flex justify-between items-center bg-green-50 p-1.5 rounded-lg border border-green-100">
                                      <span className="text-[8px] uppercase font-bold text-green-700">Troco</span>
                                      <span className="font-mono font-bold text-green-600 text-xs">
                                        R$ {Math.max(0, (state.received || 0) - state.amount).toFixed(2)}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {errorMessage && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="mb-4 p-3 bg-red-100 text-red-700 rounded-xl text-xs font-bold text-center border border-red-200"
                  >
                    {errorMessage}
                  </motion.div>
                )}

                <button 
                  onClick={handleFinishPayment}
                  className="w-full bg-[#141414] text-[#E4E3E0] py-3.5 rounded-2xl font-bold text-lg shadow-xl active:scale-95 transition-all flex items-center justify-center space-x-2 shrink-0"
                >
                  <Check size={20} />
                  <span>Finalizar Pagamento</span>
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* Confirmation Popup */}
      <AnimatePresence>
        {isConfirming && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white p-8 rounded-3xl shadow-2xl max-w-xs w-full text-center space-y-6"
            >
              <h3 className="font-serif italic text-2xl">Finalizar?</h3>
              <p className="text-sm opacity-60">Deseja concluir o pagamento desta comanda?</p>
              <div className="flex space-x-3">
                <button 
                  onClick={() => setIsConfirming(false)}
                  className="flex-1 py-3 rounded-xl font-bold text-sm border border-[#141414]/10 hover:bg-gray-50"
                >
                  Não
                </button>
                <button 
                  onClick={confirmFinal}
                  className="flex-1 bg-[#141414] text-[#E4E3E0] py-3 rounded-xl font-bold text-sm shadow-lg active:scale-95 transition-transform"
                >
                  Sim
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}
