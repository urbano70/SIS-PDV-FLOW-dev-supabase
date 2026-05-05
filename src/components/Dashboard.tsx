import React, { useState, useEffect, useRef } from 'react';
import { Table, Order, Waiter, StockItem, MenuCategory, MenuItem } from '../types';
import socket from '../lib/socket';
import { LayoutDashboard, Users, ChefHat, ShoppingCart, CheckCircle, XCircle, Video, Package, AlertTriangle, Wallet, FileText, Settings, Printer, Calendar, Download, Wifi, Menu, X, PlusCircle, Trash2, Search, Pizza, Sandwich, Beer, Clock, Edit, Save, Link as LinkIcon, History, BarChart3, PieChart, TrendingUp, ListPlus, ArrowLeft, RefreshCcw, Lock } from 'lucide-react';
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
  menu: MenuCategory[];
  pizzaFlavors: any[];
  pizzaCrusts: string[];
  activeTab: 'overview' | 'waiters' | 'stock' | 'ai' | 'reports' | 'settings' | 'products';
  setActiveTab: (tab: 'overview' | 'waiters' | 'stock' | 'ai' | 'reports' | 'settings' | 'products') => void;
  isCashRegisterOpen: boolean;
  printerConfig: any;
  setPrinterConfig: (config: any) => void;
}

export default function Dashboard({ 
  tables, 
  comandas, 
  orders, 
  waiters, 
  stock, 
  menu, 
  pizzaFlavors, 
  pizzaCrusts, 
  activeTab, 
  setActiveTab, 
  isCashRegisterOpen,
  printerConfig,
  setPrinterConfig
}: DashboardProps) {
  const { initLocalData, toggleCashRegister } = useFirebase();
  const [videoAnalysis, setVideoAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [selectedComandaId, setSelectedComandaId] = useState<number | null>(null);
  const [isComandaSelected, setIsComandaSelected] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
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
  const [isMergeConfirmOpen, setIsMergeConfirmOpen] = useState(false);
  const [overviewTab, setOverviewTab] = useState<'tables' | 'comandas'>('tables');
  const detailsRef = useRef<HTMLDivElement>(null);
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportStartDate, setReportStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportEndDate, setReportEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportSelectedItem, setReportSelectedItem] = useState<string>('');
  const [reportSelectedCategory, setReportSelectedCategory] = useState<string>('todos');
  const [showItemSuggestions, setShowItemSuggestions] = useState(false);
  const [reportSelectedPaymentMethod, setReportSelectedPaymentMethod] = useState<string>('todos');
  const [currentReportView, setCurrentReportView] = useState<'items_specific' | 'items_all' | 'sales_by_day' | 'sales_by_payment' | 'waiter_performance' | null>(null);
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

  const [discoveredPrinters] = useState([
    { name: 'Impressora Cozinha 1', ip: '192.168.1.101', status: 'online' },
    { name: 'Impressora Cozinha 2', ip: '192.168.1.103', status: 'online' },
    { name: 'Impressora Bar', ip: '192.168.1.102', status: 'online' },
    { name: 'Impressora Caixa', ip: '192.168.1.100', status: 'offline' },
  ]);

  const handleTestPrinter = (printerName: string) => {
    const printer = discoveredPrinters.find(p => p.name === printerName);
    if (printer?.status === 'offline') {
      toast.error(`Erro ao imprimir em ${printerName}`, {
        description: `A impressora no IP ${printer.ip} está offline.`
      });
      return;
    }
    
    toast.success(`Teste enviado para ${printerName}`, {
      description: `Conteúdo: "${printerName}: OK"`
    });
  };

  useEffect(() => {
    if (!isAddItemModalOpen) {
      setSearchTerm('');
      setSelectedCategory('pizzas');
    }
  }, [isAddItemModalOpen]);

  const handleSavePrinters = () => {
    // In a real app, this would save to a database or localStorage
    toast.success('Configurações de impressora salvas com sucesso!', {
      description: 'O direcionamento dos pedidos foi atualizado.'
    });
  };

  const printOrderToPrinters = (orderItems: any[]) => {
    orderItems.forEach(item => {
      let targetPrinterName = '';
      
      // Determine the printer based on item type
      if (item.type === 'pizzas') {
        targetPrinterName = printerConfig.pizzas;
      } else if (item.type === 'bebidas') {
        targetPrinterName = printerConfig.drinks;
      } else if (item.type === 'lanches') {
        targetPrinterName = printerConfig.kitchen;
      }
      
      if (targetPrinterName) {
        const printer = discoveredPrinters.find(p => p.name === targetPrinterName);
        if (printer?.status === 'online') {
          toast.success(`Pedido enviado para ${targetPrinterName}`, {
            description: `Item: ${item.name}`,
            icon: <Printer size={16} />
          });
        } else if (targetPrinterName !== '') {
          // If a printer is configured but offline
          toast.error(`Impressora ${targetPrinterName} offline`, {
            description: `O item ${item.name} não pôde ser impresso.`
          });
        }
      }
    });
  };

  const printReceiptToPrinter = (orderId: number | string, amount: number) => {
    const targetPrinterName = printerConfig.receipts;
    if (targetPrinterName) {
      const printer = discoveredPrinters.find(p => p.name === targetPrinterName);
      if (printer?.status === 'online') {
        toast.info(`Imprimindo comprovante em ${targetPrinterName}`, {
          description: `Total: R$ ${amount.toFixed(2)}`,
          icon: <FileText size={16} />
        });
      }
    }
  };

  const handlePaymentComplete = (orderId: number | string, selectedItems: Record<string, number>, partialAmount?: number, paymentMethod?: string) => {
    socket.emit('pay_items', {
      orderId,
      selectedItems,
      partialAmount,
      paymentMethod
    });

    // Handle receipt printing
    const order = orders.find(o => o.id === orderId);
    if (order) {
      const totalToPrint = partialAmount || Object.entries(selectedItems).reduce((acc, [itemId, qty]) => {
        const item = order.items.find(i => i.id === itemId);
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

  const handleTransferTable = () => {
    const sourceTableId = isComandaSelected ? selectedComandaId : selectedTableId;
    if (sourceTableId && targetTableId) {
      socket.emit('transfer_table', { 
        sourceTableId, 
        targetTableId,
        isComanda: isComandaSelected,
        reason: transferReason
      });
      setIsTransferModalOpen(false);
      setIsMergeConfirmOpen(false);
      setTargetTableId(null);
      setTransferReason('');
      toast.success(`Conta da ${isComandaSelected ? 'Comanda' : 'Mesa'} ${sourceTableId} transferida para ${isComandaSelected ? 'Comanda' : 'Mesa'} ${targetTableId}`);
    }
  };

  useEffect(() => {
    if (selectedTableId || selectedComandaId) {
      // Small delay to ensure the content is rendered before scrolling
      setTimeout(() => {
        detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [selectedTableId, selectedComandaId, isComandaSelected]);

  const handleRemoveItem = (orderId: number | string, item: any) => {
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
    const activeOrder = orders.find(o => o.tableId === tableId && o.isComanda === isComandaSelected && o.status !== 'finalizada');
    
    // Check if it's a pizza
    const category = menu.find(cat => cat.items.some(i => i.id === item.id || i.name === item.name));
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
    const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
    if (!selectedQuantityItem || !targetId) return;

    const category = menu.find(cat => cat.items.some(i => i.name === selectedQuantityItem.name));

    const newItem = {
      id: Math.random().toString(36).substr(2, 9),
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

    const activeOrder = orders.find(o => o.tableId === targetId && o.isComanda === isComandaSelected && o.status !== 'finalizada');

    if (activeOrder) {
      socket.emit('add_item_to_order', {
        orderId: activeOrder.id,
        item: newItem
      });
    } else {
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

  const pendingWaiters = waiters.filter(w => w.status === 'pending');
  const lowStockItems = stock.filter(item => item.quantity <= item.minQuantity);
  const waiterUrl = `${window.location.origin}/waiter`;

  const approveWaiter = (id: string) => {
    socket.emit('admin_approve_waiter', id);
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
            <h1 className="font-serif italic text-xl font-bold">PizzaFlow</h1>
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
            onClick={() => { setActiveTab('reports'); setIsSidebarOpen(false); }}
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
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-4 gap-4 shrink-0">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 bg-white rounded-lg shadow-sm border border-[#141414]/10 lg:hidden"
            >
              <Menu size={20} />
            </button>
            <header className="flex items-center space-x-3">
              <h2 className="font-serif italic text-3xl shrink-0">Painel</h2>
              <div className="flex items-center bg-white/50 border border-[#141414]/10 p-1 rounded-xl shadow-sm">
                <button 
                  onClick={() => setActiveTab('overview')}
                  className={`p-1.5 rounded-lg transition-all ${activeTab === 'overview' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Visão Geral"
                >
                  <LayoutDashboard size={18} />
                </button>
                <button 
                  onClick={() => setActiveTab('waiters')}
                  className={`p-1.5 rounded-lg transition-all relative ${activeTab === 'waiters' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Garçons"
                >
                  <Users size={18} />
                  {pendingWaiters.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-white" />
                  )}
                </button>
                <button 
                  onClick={() => setActiveTab('stock')}
                  className={`p-1.5 rounded-lg transition-all relative ${activeTab === 'stock' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Estoque"
                >
                  <Package size={18} />
                  {lowStockItems.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-500 rounded-full border border-white" />
                  )}
                </button>
                <button 
                  onClick={() => setActiveTab('products')}
                  className={`p-1.5 rounded-lg transition-all ${activeTab === 'products' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Produtos"
                >
                  <ShoppingCart size={18} />
                </button>
                <button 
                  onClick={() => setActiveTab('ai')}
                  className={`p-1.5 rounded-lg transition-all ${activeTab === 'ai' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="IA Vision"
                >
                  <Video size={18} />
                </button>
                <button 
                  onClick={() => setActiveTab('reports')}
                  className={`p-1.5 rounded-lg transition-all ${activeTab === 'reports' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Relatórios"
                >
                  <FileText size={18} />
                </button>
                <button 
                  onClick={() => setActiveTab('settings')}
                  className={`p-1.5 rounded-lg transition-all ${activeTab === 'settings' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/40 hover:bg-[#141414]/10'}`}
                  title="Configurações"
                >
                  <Settings size={18} />
                </button>
              </div>
            </header>
          </div>

          {activeTab === 'overview' && (
            <div className="flex items-center flex-wrap gap-2">
              <button 
                onClick={() => toggleCashRegister(!isCashRegisterOpen)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold text-sm transition-all shadow-md ${
                  isCashRegisterOpen 
                    ? 'bg-red-500 text-white hover:bg-red-600' 
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                <Wallet size={18} />
                <span>{isCashRegisterOpen ? 'Fechar Caixa' : 'Abrir Caixa'}</span>
              </button>
              <StatCard title="Mesas" value={tables.filter(t => t.status !== 'free').length} total={tables.length} icon={Users} />
              <StatCard title="Pendentes" value={orders.filter(o => o.status === 'pending').length} icon={Clock} />
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
              className="flex-1 min-h-0 pt-6"
            >
              <section className="grid grid-cols-1 md:grid-cols-5 gap-4 h-full">
                <div className="md:col-span-2 md:col-start-1 md:row-start-1 space-y-4 order-2 md:order-1">
                  <div className="flex items-center space-x-1 bg-white p-0.5 rounded-xl border border-[#141414]/10 w-fit">
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

                  <AnimatePresence mode="wait">
                    {overviewTab === 'tables' ? (
                      <motion.div 
                        key="tables-grid"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="grid grid-cols-5 sm:grid-cols-5 lg:grid-cols-5 gap-1.5">
                          {tables.map(table => (
                            <button 
                              key={table.id}
                              onClick={() => {
                                setSelectedTableId(table.id);
                                setIsComandaSelected(false);
                              }}
                              className={`p-1.5 rounded-lg border transition-all text-left w-full ${
                                selectedTableId === table.id && !isComandaSelected ? 'ring-2 ring-[#141414]/20' : ''
                              } ${
                                table.status === 'free' ? 'border-[#141414]/10 bg-white/50' :
                                table.status === 'occupied' ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' :
                                table.status === 'linked' ? 'border-blue-500 bg-blue-50 text-blue-700' :
                                'border-yellow-500 bg-yellow-50 animate-pulse'
                              }`}
                            >
                              <p className="text-[6px] uppercase tracking-widest opacity-50">Mesa</p>
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-bold">{table.id}</p>
                                {table.status === 'linked' && <LinkIcon size={8} className="text-blue-500" />}
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
                      >
                        <div className="grid grid-cols-5 sm:grid-cols-5 lg:grid-cols-5 gap-1.5">
                          {comandas.map(comanda => (
                            <button 
                              key={comanda.id}
                              onClick={() => {
                                setSelectedComandaId(comanda.id);
                                setIsComandaSelected(true);
                              }}
                              className={`p-1.5 rounded-lg border transition-all text-left w-full ${
                                selectedComandaId === comanda.id && isComandaSelected ? 'ring-2 ring-[#141414]/20' : ''
                              } ${
                                comanda.status === 'free' ? 'border-[#141414]/10 bg-white/50' :
                                comanda.status === 'occupied' ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' :
                                comanda.status === 'linked' ? 'border-blue-500 bg-blue-50 text-blue-700' :
                                'border-yellow-500 bg-yellow-50 animate-pulse'
                              }`}
                            >
                              <p className="text-[6px] uppercase tracking-widest opacity-50">Com.</p>
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-bold">{comanda.id}</p>
                                {comanda.status === 'linked' && <LinkIcon size={8} className="text-blue-500" />}
                              </div>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div ref={detailsRef} className="md:col-span-3 md:col-start-3 md:row-start-1 md:row-span-2 order-1 md:order-2 h-full flex flex-col min-h-0">
                  <div className="flex flex-col h-full">
                    {(isComandaSelected ? selectedComandaId : selectedTableId) ? (() => {
                      const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
                      const currentItem = (isComandaSelected ? comandas : tables).find(t => t.id === targetId);
                      const activeOrder = orders.find(o => o.id === currentItem?.currentOrder);
                      const waiter = waiters.find(w => w.id === activeOrder?.waiterId);
                      const hasItems = activeOrder && activeOrder.items.filter(i => !i.removed).length > 0;
                      
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
                                      const waiterName = waiters.find(w => w.id === activeOrder.waiterId)?.name || 'N/A';
                                      const total = activeOrder.items.filter(i => !i.removed).reduce((acc, i) => acc + i.price, 0);
                                      
                                      const html = `
                                        <html>
                                          <head>
                                            <title>Resumo ${tableType} ${tableId}</title>
                                            <style>
                                              body { font-family: monospace; padding: 20px; width: 300px; margin: 0 auto; color: #141414; }
                                              .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
                                              .items { margin-bottom: 10px; }
                                              .item { 
                                                display: flex; 
                                                justify-content: space-between; 
                                                margin-bottom: 5px; 
                                                font-size: ${printerConfig.itemFontSize};
                                                font-weight: ${printerConfig.boldItems ? 'bold' : 'normal'};
                                              }
                                              .footer { border-top: 1px dashed #000; padding-top: 10px; text-align: right; }
                                              .establishment { font-weight: bold; font-size: 14px; text-transform: uppercase; }
                                              @media print { body { width: 100%; margin: 0; } }
                                            </style>
                                          </head>
                                          <body>
                                            <div class="header">
                                              <div class="establishment">${printerConfig.establishmentName}</div>
                                              <div>${printerConfig.address}</div>
                                              <div>Tel: ${printerConfig.phone}</div>
                                              <div style="margin-top: 10px; font-weight: bold;">*** CONFERÊNCIA DE MESA ***</div>
                                            </div>
                                            <div class="info">
                                              <div>${tableType}: ${tableId}</div>
                                              <div>Garçom: ${waiterName}</div>
                                              <div>Data: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
                                            </div>
                                            <div style="border-bottom: 1px dashed #000; margin: 10px 0;"></div>
                                            <div class="items">
                                              ${activeOrder.items.filter(i => !i.removed).map(item => `
                                                <div class="item">
                                                  <span>${item.quantity}x ${item.name}</span>
                                                  <span>R$ ${item.price.toFixed(2)}</span>
                                                </div>
                                              `).join('')}
                                            </div>
                                            <div class="footer">
                                              <div style="font-size: 14px; font-weight: bold;">TOTAL: R$ ${total.toFixed(2)}</div>
                                            </div>
                                            <div style="text-align: center; margin-top: 20px; font-size: 10px; opacity: 0.7;">
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
                              <button 
                                onClick={() => hasItems && setIsPaymentModalOpen(true)}
                                disabled={!hasItems}
                                className={`px-3 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase shadow-sm transition-colors flex items-center space-x-1 ${
                                  hasItems 
                                    ? 'bg-green-600 hover:bg-green-700 text-white' 
                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                              >
                                <Wallet size={10} />
                                <span>Pagar</span>
                              </button>
                            </div>
                          </h3>
                          <div className="bg-white rounded-2xl border-2 border-[#141414] shadow-xl flex flex-col h-full min-h-0 overflow-hidden">
                          <div className="p-6 pb-2 shrink-0">
                            <div className="flex justify-between items-center mb-4">
                              <div className="flex flex-col">
                                <div className="flex items-center space-x-2">
                                  <h4 className="text-2xl font-bold">{isComandaSelected ? 'Comanda' : 'Mesa'} {targetId ?? ''}</h4>
                                  <button 
                                    onClick={() => setIsAddItemModalOpen(true)}
                                    className="text-[#141414] opacity-30 hover:opacity-100 transition-opacity"
                                    title="Adicionar Pedido (ADM)"
                                  >
                                    <PlusCircle size={20} />
                                  </button>
                                </div>
                                {waiter && (
                                  <span className="text-[10px] opacity-50 italic">Garçom: {waiter.name}</span>
                                )}
                              </div>
                              <div className="flex flex-col items-end space-y-2">
                                <button 
                                  onClick={() => setIsHistoryModalOpen(true)}
                                  className="text-[#141414] opacity-30 hover:opacity-100 transition-opacity"
                                  title="Histórico de Vendas"
                                >
                                  <History size={20} />
                                </button>
                                <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${
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
                                  {activeOrder.items.map((item) => (
                                    <div key={item.id} className={`flex justify-between items-center text-[11px] ${item.removed ? 'opacity-30 line-through' : ''} ${item.paid ? 'bg-green-50/50 px-2 py-1 rounded-md border border-green-100/50 mb-1' : ''}`}>
                                      <div className="flex flex-col">
                                        <div className="flex items-center space-x-2">
                                          <span className={`font-bold ${item.paid ? 'text-green-700' : ''}`}>
                                            {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                                          </span>
                                          {!item.removed && !item.paid && (item.type === 'pizzas' || item.type === 'lanches') && (
                                            <OrderTimer timestamp={item.timestamp} />
                                          )}
                                        </div>
                                        {item.observations && <span className="text-[9px] text-blue-700 italic opacity-70 mt-0.5 leading-none">Obs: {item.observations}</span>}
                                        {item.ingredients && item.type !== 'pizzas' && <span className="text-[9px] text-[#141414] opacity-40 uppercase mt-0.5 leading-none">{item.ingredients}</span>}

                                      </div>
                                      <div className="flex items-center space-x-3">
                                        <div className="flex flex-col items-end">
                                          <span className={`font-mono font-bold ${item.paid ? 'text-green-700' : ''}`}>
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
                                        {!item.removed && (
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
                                      <p className="text-[10px] uppercase font-bold text-blue-800 opacity-50 mb-1">Observações da Comanda</p>
                                      <p className="text-xs text-blue-700 italic">{activeOrder.observations}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-6">
                                <p className="text-sm opacity-50 italic">Nenhum pedido ativo para esta {isComandaSelected ? 'comanda' : 'mesa'}.</p>
                              </div>
                            )}
                          </div>

                          <div className="p-6 pt-2 border-t border-[#141414]/10 bg-gray-50/50 shrink-0">
                            {activeOrder ? (
                              <>
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center opacity-50">
                                    <span className="text-[10px] uppercase font-bold">Total Consumido</span>
                                    <span className="text-sm font-bold">
                                      R$ {activeOrder.items.filter(i => !i.removed).reduce((acc, i) => {
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
                                      <span className="text-[10px] uppercase font-bold">Desconto no Total</span>
                                      <span className="text-sm font-bold">
                                        - {activeOrder.discountType === 'percentage' ? `${activeOrder.discount}%` : `R$ ${activeOrder.discount.toFixed(2)}`}
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex justify-between items-center pt-1 border-t border-[#141414]/5">
                                    <span className="text-[10px] uppercase font-bold opacity-70">Total Líquido</span>
                                    <span className="text-sm font-bold">
                                      R$ {(() => {
                                        const total = activeOrder.items.filter(i => !i.removed).reduce((acc, i) => {
                                          let price = i.price;
                                          if (i.discount && !i.paid) {
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
                                    <span className="text-[10px] uppercase font-bold">
                                      Já Pago {activeOrder.partialPayments && activeOrder.partialPayments.length > 0 ? '(Parcial)' : ''}
                                    </span>
                                    <span className="text-sm font-bold">
                                      - R$ {(() => {
                                        const itemsPaid = activeOrder.items.filter(i => !i.removed && i.paid).reduce((acc, i) => acc + i.price, 0);
                                        const partialPaid = (activeOrder.partialPayments || []).reduce((acc, p) => acc + p.amount, 0);
                                        return (itemsPaid + partialPaid).toFixed(2);
                                      })()}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center pt-2 border-t border-dashed border-[#141414]/10">
                                    <span className="text-xs uppercase font-bold">Restante a Pagar</span>
                                    <span className="text-2xl font-bold">
                                      R$ {(() => {
                                        const total = activeOrder.items.filter(i => !i.removed).reduce((acc, i) => {
                                          let price = i.price;
                                          if (i.discount && !i.paid) {
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
                                        
                                        const paid = (() => {
                                          const itemsPaid = activeOrder.items.filter(i => !i.removed && i.paid).reduce((acc, i) => acc + i.price, 0);
                                          const partialPaid = (activeOrder.partialPayments || []).reduce((acc, p) => acc + p.amount, 0);
                                          return itemsPaid + partialPaid;
                                        })();
                                        
                                        return Math.max(0, finalTotal - paid).toFixed(2);
                                      })()}
                                    </span>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="pt-2 border-t border-[#141414]/5">
                                <button 
                                  onClick={() => setIsHistoryModalOpen(true)}
                                  className="text-[10px] uppercase font-bold opacity-30 hover:opacity-100 transition-opacity flex items-center space-x-1"
                                >
                                  <Clock size={12} />
                                  <span>Ver histórico de hoje</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      );
                    })() : (
                      <div className="bg-white/50 border-2 border-dashed border-[#141414]/10 rounded-2xl p-10 text-center opacity-30 flex-1 flex flex-col justify-center">
                        <p className="text-sm">Selecione uma mesa ou comanda para ver os detalhes.</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-2 lg:col-start-1 lg:row-start-2 space-y-4 order-3 lg:order-3 mt-4 lg:mt-0 pt-6 border-t border-[#141414]/5">
                  <div>
                    <h3 className="font-serif italic text-lg mb-3 opacity-50">Pedidos Recentes</h3>
                    <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-hide">
                      {orders.slice(-8).reverse().map(order => {
                        const waiter = waiters.find(w => w.id === order.waiterId);
                        return (
                          <div key={order.id} className="bg-white/40 hover:bg-white p-2 rounded-lg border border-[#141414]/5 transition-colors text-[10px]">
                            <div className="flex justify-between items-center">
                              <button 
                                onClick={() => {
                                  if (order.isComanda) {
                                    setSelectedComandaId(order.tableId);
                                    setIsComandaSelected(true);
                                  } else {
                                    setSelectedTableId(order.tableId);
                                    setIsComandaSelected(false);
                                  }
                                }}
                                className="font-bold hover:underline text-[#141414]"
                              >
                                {order.isComanda ? 'C' : 'M'}{order.tableId}
                              </button>
                              <span className="opacity-40">{waiter?.name?.split(' ')[0] || 'G'}</span>
                              <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-[7px] ${
                                order.status === 'pending' ? 'text-red-600' :
                                order.status === 'preparing' ? 'text-blue-600' :
                                'text-green-600'
                              }`}>
                                R$ {order.items.filter(i => !i.removed).reduce((acc, i) => acc + i.price, 0).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
              className="space-y-10"
            >
              <header>
                <h2 className="font-serif italic text-4xl mb-2">Gestão de Garçons</h2>
                <p className="text-sm opacity-60">Aprovação de novos acessos e controle de equipe.</p>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div className="space-y-10">
                  {pendingWaiters.length > 0 && (
                    <section className="bg-white border-2 border-[#141414] rounded-2xl p-8">
                      <h3 className="font-serif italic text-xl mb-6 flex items-center">
                        <Users className="mr-2" /> Solicitações Pendentes
                      </h3>
                      <div className="space-y-4">
                        {pendingWaiters.map(waiter => (
                          <div key={waiter.id || waiter.cpf} className="flex items-center justify-between p-4 border border-[#141414]/10 rounded-xl hover:bg-gray-50 transition-colors">
                            <div>
                              <p className="font-bold">{waiter.name}</p>
                              <div className="flex flex-col text-xs opacity-50">
                                {waiter.phone && <span>Tel: {waiter.phone}</span>}
                                {waiter.cpf && <span>CPF: {waiter.cpf}</span>}
                              </div>
                            </div>
                            <div className="flex space-x-2">
                              <button 
                                onClick={() => approveWaiter(waiter.id || waiter.cpf!)}
                                className="bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-lg text-sm font-bold flex items-center hover:scale-105 transition-transform"
                              >
                                <CheckCircle size={16} className="mr-2" /> Aprovar
                              </button>
                              <button className="border border-red-500 text-red-500 px-4 py-2 rounded-lg text-sm font-bold flex items-center hover:bg-red-50 transition-colors">
                                <XCircle size={16} className="mr-2" /> Negar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="mb-10">
                    <h3 className="font-serif italic text-xl mb-6">Equipe Ativa</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      {waiters.filter(w => w.status === 'approved').map(waiter => (
                        <div key={waiter.id || waiter.cpf} className="bg-white p-6 rounded-xl border border-[#141414]/10 shadow-sm flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center font-bold">
                              {waiter.name[0]}
                            </div>
                            <div>
                              <p className="font-bold">{waiter.name}</p>
                              <p className="text-[10px] opacity-50">{waiter.phone}</p>
                              <p className="text-[10px] uppercase text-green-600 font-bold">Ativo</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => socket.emit('toggle_waiter_status', { waiterId: waiter.id || waiter.cpf, status: 'inactive' })}
                            className="bg-red-50 text-red-600 p-2 rounded-lg hover:bg-red-100 transition-colors"
                            title="Inativar Garçom"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  {waiters.some(w => w.status === 'inactive') && (
                    <section>
                      <h3 className="font-serif italic text-xl mb-6 text-gray-500">Equipe Inativa</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {waiters.filter(w => w.status === 'inactive').map(waiter => (
                          <div key={waiter.id || waiter.cpf} className="bg-gray-50 p-6 rounded-xl border border-[#141414]/10 shadow-sm flex items-center justify-between grayscale opacity-60">
                            <div className="flex items-center space-x-4">
                              <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center font-bold">
                                {waiter.name[0]}
                              </div>
                              <div>
                                <p className="font-bold">{waiter.name}</p>
                                <p className="text-[10px] opacity-50">{waiter.phone}</p>
                                <p className="text-[10px] uppercase text-red-600 font-bold">Inativo</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => socket.emit('toggle_waiter_status', { waiterId: waiter.id || waiter.cpf, status: 'approved' })}
                              className="bg-green-50 text-green-600 p-2 rounded-lg hover:bg-green-100 transition-colors"
                              title="Ativar Garçom"
                            >
                              <CheckCircle size={18} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>

                <div className="bg-white p-8 rounded-3xl border border-[#141414]/10 shadow-sm flex flex-col items-center justify-center text-center space-y-6">
                  <h3 className="font-serif italic text-2xl">Cadastro de Garçom</h3>
                  <p className="text-sm opacity-50 max-w-xs">Aponte a câmera para o QR Code abaixo para acessar o terminal de auto-cadastro.</p>
                  <div className="bg-white p-4 rounded-2xl shadow-lg border border-[#141414]/5">
                    <QRCodeSVG value={waiterUrl} size={200} className="mx-auto" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-widest font-bold opacity-30">Link Direto</p>
                    <p className="text-xs font-mono bg-gray-50 px-3 py-2 rounded-lg break-all">{waiterUrl}</p>
                  </div>
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
              className="space-y-10 pt-6"
            >
              <header>
                <h2 className="font-serif italic text-4xl mb-2">Gestão de Insumos</h2>
                <p className="text-sm opacity-60">Controle de estoque e alertas de reposição.</p>
              </header>

              <div className="grid grid-cols-1 gap-6">
                <div className="bg-white border-2 border-[#141414] rounded-2xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#141414] text-[#E4E3E0]">
                        <th className="p-4 text-[10px] uppercase tracking-widest">Insumo</th>
                        <th className="p-4 text-[10px] uppercase tracking-widest">Quantidade Atual</th>
                        <th className="p-4 text-[10px] uppercase tracking-widest">Mínimo</th>
                        <th className="p-4 text-[10px] uppercase tracking-widest">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stock.map(item => (
                        <tr key={item.id} className="border-b border-[#141414]/10 hover:bg-gray-50 transition-colors">
                          <td className="p-4 font-bold">{item.name}</td>
                          <td className="p-4 font-mono">{item.quantity.toFixed(1)} {item.unit}</td>
                          <td className="p-4 font-mono opacity-50">{item.minQuantity} {item.unit}</td>
                          <td className="p-4">
                            {item.quantity <= item.minQuantity ? (
                              <span className="flex items-center text-red-600 text-[10px] font-bold uppercase">
                                <AlertTriangle size={12} className="mr-1" /> Reposição Necessária
                              </span>
                            ) : (
                              <span className="text-green-600 text-[10px] font-bold uppercase">Estável</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'ai' && (
            <motion.div 
              key="ai"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-10 pt-6"
            >
              <header>
                <h2 className="font-serif italic text-4xl mb-2">IA Vision Analysis</h2>
                <p className="text-sm opacity-60">Análise inteligente do fluxo de trabalho via Gemini 3.1 Pro.</p>
              </header>

              <div className="grid grid-cols-2 gap-10">
                <div className="bg-[#141414] rounded-2xl aspect-video flex flex-col items-center justify-center text-[#E4E3E0] p-10 text-center space-y-6">
                  <Video size={64} className="opacity-20" />
                  <div>
                    <h4 className="text-xl font-bold mb-2">Monitoramento da Cozinha</h4>
                    <p className="text-sm opacity-50">Conecte uma câmera para análise de tempo de preparo e gargalos.</p>
                  </div>
                  <button 
                    onClick={analyzeKitchenVideo}
                    disabled={isAnalyzing}
                    className="bg-[#E4E3E0] text-[#141414] px-8 py-3 rounded-full font-bold hover:scale-105 transition-transform disabled:opacity-50"
                  >
                    {isAnalyzing ? "Analisando..." : "Iniciar Análise de Fluxo"}
                  </button>
                </div>

                <div className="bg-white border-2 border-[#141414] rounded-2xl p-8 overflow-y-auto max-h-[500px]">
                  <h3 className="font-serif italic text-xl mb-6">Relatório de Otimização</h3>
                  {videoAnalysis ? (
                    <div className="prose prose-sm font-mono text-xs leading-relaxed">
                      {videoAnalysis.split('\n').map((line, i) => (
                        <p key={i} className="mb-2">{line}</p>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full opacity-30 text-center">
                      <ChefHat size={48} className="mb-4" />
                      <p>Aguardando dados para análise...</p>
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
              className="space-y-10"
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
                    <div className="bg-[#141414] text-[#E4E3E0] p-4 rounded-2xl shadow-lg space-y-1">
                      <p className="text-[9px] uppercase font-bold opacity-50 tracking-widest">Faturamento do Dia</p>
                      <p className="text-2xl font-bold font-mono">
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

                    <div className="bg-white p-4 rounded-2xl border border-[#141414]/10 shadow-sm space-y-1">
                      <p className="text-[9px] uppercase font-bold opacity-50 tracking-widest">Ticket Médio</p>
                      <p className="text-2xl font-bold font-mono">
                        {(() => {
                          const dayOrders = orders.filter(o => o.status === 'finalizada' && o.timestamp.startsWith(reportDate));
                          if (dayOrders.length === 0) return 'R$ 0.00';
                          const total = dayOrders.reduce((acc, o) => {
                            const payments = (o.paymentLog || []).reduce((pAcc, p) => pAcc + p.amount, 0);
                            return acc + payments;
                          }, 0);
                          return `R$ ${(total / dayOrders.length).toFixed(2)}`;
                        })()}
                      </p>
                      <div className="pt-2 flex items-center space-x-2 text-green-600">
                        <TrendingUp size={14} />
                        <span className="text-[10px]">Baseado em pedidos finalizados</span>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-[#141414]/10 shadow-sm space-y-1">
                      <p className="text-[9px] uppercase font-bold opacity-50 tracking-widest">Itens Vendidos</p>
                      <p className="text-2xl font-bold font-mono">
                        {orders
                          .filter(o => o.timestamp.startsWith(reportDate))
                          .reduce((acc, o) => acc + o.items.filter(i => !i.removed).length, 0)}
                      </p>
                      <div className="pt-2 flex items-center space-x-2 opacity-40">
                        <Package size={14} />
                        <span className="text-[10px]">Produtos processados hoje</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-serif italic text-xl">Gerar Relatórios</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
                        className="bg-[#141414] text-[#E4E3E0] py-1.5 px-3 rounded-lg font-bold text-[10px] flex items-center justify-center space-x-1.5 hover:opacity-90 transition-opacity"
                      >
                        <Download size={12} />
                        <span>PDF</span>
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
                                          <span className="font-mono font-bold">
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
                                                <td className="p-4 text-right font-mono">R$ {itemStats[itemName][date].total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
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
                                      <p className="text-5xl font-bold font-mono text-[#22C55E]">R$ {grandTotalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                    </div>
                                  </div>
                                  
                                  <div className="flex justify-end pt-4 no-print">
                                    <button 
                                      onClick={() => window.print()}
                                      className="bg-blue-600 text-white py-4 px-8 rounded-2xl font-bold flex items-center space-x-3 hover:scale-[1.02] active:scale-95 transition-all shadow-lg active:shadow-sm"
                                    >
                                      <Printer size={20} />
                                      <span>Imprimir Relatório</span>
                                    </button>
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
                                        <td className="py-1.5 px-3 font-mono opacity-60 text-[8px]">R$ {(data.total / data.qty).toFixed(2)}</td>
                                        <td className="py-1.5 px-3 text-center font-mono">{data.qty}</td>
                                        <td className="py-1.5 px-3 text-right font-bold text-green-600 font-mono">R$ {data.total.toFixed(2)}</td>
                                      </tr>
                                    ))}
                                    <tr className="bg-[#141414]/5 border-t border-[#141414]">
                                      <td className="py-1.5 px-3 font-bold uppercase text-[8px]">Totais</td>
                                      <td className="py-1.5 px-3 text-[8px] opacity-40">Ticket Médio: R$ {items.length > 0 ? (amountTotal / itemsCountTotal).toFixed(2) : '0.00'}</td>
                                      <td className="py-1.5 px-3 text-center font-bold font-mono">
                                        {itemsCountTotal}
                                      </td>
                                      <td className="py-1.5 px-3 text-right font-black text-xs font-mono">
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
                                          <td className="p-4 text-right font-bold text-green-600 font-mono">R$ {data.total.toFixed(2)}</td>
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
                                   <p className="text-3xl font-bold font-mono">R$ {methodTotal.toFixed(2)}</p>
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
                                       <td className="p-4 text-right font-bold font-mono">R$ {log.amount.toFixed(2)}</td>
                                     </tr>
                                   ));
                                 })()}
                               </tbody>
                             </table>
                           </div>
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
                                        <p className="text-lg font-black font-mono text-green-600 leading-none">R$ {stats.total.toFixed(2)}</p>
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
                                               <td className="py-1.5 px-3 text-right font-mono font-bold">R$ {itemData.total.toFixed(2)}</td>
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
              className="space-y-4"
            >
              <header className="flex items-center justify-between">
                <div>
                  <h2 className="font-serif italic text-2xl mb-1">Configurações</h2>
                  <p className="text-[10px] opacity-60 leading-none">Gerenciamento de periféricos e comportamento do sistema.</p>
                </div>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 h-full pb-4">
                {/* Column 1: Printers and Tests */}
                <div className="space-y-3 flex flex-col">
                  <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <Printer className="text-[#141414]" size={14} />
                      <h3 className="font-serif italic text-base leading-none">Direcionamento</h3>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {['pizzas', 'drinks', 'kitchen', 'receipts'].map((key) => (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-0.5">
                            <label className="text-[7px] uppercase font-bold opacity-40">
                              {key === 'pizzas' ? 'Pizzas' : key === 'drinks' ? 'Bebidas' : key === 'kitchen' ? (printerConfig.kitchenLabel || 'Extra') : 'Recibos'}
                            </label>
                            {key === 'kitchen' && (
                              <input 
                                type="text"
                                value={printerConfig.kitchenLabel}
                                onChange={(e) => setPrinterConfig({...printerConfig, kitchenLabel: e.target.value})}
                                className="text-[7px] font-bold bg-transparent border-b border-[#141414]/10 focus:border-[#141414] outline-none px-1 text-right w-12"
                                placeholder="Nome"
                              />
                            )}
                          </div>
                          <select 
                            value={printerConfig[key as keyof typeof printerConfig]}
                            onChange={(e) => setPrinterConfig({...printerConfig, [key]: e.target.value})}
                            className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[9px] focus:ring-1 focus:ring-[#141414] outline-none appearance-none cursor-pointer"
                          >
                            <option value="">Selecione...</option>
                            {discoveredPrinters.map(p => (
                              <option key={p.ip} value={p.name}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                    
                    <button 
                      onClick={handleSavePrinters}
                      className="w-full bg-[#141414] text-[#E4E3E0] py-1 rounded-lg font-bold mt-2 hover:opacity-90 transition-opacity text-[8px] uppercase"
                    >
                      Salvar Dispositivos
                    </button>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm overflow-hidden flex-initial">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <Printer className="text-[#141414]" size={14} />
                        <h3 className="font-serif italic text-base leading-none">Teste</h3>
                      </div>
                      <Wifi size={10} className="text-green-500 animate-pulse" />
                    </div>
                    <div className="space-y-1 max-h-[100px] overflow-y-auto pr-1 scrollbar-hide">
                      {discoveredPrinters.slice(0, 4).map((printer) => (
                        <div key={printer.ip} className={`flex justify-between items-center px-1.5 py-1 rounded-lg border ${
                          printer.status === 'online' ? 'bg-green-50/20 border-green-100' : 'bg-red-50/20 border-red-100'
                        }`}>
                          <div className="flex flex-col">
                            <span className="text-[8px] font-bold leading-none">{printer.name}</span>
                            <span className="text-[6px] opacity-40">IP: {printer.ip}</span>
                          </div>
                          <button 
                            onClick={() => handleTestPrinter(printer.name)}
                            className="text-[6px] bg-[#141414] text-white px-1 py-0.5 rounded font-bold uppercase"
                          >
                            Testar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Column 2: Receipt Layout and Data */}
                <div className="space-y-3 flex flex-col">
                  <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <FileText className="text-[#141414]" size={14} />
                      <h3 className="font-serif italic text-base leading-none">Layout Cupom</h3>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="text-[7px] uppercase font-bold opacity-40 mb-0.5 block">Estabelecimento</label>
                        <input 
                          type="text"
                          value={printerConfig.establishmentName}
                          onChange={(e) => setPrinterConfig({...printerConfig, establishmentName: e.target.value})}
                          className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[9px] focus:ring-1 focus:ring-[#141414] outline-none"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[7px] uppercase font-bold opacity-40 mb-0.5 block">Endereço</label>
                          <input 
                            type="text"
                            value={printerConfig.address}
                            onChange={(e) => setPrinterConfig({...printerConfig, address: e.target.value})}
                            className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[9px] focus:ring-1 focus:ring-[#141414] outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[7px] uppercase font-bold opacity-40 mb-0.5 block">Telefone</label>
                          <input 
                            type="text"
                            value={printerConfig.phone}
                            onChange={(e) => setPrinterConfig({...printerConfig, phone: e.target.value})}
                            className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[9px] focus:ring-1 focus:ring-[#141414] outline-none"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[7px] uppercase font-bold opacity-40 mb-0.5 block">Rodapé</label>
                        <textarea 
                          value={printerConfig.receiptFooter}
                          onChange={(e) => setPrinterConfig({...printerConfig, receiptFooter: e.target.value})}
                          className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[9px] focus:ring-1 focus:ring-[#141414] outline-none resize-none"
                          rows={1}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="col-span-2">
                          <label className="text-[7px] uppercase font-bold opacity-40 mb-0.5 block">Fonte Itens</label>
                          <div className="flex bg-[#141414]/5 p-0.5 rounded-lg">
                            {['10px', '12px', '14px', '16px'].map((size) => (
                              <button
                                key={size}
                                onClick={() => setPrinterConfig({...printerConfig, itemFontSize: size})}
                                className={`flex-1 py-0.5 text-[8px] font-bold rounded-md transition-all ${printerConfig.itemFontSize === size ? 'bg-white shadow-sm' : 'opacity-40'}`}
                              >
                                {size === '10px' ? 'P' : size === '12px' ? 'M' : size === '14px' ? 'G' : 'XG'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button 
                          onClick={() => setPrinterConfig({...printerConfig, boldItems: !printerConfig.boldItems})}
                          className={`flex items-center justify-between px-2 py-1 rounded-lg border transition-all ${printerConfig.boldItems ? 'border-[#141414] bg-[#141414]/5' : 'border-[#141414]/10 opacity-40'}`}
                        >
                          <span className="text-[7px] font-bold uppercase">Negrito</span>
                          {printerConfig.boldItems && <CheckCircle size={8} className="text-green-600" />}
                        </button>

                        <button 
                          onClick={() => setPrinterConfig({...printerConfig, showWaiter: !printerConfig.showWaiter})}
                          className={`flex items-center justify-between px-2 py-1 rounded-lg border transition-all ${printerConfig.showWaiter ? 'border-[#141414] bg-[#141414]/5' : 'border-[#141414]/10 opacity-40'}`}
                        >
                          <span className="text-[7px] font-bold uppercase">Garçom</span>
                          {printerConfig.showWaiter && <CheckCircle size={8} className="text-green-600" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm flex-initial">
                    <div className="flex items-center space-x-2 mb-2">
                      <Lock className="text-[#141414]" size={14} />
                      <h3 className="font-serif italic text-base leading-none">Dados</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button className="flex items-center justify-center space-x-1.5 py-1.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors">
                        <Download size={12} />
                        <span className="text-[8px] font-bold uppercase">Exportar</span>
                      </button>
                      <button className="flex items-center justify-center space-x-1.5 py-1.5 bg-orange-50 text-orange-700 rounded-lg border border-orange-100 hover:bg-orange-100 transition-colors">
                        <RefreshCcw size={12} />
                        <span className="text-[8px] font-bold uppercase">Importar</span>
                      </button>
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm('Deseja inicializar o banco de dados com os dados padrão?')) return;
                        const toastId = toast.loading('Inicializando dados...');
                        try {
                          await seedDatabase();
                          toast.success('Banco de dados inicializado no Firebase!', { id: toastId });
                        } catch {
                          toast.warning('Firebase indisponível — dados carregados localmente para teste.', { id: toastId, duration: 5000 });
                        } finally {
                          initLocalData();
                        }
                      }}
                      className="w-full mt-2 py-1.5 bg-red-50 text-red-700 rounded-lg border border-red-100 text-[8px] font-bold uppercase"
                    >
                      Inicializar DB (Seed)
                    </button>
                  </div>
                </div>

                {/* Column 3: Preview */}
                <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col h-full overflow-hidden">
                  <div className="flex items-center space-x-2 mb-3">
                    <FileText className="text-[#141414]" size={14} />
                    <h3 className="font-serif italic text-base leading-none">Preview Cupom</h3>
                  </div>

                  <div className="bg-gray-50 p-2 rounded-lg border border-dashed border-[#141414]/10 flex justify-center flex-1 overflow-hidden min-h-0">
                    <div className="bg-white w-full max-w-[160px] shadow-sm p-3 text-[#141414] font-mono text-[7px] space-y-2 leading-tight overflow-hidden select-none">
                      <div className="text-center space-y-0.5">
                        <p className="font-bold text-[9px] uppercase truncate">{printerConfig.establishmentName}</p>
                        <p className="opacity-70 text-[6px] truncate">{printerConfig.address}</p>
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

                      <div className="pt-1 text-center opacity-70 italic text-[6px] truncate">
                        {printerConfig.receiptFooter}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              </motion.div>
            )}
        </AnimatePresence>
      </main>

      {(() => {
        const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
        const activeOrder = targetId ? orders.find(o => o.tableId === targetId && o.isComanda === isComandaSelected && o.status !== 'finalizada') : null;
        return activeOrder && (
          <PaymentModal 
            isOpen={isPaymentModalOpen}
            onClose={() => setIsPaymentModalOpen(false)}
            order={activeOrder}
            onPaymentComplete={(selectedItems, partialAmount, paymentMethod) => handlePaymentComplete(activeOrder.id, selectedItems, partialAmount, paymentMethod)}
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
                  .filter(t => t.id !== selectedTableId && t.status !== 'linked')
                  .map(target => (
                    <button 
                      key={target.id}
                      onClick={() => setTargetTableId(target.id)}
                      className={`p-2 rounded-lg border-2 transition-all ${
                        targetTableId === target.id ? 'border-[#141414] bg-[#141414] text-white' : 'border-[#141414]/10 hover:border-[#141414]/30'
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
          <div className="fixed inset-0 bg-black/50 z-[120] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-2 border-[#141414] space-y-6"
            >
              {!targetTableId ? (
                <>
                  <div className="text-center">
                    <h3 className="font-serif italic text-2xl">Transferir {isComandaSelected ? 'Comanda' : 'Mesa'}</h3>
                    <p className="text-sm opacity-50">Para qual {isComandaSelected ? 'comanda' : 'mesa'} deseja transferir esta conta?</p>
                  </div>

                  <div className="grid grid-cols-5 gap-2 max-h-60 overflow-y-auto p-2">
                    {(isComandaSelected ? comandas : tables)
                      .filter(t => t.id !== (isComandaSelected ? selectedComandaId : selectedTableId))
                      .map(target => (
                        <button 
                          key={target.id}
                          onClick={() => setTargetTableId(target.id)}
                          className={`p-2 rounded-lg border-2 transition-all ${
                            target.status === 'occupied' || target.status === 'bill_requested' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-[#141414]/10 hover:border-[#141414]/30 text-[#141414]'
                          }`}
                        >
                          <span className="text-xs font-bold">{target.id}</span>
                        </button>
                      ))}
                  </div>

                  <div className="flex space-x-3 pt-4">
                    <button 
                      onClick={() => setIsTransferModalOpen(false)}
                      className="flex-1 py-3 rounded-xl font-bold text-sm border border-[#141414]/10"
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-6">
                  {(() => {
                    const targetTable = (isComandaSelected ? comandas : tables).find(t => t.id === targetTableId);
                    const targetOrder = targetTable?.currentOrder ? orders.find(o => o.id === targetTable.currentOrder) : null;
                    const isOccupied = targetOrder && targetOrder.items.length > 0;

                    return (
                      <>
                        <div className="text-center">
                          <h3 className="font-serif italic text-2xl">Confirmar Transferência</h3>
                          <p className="text-sm opacity-50">
                            Transferindo da {isComandaSelected ? 'Comanda' : 'Mesa'} {isComandaSelected ? selectedComandaId : selectedTableId} para a {isComandaSelected ? 'Comanda' : 'Mesa'} {targetTableId}
                          </p>
                        </div>

                        {isOccupied ? (
                          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 space-y-3">
                            <p className="text-xs font-bold text-orange-800 uppercase">Atenção: Mesa Ocupada</p>
                            <p className="text-xs text-orange-700">Esta mesa já possui itens lançados. Os itens serão mesclados.</p>
                            <div className="max-h-32 overflow-y-auto space-y-1 pr-2">
                              {targetOrder.items.map(item => (
                                <div key={item.id} className="text-[10px] flex justify-between opacity-70">
                                  <span>{item.name}</span>
                                  <span>R$ {item.price.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs font-bold uppercase opacity-50">Motivo da Troca (Obrigatório)</p>
                            <textarea 
                              value={transferReason}
                              onChange={(e) => setTransferReason(e.target.value)}
                              placeholder="Informe o motivo da troca de mesa..."
                              className="w-full h-24 p-4 bg-gray-50 border border-[#141414]/10 rounded-2xl focus:outline-none focus:border-[#141414] transition-colors text-sm resize-none"
                              autoFocus
                            />
                          </div>
                        )}

                        <div className="flex space-x-3 pt-4">
                          <button 
                            onClick={() => {
                              setTargetTableId(null);
                              setTransferReason('');
                            }}
                            className="flex-1 py-3 rounded-xl font-bold text-sm border border-[#141414]/10"
                          >
                            Voltar
                          </button>
                          <button 
                            disabled={!isOccupied && !transferReason.trim()}
                            onClick={handleTransferTable}
                            className="flex-1 bg-orange-600 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-30"
                          >
                            {isOccupied ? 'Continuar e Mesclar' : 'Mover'}
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
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

                      <div className="space-y-2">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex flex-col space-y-0.5">
                            <div className="flex justify-between items-center text-sm">
                              <span className={item.removed ? 'line-through opacity-30' : ''}>
                                {item.quantity || 1}x {item.name}
                              </span>
                              <div className="flex flex-col items-end">
                                {item.discount && (
                                  <span className="text-[10px] line-through opacity-40 font-mono">
                                    R$ {item.price.toFixed(2)}
                                  </span>
                                )}
                                <span className="font-mono">
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
                                Desconto: - {item.discountType === 'percentage' ? `${item.discount}%` : `R$ ${item.discount.toFixed(2)}`}
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
                              const total = order.items.filter(i => !i.removed).reduce((acc, i) => {
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
                          <div className="pt-3 border-t border-dashed border-[#141414]/10 space-y-2">
                            <p className="text-[9px] uppercase font-bold opacity-40">Pagamentos</p>
                            {order.paymentLog.map((p, pIdx) => (
                              <div key={pIdx} className="flex justify-between items-center text-xs">
                                <div className="flex flex-col">
                                  <span className="font-medium text-[#141414]/70">
                                    {p.type === 'partial' ? 'Pagamento Parcial' : 'Pagamento de Itens'} ({p.method})
                                  </span>
                                  <span className="text-[8px] opacity-40">{new Date(p.timestamp).toLocaleTimeString()}</span>
                                </div>
                                <span className="font-mono font-bold text-green-600">R$ {p.amount.toFixed(2)}</span>
                              </div>
                            ))}
                            
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

      {/* Add Item Modal (ADM) */}
      <AnimatePresence>
        {isAddItemModalOpen && selectedTableId && (
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
                      onClick={() => handleAddItem(selectedTableId, item)}
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
