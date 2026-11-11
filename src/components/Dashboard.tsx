import React, { useState, useEffect, useRef } from 'react';
import { usePWA } from '../hooks/usePWA';
import { Table, Order, Waiter, StockItem, MenuCategory, MenuItem, MenuSubcategory, PizzeriaConfig } from '../types';
import socket from '../lib/socket';
import { supabase } from '../lib/supabase';
import { LayoutDashboard, Users, ChefHat, ShoppingCart, CheckCircle, XCircle, Package, AlertTriangle, Wallet, FileText, Settings, Printer, Calendar, Download, Wifi, Menu, X, Plus, PlusCircle, Trash2, Search, Pizza, Beer, Sandwich, Salad, Soup, Clock, Edit, Save, Link as LinkIcon, History, BarChart3, PieChart, TrendingUp, ListPlus, ArrowLeft, RefreshCcw, Lock, Database, Monitor, LogOut, CreditCard, MessageSquare, Eye, EyeOff, ChevronDown, ChevronRight, UserPlus, Bell, BellRing, Smartphone, QrCode, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PaymentModal from './PaymentModal';
import { ReservationButton } from './reservation/ReservationButton';
import { OrderNotificationBell } from './OrderNotificationBell';
import { useOrderNotifications, loadNotificationMode, saveNotificationMode, type NotificationMode } from '../hooks/useOrderNotifications';
import { OrderTimer } from './OrderTimer';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { MENU_CATEGORIES, PIZZA_FLAVORS, PIZZA_CRUSTS } from '../constants';
import { seedDatabase } from '../lib/seed';
import { LATEST_PR } from '../version';
import { useFirebase } from './FirebaseProvider';
import { TesteDeForgo } from './TesteDeForgo';

const PLAN_DEFAULT_MENU: MenuCategory[] = [
  {
    name: 'Pratos/Porção',
    type: 'lanches',
    items: [
      { id: 'fp1', name: 'Porção grande de Batata Frita', price: 25.00, ingredients: '' },
      { id: 'fp2', name: 'Porção de Tilápia', price: 32.00, ingredients: '' },
    ],
  },
  {
    name: 'Lanches',
    type: 'lanches',
    items: [
      { id: 'fl1', name: 'X Salada', price: 20.00, ingredients: '' },
      { id: 'fl2', name: 'Cachorro Quente', price: 15.00, ingredients: '' },
    ],
  },
  {
    name: 'Bebidas',
    type: 'bebidas',
    items: [
      { id: 'fb1', name: 'Coca-cola Lata', price: 6.00, ingredients: '' },
      { id: 'fb2', name: 'Água sem gás', price: 6.00, ingredients: '' },
    ],
  },
];

const PIZZA_DEFAULT_MENU: MenuCategory[] = [
  {
    name: 'Pizzas',
    type: 'pizzas',
    visible: true,
    items: [],
    subcategories: [
      {
        id: 'com-borda',
        name: 'Com Borda',
        position: 0,
        visible: true,
        items: [
          { id: 'pcb1', name: 'Mini com Borda',       price: 0, ingredients: '4 fatias · 20cm · 1 sabor' },
          { id: 'pcb2', name: 'Média com Borda',      price: 0, ingredients: '6 fatias · 30cm · até 2 sabores' },
          { id: 'pcb3', name: 'Grande com Borda',     price: 0, ingredients: '8 fatias · 35cm · até 4 sabores' },
          { id: 'pcb4', name: 'GG com Borda',         price: 0, ingredients: '12 fatias · 40cm · até 4 sabores' },
          { id: 'pcb5', name: 'Metro com Borda',      price: 0, ingredients: '24 fatias · 100x25cm · até 6 sabores' },
        ],
      },
      {
        id: 'sem-borda',
        name: 'Sem Borda',
        position: 1,
        visible: true,
        items: [
          { id: 'psb1', name: 'Mini sem Borda',       price: 0, ingredients: '4 fatias · 20cm · 1 sabor' },
          { id: 'psb2', name: 'Média sem Borda',      price: 0, ingredients: '6 fatias · 30cm · até 2 sabores' },
          { id: 'psb3', name: 'Grande sem Borda',     price: 0, ingredients: '8 fatias · 35cm · até 4 sabores' },
          { id: 'psb4', name: 'GG sem Borda',         price: 0, ingredients: '12 fatias · 40cm · até 4 sabores' },
          { id: 'psb5', name: 'Metro sem Borda',      price: 0, ingredients: '24 fatias · 100x25cm · até 6 sabores' },
        ],
      },
    ],
  } as any,
  {
    name: 'Bebidas',
    type: 'bebidas',
    visible: true,
    items: [
      { id: 'pb1', name: 'Coca-cola Lata', price: 6.00, ingredients: '' },
      { id: 'pb2', name: 'Água sem gás', price: 6.00, ingredients: '' },
      { id: 'pb3', name: 'Suco de Laranja', price: 10.00, ingredients: '' },
    ],
    subcategories: [],
  },
];

const PLAN_CONFIG = {
  free: {
    maxTables: 5,
    tablesLocked: true,
    comandasEnabled: false,
    comandasLocked: true,
    pizzaEnabled: false,
    pizzaLocked: true,
    kdsEnabled: false,
    kdsLocked: true,
    maxWaiters: 1,
    trialDays: 14,
  },
  essencial: {
    maxTables: 10,
    tablesLocked: true,
    comandasEnabled: false,
    comandasLocked: true,
    pizzaEnabled: false,
    pizzaLocked: true,
    kdsEnabled: false,
    kdsLocked: true,
    maxWaiters: 3,
    trialDays: 0,
  },
  premium: {
    maxTables: 40,
    tablesLocked: false,
    comandasEnabled: true,
    comandasLocked: false,
    pizzaEnabled: true,
    pizzaLocked: false,
    kdsEnabled: true,
    kdsLocked: false,
    maxWaiters: 10,
    trialDays: 0,
  },
} as const;

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
  pizzaSizes: any[];
  activeTab: 'overview' | 'waiters' | 'stock' | 'reports' | 'settings' | 'products';
  setActiveTab: (tab: 'overview' | 'waiters' | 'stock' | 'reports' | 'settings' | 'products') => void;
  isCashRegisterOpen: boolean;
  toggleCashRegister: (open: boolean, cashRegisterName?: string) => void;
  printerConfig: any;
  setPrinterConfig: (config: any) => void;
  pizzariaConfig: PizzeriaConfig;
  updatePizzeriaConfig: (config: PizzeriaConfig) => void;
  onLogout?: () => void;
  plan?: string;
  ownerCreatedAt?: string;
  tenantId?: string;
}

// ── ESC/POS builder ──────────────────────────────────────────────────────────
// Mapa Unicode → CP437 puro (padrão de fábrica de toda impressora térmica barata).
// Maiúsculas acentuadas ausentes do CP437 são mapeadas para seus equivalentes
// minúsculos que CP437 suporta — imprime em minúsculo mas com acento correto.
// NÃO usa ESC t para mudar code page (ignorado por muitos modelos).
const TO_CP437 = new Map<number, number>([
  // Minúsculas acentuadas presentes no CP437
  [0x00E7,0x87],[0x00FC,0x81],[0x00E9,0x82],[0x00E2,0x83],
  [0x00E4,0x84],[0x00E0,0x85],[0x00E5,0x86],
  [0x00EA,0x88],[0x00EB,0x89],[0x00E8,0x8A],[0x00EF,0x8B],
  [0x00EE,0x8C],[0x00EC,0x8D],[0x00F4,0x93],
  [0x00F6,0x94],[0x00F2,0x95],[0x00FB,0x96],[0x00F9,0x97],
  [0x00FF,0x98],[0x00E1,0xA0],[0x00ED,0xA1],[0x00F3,0xA2],
  [0x00FA,0xA3],[0x00F1,0xA4],
  // Maiúsculas presentes no CP437 (mantidas em maiúsculo)
  [0x00C7,0x80],[0x00C4,0x8E],[0x00C5,0x8F],[0x00C9,0x90],
  [0x00C6,0x92],[0x00D6,0x99],[0x00DC,0x9A],[0x00D1,0xA5],
  [0x00E6,0x91],
  // Maiúsculas acentuadas AUSENTES do CP437 → fallback para minúsculo CP437
  [0x00C1,0xA0],[0x00C0,0x85],[0x00C2,0x83],               // Á→á  À→à  Â→â
  [0x00C8,0x8A],[0x00CA,0x88],[0x00CB,0x89],               // È→è  Ê→ê  Ë→ë
  [0x00CC,0x8D],[0x00CD,0xA1],[0x00CE,0x8C],[0x00CF,0x8B], // Ì→ì  Í→í  Î→î  Ï→ï
  [0x00D2,0x95],[0x00D3,0xA2],[0x00D4,0x93],               // Ò→ò  Ó→ó  Ô→ô
  [0x00D9,0x97],[0x00DA,0xA3],[0x00DB,0x96],               // Ù→ù  Ú→ú  Û→û
  // ã e Ã não existem no CP437 — fallback para 'a'
  [0x00E3,0x61],[0x00C3,0x61],                             // ã→a  Ã→a
  // õ e Õ não existem no CP437 — fallback para 'o'
  [0x00F5,0x6F],[0x00D5,0x6F],                             // õ→o  Õ→o
  [0x00B0,0xF8],                                           // °
]);
// Multi-char fallbacks for Unicode chars that need more than one ASCII byte
const CP437_MULTI: [number, string][] = [
  [0x2013, '-'],[0x2014, '-'],[0x2015, '-'],   // en dash, em dash, horizontal bar
  [0x00BD, '1/2'],[0x00BC, '1/4'],[0x00BE, '3/4'], // fractions
  [0x2018, "'"],[0x2019, "'"],[0x201C, '"'],[0x201D, '"'], // smart quotes
  [0x2026, '...'],[0x2022, '*'],               // ellipsis, bullet
  [0x00AB, '<'],[0x00BB, '>'],                 // guillemets
  [0x00A0, ' '],[0x00AD, '-'],                 // nbsp, soft hyphen
];
const CP437_MULTI_MAP = new Map<number, string>(CP437_MULTI);

function escStr(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 128) { out.push(cp); continue; }
    if (TO_CP437.has(cp)) { out.push(TO_CP437.get(cp)!); continue; }
    if (CP437_MULTI_MAP.has(cp)) {
      for (const c of CP437_MULTI_MAP.get(cp)!) out.push(c.charCodeAt(0));
      continue;
    }
    out.push(0x3F);
  }
  return out;
}

function wordWrap(s: string, lineLen: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (cur.length + 1 + w.length <= lineLen) { cur += ' ' + w; }
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildEscPosKitchenTicket(
  items: any | any[],
  tableType: string,
  targetId: string | number,
  printerName: string,
  paperWidth: string
): number[] {
  const itemList: any[] = Array.isArray(items) ? items : [items];
  const wide = paperWidth === '80mm';
  const lineLen = wide ? 42 : 28;
  const b: number[] = [];

  const push = (...bytes: number[]) => b.push(...bytes);
  const lf = () => push(0x0A);
  const text = (s: string) => push(...escStr(s));
  const line = () => { text('-'.repeat(lineLen)); lf(); };

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const waiterName = itemList[0]?.waiterName || 'SISTEMA';

  push(0x1B, 0x40); // Init — mantém CP437 (padrão de fábrica)

  // Header — centered
  push(0x1B, 0x61, 0x01);
  push(0x1B, 0x45, 0x01); text('VIA PRODUCAO: ' + printerName.toUpperCase()); lf();
  push(0x1B, 0x45, 0x00);

  // Mesa / Comanda — double size
  push(0x1D, 0x21, 0x11, 0x1B, 0x45, 0x01);
  text(tableType.toUpperCase() + ' ' + String(targetId)); lf();
  push(0x1D, 0x21, 0x00, 0x1B, 0x45, 0x00);

  // Data e hora
  push(0x1B, 0x45, 0x01); text(dateStr + '  ' + timeStr); lf();
  push(0x1B, 0x45, 0x00);

  push(0x1B, 0x61, 0x00);
  line();

  // Itens — separados por linha tracejada
  itemList.forEach((item, idx) => {
    if (idx > 0) line();

    const qty = item.quantity > 1 ? String(item.quantity) + 'x ' : '1x ';
    const priceStr = item.price != null ? 'R$' + Number(item.price).toFixed(2).replace('.', ',') : '';
    // For pizzas with flavors, show base name only (strip "(flavors)" part)
    const isPizza = item.type === 'pizzas' || (item.flavors && item.flavors.length > 0);
    const baseName = isPizza ? (item.name || '').replace(/\s*\(.*?\)(\s*\+.*)?$/, '').trim() : (item.name || '');
    const firstLine = qty + baseName;
    // Nome em double-height
    push(0x1D, 0x21, 0x10);
    const dhLen = Math.floor(lineLen / 2);
    wordWrap(firstLine, dhLen).forEach(l => { text(l); lf(); });
    push(0x1D, 0x21, 0x00);
    // Preço em tamanho normal, alinhado à direita
    if (priceStr) {
      push(0x1B, 0x61, 0x02); // align right
      text(priceStr); lf();
      push(0x1B, 0x61, 0x00); // align left
    }

    // Sabores listados um por linha (deduplicados com prefixo Nx quando repetido)
    if (isPizza && item.flavors && item.flavors.length > 0) {
      const countMap = new Map<string, number>();
      item.flavors.forEach((f: string) => countMap.set(f, (countMap.get(f) || 0) + 1));
      countMap.forEach((count, name) => {
        const flavorLine = count > 1 ? `${count}x ${name.toUpperCase()}` : name.toUpperCase();
        wordWrap('- ' + flavorLine, lineLen).forEach(l => { text(l); lf(); });
      });
    }

    // Borda
    if (item.crust) {
      wordWrap('Borda: ' + item.crust.toUpperCase(), lineLen).forEach(l => { text(l); lf(); });
    }

    if (item.observations) {
      wordWrap('OBS: ' + item.observations.toUpperCase(), lineLen).forEach(l => { text(l); lf(); });
    }
  });

  // Garçom — garante tamanho normal e alinhamento esquerdo antes de imprimir
  push(0x1D, 0x21, 0x00); // normal size
  push(0x1B, 0x61, 0x00); // align left
  line();
  text('Garcom: ' + waiterName); lf();
  lf(); lf(); lf(); lf(); // avança papel para garçom ficar visível acima do corte

  // Corte parcial
  push(0x1D, 0x56, 0x41, 0x03);

  return b;
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
  printerConfig,
  firstSeenRef,
  fiscalConfig,
  onOpenNfce,
}: any) => {
  const { clockOffset, data: { pizzariaConfig, shiftStartedAt } } = useFirebase();
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
  const allItemsRemoved = activeOrder && activeOrder.items && activeOrder.items.length > 0 && activeOrder.items.every((i: any) => i.removed || i.paid) && activeOrder.status !== 'finalizada';

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

  const [guestModeActive, setGuestModeActive] = useState(false);
  const [guestList, setGuestList] = useState<string[]>([]);
  const [newGuestName, setNewGuestName] = useState('');
  const [assigningGuestToItemId, setAssigningGuestToItemId] = useState<string | null>(null);
  const [assignGuestInput, setAssignGuestInput] = useState('');

  // Sync guest list and auto-enable/disable mode (also handles baixa clearing guests)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const guests = activeOrder?.guests ?? [];
    setGuestList(guests);
    setGuestModeActive(guests.length > 0);
  }, [activeOrder?.id, JSON.stringify(activeOrder?.guests)]);

  const addGuestToList = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || guestList.includes(trimmed)) return trimmed || null;
    const updated = [...guestList, trimmed];
    setGuestList(updated);
    if (activeOrder) socket.emit('set_order_guests', { orderId: activeOrder.id, guests: updated });
    return trimmed;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end mb-3 shrink-0">
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => setGuestModeActive(v => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase transition-colors ${
              guestModeActive ? 'bg-indigo-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-[#141414]'
            }`}
            title="Modo Convidados"
          >
            <Users size={11} />
            {guestModeActive ? 'Convidados ✓' : 'Convidados'}
          </button>
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
              if (!activeOrder) return;
              const tableType = isComandaSelected ? 'Comanda' : 'Mesa';
              const tableId = targetId;
              const waiterName = waiters.find((w: any) => w.id === activeOrder.waiterId)?.name || 'N/A';
              const activeItems = (activeOrder.items || []).filter((i: any) => !i.removed);
              const total = activeItems.reduce((acc: number, i: any) => acc + i.price, 0);

              const receiptPrinterName = printerConfig.receipts;
              const printer = receiptPrinterName
                ? (printerConfig.registeredPrinters || []).find((p: any) => p.name === receiptPrinterName)
                : null;

              const is50mm = (printerConfig.paperWidth || '80mm') === '50mm';

              if (printer) {
                const lineLen = is50mm ? 32 : 48;
                const b: number[] = [];
                const push = (...bytes: number[]) => b.push(...bytes);
                const lf = () => push(0x0A);
                const text = (s: string) => push(...escStr(s));
                const line = () => { text('-'.repeat(lineLen)); lf(); };
                const center = () => push(0x1B, 0x61, 0x01);
                const left = () => push(0x1B, 0x61, 0x00);
                const bold = (on: boolean) => push(0x1B, 0x45, on ? 0x01 : 0x00);

                push(0x1B, 0x40); // init
                center();
                bold(true);
                text((printerConfig.establishmentName || 'ESTABELECIMENTO').toUpperCase()); lf();
                bold(false);
                if (printerConfig.address) { text(printerConfig.address); lf(); }
                if (printerConfig.phone) { text(`Tel: ${printerConfig.phone}`); lf(); }
                lf();
                bold(true); text('*** CONFERENCIA DE MESA ***'); lf(); bold(false);
                line();
                left();
                text(`${tableType}: ${tableId}`); lf();
                text(`Garcom: ${waiterName}`); lf();
                text(`Data: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`); lf();
                line();
                activeItems.forEach((item: any) => {
                  const label = `${item.quantity || 1}x ${item.name}`;
                  const price = `R$ ${item.price.toFixed(2)}`;
                  const spaces = Math.max(1, lineLen - label.length - price.length);
                  if (printerConfig.boldItems) bold(true);
                  text(label + ' '.repeat(spaces) + price); lf();
                  if (printerConfig.boldItems) bold(false);
                });
                line();
                bold(true);
                const totalLabel = 'TOTAL:';
                const totalVal = `R$ ${total.toFixed(2)}`;
                const totalSpaces = Math.max(1, lineLen - totalLabel.length - totalVal.length);
                text(totalLabel + ' '.repeat(totalSpaces) + totalVal); lf();
                bold(false);
                if (printerConfig.receiptFooter) {
                  lf(); center(); text(printerConfig.receiptFooter); lf();
                }
                push(0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x10); // feed + cut

                if (printer.ip) {
                  socket.emit('print_escpos', { ip: printer.ip, port: printer.port || 9100, data: b });
                } else {
                  socket.emit('print_escpos', { localName: printer.name, data: b });
                }
                toast.success(`Resumo enviado para ${receiptPrinterName}`, { description: `${tableType} ${tableId} · R$ ${total.toFixed(2)}` });
              } else {
                const printWindow = window.open('', '_blank');
                if (printWindow) {
                  const _pw = is50mm ? '192px' : '304px';
                  const _fs = is50mm ? '10px' : (printerConfig.itemFontSize || '12px');
                  const html = `<html><head><title>Resumo ${tableType} ${tableId}</title>
                    <style>body{font-family:monospace;padding:12px;width:${_pw};margin:0 auto;font-size:${_fs}}
                    .sep{border-top:1px dashed #000;margin:8px 0}.item{display:flex;justify-content:space-between;margin-bottom:4px}
                    @media print{body{width:100%;margin:0}}</style></head><body>
                    <div style="text-align:center"><b>${printerConfig.establishmentName || ''}</b><br/>${printerConfig.address || ''}<br/>
                    <b>*** CONFERENCIA DE MESA ***</b></div>
                    <div class="sep"></div>
                    <div>${tableType}: ${tableId}<br/>Garcom: ${waiterName}<br/>${new Date().toLocaleString('pt-BR')}</div>
                    <div class="sep"></div>
                    ${activeItems.map((i: any) => `<div class="item"><span>${i.quantity||1}x ${i.name}</span><span>R$ ${i.price.toFixed(2)}</span></div>`).join('')}
                    <div class="sep"></div>
                    <div style="text-align:right"><b>TOTAL: R$ ${total.toFixed(2)}</b></div>
                    <div style="text-align:center;font-size:9px;margin-top:12px">${printerConfig.receiptFooter || ''}</div>
                    <script>window.onload=()=>{window.print();window.close()}</script></body></html>`;
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
            <>
            <button
              onClick={() => {
                if (currentItem?.status === 'linked') {
                  toast.warning(`Mesa vinculada. Realize o pagamento na Mesa ${currentItem.linkedTo}.`);
                  return;
                }
                hasItems && pendingAmount > 0.01 && setIsPaymentModalOpen(true);
              }}
              disabled={currentItem?.status !== 'linked' && (!hasItems || pendingAmount <= 0.01)}
              className={`px-3 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase shadow-sm transition-colors flex items-center space-x-1 ${
                currentItem?.status === 'linked' || (hasItems && pendingAmount > 0.01)
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Wallet size={10} />
              <span>Pagar</span>
            </button>
            {fiscalConfig && onOpenNfce && (
              <button
                onClick={() => onOpenNfce(activeOrder.id, pendingAmount > 0.01 ? pendingAmount : activeOrder.total)}
                className="px-3 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase shadow-sm transition-colors flex items-center space-x-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <FileText size={10} />
                <span>NFC-e</span>
              </button>
            )}
            </>
          )}
          {allItemsRemoved && (
            <button
              onClick={() => {
                socket.emit('update_order_status', { orderId: activeOrder.id, status: 'aguardando_baixa' });
                setTimeout(() => {
                  socket.emit('confirm_baixa', { orderId: activeOrder.id });
                  toast.success('Mesa liberada!');
                }, 300);
              }}
              className="px-3 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase shadow-sm bg-red-600 hover:bg-red-700 text-white flex items-center space-x-1"
            >
              <span>Liberar Mesa</span>
            </button>
          )}
        </div>
      </div>
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
              currentItem?.status === 'free' ? 'bg-gray-100 text-[#141414]'
              : currentItem?.status === 'linked' ? 'bg-blue-100 text-blue-700'
              : 'bg-[#141414] text-[#E4E3E0]'
            }`}>
              {currentItem?.status === 'occupied' ? 'ocupada'
               : currentItem?.status === 'free' ? 'livre'
               : currentItem?.status === 'linked' ? `Juntou c/ Mesa ${currentItem.linkedTo}`
               : currentItem?.status === 'aguardando_baixa' ? 'Ag. Baixa'
               : currentItem?.status}
            </span>
          </div>
        </div>
      </div>
      
      {/* Guest mode panel */}
      {guestModeActive && (
        <div className="mx-6 mb-3 bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-2 shrink-0">
          <p className="text-[10px] font-bold uppercase text-indigo-600 tracking-widest">Convidados</p>
          <div className="flex flex-wrap gap-1.5">
            {guestList.map(g => (
              <span key={g} className="flex items-center gap-1 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                {g}
                <button onClick={() => {
                  const updated = guestList.filter(x => x !== g);
                  setGuestList(updated);
                  if (activeOrder) socket.emit('set_order_guests', { orderId: activeOrder.id, guests: updated });
                  if (updated.length === 0) setGuestModeActive(false);
                }} className="opacity-70 hover:opacity-100"><X size={9} /></button>
              </span>
            ))}
            {guestList.length === 0 && <p className="text-[10px] text-indigo-400 italic">Nenhum convidado ainda.</p>}
          </div>
          <div className="flex gap-2">
            <input
              value={newGuestName}
              onChange={e => setNewGuestName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { addGuestToList(newGuestName); setNewGuestName(''); } }}
              placeholder="Nome do convidado..."
              className="flex-1 text-xs px-2 py-1.5 border border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => { addGuestToList(newGuestName); setNewGuestName(''); }}
              className="bg-indigo-600 text-white px-2 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 flex items-center gap-1"
            >
              <UserPlus size={12} /> Add
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 pt-0 scrollbar-hide">
        {activeOrder ? (
          <div className="space-y-4">
            <div className="border-b pb-2 space-y-1 pr-1">
              {(activeOrder.items || []).map((item: any, idx: number) => (
                <div key={item.id} className={`flex justify-between items-start text-sm gap-3 px-2 py-1 rounded-md ${item.removed ? 'opacity-30 line-through' : ''} ${item.paid ? 'bg-green-50/50 border border-green-100/50 mb-1' : idx % 2 === 0 ? 'bg-transparent' : 'bg-[#141414]/[0.04]'}`}>
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-bold ${item.paid ? 'text-green-700' : ''}`}>
                        {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                      </span>
                      {item.paid && (
                        <span className="text-[8px] bg-green-600 text-white px-1.5 py-0.5 rounded uppercase font-bold shrink-0">pago</span>
                      )}
                      {!item.removed && !item.paid && (item.type === 'pizzas' || item.type === 'lanches' || item.type === 'porcoes' || item.type === 'lacarte') && !item.deliveredAt && (() => {
                        if (!item.timestamp) return null; // sem timestamp = sem contagem
                        const elapsedMin = ((Date.now() - clockOffset) - new Date(item.timestamp).getTime()) / 60000;
                        return (
                          <OrderTimer
                            timestamp={item.timestamp}
                            urgent={!!(pizzariaConfig?.enabled && elapsedMin >= (pizzariaConfig?.redMinutes ?? 30))}
                            clockOffset={clockOffset}
                          />
                        );
                      })()}
                      {!item.removed && !item.paid && (item.type === 'pizzas' || item.type === 'lanches' || item.type === 'porcoes' || item.type === 'lacarte') && !item.deliveredAt && (pizzariaConfig?.kdsEnabled ?? false) && (
                        item.kitchenStatus === 'ready' ? (
                          <span className="text-[9px] bg-green-600 text-white px-2 py-0.5 rounded-full font-bold animate-pulse shrink-0">✓ Pronto — Retirar</span>
                        ) : item.kitchenStatus === 'oven' ? (
                          <span className="text-[9px] bg-orange-600 text-white px-2 py-0.5 rounded-full font-bold shrink-0">No Forno...</span>
                        ) : item.kitchenStatus === 'preparing' ? (
                          <span className="text-[9px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold shrink-0">Em preparo...</span>
                        ) : (
                          <span className="text-[9px] bg-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full font-bold shrink-0">Na fila</span>
                        )
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
                    {guestModeActive && !item.removed && !item.paid && (
                      assigningGuestToItemId === item.id ? (
                        <div className="flex items-center gap-1 mt-1" onClick={e => e.stopPropagation()}>
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
                                  if (val) { addGuestToList(val); socket.emit('set_item_guest', { orderId: activeOrder.id, itemId: item.id, guestName: val }); }
                                  setAssigningGuestToItemId(null); setAssignGuestInput('');
                                }
                              }}
                            />
                          ) : (
                            <button onClick={() => { socket.emit('set_item_guest', { orderId: activeOrder.id, itemId: item.id, guestName: assignGuestInput || null }); setAssigningGuestToItemId(null); setAssignGuestInput(''); }}
                              className="text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-bold">OK</button>
                          )}
                          <button onClick={() => { setAssigningGuestToItemId(null); setAssignGuestInput(''); }} className="text-red-400"><X size={9} /></button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setAssigningGuestToItemId(item.id); setAssignGuestInput(item.guestName || ''); }}
                          className={`mt-0.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-bold text-[9px] self-start transition-colors ${item.guestName ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
                        >
                          <Users size={8} />{item.guestName || 'Vincular'}
                        </button>
                      )
                    )}
                    {(!guestModeActive || item.removed || item.paid) && item.guestName && (
                      <span className="mt-0.5 flex items-center gap-0.5 bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-bold text-[9px] self-start">
                        <Users size={8} />{item.guestName}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-mono font-bold whitespace-nowrap ${item.paid ? 'text-green-700' : ''}`}>
                      R$ {(() => {
                        let price = item.price ?? 0;
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
  pizzaSizes,
  activeTab,
  setActiveTab,
  isCashRegisterOpen,
  toggleCashRegister,
  printerConfig,
  setPrinterConfig,
  pizzariaConfig,
  updatePizzeriaConfig,
  onLogout,
  plan = 'free',
  ownerCreatedAt,
  tenantId = '',
}: DashboardProps) {
  const { updateTableStatusLocal, logout, clockOffset, activeCashRegisterName, data: { shiftStartedAt } } = useFirebase();
  useEffect(() => { document.title = 'Painel - FechaConta'; return () => { document.title = 'FechaConta - PDV'; }; }, []);

  const [notificationMode, setNotificationMode] = useState<NotificationMode>(() => loadNotificationMode());
  const handleNotificationModeChange = (mode: NotificationMode) => { setNotificationMode(mode); saveNotificationMode(mode); };
  const { notifications, unreadCount, markAllRead, clearAll, addCallNotification } = useOrderNotifications(orders, notificationMode, isCashRegisterOpen);

  // Ouve chamadas de garçom via socket
  useEffect(() => {
    const handler = ({ tableId }: { tableId: number }) => {
      addCallNotification(tableId);
      setCallingTables(prev => new Set(prev).add(tableId));
      if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
      try {
        if (callingAudioRef.current) { callingAudioRef.current.pause(); }
        const audio = new Audio('/sounds/call-waiter.mp3');
        audio.loop = true;
        audio.play();
        callingAudioRef.current = audio;
      } catch {}
    };
    socket.on('waiter_called', handler);
    return () => { socket.off('waiter_called', handler); };
  }, [addCallNotification]);

  useEffect(() => {
    const handler = (alerts: { name: string; quantity: number; minQuantity: number }[]) => {
      setStockLowAlerts(prev => {
        const existing = new Set(prev.map(a => a.name));
        const newAlerts = alerts.filter(a => !existing.has(a.name));
        return newAlerts.length > 0 ? [...prev, ...newAlerts] : prev;
      });
    };
    socket.on('stock_low_alert', handler);
    return () => { socket.off('stock_low_alert', handler); };
  }, []);

  // Verifica itens já abaixo do mínimo ao carregar o estoque pela primeira vez
  const stockInitCheckedRef = useRef(false);
  useEffect(() => {
    if (stockInitCheckedRef.current || stock.length === 0) return;
    stockInitCheckedRef.current = true;
    const below = stock.filter((s: any) => s.minQuantity > 0 && s.quantity <= s.minQuantity);
    if (below.length > 0) {
      setStockLowAlerts(below.map((s: any) => ({ name: s.name, quantity: s.quantity, minQuantity: s.minQuantity })));
    }
  }, [stock]);

  // Estado do modal Chama Garçom
  const [callWaiterModal, setCallWaiterModal] = useState(false);
  const [callWaiterTable, setCallWaiterTable] = useState(1);
  const [callWaiterRateLimit, setCallWaiterRateLimit] = useState(3);
  const callWaiterUrl = callWaiterModal
    ? `${window.location.origin}/chamar/${tenantId}/${callWaiterTable}?rl=${callWaiterRateLimit}`
    : '';

  // Mesas que estão chamando o garçom (sino pulsando)
  const [callingTables, setCallingTables] = useState<Set<number>>(new Set());
  const [callingTablePopup, setCallingTablePopup] = useState<number | null>(null);
  const callingAudioRef = useRef<HTMLAudioElement | null>(null);

  // Drag & drop de transferência de mesa
  const [stockLowAlerts, setStockLowAlerts] = useState<{ name: string; quantity: number; minQuantity: number }[]>([]);

  const [dragSourceTable, setDragSourceTable] = useState<number | null>(null);
  const [dragSourceComanda, setDragSourceComanda] = useState<number | null>(null);
  const [transferPopup, setTransferPopup] = useState<{ source: number; target: number; isComanda?: boolean } | null>(null);
  const [dragTransferMode, setDragTransferMode] = useState<'all' | 'items'>('all');
  const [dragSelectedIds, setDragSelectedIds] = useState<Record<string, boolean>>({});

  // Client-side first-seen tracking for items and orders — avoids stale DB timestamps.
  const firstSeenRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const now = Date.now();
    orders.forEach((o: any) => {
      const orderKey = `order:${o.id}`;
      (o.items || []).forEach((item: any) => {
        const itemKey = String(item.id);
        if (itemKey && !firstSeenRef.current.has(itemKey)) {
          firstSeenRef.current.set(itemKey, now);
          if (!firstSeenRef.current.has(orderKey)) {
            firstSeenRef.current.set(orderKey, now);
          }
        }
      });
    });
  }, [orders]);

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
  const [isRemoveAllTableItems, setIsRemoveAllTableItems] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [isFlavorModalOpen, setIsFlavorModalOpen] = useState(false);
  const [selectedPizzaItem, setSelectedPizzaItem] = useState<any>(null);
  const [selectedFlavors, setSelectedFlavors] = useState<any[]>([]);
  const [maxFlavors, setMaxFlavors] = useState(1);
  const [selectionStep, setSelectionStep] = useState<'border_choice' | 'build'>('border_choice');
  const [pizzaHasBorder, setPizzaHasBorder] = useState(false);
  const [selectedCrusts, setSelectedCrusts] = useState<string[]>([]);
  const [selectedPizzaSize, setSelectedPizzaSize] = useState<string | null>(null);
  const [pizzaObservations, setPizzaObservations] = useState('');
  const [crustObservations, setCrustObservations] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const productsScrollRef = React.useRef<HTMLDivElement>(null);
  const [isSizeModalOpen, setIsSizeModalOpen] = useState(false);
  const [editingSize, setEditingSize] = useState<any>(null);
  const [editingSizeIndex, setEditingSizeIndex] = useState<number>(-1);
  const [sizeForm, setSizeForm] = useState({ name: '', slices: 4, dim: '', people: '', maxFlavors: 2, detail: '', basePrice: 0 });
  const [isCrustModalOpen, setIsCrustModalOpen] = useState(false);
  const [editingCrustName, setEditingCrustName] = useState('');
  const [editingCrustOriginal, setEditingCrustOriginal] = useState('');
  const [newCrustName, setNewCrustName] = useState('');
  const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
  const [selectedQuantityItem, setSelectedQuantityItem] = useState<any>(null);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemObservations, setItemObservations] = useState('');
  const [admGuestForItem, setAdmGuestForItem] = useState('');
  const [admModalNewGuest, setAdmModalNewGuest] = useState('');
  const [admLocalGuests, setAdmLocalGuests] = useState<string[]>([]);
  // Sinaliza que o add-item modal fechou para abrir sub-modal (quantidade/pizza)
  // e não deve limpar os convidados selecionados
  const admOpeningSubModal = React.useRef(false);
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
  const [currentReportView, setCurrentReportView] = useState<'items_specific' | 'items_all' | 'sales_by_day' | 'sales_by_payment' | 'waiter_performance' | 'table_sales' | 'delivery_time' | 'cash_register' | null>(null);
  const [cashRegReportDate, setCashRegReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [cashRegReportList, setCashRegReportList] = useState<any[]>([]);
  const [cashRegReportLoading, setCashRegReportLoading] = useState(false);
  const [reportSelectedTable, setReportSelectedTable] = useState<string>('todas');
  const [snoozeMap, setSnoozeMap] = useState<Record<string, number>>({});
  const [inactivityPopup, setInactivityPopup] = useState<{ tableId: number; isComanda: boolean; minutes: number } | null>(null);
  const [, forceInactivityUpdate] = useState(0);
  const prevActivityRef = useRef<Record<string, number>>({});
  const [printerAgentOnline, setPrinterAgentOnline] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanPrinters, setScanPrinters] = useState<{ip?: string; port?: number; localName?: string; portName?: string; status?: string}[]>([]);
  const [agentPairingCode, setAgentPairingCode] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const [scanAssigning, setScanAssigning] = useState<{name: string; ip: string; port: number; localName?: string; portName?: string} | null>(null);
  const { canInstall, install, isInstalled } = usePWA('dashboard');

  // Estado local do card "Estrutura do Salão" (salvo só ao clicar em Salvar)
  const [localNumTables, setLocalNumTables] = useState<number>(pizzariaConfig.numTables ?? 10);
  const [localNumComandas, setLocalNumComandas] = useState<number>(pizzariaConfig.numComandas ?? 50);
  const [localMaxWaiters, setLocalMaxWaiters] = useState<number>(pizzariaConfig.maxWaiters ?? 10);
  const [localLogoUrl, setLocalLogoUrl] = useState<string>(printerConfig.logoUrl || '');
  const [savingConfig, setSavingConfig] = useState(false);
  const [cashRegisterPickerOpen, setCashRegisterPickerOpen] = useState(false);
  const [localCashRegisters, setLocalCashRegisters] = useState<{ id: string; name: string }[]>(() => pizzariaConfig.cashRegisters ?? []);
  const [newRegisterName, setNewRegisterName] = useState('');
  const [cashRegisterReportModal, setCashRegisterReportModal] = useState(false);
  const [pendingCloseRegisterName, setPendingCloseRegisterName] = useState<string | undefined>(undefined);

  // Sincroniza estado local quando dados do servidor chegam
  useEffect(() => {
    setLocalNumTables(pizzariaConfig.numTables ?? 10);
    setLocalNumComandas(pizzariaConfig.numComandas ?? 50);
    setLocalMaxWaiters(pizzariaConfig.maxWaiters ?? 10);
  }, [pizzariaConfig.numTables, pizzariaConfig.numComandas, pizzariaConfig.maxWaiters]);

  useEffect(() => {
    setLocalCashRegisters(pizzariaConfig.cashRegisters ?? []);
  }, [pizzariaConfig.cashRegisters]);

  useEffect(() => {
    setLocalLogoUrl(printerConfig.logoUrl || '');
  }, [printerConfig.logoUrl]);

  const salonDirty =
    localNumTables !== (pizzariaConfig.numTables ?? 10) ||
    localNumComandas !== (pizzariaConfig.numComandas ?? 50) ||
    localMaxWaiters !== (pizzariaConfig.maxWaiters ?? 10) ||
    localLogoUrl !== (printerConfig.logoUrl || '');

  const saveSalonConfig = async () => {
    setSavingConfig(true);
    updatePizzeriaConfig({ ...pizzariaConfig, numTables: localNumTables, numComandas: Math.min(50, localNumComandas), maxWaiters: Math.max(1, Math.min(40, localMaxWaiters)) });
    (setPrinterConfig as any)((prev: any) => {
      const updated = { ...prev, logoUrl: localLogoUrl };
      localStorage.setItem('printerConfig', JSON.stringify(updated));
      return updated;
    });
    await new Promise(r => setTimeout(r, 600));
    setSavingConfig(false);
    toast.success('Configurações do salão salvas!');
  };

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
      (i: any) => !i.removed && !i.paid && !i.deliveredAt && (i.type === 'pizzas' || i.type === 'lanches' || i.type === 'porcoes' || i.type === 'lacarte')
    );
    if (pending.length === 0) return null;
    const now = Date.now() - clockOffset;
    const shiftMs = shiftStartedAt ? new Date(shiftStartedAt).getTime() : 0;
    let oldest = Infinity;
    for (const i of pending) {
      const rawMs = i.timestamp ? new Date(i.timestamp).getTime() : 0;
      if (rawMs === 0) continue; // no timestamp — ignore per requirement
      const startMs = shiftMs > 0 ? Math.max(rawMs, shiftMs) : rawMs;
      if (startMs < oldest) oldest = startMs;
    }
    if (!isFinite(oldest)) return 'green'; // no valid timestamps = just started = green
    const elapsed = (now - oldest) / 60000;
    if (elapsed >= pizzariaConfig.redMinutes) return 'red';
    if (elapsed >= pizzariaConfig.orangeMinutes) return 'orange';
    if (elapsed >= pizzariaConfig.yellowMinutes) return 'yellow';
    return 'green';
  };
  const [isEditProductModalOpen, setIsEditProductModalOpen] = useState(false);
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [editProductTab, setEditProductTab] = useState<'geral'|'fiscal'>('geral');
  const [addProductTab, setAddProductTab] = useState<'geral'|'fiscal'>('geral');
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isAddCategoryPopupOpen, setIsAddCategoryPopupOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{oldName: string, name: string, visible: boolean, type: string} | null>(null);
  const [newCategoryData, setNewCategoryData] = useState({ name: '', type: 'lanches' });
  const [newProductCategory, setNewProductCategory] = useState<string | null>(null);
  const [newProductSubcategoryId, setNewProductSubcategoryId] = useState<string | null>(null);
  const [newProductData, setNewProductData] = useState({ name: '', price: 0, ingredients: '' });
  const [isAddSubcategoryModalOpen, setIsAddSubcategoryModalOpen] = useState(false);
  const [newSubcategoryData, setNewSubcategoryData] = useState({ categoryName: '', name: '' });
  const [editingSubcategory, setEditingSubcategory] = useState<{categoryName: string, subcategoryId: string, name: string} | null>(null);
  const [isEditFlavorModalOpen, setIsEditFlavorModalOpen] = useState(false);
  const [isAddFlavorModalOpen, setIsAddFlavorModalOpen] = useState(false);
  const [editingFlavor, setEditingFlavor] = useState<any>(null);
  const [newFlavorData, setNewFlavorData] = useState({ name: '', ingredients: '', price: 0 });
  const [editingProduct, setEditingProduct] = useState<{categoryName: string, subcategoryId?: string, item: MenuItem} | null>(null);

  const [stockEdits, setStockEdits] = useState<Record<string, { quantity: string; minQuantity: string; unit: string }>>({});
  const [isStockHistoryModalOpen, setIsStockHistoryModalOpen] = useState(false);
  const [stockAdjustPending, setStockAdjustPending] = useState<{ menuItemId: string; quantity: number; minQuantity: number; unit: string; itemName: string; change: number } | null>(null);
  const [stockAdjustReason, setStockAdjustReason] = useState('');
  const [stockHistoryStart, setStockHistoryStart] = useState(new Date().toISOString().split('T')[0]);
  const [stockHistoryEnd, setStockHistoryEnd] = useState(new Date().toISOString().split('T')[0]);

  const importFileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{
    menu: any[]; stock: any[]; stockLog: any[];
    pizzaFlavors: any[]; pizzaCrusts: any[];
    pizzariaConfig?: any; printerConfig?: any;
    finEmployees: any[]; finPayments: any[]; finExpenses: any[];
    fileName: string; version?: string;
  } | null>(null);
  const [importingFin, setImportingFin] = useState(false);

  const [isSeedModalOpen, setIsSeedModalOpen] = useState(false);
  const [seedSteps, setSeedSteps] = useState<string[]>([]);
  const [isSeedComplete, setIsSeedComplete] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [qrMesaModal, setQrMesaModal] = useState<{ num: number } | null>(null);
  const [qrMesaSelected, setQrMesaSelected] = useState<number>(1);
  const [settingsTab, setSettingsTab] = useState<'salon' | 'operation' | 'print' | 'data' | 'fiscal'>('salon');
  const [fiscalConfig, setFiscalConfig] = useState<any>(null);
  const [fiscalConfigLoading, setFiscalConfigLoading] = useState(false);
  const [fiscalConfigSaving, setFiscalConfigSaving] = useState(false);
  const [sefazStatus, setSefazStatus] = useState<{
    checking: boolean;
    nfce: { online: boolean; cStat: string; xMotivo: string } | null;
    nfe:  { online: boolean; cStat: string; xMotivo: string } | null;
    checkedAt: string | null;
  }>({ checking: false, nfce: null, nfe: null, checkedAt: null });
  const [nfceModal, setNfceModal] = useState<{ orderId: number | string; total: number } | null>(null);
  const [nfceCpf, setNfceCpf] = useState('');
  const [nfcePagamento, setNfcePagamento] = useState<'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix' | 'outros'>('dinheiro');
  const [nfceEmitting, setNfceEmitting] = useState(false);
  const [nfceResult, setNfceResult] = useState<any>(null);
  const [fiscalNotes, setFiscalNotes] = useState<any[]>([]);
  const [cancelModal, setCancelModal] = useState<{ chaveAcesso: string; modelo: string; orderId: string | number } | null>(null);
  const [cancelMotivo, setCancelMotivo] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [inutilizarModal, setInutilizarModal] = useState(false);
  const [inutilizarForm, setInutilizarForm] = useState({ modelo: '65' as '55' | '65', serie: '', nNFIni: '', nNFFin: '', xJust: '' });
  const [inutilizarLoading, setInutilizarLoading] = useState(false);
  const [nfceContingenciaMode, setNfceContingenciaMode] = useState<'normal' | 'offline' | 'epec' | 'svcrs'>('normal');
  const [nfceDhCont, setNfceDhCont] = useState('');
  const [nfceXJust, setNfceXJust] = useState('');

  const handleFixTables = async () => {
    try {
      const res = await fetch('/api/fix-tables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenantId || 'default' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
      toast.success(`Mesas corrigidas: ${data.fixed} liberada(s)`);
    } catch (error: any) {
      toast.error(`Erro ao corrigir mesas: ${error.message}`);
    }
  };

  const handleSeedMenu = async () => {
    try {
      const res = await fetch('/api/seed-menu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenantId || 'default' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
      toast.success('Cardápio atualizado com sucesso!');
    } catch (error: any) {
      toast.error(`Erro ao atualizar cardápio: ${error.message}`);
    }
  };

  const handleSeedDatabase = async () => {
    setIsSeedModalOpen(true);
    setIsSeeding(true);
    setSeedSteps([]);
    setIsSeedComplete(false);

    try {
      const res = await fetch('/api/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenantId || 'default' }) });
      const data = await res.json();

      if (data.steps) setSeedSteps(data.steps);

      if (!res.ok) throw new Error(data.error || 'Erro desconhecido');

      setSeedSteps(prev => [...prev, 'Liberando mesas e zerando pedidos...']);
      socket.emit('reset_system');

      setSeedSteps(prev => [...prev, 'Aplicando cardápio padrão do plano...']);
      const seedMenu = pizzariaConfig.enabled ? PIZZA_DEFAULT_MENU : PLAN_DEFAULT_MENU;
      socket.emit('bulk_import', { menu: seedMenu });
      localStorage.removeItem('plan_menu_seeded');
      localStorage.setItem('plan_menu_seeded', '1');

      setSeedSteps(prev => [...prev, 'Concluído!']);
      setIsSeedComplete(true);
      setIsSeeding(false);
    } catch (error: any) {
      console.error('Seed process failed:', error);
      setSeedSteps(prev => [...prev, `Erro: ${error.message}`]);
      setIsSeeding(false);
      toast.error('Erro na inicialização');
    }
  };

  // Derive plan config — falls back to free
  const planKey = (plan in PLAN_CONFIG ? plan : 'free') as keyof typeof PLAN_CONFIG;
  const planCfg = PLAN_CONFIG[planKey];
  // Admin pode sobrescrever o limite de garçons nas configurações (até 40)
  const effectiveMaxWaiters = pizzariaConfig.maxWaiters ?? planCfg.maxWaiters;

  // Map internal type values to display labels
  const typeLabel = (type: string) => {
    if (type === 'pizzas') return 'Pizzas';
    if (type === 'lanches') return 'Lanches';
    if (type === 'bebidas') return 'Bebidas';
    if (type === 'porcoes') return 'Porções';
    if (type === 'lacarte') return 'À la carte';
    return type;
  };

  // Filter "Outros" + pizza categories when pizza mode is disabled
  const displayMenu = menu.filter(cat => {
    if (cat.name === 'Outros') return false;
    if (cat.type === 'pizzas' && !pizzariaConfig.enabled) return false;
    return true;
  });

  // Enforce plan-based restrictions on pizzariaConfig
  useEffect(() => {
    if (!pizzariaConfig) return;
    const cfg = PLAN_CONFIG[(plan in PLAN_CONFIG ? plan : 'free') as keyof typeof PLAN_CONFIG];
    // kdsEnabled só é forçado quando o plano não permite escolha (kdsLocked)
    const kdsNeedsUpdate = cfg.kdsLocked && (pizzariaConfig.kdsEnabled ?? false) !== cfg.kdsEnabled;
    const needsUpdate =
      (cfg.tablesLocked && pizzariaConfig.numTables !== cfg.maxTables) ||
      pizzariaConfig.comandasEnabled !== cfg.comandasEnabled ||
      pizzariaConfig.enabled !== cfg.pizzaEnabled ||
      kdsNeedsUpdate;
    if (needsUpdate) {
      updatePizzeriaConfig({
        ...pizzariaConfig,
        numTables: cfg.tablesLocked ? cfg.maxTables : (pizzariaConfig.numTables ?? cfg.maxTables),
        comandasEnabled: cfg.comandasEnabled,
        enabled: cfg.pizzaEnabled,
        ...(cfg.kdsLocked ? { kdsEnabled: cfg.kdsEnabled } : {}),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, pizzariaConfig.numTables]);

  // Seed default menu once when menu is empty
  useEffect(() => {
    const seedKey = 'plan_menu_seeded';
    if (localStorage.getItem(seedKey)) return;
    if (menu.length > 0) {
      localStorage.setItem(seedKey, '1');
      return;
    }
    const seedMenu = pizzariaConfig.enabled ? PIZZA_DEFAULT_MENU : PLAN_DEFAULT_MENU;
    socket.emit('bulk_import', { menu: seedMenu });
    localStorage.setItem(seedKey, '1');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, menu.length, pizzariaConfig.enabled]);

  const handleTestPrinter = (printerName: string) => {
    if (!printerName || printerName === 'none') {
      toast.info('Nenhuma impressora configurada para este canal.');
      return;
    }
    const printer = (printerConfig.registeredPrinters || []).find((p: any) => p.name === printerName);
    if (!printer) { toast.error('Impressora não encontrada.'); return; }

    // Monta página de teste ESC/POS
    const wide = (printerConfig.paperWidth || '80mm') !== '50mm';
    const lineLen = wide ? 42 : 24;
    const b: number[] = [];
    const push = (...bytes: number[]) => b.push(...bytes);
    const lf = () => push(0x0A);
    const text = (s: string) => push(...escStr(s));
    const line = () => { text('-'.repeat(lineLen)); lf(); };
    const now = new Date();

    push(0x1B, 0x40); // init
    push(0x1B, 0x61, 0x01); // center
    push(0x1B, 0x45, 0x01); text(printerConfig.establishmentName || 'FECHACONTA PDV'); lf();
    push(0x1B, 0x45, 0x00);
    line();
    push(0x1D, 0x21, 0x11, 0x1B, 0x45, 0x01);
    text('TESTE OK'); lf();
    push(0x1D, 0x21, 0x00, 0x1B, 0x45, 0x00);
    line();
    text(printerName.toUpperCase()); lf();
    if (printer.ip) text('IP: ' + printer.ip + ':' + (printer.port || 9100));
    else text('USB: ' + (printer.localName || printer.name));
    lf();
    text(now.toLocaleDateString('pt-BR') + '  ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })); lf();
    push(0x1B, 0x61, 0x00);
    line();
    push(0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x10); // feed + cut

    if (printer.ip) {
      // Impressora de rede (IP conhecido) — TCP direto é mais confiável que o spooler do Windows
      socket.emit('print_escpos', { ip: printer.ip, port: printer.port || 9100, data: b });
      toast.success(`Teste enviado para ${printerName}`, { description: `TCP: ${printer.ip}:${printer.port || 9100}` });
    } else if (printer.localName) {
      // Impressora local (USB) descoberta via Windows — usa spooler
      socket.emit('print_escpos', { localName: printer.localName, data: b });
      toast.success(`Teste enviado para ${printerName}`, { description: `Spooler Windows: ${printer.localName}` });
    } else {
      toast.error('Configure o IP ou recadastre a impressora via busca.');
    }
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
      setSelectedCategory(null);
      setSelectedSubcategory(null);
      // Só limpa convidados se o modal fechou por cancelamento (não por transição para sub-modal)
      if (!admOpeningSubModal.current) {
        setAdmLocalGuests([]);
        setAdmGuestForItem('');
      }
      admOpeningSubModal.current = false;
    }
  }, [isAddItemModalOpen]);

  const handleSavePrinters = () => {
    (setPrinterConfig as any)((latest: any) => {
      try {
        localStorage.setItem('printerConfig', JSON.stringify(latest));
        // Sincroniza nome e logo com o servidor para exibição na página da mesa
        socket.emit('update_pizzaria_config', {
          establishmentName: latest.establishmentName || '',
          logoUrl: latest.logoUrl || '',
        });
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

    // Agrupa itens por impressora-destino para emitir uma via por setor
    const groups = new Map<string, { printerName: string; paperWidth: string; items: any[] }>();

    orderItems.forEach(item => {
      let targetPrinterName = '';
      let shouldPrint = false;
      let sectorPaperWidth = '80mm';

      if (item.type === 'pizzas') {
        targetPrinterName = printerConfig.pizzas || printerConfig.kitchen;
        shouldPrint = printerConfig.autoPrintPizzas ?? true;
        sectorPaperWidth = (printerConfig as any).pizzasPaperWidth || printerConfig.paperWidth || '80mm';
      } else if (item.type === 'bebidas') {
        targetPrinterName = printerConfig.drinks || printerConfig.kitchen;
        shouldPrint = printerConfig.autoPrintDrinks ?? false;
        sectorPaperWidth = (printerConfig as any).drinksPaperWidth || printerConfig.paperWidth || '80mm';
      } else {
        // lanches, porcoes, lacarte e qualquer outro tipo vão para a cozinha
        targetPrinterName = printerConfig.kitchen;
        shouldPrint = printerConfig.autoPrintKitchen ?? true;
        sectorPaperWidth = (printerConfig as any).kitchenPaperWidth || printerConfig.paperWidth || '80mm';
      }

      if (shouldPrint && targetPrinterName && targetPrinterName !== 'none') {
        const key = targetPrinterName;
        if (!groups.has(key)) groups.set(key, { printerName: targetPrinterName, paperWidth: sectorPaperWidth, items: [] });
        groups.get(key)!.items.push(item);
      }
    });

    groups.forEach(({ printerName, paperWidth, items }) => {
      const printer = (printerConfig.registeredPrinters || []).find((p: any) => p.name === printerName);

      if (printer) {
        // ── Impressão ESC/POS: via TCP (IP) ou via agente local (USB/localName) ──
        const data = buildEscPosKitchenTicket(items, tableType, String(targetId), printerName, paperWidth);
        if (printer.ip) {
          socket.emit('print_escpos', { ip: printer.ip, port: printer.port || 9100, data });
        } else {
          socket.emit('print_escpos', { localName: printer.name, data });
        }
      } else {
        // ── Fallback: diálogo de impressão do navegador ──────────────────────
        const printFrame = document.createElement('iframe');
        printFrame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        document.body.appendChild(printFrame);

        const now = new Date();
        const dateStr = now.toLocaleDateString('pt-BR');
        const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const _pw   = paperWidth === '48mm' ? '181px' : '304px';
        const _tblFs = paperWidth === '48mm' ? '20px' : '32px';
        const _itemFs = paperWidth === '48mm' ? '13px' : '18px';
        const _obsFs  = paperWidth === '48mm' ? '10px' : '14px';
        const itemsHtml = items.map(item => {
          const isPiz = item.type === 'pizzas' || (item.flavors && item.flavors.length > 0);
          const baseN = isPiz ? (item.name || '').replace(/\s*\(.*?\)(\s*\+.*)?$/, '').trim() : (item.name || '');
          let flavorsHtml = '';
          if (isPiz && item.flavors && item.flavors.length > 0) {
            const cm = new Map<string, number>();
            item.flavors.forEach((f: string) => cm.set(f, (cm.get(f) || 0) + 1));
            flavorsHtml = Array.from(cm.entries()).map(([n, c]) =>
              `<div style="font-size:${_obsFs};padding-left:8px">- ${(c > 1 ? `${c}x ` : '') + n.toUpperCase()}</div>`
            ).join('');
          }
          const crustHtml = item.crust ? `<div style="font-size:${_obsFs}">Borda: ${item.crust.toUpperCase()}</div>` : '';
          return `
          <div class="item-detail">${item.quantity || 1}x ${baseN.toUpperCase()}</div>
          ${flavorsHtml}${crustHtml}
          ${item.observations ? `<div class="observation">OBS: ${item.observations.toUpperCase()}</div>` : ''}
        `;
        }).join(`<div class="sep"></div>`);
        const html = `<html><head><style>
            @page{size:${_pw} auto;margin:4mm}
            *{box-sizing:border-box}
            body{font-family:monospace;padding:4px;width:${_pw};margin:0;color:#000}
            .header{text-align:center;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:8px}
            .table-info{font-size:${_tblFs};font-weight:bold;margin:4px 0;border:3px solid #000;padding:6px;text-align:center}
            .item-detail{font-size:${_itemFs};font-weight:bold;text-transform:uppercase;margin-bottom:4px}
            .observation{background:#000;color:#fff;padding:6px;font-weight:bold;font-size:${_obsFs};margin-top:4px}
            .sep{border-top:1px dashed #000;margin:6px 0}
          </style></head><body>
            <div class="header">
              <div style="font-size:11px;font-weight:bold">VIA PRODUCAO: ${printerName.toUpperCase()}</div>
              <div class="table-info">${tableType.toUpperCase()} ${targetId}</div>
              <div style="font-size:11px;font-weight:bold;margin-top:4px">${dateStr} &nbsp; ${timeStr}</div>
            </div>
            ${itemsHtml}
            <div style="font-size:9px;margin-top:8px;border-top:1px solid #000;padding-top:4px">Garcom: ${items[0]?.waiterName || 'SISTEMA'}</div>
          </body></html>`;

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

    const handlePrintResult = (result: { success: boolean; ip: string; error?: string }) => {
      if (result.success) {
        toast.success('Impresso com sucesso', { description: `Impressora ${result.ip}`, duration: 2000 });
      } else {
        toast.error('Falha na impressão', { description: `${result.ip} — ${result.error}` });
      }
    };

    socket.emit('register_print_socket');
    socket.on('kitchen_print_order', handleKitchenOrder);
    socket.on('print_result', handlePrintResult);
    return () => {
      socket.off('kitchen_print_order', handleKitchenOrder);
      socket.off('print_result', handlePrintResult);
    };
  }, [printerConfig.autoPrintKitchen, printerConfig.autoPrintPizzas, printerConfig.autoPrintDrinks, printerConfig.kitchen, printerConfig.drinks, printerConfig.pizzas, printerConfig.registeredPrinters, printerConfig.paperWidth]);

  // Status do agente de impressão local
  const [pendingAgentSocketId, setPendingAgentSocketId] = useState<string | null>(null);
  useEffect(() => {
    const handleAgentStatus = (data: { online: boolean }) => {
      setPrinterAgentOnline(data.online);
      if (data.online) { setScanRunning(true); setScanPrinters([]); setPendingAgentSocketId(null); }
    };
    const handleInitData = (data: any) => {
      if (typeof data?.printerAgentOnline === 'boolean') setPrinterAgentOnline(data.printerAgentOnline);
    };
    const handleScanResult = (data: { printers: {ip: string; port: number}[]; error?: string }) => {
      setScanRunning(false);
      if (data.error) { toast.error(data.error); return; }
      setScanPrinters(data.printers);
    };
    const handleAgentCodeResult = (data: { success: boolean; error?: string }) => {
      setIsPairing(false);
      if (data.success) {
        toast.success('Agente emparelhado! Escaneando impressoras...');
        setAgentPairingCode('');
        setScanPrinters([]);
        setScanRunning(true);
        setScanModalOpen(true);
      } else {
        toast.error(data.error || 'Código inválido. Verifique o código exibido no agente.');
      }
    };
    const handlePairingAvailable = ({ socketId }: { socketId: string }) => {
      setPendingAgentSocketId(socketId);
      toast('Agente de impressão detectado! Vá em Configurações → Impressão para parear.', { icon: '🖨️' });
    };
    const handleReconnect = () => {
      socket.emit('request_agent_status');
    };
    const handleCashRegReports = (data: any[]) => {
      setCashRegReportList(data);
      setCashRegReportLoading(false);
    };
    socket.on('printer_agent_status', handleAgentStatus);
    socket.on('init_data', handleInitData);
    socket.on('scan_printers_result', handleScanResult);
    socket.on('agent_code_result', handleAgentCodeResult);
    socket.on('printer_agent_pairing_available', handlePairingAvailable);
    socket.on('connect', handleReconnect);
    socket.on('cash_register_reports_response', handleCashRegReports);
    return () => {
      socket.off('printer_agent_status', handleAgentStatus);
      socket.off('init_data', handleInitData);
      socket.off('scan_printers_result', handleScanResult);
      socket.off('agent_code_result', handleAgentCodeResult);
      socket.off('printer_agent_pairing_available', handlePairingAvailable);
      socket.off('connect', handleReconnect);
      socket.off('cash_register_reports_response', handleCashRegReports);
    };
  }, []);

  // Timeout de segurança: se scan ficar rodando >90s sem resposta, encerra
  const scanRunningRef = useRef(false);
  useEffect(() => {
    scanRunningRef.current = scanRunning;
    if (!scanRunning) return;
    const t = setTimeout(() => {
      if (scanRunningRef.current) {
        setScanRunning(false);
        toast.error('Tempo limite do scan atingido. Verifique se o agente está conectado.');
      }
    }, 90000);
    return () => clearTimeout(t);
  }, [scanRunning]);

  const buildAndPrintCashRegisterReport = () => {
    const receiptPrinterName = printerConfig.receipts;
    const printer = receiptPrinterName
      ? (printerConfig.registeredPrinters || []).find((p: any) => p.name === receiptPrinterName)
      : null;

    const is50mm = (printerConfig.paperWidth || '80mm') === '50mm';
    const lineLen = is50mm ? 32 : 48;
    const b: number[] = [];
    const push = (...bytes: number[]) => b.push(...bytes);
    const lf = () => push(0x0A);
    const text = (s: string) => push(...escStr(s));
    const ln  = () => { text('-'.repeat(lineLen)); lf(); };
    const dln = () => { text('='.repeat(lineLen)); lf(); };
    const center = () => push(0x1B, 0x61, 0x01);
    const left   = () => push(0x1B, 0x61, 0x00);
    const right  = () => push(0x1B, 0x61, 0x02);
    const bold   = (on: boolean) => push(0x1B, 0x45, on ? 0x01 : 0x00);
    const dbl    = (on: boolean) => push(0x1D, 0x21, on ? 0x11 : 0x00);

    const fmtMoney = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
    const fmtDate  = (d: Date) => d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const colRow   = (left2: string, right2: string) => {
      const sp = Math.max(1, lineLen - left2.length - right2.length);
      text(left2 + ' '.repeat(sp) + right2); lf();
    };
    const col3Row  = (c1: string, c2: string, c3: string, w1: number) => {
      const rem = lineLen - w1;
      const w2 = Math.floor(rem / 2);
      const w3 = rem - w2;
      const p1 = c1.substring(0, w1).padEnd(w1);
      const p2 = c2.substring(0, w2).padStart(w2);
      const p3 = c3.substring(0, w3).padStart(w3);
      text(p1 + p2 + p3); lf();
    };

    // Coleta dados do turno
    const shiftOrders = orders.filter((o: any) => {
      if (!shiftStartedAt) return true;
      return new Date(o.timestamp) >= new Date(shiftStartedAt);
    });
    const finishedOrders = shiftOrders.filter((o: any) => o.status === 'finalizada');

    // Totais por método de pagamento
    const methodTotals: Record<string, number> = {};
    finishedOrders.forEach((o: any) => {
      (o.paymentLog || o.partialPayments || []).forEach((p: any) => {
        const m = (p.method || 'Outros').trim();
        methodTotals[m] = (methodTotals[m] || 0) + (p.amount || 0);
      });
    });

    // Totais por produto
    const productTotals: Record<string, { qty: number; total: number }> = {};
    finishedOrders.forEach((o: any) => {
      (o.items || []).filter((i: any) => !i.removed).forEach((i: any) => {
        const k = i.name || 'Item';
        if (!productTotals[k]) productTotals[k] = { qty: 0, total: 0 };
        const q = i.quantity || 1;
        productTotals[k].qty   += q;
        productTotals[k].total += i.price || 0;
      });
    });

    // Totais por categoria
    const categoryTotals: Record<string, { qty: number; total: number }> = {};
    finishedOrders.forEach((o: any) => {
      (o.items || []).filter((i: any) => !i.removed).forEach((i: any) => {
        const cat = (i.type || 'outros').toUpperCase();
        if (!categoryTotals[cat]) categoryTotals[cat] = { qty: 0, total: 0 };
        categoryTotals[cat].qty   += i.quantity || 1;
        categoryTotals[cat].total += i.price || 0;
      });
    });

    const totalBruto = Object.values(productTotals).reduce((s, v) => s + v.total, 0);
    const totalDesc  = finishedOrders.reduce((s: number, o: any) => {
      const disc = o.discount ? (o.discountType === 'percentage' ? totalBruto * o.discount / 100 : o.discount) : 0;
      return s + disc;
    }, 0);
    const totalLiq   = totalBruto - totalDesc;
    const totalPaid  = Object.values(methodTotals).reduce((s, v) => s + v, 0);

    const now = new Date();
    const registerName = activeCashRegisterName || pendingCloseRegisterName || '-';

    // ── Helpers de layout ───────────────────────────────────────────────
    // Título de seção: "===== TITULO =====" centralizado
    const secTitle = (t: string) => {
      const inner = ` ${t} `;
      const sides = Math.floor((lineLen - inner.length) / 2);
      const eqR = '='.repeat(Math.max(0, lineLen - sides - inner.length));
      text('='.repeat(Math.max(0, sides)) + inner + eqR); lf();
    };
    // 2 colunas: label esquerda, valor direita
    const col2 = (label: string, value: string) => {
      const sp = Math.max(1, lineLen - label.length - value.length);
      text(label + ' '.repeat(sp) + value); lf();
    };
    // 3 colunas: nome | qtde | total (colunas 2 e 3 alinhadas à direita)
    const w1 = is50mm ? 14 : 24;
    const w2 = is50mm ? 6  : 8;
    const w3 = lineLen - w1 - w2;
    const col3 = (c1: string, c2: string, c3: string) => {
      text(c1.substring(0, w1).padEnd(w1) + c2.substring(0, w2).padStart(w2) + c3.padStart(w3)); lf();
    };
    // Linha de pagamento: nome à esquerda, valor à direita (12 chars)
    const payRow = (label: string, value: string) => {
      const vLen = Math.min(12, lineLen - 2);
      text(label.substring(0, lineLen - vLen - 1).padEnd(lineLen - vLen) + value.padStart(vLen)); lf();
    };

    // ── Montar o documento ESC/POS ──────────────────────────────────────
    push(0x1B, 0x40); // init
    push(0x1B, 0x74, 0x02); // CP437

    // Cabeçalho
    center();
    dbl(true); bold(true); text('RELATORIO DE CAIXA'); lf(); dbl(false); bold(false);
    lf();
    left();
    text(`Cx: ${registerName}`); lf();
    col2('Abertura:', fmtDate(new Date(shiftStartedAt)));
    col2('Fechamento:', fmtDate(now));
    col2('Fundo de Caixa:', fmtMoney(0));
    dln();

    // Formas de pagamento
    secTitle('PAGAMENTOS');
    bold(true); payRow('Meio de Pagamento', 'Total'); bold(false);
    ln();
    const payEntries = Object.entries(methodTotals).sort((a, b) => b[1] - a[1]);
    if (payEntries.length === 0) {
      text('Nenhum pagamento registrado.'); lf();
    } else {
      payEntries.forEach(([m, v]) => payRow(m, v.toFixed(2).replace('.', ',')));
    }
    ln();
    bold(true); payRow('TOTAL RECEBIDO:', totalPaid.toFixed(2).replace('.', ',')); bold(false);
    lf();

    // Itens vendidos
    secTitle('ITENS VENDIDOS');
    bold(true); col3('Produto', 'Qtde', 'Total'); bold(false);
    ln();
    if (Object.keys(productTotals).length === 0) {
      text('Nenhum item vendido.'); lf();
    } else {
      Object.entries(productTotals).sort((a, b) => b[1].total - a[1].total).forEach(([name, v]) => {
        const qtyStr = v.qty % 1 === 0 ? v.qty.toString() : v.qty.toFixed(3).replace('.', ',');
        col3(name, qtyStr, v.total.toFixed(2).replace('.', ','));
      });
    }
    ln();
    bold(true);
    col2('TOTAL VENDIDO BRUTO:', fmtMoney(totalBruto));
    if (totalDesc > 0) col2('Descontos:', `-${fmtMoney(totalDesc)}`);
    col2('TOTAL VENDIDO LIQUIDO:', fmtMoney(totalLiq));
    bold(false);
    lf();

    // Categorias
    if (Object.keys(categoryTotals).length > 0) {
      secTitle('CATEGORIAS');
      bold(true); col3('Categoria', 'Qtde', 'Total'); bold(false);
      ln();
      Object.entries(categoryTotals).sort((a, b) => b[1].total - a[1].total).forEach(([cat, v]) => {
        const qStr = v.qty % 1 === 0 ? v.qty.toString() : v.qty.toFixed(3).replace('.', ',');
        col3(cat, qStr, v.total.toFixed(2).replace('.', ','));
      });
      ln();
      bold(true); col2('TOTAL CLASSES:', fmtMoney(totalLiq)); bold(false);
      lf();
    }

    // Rodapé
    dln();
    bold(true); col2('TOTAL VALES:', fmtMoney(0)); bold(false);
    lf();
    text(`Usuario: ${registerName}`); lf();
    if (printerConfig.receiptFooter) { lf(); center(); text(printerConfig.receiptFooter); left(); lf(); }
    push(0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x10); // feed + cut

    if (printer) {
      if (printer.ip) {
        socket.emit('print_escpos', { ip: printer.ip, port: printer.port || 9100, data: b });
      } else {
        socket.emit('print_escpos', { localName: printer.name, data: b });
      }
      toast.success('Relatório de caixa enviado para impressão');
    } else {
      // Fallback: janela de impressão do navegador
      const fmtDateFb = (d: Date) => d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const sep = '='.repeat(42);
      const dash = '-'.repeat(42);
      const rows: string[] = [];
      const add = (s = '') => rows.push(s);
      const fb2 = (l: string, r: string) => add(l.padEnd(42 - r.length) + r);
      const fb3 = (c1: string, c2: string, c3: string) => add(c1.padEnd(24) + c2.padStart(8) + c3.padStart(10));
      const fbPay = (l: string, r: string) => add(l.padEnd(30) + r.padStart(12));
      add('         RELATORIO DE CAIXA');
      add('');
      add(`Cx: ${registerName}`);
      fb2('Abertura:', fmtDateFb(new Date(shiftStartedAt)));
      fb2('Fechamento:', fmtDateFb(now));
      fb2('Fundo de Caixa:', 'R$ 0,00');
      add(sep);
      add('===== PAGAMENTOS =====');
      fbPay('Meio de Pagamento', 'Total');
      add(dash);
      payEntries.forEach(([m, v]) => fbPay(m, v.toFixed(2).replace('.', ',')));
      add(dash);
      fbPay('TOTAL RECEBIDO:', totalPaid.toFixed(2).replace('.', ','));
      add('');
      add('===== ITENS VENDIDOS =====');
      fb3('Produto', 'Qtde', 'Total');
      add(dash);
      Object.entries(productTotals).sort((a,b)=>b[1].total-a[1].total).forEach(([n, v]) => {
        const q = v.qty % 1 === 0 ? v.qty.toString() : v.qty.toFixed(3).replace('.', ',');
        fb3(n, q, v.total.toFixed(2).replace('.', ','));
      });
      add(dash);
      fb2('TOTAL VENDIDO BRUTO:', `R$ ${totalBruto.toFixed(2)}`);
      if (totalDesc > 0) fb2('Descontos:', `-R$ ${totalDesc.toFixed(2)}`);
      fb2('TOTAL VENDIDO LIQUIDO:', `R$ ${totalLiq.toFixed(2)}`);
      add('');
      if (Object.keys(categoryTotals).length > 0) {
        add('===== CATEGORIAS =====');
        fb3('Categoria', 'Qtde', 'Total');
        add(dash);
        Object.entries(categoryTotals).sort((a,b)=>b[1].total-a[1].total).forEach(([cat, v]) => {
          const q = v.qty % 1 === 0 ? v.qty.toString() : v.qty.toFixed(3).replace('.', ',');
          fb3(cat, q, v.total.toFixed(2).replace('.', ','));
        });
        add(dash);
        fb2('TOTAL CLASSES:', `R$ ${totalLiq.toFixed(2)}`);
        add('');
      }
      add(sep);
      fb2('TOTAL VALES:', 'R$ 0,00');
      add(`Usuario: ${registerName}`);
      const pw = window.open('', '_blank');
      if (pw) {
        pw.document.write(`<html><head><title>Rel. Caixa</title><style>body{font-family:monospace;font-size:12px;padding:16px;white-space:pre;line-height:1.5}@media print{body{margin:0}}</style></head><body>${rows.join('\n')}<script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`);
        pw.document.close();
      }
    }
  };

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
      payerName,
      fromAdmin: true
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

  // Current active order for the selected table/comanda (used by item modals)
  const admCurrentOrder = React.useMemo(() => {
    const targetId = isComandaSelected ? selectedComandaId : selectedTableId;
    if (!targetId) return null;
    return orders.filter(o =>
      o.status !== 'finalizada' &&
      o.tableId && String(o.tableId) === String(targetId) &&
      !!o.isComanda === !!isComandaSelected
    ).sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())[0] || null;
  }, [orders, selectedTableId, selectedComandaId, isComandaSelected]);
  const admGuestList = React.useMemo(() => {
    const base = admCurrentOrder?.guests || [];
    const all = [...base];
    admLocalGuests.forEach(g => { if (!all.includes(g)) all.push(g); });
    return all;
  }, [admCurrentOrder?.guests, admLocalGuests]);

  // Limpa convidados locais ao trocar de mesa/pedido
  useEffect(() => {
    setAdmLocalGuests([]);
  }, [admCurrentOrder?.id]);

  // Pré-seleciona convidado existente ao abrir modal
  useEffect(() => {
    if (isAddItemModalOpen) {
      const guests = admCurrentOrder?.guests || [];
      if (guests.length === 1) {
        setAdmGuestForItem(guests[0]);
      }
    }
  }, [isAddItemModalOpen, admCurrentOrder?.id]);

  const addAdmGuestToList = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const base = admCurrentOrder?.guests || [];
    if (base.includes(trimmed) && !admLocalGuests.includes(trimmed)) {
      setAdmLocalGuests(prev => [...prev, trimmed]);
      return trimmed;
    }
    if (!base.includes(trimmed)) {
      const updated = [...base, trimmed];
      if (admCurrentOrder) socket.emit('set_order_guests', { orderId: admCurrentOrder.id, guests: updated });
    }
    // Atualiza estado local imediatamente sem esperar o servidor
    setAdmLocalGuests(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
    return trimmed;
  };

  const getLastActivityMs = (id: number, isComanda: boolean): number | null => {
    if (!isCashRegisterOpen) return null;
    const list = isComanda ? comandas : tables;
    const entity = list.find(e => e.id === id);
    if (!entity || entity.status === 'free' || !entity.currentOrder) return null;
    const order = orders.find(o => String(o.id) === String(entity.currentOrder));
    if (!order) return null;
    const activeItems = (order.items || []).filter(i => !i.removed);
    if (activeItems.length === 0) return null;
    // Only count items added in the current shift (after cashier opened).
    // Discard items without timestamp — per requirement, no timer without the event.
    const shiftMs = shiftStartedAt ? new Date(shiftStartedAt).getTime() : 0;
    let latestMs = 0;
    for (const item of activeItems) {
      const ts = item.timestamp ? new Date(item.timestamp).getTime() : 0;
      if (ts > 0 && (shiftMs === 0 || ts >= shiftMs) && ts > latestMs) latestMs = ts;
    }
    if (latestMs === 0) return null;
    return latestMs;
  };

  const getInactivityMinutes = (id: number, isComanda: boolean): number => {
    const last = getLastActivityMs(id, isComanda);
    if (last === null) return 0;
    return Math.floor(((Date.now() - clockOffset) - last) / 60_000);
  };

  const shouldShowInactivityIcon = (id: number, isComanda: boolean): boolean => {
    if (!pizzariaConfig?.enabled) return false;
    const list = isComanda ? comandas : tables;
    const entity = list.find(e => e.id === id);
    if (!entity || entity.status === 'free' || !entity.currentOrder) return false;
    const last = getLastActivityMs(id, isComanda);
    if (last === null) return false; // no valid timestamps — don't alert
    const nowAdjusted = Date.now() - clockOffset;
    if (Math.floor((nowAdjusted - last) / 60_000) < (pizzariaConfig?.inactivityMinutes ?? 30)) return false;
    const key = `${isComanda ? 'c' : 't'}_${id}`;
    return nowAdjusted > (snoozeMap[key] ?? 0);
  };

  const getTableItemTypes = (id: number, isComanda: boolean): { hasLanche: boolean; hasPizza: boolean; hasPorcao: boolean; hasLaCarte: boolean } => {
    const tableOrders = orders.filter((o: any) =>
      String(o.tableId) === String(id) &&
      !!o.isComanda === isComanda &&
      o.status !== 'paid' &&
      o.status !== 'delivered' &&
      o.status !== 'finalizada'
    );
    const allItems = tableOrders.flatMap((o: any) => (o.items || []).filter((i: any) => !i.removed && !i.paid));
    return {
      hasLanche: allItems.some((i: any) => i.type === 'lanches'),
      hasPizza: allItems.some((i: any) => i.type === 'pizzas'),
      hasPorcao: allItems.some((i: any) => i.type === 'porcoes'),
      hasLaCarte: allItems.some((i: any) => i.type === 'lacarte'),
    };
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
      reason: removalReason.trim()
    });
    
    setIsRemovalModalOpen(false);
    setItemToRemove(null);
    setRemovalQuantity(1);
    setRemovalReason('');
    toast.success('Item removido pelo ADM');
  };

  const confirmRemoveAllTableItems = () => {
    if (!itemToRemove || !removalReason.trim()) return;
    const order = orders.find((o: any) => String(o.id) === String(itemToRemove.orderId));
    if (!order) return;
    const activeItems = (order.items || []).filter((i: any) => !i.removed && !i.paid);
    activeItems.forEach((item: any) => {
      socket.emit('remove_item', {
        orderId: order.id,
        itemId: item.id,
        quantity: item.quantity || 1,
        removedBy: 'ADM',
        reason: removalReason.trim()
      });
    });
    setIsRemovalModalOpen(false);
    setItemToRemove(null);
    setRemovalQuantity(1);
    setRemovalReason('');
    setIsRemoveAllTableItems(false);
    toast.success(`${activeItems.length} item(s) removido(s) da mesa`);
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
    const selectedTableOrComanda = (isComandaSelected ? comandas : tables).find(t => t.id === tableId);
    if (selectedTableOrComanda?.status === 'aguardando_baixa') {
      toast.error('Esta mesa está aguardando baixa. Faça a baixa antes de adicionar novos itens.');
      return;
    }
    const activeOrder = orders.filter(o => 
      tableId && o.tableId && 
      String(o.tableId) === String(tableId) && 
      !!o.isComanda === !!isComandaSelected && 
      o.status !== 'finalizada'
    ).sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())[0];
    
    // Check if it's a pizza — also look inside subcategories
    const category = menu.find(cat =>
      cat.items?.some((i: any) => i.id === item.id || i.name === item.name) ||
      (cat.subcategories || []).some((sub: any) => sub.items?.some((i: any) => i.id === item.id || i.name === item.name))
    );
    const fromSubcat = category && (category.subcategories || []).find((sub: any) =>
      sub.items?.some((i: any) => i.id === item.id || i.name === item.name)
    );
    const isPizza = category?.type === 'pizzas' || item.type === 'pizzas';
    const isSnackOrDrink = category?.type === 'lanches' || category?.type === 'bebidas' || category?.type === 'porcoes' || category?.type === 'lacarte' || item.type === 'lanches' || item.type === 'bebidas' || item.type === 'porcoes' || item.type === 'lacarte';

    if (isPizza && !isFlavorModalOpen) {
      // Determina borda pelo nome da subcategoria (Com Borda → true, Sem Borda → false)
      const hasBorder = fromSubcat
        ? fromSubcat.name.toLowerCase().includes('com')
        : false;
      // Tenta pré-selecionar tamanho pelo nome do item clicado
      const sizeMatch = pizzaSizes.find((s: any) =>
        item.name.toLowerCase().includes(s.name.toLowerCase())
      );
      setSelectedPizzaItem(item);
      setSelectedFlavors([]);
      setSelectedCrusts([]);
      setSelectedPizzaSize(sizeMatch ? sizeMatch.name : null);
      setPizzaHasBorder(hasBorder);
      setPizzaObservations('');
      setCrustObservations('');
      setMaxFlavors(sizeMatch ? sizeMatch.maxFlavors : 1);
      // Se vier de subcategoria conhecida, pula a etapa de escolha de borda
      setSelectionStep(fromSubcat ? 'build' : 'border_choice');
      setIsFlavorModalOpen(true);
      admOpeningSubModal.current = true;
      setIsAddItemModalOpen(false);
      return;
    }

    if (isSnackOrDrink && !isQuantityModalOpen) {
      setSelectedQuantityItem(item);
      setItemQuantity(1);
      setItemObservations('');
      setIsQuantityModalOpen(true);
      admOpeningSubModal.current = true;
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
      ingredients: item.ingredients,
      guestName: item.guestName || admGuestForItem || undefined,
    };

    if (activeOrder) {
      socket.emit('add_item_to_order', {
        orderId: activeOrder.id,
        item: newItem
      });
      // Persiste convidado em order.guests para aparecer nas próximas aberturas do modal
      const guestForThisItem = newItem.guestName;
      if (guestForThisItem && !(activeOrder.guests || []).includes(guestForThisItem)) {
        socket.emit('set_order_guests', { orderId: activeOrder.id, guests: [...(activeOrder.guests || []), guestForThisItem] });
      }
    } else {
      updateTableStatusLocal(tableId, isComandaSelected, 'occupied');
      socket.emit('new_order', {
        tableId,
        isComanda: isComandaSelected,
        items: [newItem],
        waiterId: 'ADM',
        waiterName: 'ADM',
        guests: admGuestForItem ? [admGuestForItem] : undefined,
      });
    }
    setIsAddItemModalOpen(false);
    setIsFlavorModalOpen(false);
    setAdmGuestForItem('');
    setAdmModalNewGuest('');
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
      ingredients: selectedQuantityItem.ingredients,
      guestName: admGuestForItem || undefined,
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
      // Persiste convidado em order.guests para aparecer nas próximas aberturas do modal
      if (admGuestForItem && !(activeOrder.guests || []).includes(admGuestForItem)) {
        const updatedGuests = [...(activeOrder.guests || []), admGuestForItem];
        socket.emit('set_order_guests', { orderId: activeOrder.id, guests: updatedGuests });
      }
    } else {
      updateTableStatusLocal(targetId, isComandaSelected, 'occupied');
      socket.emit('new_order', {
        tableId: targetId,
        isComanda: isComandaSelected,
        items: [newItem],
        waiterId: 'ADM',
        waiterName: 'ADM',
        guests: admGuestForItem ? [admGuestForItem] : undefined,
      });
    }
    setIsQuantityModalOpen(false);
    setSelectedQuantityItem(null);
    setAdmGuestForItem('');
    setAdmModalNewGuest('');
    toast.success('Item adicionado pelo ADM');
  };

  const confirmFlavorSelection = () => {
    if (selectedFlavors.length === 0) {
      toast.error('Selecione pelo menos um sabor');
      return;
    }
    setSelectionStep('build');
  };

  const confirmPizzaSelection = () => {
    if (selectedFlavors.length === 0) { toast.error('Selecione pelo menos um sabor'); return; }
    if (!selectedPizzaSize && !selectedPizzaItem?.name) { toast.error('Selecione o tamanho'); return; }
    const flavorCountMap = new Map<string, number>();
    selectedFlavors.forEach(f => flavorCountMap.set(f.name, (flavorCountMap.get(f.name) || 0) + 1));
    const uniqueFlavors = Array.from(flavorCountMap.entries());
    const flavorNames = uniqueFlavors.map(([name, count]) => count > 1 ? `${count}x ${name}` : name).join(' / ');
    const flavorIngredients = selectedFlavors.filter((f, i, arr) => arr.findIndex((x: any) => x.name === f.name) === i).map(f => f.ingredients).join(' + ');
    // find the matching menu item for price — check subcategories first, then direct items
    const pizzaCat = menu.find((c: any) => c.type === 'pizzas');
    const allPizzaItems = [
      ...(pizzaCat?.items || []),
      ...(pizzaCat?.subcategories || []).flatMap((s: any) => s.items || []),
    ];
    const hasBorder = selectedCrusts.length > 0 || pizzaHasBorder;
    const matchedSizeItem =
      allPizzaItems.find((i: any) =>
        i.name.toLowerCase().includes(selectedPizzaSize.toLowerCase()) &&
        (hasBorder ? i.name.toLowerCase().includes('com') : i.name.toLowerCase().includes('sem'))
      ) ||
      allPizzaItems.find((i: any) => i.name.toLowerCase().includes(selectedPizzaSize.toLowerCase())) ||
      selectedPizzaItem;

    // Monta nome: usa nome do item (contém tamanho) ou selectedPizzaSize
    const sizeLabel = selectedPizzaItem?.name
      ? selectedPizzaItem.name.replace(/ com borda| sem borda/i, '').trim()
      : `Pizza ${selectedPizzaSize}`;
    const crustLabel = selectedCrusts.length > 0 ? ` + Borda ${selectedCrusts.join(' / ')}` : '';
    const obsAll = [pizzaObservations, crustObservations ? `Borda: ${crustObservations}` : ''].filter(Boolean).join(' | ');

    // Acréscimo: cada slot de sabor com preço extra soma seu valor integralmente
    const extraFlavorPrice = selectedFlavors.reduce((acc, f) => acc + (f.price || 0), 0);
    const basePrice = matchedSizeItem?.price ?? selectedPizzaItem?.price ?? 0;

    const itemWithDetails = {
      ...matchedSizeItem,
      id: Math.random().toString(36).substr(2, 9),
      menuItemId: matchedSizeItem?.id || selectedPizzaItem?.id,
      name: `${sizeLabel} (${flavorNames})${crustLabel}`,
      type: 'pizzas',
      price: basePrice + extraFlavorPrice,
      flavors: selectedFlavors.map(f => f.name),
      ingredients: flavorIngredients,
      crust: selectedCrusts.length > 0 ? selectedCrusts.join(' / ') : null,
      observations: obsAll,
      guestName: undefined,
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
  const waiterUrl = `${window.location.origin}/waiter${tenantId ? `?tenant=${tenantId}` : ''}`;

  const approveWaiter = (id: string) => {
    const target = waiters.find(w => w.id === id || (w as any).cpf === id);
    const alreadyApproved = target?.status === 'approved';
    if (!alreadyApproved) {
      const approvedCount = waiters.filter(w => w.status === 'approved').length;
      if (approvedCount >= effectiveMaxWaiters) {
        toast.error(`Limite atingido: máximo de ${effectiveMaxWaiters} garçom${effectiveMaxWaiters !== 1 ? 's' : ''} configurado.`);
        return;
      }
    }
    socket.emit('admin_approve_waiter', id);
    toast.success('Garçom aprovado!');
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
          {(pizzariaConfig.kdsEnabled ?? false) && (
            <div className="border-t border-[#141414]/10 pt-2 mt-1">
              <a
                href="/app/kitchen"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsSidebarOpen(false)}
                className="flex items-center space-x-3 p-3 rounded-lg transition-colors text-orange-600 hover:bg-orange-50"
              >
                <Monitor size={20} />
                <span className="text-sm font-medium">Abrir KDS</span>
              </a>
            </div>
          )}
        </nav>

        <div className="mt-auto pt-4 border-t border-[#141414]/10">
          <p className="text-[9px] text-[#141414]/30 font-mono text-center">PR #{LATEST_PR}</p>
        </div>
      </motion.div>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden p-4 lg:p-6 pb-14 bg-[#F5F5F3] flex flex-col">
        <div className="flex items-center gap-2 mb-4 shrink-0 min-w-0">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 bg-white rounded-lg shadow-sm border border-[#141414]/10 lg:hidden shrink-0"
          >
            <Menu size={20} />
          </button>
          <header className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="font-serif italic text-2xl lg:text-3xl shrink-0">Painel</h2>
            <div className="flex items-center bg-white/50 border border-[#141414]/10 p-0.5 rounded-xl shadow-sm overflow-x-auto scrollbar-hide shrink-0">
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
                {(pizzariaConfig.kdsEnabled ?? false) && (
                  <>
                    <div className="w-px h-4 bg-[#141414]/10 mx-0.5 shrink-0" />
                    <a
                      href="/app/kitchen"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg transition-all shrink-0 text-orange-500 hover:bg-orange-50"
                      title="Abrir KDS"
                    >
                      <Monitor size={16} />
                    </a>
                  </>
                )}
              </div>
            {/* Establishment name — fills space between tabs and exit button */}
            {(printerConfig.establishmentName || printerConfig.logoUrl) && (
              <div className="flex-1 min-w-0 flex items-center justify-center gap-3 px-3 hidden sm:flex">
                {printerConfig.logoUrl && (
                  <img
                    src={printerConfig.logoUrl}
                    alt="Logo"
                    className="h-16 w-auto max-w-[120px] object-contain shrink-0 select-none pointer-events-none"
                  />
                )}
                {printerConfig.establishmentName && (
                  <p className="text-2xl font-serif italic font-bold opacity-80 truncate">
                    {printerConfig.establishmentName}
                  </p>
                )}
              </div>
            )}
            {canInstall && !isInstalled && (
              <button
                onClick={install}
                title="Instalar app na tela inicial"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-bold uppercase transition-colors shrink-0"
              >
                <Download size={11} />
                Instalar app
              </button>
            )}
            <OrderNotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              mode={notificationMode}
              onMarkAllRead={markAllRead}
              onClearAll={clearAll}
            />
            <button
              onClick={() => {
                if (isCashRegisterOpen) {
                  toast.warning('O caixa está aberto. Feche o caixa antes de sair.');
                  return;
                }
                (onLogout ?? logout)();
              }}
              title="Sair"
              className="p-1.5 rounded-lg text-[#141414]/30 hover:text-red-500 hover:bg-red-50 transition-all shrink-0"
            >
              <LogOut size={16} />
            </button>
          </header>
        </div>

        {activeTab === 'overview' && (
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pt-3 pb-0.5 mb-1 shrink-0">
            <div className="relative shrink-0">
              {isCashRegisterOpen && activeCashRegisterName && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#141414] text-white text-[7px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap z-10 pointer-events-none">
                  {activeCashRegisterName}
                </span>
              )}
              <button
                onClick={() => {
                  if (!isCashRegisterOpen) {
                    setCashRegisterPickerOpen(v => !v);
                  } else {
                    const activeTables = tables.find(t => t.status !== "free");
                    const activeComandas = comandas.find(c => c.status !== "free");
                    if (activeTables || activeComandas) {
                      toast.error("Não é possível fechar o caixa com mesas ou comandas ocupadas.");
                    } else {
                      setPendingCloseRegisterName(activeCashRegisterName ?? undefined);
                      setCashRegisterReportModal(true);
                    }
                  }
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition-all shadow-sm ${
                  isCashRegisterOpen
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                <Wallet size={14} />
                <span>{isCashRegisterOpen ? 'Fechar Caixa' : 'Abrir Caixa'}</span>
              </button>
            </div>
            <StatCard title="Mesas" value={tables.filter(t => t.status !== 'free').length} total={tables.length} icon={Users} />
            <StatCard title="Pend." value={orders.filter(o => o.status === 'pending').length} icon={Clock} />
          </div>
        )}

        {/* Modal: Relatório ao fechar caixa */}
        {cashRegisterReportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setCashRegisterReportModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-80 max-w-full flex flex-col gap-4 z-10">
              <div className="flex flex-col items-center gap-1 text-center">
                <div className="w-12 h-12 rounded-full bg-[#141414]/5 flex items-center justify-center mb-1">
                  <Printer size={22} className="text-[#141414]/60" />
                </div>
                <h3 className="font-black text-sm text-[#141414]">Fechar Caixa</h3>
                {pendingCloseRegisterName && (
                  <p className="text-[10px] text-[#141414]/50 font-semibold">{pendingCloseRegisterName}</p>
                )}
                <p className="text-[11px] text-[#141414]/60 mt-1">Deseja imprimir o relatório de caixa antes de fechar?</p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    buildAndPrintCashRegisterReport();
                    toggleCashRegister(false, pendingCloseRegisterName);
                    setCashRegisterReportModal(false);
                    setPendingCloseRegisterName(undefined);
                  }}
                  className="w-full py-2.5 bg-[#141414] text-white text-[11px] font-black rounded-xl flex items-center justify-center gap-2 hover:bg-[#141414]/80 transition-colors"
                >
                  <Printer size={14} />
                  Imprimir e Fechar
                </button>
                <button
                  onClick={() => {
                    toggleCashRegister(false, pendingCloseRegisterName);
                    setCashRegisterReportModal(false);
                    setPendingCloseRegisterName(undefined);
                  }}
                  className="w-full py-2.5 bg-[#141414]/8 text-[#141414] text-[11px] font-bold rounded-xl hover:bg-[#141414]/12 transition-colors"
                >
                  Fechar sem imprimir
                </button>
                <button
                  onClick={() => { setCashRegisterReportModal(false); setPendingCloseRegisterName(undefined); }}
                  className="w-full py-2 text-[#141414]/40 text-[10px] font-semibold hover:text-[#141414]/60 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {cashRegisterPickerOpen && !isCashRegisterOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setCashRegisterPickerOpen(false)} />
            <div
              className="fixed left-4 top-20 z-50 bg-white rounded-xl shadow-xl border border-[#141414]/10 w-52 overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-3 py-2 border-b border-[#141414]/5">
                <span className="text-[8px] font-black uppercase tracking-widest text-[#141414]/40">Selecionar Caixa</span>
              </div>
              {(pizzariaConfig.cashRegisters ?? []).length === 0 ? (
                <div className="px-3 py-3 text-center">
                  <p className="text-[8px] text-[#141414]/40 leading-tight">Nenhum caixa cadastrado.<br />Configure em <strong>Configurações → Salão</strong>.</p>
                </div>
              ) : (
                (pizzariaConfig.cashRegisters ?? []).map(reg => (
                  <button
                    key={reg.id}
                    onClick={() => {
                      setCashRegisterPickerOpen(false);
                      toggleCashRegister(true, reg.name);
                    }}
                    className="w-full text-left px-3 py-2 text-[10px] font-semibold text-[#141414] hover:bg-[#141414]/5 transition-colors flex items-center gap-2"
                  >
                    <Wallet size={10} className="text-[#141414]/40 shrink-0" />
                    {reg.name}
                  </button>
                ))
              )}
            </div>
          </>
        )}

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
                      {pizzariaConfig.comandasEnabled !== false && (
                        <button
                          onClick={() => setOverviewTab('comandas')}
                          className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${overviewTab === 'comandas' ? 'bg-[#141414] text-[#E4E3E0] shadow-md' : 'text-[#141414]/50 hover:bg-[#141414]/5'}`}
                        >
                          Comandas
                        </button>
                      )}
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
                    <ReservationButton />
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
                          className="h-full flex flex-col min-h-0"
                        >
                          <div className="flex-1 overflow-y-auto scrollbar-hide pr-1">
                          <div className="grid grid-cols-8 gap-1 pb-2">
                            {[...tables].sort((a, b) => a.id - b.id).filter(t => t.id <= (planCfg.tablesLocked ? planCfg.maxTables : (pizzariaConfig.numTables ?? planCfg.maxTables))).map(table => (
                              <button
                                key={table.id}
                                draggable={table.status === 'occupied'}
                                onDragStart={e => { if (table.status === 'occupied') { setDragSourceTable(table.id); e.dataTransfer.effectAllowed = 'move'; } }}
                                onDragEnd={() => setDragSourceTable(null)}
                                onDragOver={e => { if (dragSourceTable !== null && dragSourceTable !== table.id && table.status === 'free') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                                onDrop={e => { e.preventDefault(); if (dragSourceTable !== null && table.status === 'free') { setTransferPopup({ source: dragSourceTable, target: table.id }); setDragTransferMode('all'); setDragSelectedIds({}); setDragSourceTable(null); } }}
                                onClick={() => {
                                  setSelectedTableId(table.id);
                                  setIsComandaSelected(false);
                                  setShowingRecentOrders(false);
                                  if (callingTables.has(table.id)) {
                                    setCallingTablePopup(table.id);
                                  } else if (shouldShowInactivityIcon(table.id, false)) {
                                    setInactivityPopup({ tableId: table.id, isComanda: false, minutes: getInactivityMinutes(table.id, false) });
                                  }
                                }}
                                className={`relative aspect-square rounded-lg border-2 transition-all duration-300 w-full flex flex-col items-center justify-center gap-0.5 hover:scale-[1.06] hover:-translate-y-0.5 ${
                                  selectedTableId === table.id && !isComandaSelected ? 'ring-2 ring-offset-1 ring-[#141414]/40' : ''
                                } ${(() => {
                                  const pc = getPizzeriaTableColor(table.id, false);
                                  if (pc === 'green') return 'border-green-500 bg-gradient-to-b from-green-400 to-green-500 text-white shadow-md shadow-green-300/60 hover:shadow-lg hover:shadow-green-400/70';
                                  if (pc === 'yellow') return 'border-yellow-400 bg-gradient-to-b from-yellow-300 to-yellow-400 text-[#141414] shadow-md shadow-yellow-300/60 hover:shadow-lg hover:shadow-yellow-400/70';
                                  if (pc === 'orange') return 'border-orange-400 bg-gradient-to-b from-orange-400 to-orange-500 text-white shadow-md shadow-orange-300/60 hover:shadow-lg hover:shadow-orange-400/70';
                                  if (pc === 'red') return 'border-red-500 bg-gradient-to-b from-red-400 to-red-500 text-white animate-pulse shadow-md shadow-red-300/60 hover:shadow-lg hover:shadow-red-500/70';
                                  if (table.status === 'free') return 'border-[#141414]/10 bg-white/60 hover:bg-white hover:border-[#141414]/20 text-[#141414]/35 shadow-sm hover:shadow-md hover:shadow-[#141414]/10';
                                  if (table.status === 'occupied') return 'border-[#141414]/80 bg-gradient-to-b from-[#202020] to-[#141414] text-[#E4E3E0] shadow-md shadow-[#141414]/30 hover:shadow-lg hover:shadow-[#141414]/50';
                                  if (table.status === 'aguardando_baixa') return 'border-purple-400 bg-gradient-to-b from-purple-500 to-purple-600 text-white animate-pulse shadow-md shadow-purple-300/60 hover:shadow-lg hover:shadow-purple-500/70';
                                  if (table.status === 'linked') return 'border-blue-400 bg-gradient-to-b from-blue-50 to-blue-100 text-blue-700 shadow-sm shadow-blue-200/60 hover:shadow-md hover:shadow-blue-400/50';
                                  return 'border-yellow-500 bg-yellow-50 animate-pulse shadow-sm hover:shadow-md hover:shadow-yellow-400/50';
                                })()}`}
                              >
                                <p className="text-[9px] uppercase tracking-widest font-bold leading-none">Mesa</p>
                                <p className="text-xl font-black leading-none">{table.id}</p>
                                <div className="flex flex-wrap items-center justify-center gap-[2px] min-h-5 overflow-hidden w-full">
                                  {(() => {
                                    const types = getTableItemTypes(table.id, false);
                                    return (<>
                                      {types.hasLanche && <Sandwich size={16} className="shrink-0 text-amber-500" />}
                                      {types.hasPizza && <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-red-500" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 L22 21 H2 Z"/><path d="M2 21 Q12 23.5 22 21"/><circle cx="12" cy="11" r="1.1"/><circle cx="8" cy="16" r="0.9"/><circle cx="16" cy="16" r="0.9"/><circle cx="10" cy="13.5" r="0.7"/><circle cx="14" cy="13.5" r="0.7"/></svg>}
                                      {types.hasPorcao && <Salad size={16} className="shrink-0 text-orange-500" />}
                                      {types.hasLaCarte && <Soup size={16} className="shrink-0 text-emerald-600" />}
                                      {table.status === 'linked' && <LinkIcon size={12} className="text-blue-500" />}
                                      {shouldShowInactivityIcon(table.id, false) && <Clock size={11} className="text-amber-400 animate-pulse" />}
                                      {callingTables.has(table.id) && <BellRing size={13} className="text-orange-400 animate-bounce shrink-0" />}
                                    </>);
                                  })()}
                                </div>
                              </button>
                            ))}
                          </div>
                          {/* Time-limit plan countdown — Free plan only */}
                          {planKey === 'free' && ownerCreatedAt && (() => {
                            const trialDays = planCfg.trialDays;
                            const start = new Date(ownerCreatedAt).getTime();
                            const expiry = start + trialDays * 24 * 60 * 60 * 1000;
                            const remaining = Math.max(0, Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000)));
                            const urgent = remaining <= 3;
                            return (
                              <div className={`mt-2 mx-0.5 rounded-lg border px-3 py-2 flex items-center justify-between ${urgent ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                                <div>
                                  <p className={`text-[7px] font-bold uppercase tracking-widest leading-none ${urgent ? 'text-red-600' : 'text-amber-700'}`}>Time-limit plan</p>
                                  <p className={`text-[9px] mt-0.5 font-semibold ${urgent ? 'text-red-700' : 'text-amber-800'}`}>
                                    {remaining > 0 ? `${remaining} dia${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}` : 'Período de teste encerrado'}
                                  </p>
                                </div>
                                <div className={`text-2xl font-black font-mono ${urgent ? 'text-red-500' : 'text-amber-500'}`}>
                                  {remaining}
                                </div>
                              </div>
                            );
                          })()}
                          </div>
                        </motion.div>
                      ) : (pizzariaConfig.comandasEnabled === false ? null : (
                        <motion.div
                          key="comandas-grid"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.2 }}
                          className="h-full overflow-y-auto scrollbar-hide pr-1"
                        >
                          <div className="grid grid-cols-8 gap-1 pb-2">
                            {[...comandas].sort((a, b) => a.id - b.id).filter(c => !pizzariaConfig.numComandas || c.id <= pizzariaConfig.numComandas).map(comanda => (
                              <button
                                key={comanda.id}
                                draggable={comanda.status === 'occupied'}
                                onDragStart={e => { if (comanda.status === 'occupied') { setDragSourceComanda(comanda.id); e.dataTransfer.effectAllowed = 'move'; } }}
                                onDragEnd={() => setDragSourceComanda(null)}
                                onDragOver={e => { if (dragSourceComanda !== null && dragSourceComanda !== comanda.id && comanda.status === 'free') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                                onDrop={e => { e.preventDefault(); if (dragSourceComanda !== null && comanda.status === 'free') { setTransferPopup({ source: dragSourceComanda, target: comanda.id, isComanda: true }); setDragTransferMode('all'); setDragSelectedIds({}); setDragSourceComanda(null); } }}
                                onClick={() => {
                                  setSelectedComandaId(comanda.id);
                                  setIsComandaSelected(true);
                                  setShowingRecentOrders(false);
                                  if (shouldShowInactivityIcon(comanda.id, true)) {
                                    setInactivityPopup({ tableId: comanda.id, isComanda: true, minutes: getInactivityMinutes(comanda.id, true) });
                                  }
                                }}
                                className={`relative aspect-square rounded-lg border-2 transition-all duration-300 w-full flex flex-col items-center justify-center gap-0.5 hover:scale-[1.06] hover:-translate-y-0.5 ${
                                  selectedComandaId === comanda.id && isComandaSelected ? 'ring-2 ring-offset-1 ring-[#141414]/40' : ''
                                } ${(() => {
                                  const pc = getPizzeriaTableColor(comanda.id, true);
                                  if (pc === 'green') return 'border-green-500 bg-gradient-to-b from-green-400 to-green-500 text-white shadow-md shadow-green-300/60 hover:shadow-lg hover:shadow-green-400/70';
                                  if (pc === 'yellow') return 'border-yellow-400 bg-gradient-to-b from-yellow-300 to-yellow-400 text-[#141414] shadow-md shadow-yellow-300/60 hover:shadow-lg hover:shadow-yellow-400/70';
                                  if (pc === 'orange') return 'border-orange-400 bg-gradient-to-b from-orange-400 to-orange-500 text-white shadow-md shadow-orange-300/60 hover:shadow-lg hover:shadow-orange-400/70';
                                  if (pc === 'red') return 'border-red-500 bg-gradient-to-b from-red-400 to-red-500 text-white animate-pulse shadow-md shadow-red-300/60 hover:shadow-lg hover:shadow-red-500/70';
                                  if (comanda.status === 'free') return 'border-[#141414]/10 bg-white/60 hover:bg-white hover:border-[#141414]/20 text-[#141414]/35 shadow-sm hover:shadow-md hover:shadow-[#141414]/10';
                                  if (comanda.status === 'occupied') return 'border-[#141414]/80 bg-gradient-to-b from-[#202020] to-[#141414] text-[#E4E3E0] shadow-md shadow-[#141414]/30 hover:shadow-lg hover:shadow-[#141414]/50';
                                  if (comanda.status === 'aguardando_baixa') return 'border-purple-400 bg-gradient-to-b from-purple-500 to-purple-600 text-white animate-pulse shadow-md shadow-purple-300/60 hover:shadow-lg hover:shadow-purple-500/70';
                                  if (comanda.status === 'linked') return 'border-blue-400 bg-gradient-to-b from-blue-50 to-blue-100 text-blue-700 shadow-sm shadow-blue-200/60 hover:shadow-md hover:shadow-blue-400/50';
                                  return 'border-yellow-500 bg-yellow-50 animate-pulse shadow-sm hover:shadow-md hover:shadow-yellow-400/50';
                                })()}`}
                              >
                                <p className="text-[7px] uppercase tracking-widest opacity-55 font-bold leading-none">Com.</p>
                                <p className="text-sm font-black leading-none">{comanda.id}</p>
                                <div className="flex flex-wrap items-center justify-center gap-[2px] min-h-5 overflow-hidden w-full">
                                  {(() => {
                                    const types = getTableItemTypes(comanda.id, true);
                                    return (<>
                                      {types.hasLanche && <Sandwich size={16} className="shrink-0 text-amber-500" />}
                                      {types.hasPizza && <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-red-500" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 L22 21 H2 Z"/><path d="M2 21 Q12 23.5 22 21"/><circle cx="12" cy="11" r="1.1"/><circle cx="8" cy="16" r="0.9"/><circle cx="16" cy="16" r="0.9"/><circle cx="10" cy="13.5" r="0.7"/><circle cx="14" cy="13.5" r="0.7"/></svg>}
                                      {types.hasPorcao && <Salad size={16} className="shrink-0 text-orange-500" />}
                                      {types.hasLaCarte && <Soup size={16} className="shrink-0 text-emerald-600" />}
                                      {comanda.status === 'linked' && <LinkIcon size={12} className="text-blue-500" />}
                                      {shouldShowInactivityIcon(comanda.id, true) && <Clock size={11} className="text-amber-400 animate-pulse" />}
                                    </>);
                                  })()}
                                </div>
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      ))}
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
                          key={isComandaSelected ? `comanda-${selectedComandaId}` : `table-${selectedTableId}`}
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
                          firstSeenRef={firstSeenRef}
                          fiscalConfig={fiscalConfig}
                          onOpenNfce={(orderId: number | string, total: number) => { setNfceResult(null); setNfceCpf(''); setNfcePagamento('dinheiro'); setNfceModal({ orderId, total }); }}
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
                    {/* Waiter plan limit badge */}
                    {(() => {
                      const approvedCount = waiters.filter(w => w.status === 'approved').length;
                      const atLimit = approvedCount >= effectiveMaxWaiters;
                      return (
                        <div className={`flex items-center justify-between mb-3 px-3 py-1.5 rounded-lg border text-[10px] font-bold ${atLimit ? 'bg-red-50 border-red-200 text-red-700' : 'bg-[#F5F5F3] border-[#141414]/10 text-[#141414]/60'}`}>
                          <span className="flex items-center gap-1.5">
                            <Users size={11} />
                            Garçons ativos: {approvedCount} / {effectiveMaxWaiters}
                          </span>
                          {atLimit && <Lock size={10} className="text-red-500" />}
                        </div>
                      );
                    })()}
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
                                  socket.emit('toggle_waiter_status', { waiterId: waiter.id || waiter.cpf, status: 'inactive' });
                                  toast.success('Garçom inativado');
                                  try {
                                    const { updateDocument } = await import('../lib/firebaseService');
                                    await updateDocument('waiters', waiter.id || waiter.cpf!, { status: 'inactive' });
                                  } catch {}
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
                          const itemKey = item.menuItemId ?? item.id;
                          const edit = stockEdits[itemKey] ?? { quantity: String(item.quantity), minQuantity: String(item.minQuantity), unit: item.unit };
                          const isDirty = stockEdits[itemKey] !== undefined;
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
                                  onChange={e => setStockEdits(prev => ({ ...prev, [itemKey]: { ...edit, quantity: e.target.value } }))}
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
                                  onChange={e => setStockEdits(prev => ({ ...prev, [itemKey]: { ...edit, minQuantity: e.target.value } }))}
                                  className="w-20 border border-[#141414]/20 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:border-[#141414]"
                                />
                              </td>
                              <td className="p-3 lg:p-4">
                                <select
                                  value={edit.unit}
                                  onChange={e => setStockEdits(prev => ({ ...prev, [itemKey]: { ...edit, unit: e.target.value } }))}
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
                                          menuItemId: itemKey,
                                          quantity: newQty,
                                          minQuantity: parseFloat(edit.minQuantity) || 0,
                                          unit: edit.unit,
                                          itemName: item.name,
                                          change: newQty - currentQty,
                                        });
                                      } else {
                                        socket.emit('update_stock_item', {
                                          menuItemId: itemKey,
                                          quantity: newQty,
                                          minQuantity: parseFloat(edit.minQuantity) || 0,
                                          unit: edit.unit,
                                        });
                                        setStockEdits(prev => { const n = { ...prev }; delete n[itemKey]; return n; });
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

          {activeTab === 'products' && (
            <motion.div
              key="products"
              ref={productsScrollRef}
              onScroll={e => setShowScrollTop((e.target as HTMLElement).scrollTop > 300)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 overflow-y-auto space-y-10 pr-2 scrollbar-hide pt-6"
            >
              <header className="sticky top-0 z-30 bg-[#F5F5F3]/90 backdrop-blur-md py-6 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-[#141414]/5 space-y-4 md:space-y-0">
                <div className="flex items-center space-x-6 w-full overflow-hidden">
                  <div className="shrink-0">
                    <h2 className="font-serif italic text-3xl">Produtos</h2>
                    <p className="text-[10px] uppercase tracking-widest opacity-50">Cardápio Digital</p>
                  </div>
                  <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide flex-1 items-center">
                    {displayMenu.map(category => (
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
                    {pizzariaConfig.enabled && (
                      <>
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
                        <button
                          onClick={() => {
                            const element = document.getElementById(`category-tamanhos`);
                            element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                          className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all whitespace-nowrap"
                        >
                          Tamanhos
                        </button>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setIsAddCategoryPopupOpen(true)}
                    className="shrink-0 flex items-center gap-1.5 bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-xl text-xs font-bold hover:scale-105 transition-transform shadow-md ml-2"
                  >
                    <PlusCircle size={14} />
                    <span>Nova Categoria</span>
                  </button>
                </div>
              </header>

              {showScrollTop && (
                <button
                  onClick={() => productsScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="fixed bottom-8 right-8 z-40 bg-[#141414] text-[#E4E3E0] w-11 h-11 rounded-full flex items-center justify-center shadow-xl hover:scale-110 transition-transform"
                  title="Voltar ao topo"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
              )}

              <div className="space-y-8 pb-20 relative">
                {menu.map(category => {
                  const totalItems = category.items.length + (category.subcategories || []).reduce((sum, s) => sum + s.items.length, 0);
                  const renderItemRow = (item: MenuItem, catName: string, subId?: string) => (
                    <div key={item.id} className={`px-8 py-5 flex justify-between items-center hover:bg-gray-50/50 transition-colors ${(item as any).visible === false ? 'opacity-40' : ''}`}>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-base">{item.name}</p>
                          {(item as any).visible === false && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-red-100 text-red-500 rounded-full">Oculto</span>
                          )}
                        </div>
                        <p className="text-sm opacity-60 max-w-xl">{item.ingredients}</p>
                      </div>
                      <div className="flex items-center space-x-3">
                        <p className="font-mono font-bold text-lg mr-2">R$ {item.price.toFixed(2)}</p>
                        <div className="flex flex-col items-center space-y-1">
                          <span className="text-[7px] uppercase font-bold opacity-40 tracking-widest">Estoque</span>
                          <button
                            onClick={() => {
                              const enabled = !(item as any).trackStock;
                              socket.emit('toggle_stock_tracking', { menuItemId: item.id, categoryName: catName, subcategoryId: subId, enabled });
                              toast.success(enabled ? `"${item.name}" adicionado ao estoque` : `"${item.name}" removido do estoque`);
                            }}
                            className={`relative w-10 h-5 rounded-full transition-colors focus:outline-none ${(item as any).trackStock ? 'bg-green-500' : 'bg-gray-200'}`}
                          >
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(item as any).trackStock ? 'translate-x-5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                        <button
                          onClick={() => socket.emit('toggle_item_visibility', { categoryName: catName, subcategoryId: subId, itemId: item.id, visible: (item as any).visible === false })}
                          title={(item as any).visible === false ? 'Exibir no cardápio' : 'Ocultar no cardápio'}
                          className={`p-2.5 rounded-xl border border-[#141414]/10 transition-all ${(item as any).visible === false ? 'text-red-400 hover:bg-red-50' : 'text-gray-400 hover:bg-gray-100'}`}
                        >
                          {(item as any).visible === false ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                        <button
                          onClick={() => { setEditingProduct({ categoryName: catName, subcategoryId: subId, item: { ...item } }); setIsEditProductModalOpen(true); }}
                          className="p-2.5 rounded-xl border border-[#141414]/10 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all text-blue-600"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Excluir "${item.name}"?`)) { socket.emit('delete_product', { categoryName: catName, productId: item.id, subcategoryId: subId }); toast.success('Produto excluído!'); }}}
                          className="p-2.5 rounded-xl border border-[#141414]/10 hover:bg-red-600 hover:text-white transition-all text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );

                  return (
                    <div key={category.name} id={`category-${category.name}`} className="bg-white rounded-3xl border border-[#141414]/10 shadow-sm overflow-hidden scroll-mt-48 md:scroll-mt-32">
                      {/* Category header */}
                      <div className="bg-[#141414] px-8 py-4 border-b border-[#141414]/10 flex justify-between items-center flex-wrap gap-3">
                        <div className="flex items-center gap-4">
                          {editingCategory?.oldName === category.name ? (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editingCategory.name}
                                  onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                  className="bg-white border border-white/30 rounded-lg px-3 py-1.5 font-bold outline-none focus:border-white text-[#141414]"
                                />
                                <button onClick={() => { socket.emit('update_category', { oldName: editingCategory.oldName, updatedData: { name: editingCategory.name, type: editingCategory.type } }); setEditingCategory(null); toast.success('Categoria atualizada!'); }} className="p-2 bg-green-500 text-white rounded-lg"><Save size={16} /></button>
                                <button onClick={() => setEditingCategory(null)} className="p-2 bg-white/20 text-white rounded-lg"><X size={16} /></button>
                              </div>
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="text-[9px] text-white/50 font-bold uppercase mr-1">Tipo:</span>
                                {[
                                  { key: 'lanches', label: 'Lanche' },
                                  { key: 'pizzas', label: 'Pizza' },
                                  { key: 'bebidas', label: 'Bebida' },
                                  { key: 'porcoes', label: 'Porção' },
                                  { key: 'lacarte', label: 'À la carte' },
                                ].map(opt => (
                                  <button
                                    key={opt.key}
                                    onClick={() => setEditingCategory({ ...editingCategory, type: opt.key })}
                                    className={`px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${editingCategory.type === opt.key ? 'bg-white text-[#141414]' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <>
                              <h3 className="font-serif italic text-xl text-white">{category.name}</h3>
                              <span className="text-[10px] uppercase tracking-widest font-bold text-white/50 bg-white/10 px-3 py-1 rounded-full">{totalItems} itens</span>
                              {!(category.visible ?? true) && <span className="text-[10px] text-red-400 font-bold uppercase px-2 py-0.5 bg-red-900/30 rounded-full">Oculto</span>}
                              {category.trackTime && <span className="text-[10px] text-amber-300 font-bold uppercase px-2 py-0.5 bg-amber-900/30 rounded-full flex items-center gap-1"><Clock size={10} /> Tempo ativo</span>}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            title={(category.visible ?? true) ? 'Ocultar no cardápio' : 'Exibir no cardápio'}
                            onClick={() => socket.emit('toggle_category_visibility', { categoryName: category.name, visible: !(category.visible ?? true) })}
                            className="p-2 rounded-xl border border-white/20 hover:bg-white/10 transition-all text-white"
                          >
                            {(category.visible ?? true) ? <Eye size={16} /> : <EyeOff size={16} className="text-red-400" />}
                          </button>
                          <button
                            title={category.trackTime ? 'Contagem de tempo: ativa' : 'Ativar contagem de tempo até entrega'}
                            onClick={() => { socket.emit('update_category', { oldName: category.name, updatedData: { trackTime: !category.trackTime } }); toast.success(category.trackTime ? 'Contagem de tempo desativada' : 'Contagem de tempo ativada!'); }}
                            className={`p-2 rounded-xl border transition-all ${category.trackTime ? 'border-amber-400 bg-amber-400/20 text-amber-300' : 'border-white/20 hover:bg-white/10 text-white/50'}`}
                          >
                            <Clock size={16} />
                          </button>
                          <button onClick={() => setEditingCategory({ oldName: category.name, name: category.name, visible: category.visible ?? true, type: category.type || 'lanches' })} className="p-2 rounded-xl border border-white/20 hover:bg-white/10 transition-all text-blue-300"><Edit size={16} /></button>
                          <button
                            onClick={() => { setNewSubcategoryData({ categoryName: category.name, name: '' }); setIsAddSubcategoryModalOpen(true); }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/20 text-white text-xs font-bold hover:bg-white/10 transition-all"
                          >
                            <PlusCircle size={14} /> Subcategoria
                          </button>
                          {(category.subcategories || []).length === 0 && (
                            <button
                              onClick={() => { setNewProductCategory(category.name); setNewProductSubcategoryId(null); setNewProductData({ name: '', price: 0, ingredients: '' }); setIsAddProductModalOpen(true); }}
                              className="flex items-center gap-1.5 px-3 py-2 bg-white text-[#141414] rounded-xl text-xs font-bold hover:opacity-80 transition-all"
                            >
                              <PlusCircle size={14} /> Item
                            </button>
                          )}
                          <button onClick={() => { if (confirm(`Excluir categoria "${category.name}" e todos seus itens?`)) { socket.emit('delete_category', category.name); toast.success('Categoria excluída!'); }}} className="p-2 rounded-xl border border-white/20 hover:bg-red-900/30 text-red-400 transition-all"><Trash2 size={16} /></button>
                        </div>
                      </div>

                      {/* Subcategories */}
                      {(category.subcategories || []).map(sub => (
                        <div key={sub.id} className="border-b border-[#141414]/5 last:border-b-0">
                          {/* Subcategory header */}
                          <div className="px-8 py-3 bg-[#141414]/[0.06] border-b border-[#141414]/10 flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-3">
                              {editingSubcategory?.subcategoryId === sub.id ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs opacity-40">↳</span>
                                  <input
                                    type="text"
                                    value={editingSubcategory.name}
                                    onChange={(e) => setEditingSubcategory({ ...editingSubcategory, name: e.target.value })}
                                    className="bg-white border border-[#141414]/20 rounded-lg px-3 py-1 text-sm font-bold outline-none focus:border-[#141414]"
                                  />
                                  <button onClick={() => { socket.emit('update_subcategory', { categoryName: category.name, subcategoryId: sub.id, updatedData: { name: editingSubcategory.name } }); setEditingSubcategory(null); toast.success('Subcategoria atualizada!'); }} className="p-1.5 bg-green-500 text-white rounded-lg"><Save size={14} /></button>
                                  <button onClick={() => setEditingSubcategory(null)} className="p-1.5 bg-gray-200 rounded-lg"><X size={14} /></button>
                                </div>
                              ) : (
                                <>
                                  <span className="text-[#141414]/30 font-bold">↳</span>
                                  <span className="font-bold text-sm">{sub.name}</span>
                                  <span className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-[#141414]/10 opacity-60">{sub.items.length} itens</span>
                                  {!sub.visible && <span className="text-[10px] text-red-500 font-bold uppercase px-2 py-0.5 bg-red-50 rounded-full">Oculto</span>}
                                  {sub.trackTime && <span className="text-[10px] text-amber-600 font-bold uppercase px-2 py-0.5 bg-amber-50 rounded-full flex items-center gap-1"><Clock size={10} /> Tempo ativo</span>}
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                title={sub.visible ? 'Ocultar subcategoria' : 'Exibir subcategoria'}
                                onClick={() => socket.emit('update_subcategory', { categoryName: category.name, subcategoryId: sub.id, updatedData: { visible: !sub.visible } })}
                                className="p-1.5 rounded-lg hover:bg-gray-100 transition-all"
                              >
                                {sub.visible ? <Eye size={14} /> : <EyeOff size={14} className="text-red-400" />}
                              </button>
                              <button
                                title={sub.trackTime ? 'Desativar contagem de tempo' : 'Ativar contagem de tempo até entrega'}
                                onClick={() => { socket.emit('update_subcategory', { categoryName: category.name, subcategoryId: sub.id, updatedData: { trackTime: !sub.trackTime } }); toast.success(sub.trackTime ? 'Contagem de tempo desativada' : 'Contagem de tempo ativada!'); }}
                                className={`p-1.5 rounded-lg transition-all ${sub.trackTime ? 'bg-amber-100 text-amber-600' : 'hover:bg-gray-100 text-[#141414]/30'}`}
                              >
                                <Clock size={14} />
                              </button>
                              <button onClick={() => setEditingSubcategory({ categoryName: category.name, subcategoryId: sub.id, name: sub.name })} className="p-1.5 rounded-lg hover:bg-gray-100 text-blue-500"><Edit size={14} /></button>
                              <button
                                onClick={() => { setNewProductCategory(category.name); setNewProductSubcategoryId(sub.id); setNewProductData({ name: '', price: 0, ingredients: '' }); setIsAddProductModalOpen(true); }}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#141414] text-white rounded-lg text-xs font-bold hover:opacity-80"
                              >
                                <PlusCircle size={12} /> Item
                              </button>
                              <button onClick={() => { if (confirm(`Excluir subcategoria "${sub.name}"?`)) { socket.emit('delete_subcategory', { categoryName: category.name, subcategoryId: sub.id }); toast.success('Subcategoria excluída!'); }}} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={14} /></button>
                            </div>
                          </div>
                          {/* Items in subcategory */}
                          <div className="divide-y divide-[#141414]/5">
                            {sub.items.map(item => renderItemRow(item, category.name, sub.id))}
                            {sub.items.length === 0 && (
                              <p className="px-8 py-4 text-sm opacity-40 italic">Nenhum item nesta subcategoria.</p>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* Direct items (when no subcategories or for backward compat) */}
                      {category.items.length > 0 && (
                        <div className="divide-y divide-[#141414]/5">
                          {(category.subcategories || []).length > 0 && (
                            <div className="px-8 py-2 bg-[#141414]/[0.02] border-b border-dashed border-[#141414]/10">
                              <span className="text-[10px] font-bold opacity-40 uppercase">Itens sem subcategoria</span>
                            </div>
                          )}
                          {category.items.map(item => renderItemRow(item, category.name))}
                        </div>
                      )}

                      {totalItems === 0 && (
                        <p className="px-8 py-6 text-sm opacity-40 italic text-center">Nenhum item cadastrado. Adicione subcategorias ou itens.</p>
                      )}
                    </div>
                  );
                })}

                {pizzariaConfig.enabled && (<>
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
                        setNewFlavorData({ name: '', ingredients: '', price: 0 });
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
                      onClick={() => { setNewCrustName(''); setIsCrustModalOpen(true); setEditingCrustOriginal(''); setEditingCrustName(''); }}
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
                            onClick={() => { setEditingCrustOriginal(crust); setEditingCrustName(crust); setIsCrustModalOpen(true); }}
                            className="p-3 rounded-xl border border-[#141414]/10 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            onClick={() => { socket.emit('delete_pizza_crust', crust); toast.success('Borda excluída com sucesso!'); }}
                            className="p-3 rounded-xl border border-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pizza Sizes Section */}
                <div id="category-tamanhos" className="bg-white rounded-3xl border border-[#141414]/10 shadow-sm overflow-hidden scroll-mt-48 md:scroll-mt-32">
                  <div className="bg-gray-50 px-8 py-4 border-b border-[#141414]/10 flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                      <h3 className="font-serif italic text-xl">Tamanhos das Pizzas</h3>
                      <span className="text-[10px] uppercase tracking-widest font-bold opacity-50 bg-white px-3 py-1 rounded-full border border-[#141414]/10">
                        {pizzaSizes.length} itens
                      </span>
                    </div>
                    <button
                      onClick={() => { setSizeForm({ name: '', slices: 4, dim: '', people: '', maxFlavors: 2, detail: '', basePrice: 0 }); setEditingSize(null); setEditingSizeIndex(-1); setIsSizeModalOpen(true); }}
                      className="flex items-center space-x-2 bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-xl text-xs font-bold hover:scale-105 transition-transform"
                    >
                      <PlusCircle size={16} />
                      <span>Adicionar Tamanho</span>
                    </button>
                  </div>
                  <div className="divide-y divide-[#141414]/5">
                    {pizzaSizes.map((size, idx) => (
                      <div key={idx} className="px-8 py-4 flex justify-between items-center hover:bg-gray-50/50 transition-colors">
                        <div className="space-y-1">
                          <p className="font-bold text-lg">{size.name} {size.basePrice ? <span className="text-green-600 font-semibold">R$ {Number(size.basePrice).toFixed(2)}</span> : ''}</p>
                          <p className="text-sm opacity-50">{size.slices} fatias · {size.dim} · {size.people} · {size.detail}</p>
                        </div>
                        <div className="flex items-center space-x-4">
                          <button
                            onClick={() => { setSizeForm({ name: size.name, slices: size.slices, dim: size.dim, people: size.people, maxFlavors: size.maxFlavors, detail: size.detail, basePrice: size.basePrice || 0 }); setEditingSize(size); setEditingSizeIndex(idx); setIsSizeModalOpen(true); }}
                            className="p-3 rounded-xl border border-[#141414]/10 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            onClick={() => { socket.emit('delete_pizza_size', idx); toast.success('Tamanho excluído!'); }}
                            className="p-3 rounded-xl border border-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                </>)}
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

                      <button
                        onClick={() => setCurrentReportView('delivery_time')}
                        className="p-3 bg-white border border-[#141414]/10 rounded-xl hover:border-[#141414] hover:shadow-md transition-all text-left group"
                      >
                        <div className="w-8 h-8 bg-teal-50 text-teal-600 rounded-lg flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <Clock size={16} />
                        </div>
                        <h4 className="font-bold text-[10px] uppercase mb-0.5">Tempo de Pedido</h4>
                        <p className="text-[8px] opacity-50 leading-tight">Pedido até entrega por item.</p>
                      </button>

                      <button
                        onClick={() => { setCurrentReportView('cash_register'); setCashRegReportLoading(true); socket.emit('get_cash_register_reports', { date: cashRegReportDate }); }}
                        className="p-3 bg-white border border-[#141414]/10 rounded-xl hover:border-[#141414] hover:shadow-md transition-all text-left group"
                      >
                        <div className="w-8 h-8 bg-[#141414] text-white rounded-lg flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <Wallet size={16} />
                        </div>
                        <h4 className="font-bold text-[10px] uppercase mb-0.5">Relatório de Caixa</h4>
                        <p className="text-[8px] opacity-50 leading-tight">Abertura e fechamento por dia.</p>
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
                          {currentReportView === 'delivery_time' && 'Tempo de Pedido'}
                          {currentReportView === 'cash_register' && 'Relatório de Caixa'}
                        </h2>
                        <p className="text-[9px] opacity-60">Filtre para gerar o relatório.</p>
                      </div>
                    </div>
                  </header>

                  <div className="sticky top-0 z-20 bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm">
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
                              {displayMenu.map(cat => (
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

                        {currentReportView === 'delivery_time' && (
                          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {(() => {
                              // Collect all delivery records from all orders in date range
                              const rows: {
                                itemName: string;
                                tableId: number | string;
                                isComanda: boolean;
                                orderedAt: string | null;
                                deliveredAt: string;
                                durationMinutes: number | null;
                                launchedBy: string;
                                deliveredBy: string;
                              }[] = [];

                              orders.forEach(o => {
                                const orderDate = (o.timestamp || '').split('T')[0];
                                if (orderDate < reportStartDate || orderDate > reportEndDate) return;
                                (o.deliveryLog || []).forEach((d: any) => {
                                  // find original item for launchedBy
                                  const item = (o.items || []).find((i: any) => i.id === d.itemId || i.name === d.itemName);
                                  rows.push({
                                    itemName: d.itemName,
                                    tableId: d.tableId ?? o.tableId,
                                    isComanda: d.isComanda ?? o.isComanda ?? false,
                                    orderedAt: d.orderedAt || item?.timestamp || null,
                                    deliveredAt: d.deliveredAt,
                                    durationMinutes: d.durationMinutes,
                                    launchedBy: item?.waiterName || d.waiterName || '—',
                                    deliveredBy: item?.deliveredBy || d.waiterName || '—',
                                  });
                                });
                              });

                              // Filter by waiter if selected
                              const filtered = rows.filter(r =>
                                reportSelectedWaiter === 'todos' ||
                                r.launchedBy === reportSelectedWaiter ||
                                r.deliveredBy === reportSelectedWaiter
                              ).sort((a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime());

                              if (filtered.length === 0) return (
                                <div className="p-20 text-center bg-white rounded-3xl border border-dashed border-[#141414]/10">
                                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Clock size={32} className="text-gray-300" />
                                  </div>
                                  <p className="text-gray-400 italic font-serif">Nenhuma entrega registrada no período.</p>
                                </div>
                              );

                              const durations = filtered.map(r => r.durationMinutes).filter((d): d is number => d !== null);
                              const avgMin = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
                              const maxMin = durations.length ? Math.max(...durations) : null;
                              const minMin = durations.length ? Math.min(...durations) : null;

                              return (
                                <>
                                  {/* Stats summary */}
                                  <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-white border border-[#141414]/10 rounded-xl p-3 text-center">
                                      <p className="text-[8px] uppercase font-bold opacity-40 mb-1">Entregas</p>
                                      <p className="text-xl font-black">{filtered.length}</p>
                                    </div>
                                    <div className="bg-white border border-[#141414]/10 rounded-xl p-3 text-center">
                                      <p className="text-[8px] uppercase font-bold opacity-40 mb-1">Tempo médio</p>
                                      <p className={`text-xl font-black ${avgMin !== null && avgMin > 20 ? 'text-red-500' : avgMin !== null && avgMin > 10 ? 'text-amber-500' : 'text-emerald-600'}`}>
                                        {avgMin !== null ? `${avgMin}min` : '—'}
                                      </p>
                                    </div>
                                    <div className="bg-white border border-[#141414]/10 rounded-xl p-3 text-center">
                                      <p className="text-[8px] uppercase font-bold opacity-40 mb-1">Máx / Mín</p>
                                      <p className="text-sm font-black">
                                        <span className="text-red-400">{maxMin !== null ? `${maxMin}m` : '—'}</span>
                                        <span className="opacity-30 mx-1">/</span>
                                        <span className="text-emerald-600">{minMin !== null ? `${minMin}m` : '—'}</span>
                                      </p>
                                    </div>
                                  </div>

                                  {/* Table */}
                                  <div className="bg-white border border-[#141414]/10 rounded-xl overflow-hidden shadow-sm">
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-[10px]">
                                        <thead>
                                          <tr className="bg-[#141414]/3 border-b border-[#141414]/10">
                                            <th className="text-left p-2 font-bold uppercase opacity-50">Item</th>
                                            <th className="text-center p-2 font-bold uppercase opacity-50">Mesa</th>
                                            <th className="text-left p-2 font-bold uppercase opacity-50">Pedido em</th>
                                            <th className="text-left p-2 font-bold uppercase opacity-50">Entregue em</th>
                                            <th className="text-center p-2 font-bold uppercase opacity-50">Tempo</th>
                                            <th className="text-left p-2 font-bold uppercase opacity-50">Lançado por</th>
                                            <th className="text-left p-2 font-bold uppercase opacity-50">Entregue por</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {filtered.map((r, i) => {
                                            const fmtTime = (iso: string | null) => {
                                              if (!iso) return '—';
                                              const d = new Date(iso);
                                              return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
                                                d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                                            };
                                            const durColor = r.durationMinutes === null ? '' :
                                              r.durationMinutes > 20 ? 'text-red-500 font-black' :
                                              r.durationMinutes > 10 ? 'text-amber-500 font-bold' : 'text-emerald-600 font-bold';
                                            return (
                                              <tr key={i} className={`border-b border-[#141414]/5 ${i % 2 === 0 ? '' : 'bg-[#141414]/[0.015]'}`}>
                                                <td className="p-2 font-semibold">{r.itemName}</td>
                                                <td className="p-2 text-center font-bold">{r.isComanda ? `Com.${r.tableId}` : `Mesa ${r.tableId}`}</td>
                                                <td className="p-2 opacity-70">{fmtTime(r.orderedAt)}</td>
                                                <td className="p-2 opacity-70">{fmtTime(r.deliveredAt)}</td>
                                                <td className={`p-2 text-center ${durColor}`}>
                                                  {r.durationMinutes !== null ? `${r.durationMinutes}min` : '—'}
                                                </td>
                                                <td className="p-2 opacity-70">{r.launchedBy}</td>
                                                <td className="p-2 opacity-70">{r.deliveredBy}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
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

                      {currentReportView === 'cash_register' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-2 bg-white border border-[#141414]/10 rounded-xl px-3 py-2">
                              <Calendar size={13} className="opacity-40" />
                              <input
                                type="date"
                                value={cashRegReportDate}
                                onChange={e => {
                                  setCashRegReportDate(e.target.value);
                                  setCashRegReportLoading(true);
                                  socket.emit('get_cash_register_reports', { date: e.target.value });
                                }}
                                className="bg-transparent border-none font-bold outline-none text-xs"
                              />
                            </div>
                            <button
                              onClick={() => { setCashRegReportLoading(true); socket.emit('get_cash_register_reports', { date: cashRegReportDate }); }}
                              className="flex items-center gap-1.5 px-3 py-2 bg-[#141414] text-white text-[10px] font-bold rounded-xl hover:bg-[#141414]/80 transition-colors"
                            >
                              <Search size={11} /> Buscar
                            </button>
                          </div>

                          {cashRegReportLoading ? (
                            <div className="p-12 text-center bg-white rounded-2xl border border-[#141414]/10">
                              <p className="text-[11px] text-[#141414]/40 font-semibold">Carregando...</p>
                            </div>
                          ) : cashRegReportList.length === 0 ? (
                            <div className="p-16 text-center bg-white rounded-2xl border border-dashed border-[#141414]/10">
                              <div className="w-14 h-14 bg-[#141414]/5 rounded-full flex items-center justify-center mx-auto mb-3">
                                <Wallet size={28} className="text-[#141414]/20" />
                              </div>
                              <p className="text-[#141414]/40 italic font-serif text-sm">Nenhum relatório para esta data.</p>
                              <p className="text-[9px] text-[#141414]/25 mt-1">Relatórios são gerados automaticamente ao abrir/fechar o caixa.</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {cashRegReportList.map((report: any) => {
                                const isClose = report.type === 'close';
                                const rd = report.report_data || {};
                                const fmtMoney = (v: number) => `R$ ${(v || 0).toFixed(2).replace('.', ',')}`;
                                const fmtDT = (iso: string) => {
                                  if (!iso) return '—';
                                  const d = new Date(iso);
                                  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                                };
                                const methodTotals: Record<string, number> = rd.methodTotals || {};
                                const productTotals: Record<string, { qty: number; total: number }> = rd.productTotals || {};
                                const categoryTotals: Record<string, { qty: number; total: number }> = rd.categoryTotals || {};

                                const printReport = () => {
                                  const pc: any = (() => { try { return JSON.parse(localStorage.getItem('printerConfig') || '{}'); } catch { return {}; } })();
                                  const printer = (pc.registeredPrinters || []).find((p: any) => p.name === pc.receipts);
                                  const is50 = pc.paperWidth === '50mm';
                                  const LL = is50 ? 32 : 48;
                                  const ESC = 0x1b; const GS = 0x1d;
                                  const by: number[] = [];
                                  const pu = (...a: number[]) => a.forEach(x => by.push(x));
                                  const lf = () => pu(0x0a);
                                  const eS = (s: string) => { const r: number[] = []; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); r.push(c < 128 ? c : (c===231?135:c===199?199:c===227?227:c===195?195:c===245?245:c===213?213:c===233?130:c===201?201:c===225?160:c===193?193:c===237?161:c===205?205:c===243?162:c===211?211:c===250?163:c===218?218:c===252?129:c===220?154:c===226?131:c===234?136:c===244?147:63)); } return r; };
                                  const tx = (s: string) => { pu(...eS(s)); lf(); };
                                  const ln = () => tx('-'.repeat(LL));
                                  const dln = () => tx('='.repeat(LL));
                                  const aln = (a: 0|1|2) => pu(ESC, 0x61, a);
                                  const bold = (on: boolean) => pu(ESC, 0x45, on ? 1 : 0);
                                  const dbl = (on: boolean) => pu(GS, 0x21, on ? 0x11 : 0x00);
                                  const fmtM = (v: number) => `R$ ${(v||0).toFixed(2).replace('.', ',')}`;
                                  const fmtDT2 = (iso: string) => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); };
                                  const col2 = (l: string, r: string) => { tx(l + ' '.repeat(Math.max(1, LL-l.length-r.length)) + r); };
                                  const secT = (t: string) => { const inner=` ${t} `; const s=Math.floor((LL-inner.length)/2); tx('='.repeat(Math.max(0,s))+inner+'='.repeat(Math.max(0,LL-s-inner.length))); };
                                  const w1r = is50 ? 14 : 24; const w2r = is50 ? 6 : 8; const w3r = LL-w1r-w2r;
                                  const col3 = (c1: string, c2: string, c3: string) => tx(c1.substring(0,w1r).padEnd(w1r)+c2.substring(0,w2r).padStart(w2r)+c3.padStart(w3r));
                                  const payR = (l: string, r: string) => { const vL=Math.min(12,LL-2); tx(l.substring(0,LL-vL-1).padEnd(LL-vL)+r.padStart(vL)); };

                                  pu(ESC, 0x40); pu(ESC, 0x74, 2);
                                  // Cabeçalho
                                  aln(1); dbl(true); bold(true); tx('RELATORIO DE CAIXA'); dbl(false); bold(false);
                                  lf(); aln(0);
                                  tx(`Cx: ${report.cash_register_name || '-'}`);
                                  col2('Abertura:', fmtDT2(report.shift_started_at));
                                  col2('Fechamento:', fmtDT2(report.created_at));
                                  col2('Fundo de Caixa:', fmtM(0));
                                  dln();
                                  // Pagamentos
                                  secT('PAGAMENTOS');
                                  bold(true); payR('Meio de Pagamento', 'Total'); bold(false);
                                  ln();
                                  const payE = Object.entries(methodTotals).sort((a,b)=>b[1]-a[1]);
                                  if (payE.length === 0) { tx('Nenhum pagamento.'); } else { payE.forEach(([m,v])=>payR(m,(v as number).toFixed(2).replace('.',','))); }
                                  ln(); bold(true); payR('TOTAL RECEBIDO:', (rd.totalPaid||0).toFixed(2).replace('.',',')); bold(false); lf();
                                  // Itens
                                  if (isClose && Object.keys(productTotals).length > 0) {
                                    secT('ITENS VENDIDOS');
                                    bold(true); col3('Produto','Qtde','Total'); bold(false); ln();
                                    Object.entries(productTotals).sort((a,b)=>b[1].total-a[1].total).forEach(([n,v])=>{
                                      const q=v.qty%1===0?v.qty.toString():v.qty.toFixed(3).replace('.',',');
                                      col3(n,q,v.total.toFixed(2).replace('.',','));
                                    });
                                    ln();
                                    bold(true); col2('TOTAL VENDIDO BRUTO:', fmtM(rd.totalPaid||0)); bold(false); lf();
                                  }
                                  // Categorias
                                  if (isClose && Object.keys(categoryTotals).length > 0) {
                                    secT('CATEGORIAS');
                                    bold(true); col3('Categoria','Qtde','Total'); bold(false); ln();
                                    Object.entries(categoryTotals).sort((a,b)=>b[1].total-a[1].total).forEach(([cat,v])=>{
                                      const q=v.qty%1===0?v.qty.toString():v.qty.toFixed(3).replace('.',',');
                                      col3(cat,q,v.total.toFixed(2).replace('.',','));
                                    });
                                    ln(); bold(true); col2('TOTAL CLASSES:', fmtM(rd.totalPaid||0)); bold(false); lf();
                                  }
                                  // Rodapé
                                  dln(); bold(true); col2('TOTAL VALES:', fmtM(0)); bold(false);
                                  lf(); tx(`Usuario: ${report.cash_register_name || '-'}`);
                                  pu(0x0a,0x0a,0x0a,GS,0x56,0x41,0x10);

                                  if (printer) {
                                    if (printer.ip) socket.emit('print_escpos', { ip: printer.ip, port: printer.port||9100, data: by });
                                    else socket.emit('print_escpos', { localName: printer.name, data: by });
                                  } else {
                                    const sep='='.repeat(42); const dash='-'.repeat(42);
                                    const rows: string[]=[]; const add=(s='')=>rows.push(s);
                                    const fb2=(l:string,r:string)=>add(l.padEnd(42-r.length)+r);
                                    const fb3=(c1:string,c2:string,c3:string)=>add(c1.padEnd(24)+c2.padStart(8)+c3.padStart(10));
                                    const fbP=(l:string,r:string)=>add(l.padEnd(30)+r.padStart(12));
                                    add('         RELATORIO DE CAIXA'); add('');
                                    add(`Cx: ${report.cash_register_name||'-'}`);
                                    fb2('Abertura:', fmtDT2(report.shift_started_at));
                                    fb2('Fechamento:', fmtDT2(report.created_at));
                                    fb2('Fundo de Caixa:', 'R$ 0,00'); add(sep);
                                    add('===== PAGAMENTOS ====='); fbP('Meio de Pagamento','Total'); add(dash);
                                    payE.forEach(([m,v])=>fbP(m,(v as number).toFixed(2).replace('.',',')));
                                    add(dash); fbP('TOTAL RECEBIDO:',(rd.totalPaid||0).toFixed(2).replace('.',',')); add('');
                                    if (isClose && Object.keys(productTotals).length>0) {
                                      add('===== ITENS VENDIDOS ====='); fb3('Produto','Qtde','Total'); add(dash);
                                      Object.entries(productTotals).sort((a,b)=>b[1].total-a[1].total).forEach(([n,v])=>{const q=v.qty%1===0?v.qty.toString():v.qty.toFixed(3).replace('.',',');fb3(n,q,v.total.toFixed(2).replace('.',','));});
                                      add(dash); fb2('TOTAL VENDIDO BRUTO:','R$ '+(rd.totalPaid||0).toFixed(2)); add('');
                                    }
                                    if (isClose && Object.keys(categoryTotals).length>0) {
                                      add('===== CATEGORIAS ====='); fb3('Categoria','Qtde','Total'); add(dash);
                                      Object.entries(categoryTotals).sort((a,b)=>b[1].total-a[1].total).forEach(([cat,v])=>{const q=v.qty%1===0?v.qty.toString():v.qty.toFixed(3).replace('.',',');fb3(cat,q,v.total.toFixed(2).replace('.',','));});
                                      add(dash); fb2('TOTAL CLASSES:','R$ '+(rd.totalPaid||0).toFixed(2)); add('');
                                    }
                                    add(sep); fb2('TOTAL VALES:','R$ 0,00'); add(`Usuario: ${report.cash_register_name||'-'}`);
                                    const pw=window.open('','_blank'); if(pw){pw.document.write(`<html><head><title>Rel. Caixa</title><style>body{font-family:monospace;font-size:12px;padding:16px;white-space:pre;line-height:1.5}@media print{body{margin:0}}</style></head><body>${rows.join('\n')}<script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`);pw.document.close();}
                                  }
                                };

                                return (
                                  <div key={report.id} className="bg-white border border-[#141414]/10 rounded-2xl overflow-hidden shadow-sm">
                                    <div className={`flex items-center justify-between px-4 py-3 ${isClose ? 'bg-[#141414]' : 'bg-[#141414]/5'}`}>
                                      <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isClose ? 'bg-white/10' : 'bg-[#141414]/10'}`}>
                                          <Wallet size={14} className={isClose ? 'text-white' : 'text-[#141414]'} />
                                        </div>
                                        <div>
                                          <p className={`text-[10px] font-black uppercase tracking-widest ${isClose ? 'text-white' : 'text-[#141414]'}`}>{isClose ? 'Fechamento' : 'Abertura'}</p>
                                          {report.cash_register_name && <p className={`text-[9px] font-semibold ${isClose ? 'text-white/60' : 'text-[#141414]/50'}`}>{report.cash_register_name}</p>}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className={`text-[10px] font-mono ${isClose ? 'text-white/70' : 'text-[#141414]/50'}`}>{fmtDT(report.created_at)}</span>
                                        <button onClick={printReport} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold transition-colors ${isClose ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-[#141414]/10 text-[#141414] hover:bg-[#141414]/20'}`}>
                                          <Printer size={11} /> Imprimir
                                        </button>
                                      </div>
                                    </div>
                                    {isClose && (
                                      <div className="px-4 py-3 space-y-2">
                                        {Object.keys(methodTotals).length > 0 && (
                                          <div className="flex flex-wrap gap-2">
                                            {Object.entries(methodTotals).map(([m, v]) => (
                                              <span key={m} className="text-[9px] bg-[#141414]/5 rounded-lg px-2 py-1 font-semibold">
                                                {m}: <span className="font-black text-green-700">{fmtMoney(v as number)}</span>
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                        {rd.orderCount !== undefined && (
                                          <p className="text-[9px] text-[#141414]/40 font-semibold">{rd.orderCount} pedidos finalizados · Total: <span className="text-[#141414] font-black">{fmtMoney(rd.totalPaid || 0)}</span></p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
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
              className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"
            >
              <div className="pt-2 pb-6">
              <header className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-serif italic text-xl mb-0.5">Configurações</h2>
                  <p className="text-[9px] opacity-50 leading-none uppercase tracking-widest font-bold">Estabelecimento · Periféricos · Sistema</p>
                </div>
              </header>

              {/* ── Abas de Configurações ── */}
              <div className="flex gap-1 mb-4 border-b border-[#141414]/10 pb-0">
                {([
                  { key: 'salon', label: 'Salão' },
                  { key: 'operation', label: 'Operação' },
                  { key: 'print', label: 'Impressão' },
                  { key: 'data', label: 'Dados' },
                  { key: 'fiscal', label: 'Fiscal' },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setSettingsTab(tab.key)}
                    className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-t-lg transition-colors border-b-2 -mb-px ${settingsTab === tab.key ? 'border-[#141414] text-[#141414] bg-white' : 'border-transparent text-[#141414]/40 hover:text-[#141414]/70 hover:bg-[#141414]/4'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── Aba: Salão ── */}
              {settingsTab === 'salon' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-4">

              {/* Card: Estrutura do Salão — movido para o topo do grid */}
              <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <LayoutDashboard className="text-[#141414]" size={13} />
                  <h3 className="font-serif italic text-sm leading-none flex-1">Estrutura do Salão</h3>
                  {salonDirty && !isCashRegisterOpen && (
                    <span className="text-[7px] text-amber-600 font-bold uppercase">não salvo</span>
                  )}
                  <button
                    onClick={saveSalonConfig}
                    disabled={isCashRegisterOpen || savingConfig || (!salonDirty && !planCfg.tablesLocked)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all ${
                      !isCashRegisterOpen && salonDirty
                        ? 'bg-[#141414] text-white hover:opacity-80'
                        : 'bg-[#141414]/10 text-[#141414]/40 cursor-not-allowed'
                    }`}
                  >
                    <Save size={9} />
                    {savingConfig ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
                {isCashRegisterOpen && (
                  <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1 mb-2">
                    <Lock size={9} className="text-red-500 shrink-0" />
                    <span className="text-[8px] text-red-700 font-bold">Feche o caixa para alterar</span>
                  </div>
                )}
                {!isCashRegisterOpen && (planCfg.tablesLocked || planCfg.comandasLocked) && (
                  <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">
                    <Lock size={9} className="text-amber-600 shrink-0" />
                    <span className="text-[8px] text-amber-700 font-bold">Plano {planKey.charAt(0).toUpperCase() + planKey.slice(1)} — limite do plano</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[7.5px] font-black uppercase opacity-40 mb-1 flex items-center gap-1">
                      Nº de Mesas {planCfg.tablesLocked && <Lock size={7} className="text-amber-500" />}
                    </label>
                    <input
                      type="number" min="1" max="500"
                      value={planCfg.tablesLocked ? planCfg.maxTables : localNumTables}
                      readOnly={isCashRegisterOpen || planCfg.tablesLocked}
                      disabled={isCashRegisterOpen || planCfg.tablesLocked}
                      onChange={(e) => !isCashRegisterOpen && !planCfg.tablesLocked && setLocalNumTables(Math.max(1, parseInt(e.target.value) || 1))}
                      className={`w-full border-none rounded-lg py-1.5 px-2 font-bold text-[10px] outline-none ${isCashRegisterOpen ? 'bg-red-50 text-red-400 cursor-not-allowed' : planCfg.tablesLocked ? 'bg-amber-50 text-amber-700 cursor-not-allowed' : 'bg-[#141414]/5 focus:ring-1 focus:ring-[#141414]'}`}
                    />
                  </div>
                  <div>
                    <label className="block text-[7.5px] font-black uppercase opacity-40 mb-1">Máx. Garçons</label>
                    <input
                      type="number" min="1" max="40"
                      value={localMaxWaiters}
                      disabled={isCashRegisterOpen}
                      onChange={(e) => !isCashRegisterOpen && setLocalMaxWaiters(Math.max(1, Math.min(40, parseInt(e.target.value) || 1)))}
                      className={`w-full border-none rounded-lg py-1.5 px-2 font-bold text-[10px] outline-none ${isCashRegisterOpen ? 'bg-red-50 text-red-400 cursor-not-allowed' : 'bg-[#141414]/5 focus:ring-1 focus:ring-[#141414]'}`}
                    />
                  </div>
                  <div>
                    <label className="block text-[7.5px] font-black uppercase opacity-40 mb-1 flex items-center gap-1">
                      Comandas {planCfg.comandasLocked && <Lock size={7} className="text-amber-500" />}
                    </label>
                    <button
                      disabled={isCashRegisterOpen || planCfg.comandasLocked}
                      onClick={() => !isCashRegisterOpen && !planCfg.comandasLocked && updatePizzeriaConfig({ ...pizzariaConfig, comandasEnabled: !(pizzariaConfig.comandasEnabled ?? true) })}
                      className={`w-full px-3 py-1.5 rounded-lg font-bold text-[8px] uppercase transition-all text-center ${
                        isCashRegisterOpen ? 'bg-red-50 text-red-400 cursor-not-allowed'
                        : planCfg.comandasLocked ? 'bg-[#141414]/10 text-[#141414]/30 cursor-not-allowed'
                        : (pizzariaConfig.comandasEnabled ?? true) ? 'bg-green-500 text-white' : 'bg-[#141414]/10 text-[#141414]/50'
                      }`}
                    >
                      {planCfg.comandasLocked ? (planCfg.comandasEnabled ? 'Ativo' : 'Inativo') : (pizzariaConfig.comandasEnabled ?? true) ? 'Ativo' : 'Inativo'}
                    </button>
                  </div>
                  {(pizzariaConfig.comandasEnabled ?? true) && (
                    <div>
                      <label className="block text-[7.5px] font-black uppercase opacity-40 mb-1">Nº Comandas</label>
                      <input
                        type="number" min="1" max="50"
                        value={localNumComandas}
                        readOnly={isCashRegisterOpen}
                        disabled={isCashRegisterOpen}
                        onChange={(e) => !isCashRegisterOpen && setLocalNumComandas(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                        className={`w-full border-none rounded-lg py-1.5 px-2 font-bold text-[10px] outline-none ${isCashRegisterOpen ? 'bg-red-50 text-red-400 cursor-not-allowed' : 'bg-[#141414]/5 focus:ring-1 focus:ring-[#141414]'}`}
                      />
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className="block text-[7.5px] font-black uppercase opacity-40 mb-1">URL da Logo</label>
                    <input
                      type="url" value={localLogoUrl}
                      onChange={(e) => setLocalLogoUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full bg-[#141414]/5 border-none rounded-lg py-1.5 px-2 font-bold text-[9px] focus:ring-1 focus:ring-[#141414] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Card: Notificações de Lançamentos (movido para o grid) */}
              <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Bell className="text-[#141414]" size={13} />
                  <h3 className="font-serif italic text-sm leading-none flex-1">Notificações</h3>
                </div>
                <p className="text-[8px] opacity-40 mb-2.5 leading-relaxed">Alertas em tempo real quando um garçom lança um item.</p>
                <div className="flex flex-col gap-1.5 mb-3">
                  {([
                    { value: 'full', label: 'Completo', desc: 'Badge + popup a cada lançamento' },
                    { value: 'badge', label: 'Só badge', desc: 'Apenas o número no ícone' },
                    { value: 'disabled', label: 'Desativado', desc: 'Sem notificações' },
                  ] as { value: NotificationMode; label: string; desc: string }[]).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleNotificationModeChange(opt.value)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                        notificationMode === opt.value
                          ? 'bg-[#141414] text-white border-[#141414]'
                          : 'bg-transparent border-[#141414]/10 hover:bg-[#141414]/5'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full border-2 shrink-0 ${notificationMode === opt.value ? 'bg-white border-white' : 'border-[#141414]/30'}`} />
                      <div>
                        <p className="text-[9px] font-bold">{opt.label}</p>
                        <p className={`text-[8px] ${notificationMode === opt.value ? 'opacity-70' : 'opacity-40'}`}>{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-[#141414]/8 pt-2.5">
                  <p className="text-[7.5px] font-black uppercase opacity-30 tracking-wider mb-1.5">Chama Garçom</p>
                  <p className="text-[8px] opacity-40 mb-2 leading-relaxed">QR Code fixo por mesa para clientes chamarem o garçom diretamente.</p>
                  <button
                    onClick={() => setCallWaiterModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 text-white text-[9px] font-bold uppercase tracking-wide hover:bg-orange-600 transition-colors"
                  >
                    <BellRing size={10} /> Configurar Chama Garçom
                  </button>
                </div>
              </div>

              {/* Card: Configuração de Caixas */}
              <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet className="text-[#141414]" size={13} />
                  <h3 className="font-serif italic text-sm leading-none flex-1">Configuração de Caixas</h3>
                  <span className="text-[7px] text-green-600 font-bold uppercase opacity-0 select-none" id="cr-saved-badge" />
                </div>
                {isCashRegisterOpen && (
                  <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1 mb-2">
                    <Lock size={9} className="text-red-500 shrink-0" />
                    <span className="text-[8px] text-red-700 font-bold">Feche o caixa para alterar</span>
                  </div>
                )}
                <p className="text-[8px] text-[#141414]/40 mb-2 leading-tight">
                  Nomeie seus caixas para controlar qual estação pode abrir cada um. Um caixa com o mesmo nome não pode ser aberto em dois lugares ao mesmo tempo.
                </p>
                <div className="space-y-1 mb-2">
                  {localCashRegisters.length === 0 && (
                    <p className="text-[8px] text-[#141414]/30 italic text-center py-1">Nenhum caixa configurado — sem restrição de acesso</p>
                  )}
                  {localCashRegisters.map(reg => (
                    <div key={reg.id} className="flex items-center gap-2 bg-[#141414]/3 rounded-lg px-2 py-1.5">
                      <Wallet size={10} className="text-[#141414]/40 shrink-0" />
                      <span className="text-[9px] font-semibold text-[#141414] flex-1">{reg.name}</span>
                      <button
                        disabled={isCashRegisterOpen}
                        onClick={() => {
                          if (isCashRegisterOpen) return;
                          const updated = localCashRegisters.filter(r => r.id !== reg.id);
                          setLocalCashRegisters(updated);
                          updatePizzeriaConfig({ ...pizzariaConfig, cashRegisters: updated });
                        }}
                        className={`p-0.5 rounded transition-colors ${isCashRegisterOpen ? 'text-[#141414]/20 cursor-not-allowed' : 'text-[#141414]/30 hover:text-red-500'}`}
                      >
                        <Trash2 size={9} />
                      </button>
                    </div>
                  ))}
                </div>
                {!isCashRegisterOpen && (
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newRegisterName}
                      onChange={e => setNewRegisterName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newRegisterName.trim()) {
                          const trimmed = newRegisterName.trim();
                          if (localCashRegisters.some(r => r.name.toLowerCase() === trimmed.toLowerCase())) {
                            toast.error('Já existe um caixa com esse nome.');
                            return;
                          }
                          const updated = [...localCashRegisters, { id: Math.random().toString(36).substr(2, 9), name: trimmed }];
                          setLocalCashRegisters(updated);
                          updatePizzeriaConfig({ ...pizzariaConfig, cashRegisters: updated });
                          setNewRegisterName('');
                          toast.success(`"${trimmed}" salvo!`);
                        }
                      }}
                      placeholder="Nome do caixa..."
                      className="flex-1 bg-[#141414]/5 border-none rounded-lg py-1.5 px-2 text-[9px] font-medium outline-none focus:ring-1 focus:ring-[#141414]"
                    />
                    <button
                      onClick={() => {
                        const trimmed = newRegisterName.trim();
                        if (!trimmed) return;
                        if (localCashRegisters.some(r => r.name.toLowerCase() === trimmed.toLowerCase())) {
                          toast.error('Já existe um caixa com esse nome.');
                          return;
                        }
                        const updated = [...localCashRegisters, { id: Math.random().toString(36).substr(2, 9), name: trimmed }];
                        setLocalCashRegisters(updated);
                        updatePizzeriaConfig({ ...pizzariaConfig, cashRegisters: updated });
                        setNewRegisterName('');
                        toast.success(`"${trimmed}" salvo!`);
                      }}
                      className="bg-[#141414] text-white px-2 py-1.5 rounded-lg text-[9px] font-bold hover:opacity-80 transition-opacity flex items-center gap-1"
                    >
                      <Plus size={9} />
                      Add
                    </button>
                  </div>
                )}
              </div>
              </div>
              )}

              {/* ── Aba: Operação ── */}
              {settingsTab === 'operation' && (
              <div className="flex justify-center mb-4">
              <div className="w-full max-w-xl">

              {/* Card: TesteDeForgo + Funcionamento unificado */}
              <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Settings className="text-[#141414]" size={13} />
                  <h3 className="font-serif italic text-sm leading-none">Funcionamento</h3>
                </div>

                {/* Modo Pizzaria */}
                <div className="rounded-xl border border-[#141414]/8 bg-[#fafafa] p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Pizza size={10} className="opacity-50" />
                      <div>
                        <p className="text-[8px] font-bold leading-none flex items-center gap-1">Modo Pizzaria {planCfg.pizzaLocked && <Lock size={7} className="text-amber-500" />}</p>
                        <p className="text-[6.5px] opacity-40 leading-tight mt-0.5">{pizzariaConfig.enabled ? 'Cardápio pizza + alertas de tempo.' : 'Modo restaurante/lanchonete.'}</p>
                      </div>
                    </div>
                    <button disabled={planCfg.pizzaLocked} onClick={() => !planCfg.pizzaLocked && updatePizzeriaConfig({ ...pizzariaConfig, enabled: !pizzariaConfig.enabled })} className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ml-2 ${planCfg.pizzaLocked ? 'bg-[#141414]/10 cursor-not-allowed' : pizzariaConfig.enabled ? 'bg-green-500' : 'bg-[#141414]/20'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${!planCfg.pizzaLocked && pizzariaConfig.enabled ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                  {pizzariaConfig.enabled && (
                    <div className="bg-white rounded-lg p-2 border border-[#141414]/8 space-y-1.5">
                      <p className="text-[7px] uppercase font-bold opacity-40 leading-none">Alertas de tempo</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {([
                          { label: '🟡 Amarelo', val: localYellow, set: setLocalYellow, cls: 'bg-yellow-50 border-yellow-200 focus:ring-yellow-400' },
                          { label: '🟠 Laranja', val: localOrange, set: setLocalOrange, cls: 'bg-orange-50 border-orange-200 focus:ring-orange-400' },
                          { label: '🔴 Vermelho', val: localRed, set: setLocalRed, cls: 'bg-red-50 border-red-200 focus:ring-red-400' },
                        ]).map(({ label, val, set, cls }) => (
                          <div key={label}>
                            <label className="text-[6px] uppercase font-bold opacity-45 mb-0.5 block leading-none">{label}</label>
                            <input type="number" min={1} value={val} onChange={(e) => set(Math.max(1, Number(e.target.value)))} className={`w-full border rounded-lg py-1 px-1.5 font-bold text-[8px] focus:ring-1 outline-none ${cls}`} />
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className="text-[6px] uppercase font-bold opacity-45 mb-0.5 block leading-none">⏰ Inatividade (min)</label>
                        <input type="number" min={1} value={localInactivity} onChange={(e) => setLocalInactivity(Math.max(1, Number(e.target.value)))} className="w-full bg-amber-50 border border-amber-200 rounded-lg py-1 px-1.5 font-bold text-[8px] focus:ring-1 focus:ring-amber-400 outline-none" />
                      </div>
                      <button onClick={() => { updatePizzeriaConfig({ ...pizzariaConfig, yellowMinutes: localYellow, orangeMinutes: localOrange, redMinutes: localRed, inactivityMinutes: localInactivity }); toast.success('Alertas salvos!'); }} className="w-full bg-[#141414] text-[#E4E3E0] py-1 rounded-lg font-bold hover:opacity-90 transition-opacity text-[7px] uppercase">
                        Salvar Alertas
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  {/* KDS */}
                  <div className="flex items-center justify-between rounded-lg border border-[#141414]/8 bg-[#fafafa] px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <Monitor size={10} className="opacity-50" />
                      <div>
                        <p className="text-[8px] font-bold leading-none flex items-center gap-1">KDS — Cozinha Digital {planCfg.kdsLocked && <Lock size={7} className="text-amber-500" />}</p>
                        <p className="text-[6.5px] opacity-40 leading-tight mt-0.5">{(pizzariaConfig.kdsEnabled ?? false) ? 'Cozinha marca "Pronto" antes da entrega.' : 'KDS desativado.'}</p>
                      </div>
                    </div>
                    <button disabled={planCfg.kdsLocked} onClick={() => !planCfg.kdsLocked && updatePizzeriaConfig({ ...pizzariaConfig, kdsEnabled: !(pizzariaConfig.kdsEnabled ?? false) })} className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ml-2 ${planCfg.kdsLocked ? 'cursor-not-allowed opacity-50' : ''} ${(pizzariaConfig.kdsEnabled ?? false) ? 'bg-green-500' : 'bg-[#141414]/20'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(pizzariaConfig.kdsEnabled ?? false) ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                  {(pizzariaConfig.kdsEnabled ?? false) && (
                    <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-lg px-2 py-1">
                      <span className="text-[6px] uppercase font-bold text-green-700 shrink-0">Link:</span>
                      <a href={`${window.location.origin}/app/kitchen`} target="_blank" rel="noopener noreferrer" className="text-[7px] text-green-700 font-mono truncate hover:underline flex-1">{`${window.location.origin}/app/kitchen`}</a>
                      <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/app/kitchen`)} className="shrink-0 text-[6px] bg-green-600 text-white rounded px-1 py-0.5 hover:bg-green-700">Copiar</button>
                    </div>
                  )}
                  {/* Garçom pode pagar */}
                  <div className="flex items-center justify-between rounded-lg border border-[#141414]/8 bg-[#fafafa] px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <Wallet size={10} className="opacity-50" />
                      <div>
                        <p className="text-[8px] font-bold leading-none">Garçom pode pagar</p>
                        <p className="text-[6.5px] opacity-40 leading-tight mt-0.5">{(pizzariaConfig.waiterCanPay ?? true) ? 'Botão "Pagar" visível no app.' : 'Somente pelo caixa.'}</p>
                      </div>
                    </div>
                    <button onClick={() => updatePizzeriaConfig({ ...pizzariaConfig, waiterCanPay: !(pizzariaConfig.waiterCanPay ?? true) })} className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ml-2 ${(pizzariaConfig.waiterCanPay ?? true) ? 'bg-green-500' : 'bg-[#141414]/20'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(pizzariaConfig.waiterCanPay ?? true) ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                  {/* Garçom pode cancelar item */}
                  <div className="flex items-center justify-between rounded-lg border border-[#141414]/8 bg-[#fafafa] px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <X size={10} className="opacity-50" />
                      <div>
                        <p className="text-[8px] font-bold leading-none">Garçom pode cancelar item</p>
                        <p className="text-[6.5px] opacity-40 leading-tight mt-0.5">{(pizzariaConfig.waiterCanCancelItem ?? false) ? 'Pode remover itens do pedido.' : 'Somente o caixa cancela.'}</p>
                      </div>
                    </div>
                    <button onClick={() => updatePizzeriaConfig({ ...pizzariaConfig, waiterCanCancelItem: !(pizzariaConfig.waiterCanCancelItem ?? false) })} className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ml-2 ${(pizzariaConfig.waiterCanCancelItem ?? false) ? 'bg-green-500' : 'bg-[#141414]/20'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(pizzariaConfig.waiterCanCancelItem ?? false) ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* TesteDeForgo inline */}
                <div className="border-t border-[#141414]/8 pt-2">
                  <TesteDeForgo tenantId={tenantId} />
                </div>
              </div>

              </div>
              </div>
              )}

              {/* ── Aba: Impressão ── */}
              {settingsTab === 'print' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-4">

                {/* ── Coluna 1: Impressão ─────────────────────────────────────── */}
                <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col gap-4">

                  {/* ── Cabeçalho ── */}
                  <div className="flex items-center gap-2">
                    <Printer className="text-[#141414]" size={13} />
                    <h3 className="font-serif italic text-sm leading-none flex-1">Impressoras</h3>
                    <span className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full ${printerAgentOnline ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${printerAgentOnline ? 'bg-green-500 animate-pulse' : 'bg-red-300'}`} />
                      {printerAgentOnline ? 'Agente conectado' : 'Agente offline'}
                    </span>
                  </div>

                  {/* ── Passo 1: Agente ── */}
                  <div className="rounded-xl border border-[#141414]/8 p-2.5 bg-[#fafafa] space-y-1.5">
                    <p className="text-[7.5px] font-black uppercase tracking-wider opacity-40">① Agente de impressão</p>
                    {!printerAgentOnline ? (
                      <div className="space-y-1.5">
                        {pendingAgentSocketId ? (
                          <>
                            <p className="text-[8px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 leading-relaxed">
                              Agente detectado aguardando pareamento. Clique abaixo para vincular ao seu estabelecimento.
                            </p>
                            <button
                              onClick={() => {
                                socket.emit('claim_printer_agent', { agentSocketId: pendingAgentSocketId });
                                setPendingAgentSocketId(null);
                              }}
                              className="w-full flex items-center justify-center gap-1.5 text-[8px] font-bold py-1.5 px-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                            >
                              🖨️ Parear Agente
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="text-[8px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-relaxed">
                              Agente offline. Verifique se o agente está rodando no PC e clique em Reconectar.
                            </p>
                            <button
                              onClick={() => { socket.disconnect(); socket.connect(); }}
                              className="w-full flex items-center justify-center gap-1.5 text-[8px] font-bold py-1.5 px-3 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                            >
                              <span className="w-2.5 h-2.5 border border-white border-t-transparent rounded-full" style={{animation:'spin 1s linear infinite'}} />
                              Reconectar
                            </button>
                          </>
                        )}
                      </div>
                    ) : scanRunning ? (
                      <p className="text-[8px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 leading-relaxed flex items-center gap-1.5">
                        <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                        Buscando impressoras na rede e no Windows...
                      </p>
                    ) : scanPrinters.length > 0 ? (
                      <p className="text-[8px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 leading-relaxed">
                        {scanPrinters.length} impressora(s) encontrada(s). Clique em "Adicionar" para cadastrar.
                      </p>
                    ) : (
                      <p className="text-[8px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 leading-relaxed">
                        Agente conectado. Buscando impressoras automaticamente...
                      </p>
                    )}
                    <a href="/download/fechaconta-agente.exe" download
                      className="flex items-center justify-center gap-1.5 text-[8px] font-bold py-1.5 px-3 rounded-lg bg-[#141414] text-[#E4E3E0] hover:opacity-80 transition-opacity w-full">
                      <Download size={9} /> Baixar Agente (.exe) para Windows
                    </a>
                    <a href={`/api/agent-config?tenant=${tenantId || ''}`} download="config.json"
                      className="flex items-center justify-center gap-1.5 text-[8px] font-bold py-1.5 px-3 rounded-lg bg-blue-700 text-white hover:opacity-80 transition-opacity w-full">
                      <Download size={9} /> Baixar config.json do Agente
                    </a>
                    <p className="text-[7px] text-[#141414]/50 leading-tight">
                      Coloque o <strong>config.json</strong> na mesma pasta do exe antes de iniciar o agente.
                    </p>
                    {printerAgentOnline && (
                      <button
                        onClick={() => { setScanPrinters([]); setScanRunning(true); socket.emit('scan_printers_request'); }}
                        className="w-full flex items-center justify-center gap-1.5 text-[8px] font-bold py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        <Search size={9} /> {scanPrinters.length > 0 ? 'Buscar novamente' : 'Buscar impressoras disponíveis'}
                      </button>
                    )}
                    {/* ── Impressoras descobertas (inline) ── */}
                    {scanPrinters.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-[#141414]/8">
                        <p className="text-[7px] font-black uppercase tracking-wider opacity-40">Impressoras descobertas</p>
                        {scanPrinters.map((p, i) => {
                          const extractedIp = p.portName?.match(/(\d{1,3}(?:\.\d{1,3}){3})/)?.[1] || '';
                          const displayName = p.localName || p.ip || '';
                          const displaySub = p.localName
                            ? (extractedIp ? `${extractedIp} · ${p.status || 'Pronta'}` : `${p.portName || '—'} · ${p.status || 'Pronta'}`)
                            : `${p.ip} · Porta ${p.port}`;
                          const alreadyAdded = (printerConfig.registeredPrinters || []).some((r: any) =>
                            r.name === displayName || (p.ip && r.ip === p.ip)
                          );
                          return (
                            <div key={i} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 border transition-all ${alreadyAdded ? 'bg-green-50 border-green-200' : 'bg-white border-[#141414]/8'}`}>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-[8px] leading-tight truncate">{displayName}</p>
                                <p className="text-[7px] opacity-40 truncate">{displaySub}</p>
                              </div>
                              {alreadyAdded ? (
                                <span className="shrink-0 text-[7px] font-bold text-green-600 flex items-center gap-0.5">
                                  <CheckCircle size={9} /> OK
                                </span>
                              ) : (
                                <button
                                  onClick={() => {
                                    const ip = p.ip || extractedIp;
                                    const entry = { name: displayName, ip, port: p.port || 9100, localName: p.localName, portName: p.portName };
                                    (setPrinterConfig as any)((prev: any) => {
                                      const updated = { ...prev, registeredPrinters: [...(prev.registeredPrinters || []), entry] };
                                      localStorage.setItem('printerConfig', JSON.stringify(updated));
                                      return updated;
                                    });
                                    setScanAssigning(entry);
                                    setScanModalOpen(true);
                                  }}
                                  className="shrink-0 text-[7px] font-bold bg-[#141414] text-white px-2 py-1 rounded-md hover:opacity-80 transition-opacity"
                                >
                                  Adicionar
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Passo 2: Impressoras cadastradas ── */}
                  <div className="space-y-2">
                    <p className="text-[7.5px] font-black uppercase tracking-wider opacity-40">② Impressoras cadastradas</p>
                    {(printerConfig.registeredPrinters || []).length === 0 ? (
                      <p className="text-[8px] opacity-40 text-center py-2">Nenhuma impressora cadastrada. Use "Buscar" ou adicione manualmente.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                        {(printerConfig.registeredPrinters || []).map((p: any, idx: number) => (
                          <div key={idx} className="rounded-lg border border-[#141414]/8 bg-[#fafafa] p-2 space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 min-w-0">
                                <label className="text-[6.5px] uppercase font-bold opacity-35 leading-none block mb-0.5">Nome / Apelido</label>
                                <input
                                  type="text"
                                  value={p.name}
                                  onChange={(e) => { const name = e.target.value; (setPrinterConfig as any)((prev: any) => { const u = [...prev.registeredPrinters]; u[idx] = { ...u[idx], name }; return { ...prev, registeredPrinters: u }; }); }}
                                  placeholder="ex: Cozinha, Bar, Caixa..."
                                  className="w-full bg-white border border-[#141414]/10 rounded-md py-0.5 px-1.5 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none"
                                />
                              </div>
                              <button onClick={() => handleTestPrinter(p.name)}
                                className="shrink-0 text-[7px] bg-[#141414] text-white px-2 py-1 rounded-md font-bold uppercase hover:opacity-80">Testar</button>
                              <button onClick={() => (setPrinterConfig as any)((prev: any) => ({ ...prev, registeredPrinters: prev.registeredPrinters.filter((_: any, i: number) => i !== idx) }))}
                                className="shrink-0 text-red-400 hover:text-red-600 transition-colors"><Trash2 size={11} /></button>
                            </div>
                            <div className="flex gap-1.5">
                              <div className="flex-1 min-w-0">
                                <label className="text-[6.5px] uppercase font-bold opacity-35 leading-none block mb-0.5">IP da Impressora</label>
                                <input
                                  type="text"
                                  value={p.ip || ''}
                                  onChange={(e) => { const ip = e.target.value; (setPrinterConfig as any)((prev: any) => { const u = [...prev.registeredPrinters]; u[idx] = { ...u[idx], ip }; return { ...prev, registeredPrinters: u }; }); }}
                                  placeholder="192.168.1.10  (deixe vazio se USB)"
                                  className="w-full bg-white border border-[#141414]/10 rounded-md py-0.5 px-1.5 font-mono font-bold text-[8px] focus:ring-1 focus:ring-[#141414] outline-none"
                                />
                              </div>
                              <div className="w-14 shrink-0">
                                <label className="text-[6.5px] uppercase font-bold opacity-35 leading-none block mb-0.5">Porta</label>
                                <input
                                  type="text"
                                  value={p.port || '9100'}
                                  onChange={(e) => { const port = Number(e.target.value) || 9100; (setPrinterConfig as any)((prev: any) => { const u = [...prev.registeredPrinters]; u[idx] = { ...u[idx], port }; return { ...prev, registeredPrinters: u }; }); }}
                                  placeholder="9100"
                                  className="w-full bg-white border border-[#141414]/10 rounded-md py-0.5 px-1.5 font-mono font-bold text-[8px] focus:ring-1 focus:ring-[#141414] outline-none"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => (setPrinterConfig as any)((prev: any) => ({ ...prev, registeredPrinters: [...(prev.registeredPrinters || []), { name: '', ip: '', port: 9100 }] }))}
                      className="w-full border border-dashed border-[#141414]/20 text-[#141414]/40 py-1.5 rounded-lg text-[7.5px] font-bold uppercase hover:border-[#141414]/40 hover:text-[#141414]/60 transition-colors"
                    >
                      + Adicionar manualmente
                    </button>
                  </div>

                  {/* ── Passo 3: Roteamento ── */}
                  <div className="space-y-2">
                    <div>
                      <p className="text-[7.5px] font-black uppercase tracking-wider opacity-40">③ Para onde imprimir?</p>
                      <p className="text-[7px] opacity-35 mt-0.5">Defina qual impressora recebe cada tipo de pedido. "Auto" envia automaticamente ao lançar o item.</p>
                    </div>
                    <div className="space-y-1.5">
                      {([
                        { key: 'pizzas',   autoKey: 'autoPrintPizzas',   pwKey: 'pizzasPaperWidth', label: pizzariaConfig.enabled ? 'Pratos / Pizzas' : 'Pratos', icon: <Pizza size={10} /> },
                        { key: 'drinks',   autoKey: 'autoPrintDrinks',   pwKey: 'drinksPaperWidth',  label: 'Bebidas',  icon: <Beer size={10} /> },
                        { key: 'kitchen',  autoKey: 'autoPrintKitchen',  pwKey: 'kitchenPaperWidth', label: 'Lanches',  icon: <ChefHat size={10} /> },
                        { key: 'receipts', autoKey: 'autoPrintReceipts', pwKey: null,                label: 'Recibos',  icon: <FileText size={10} /> },
                      ] as const).map(({ key, autoKey, pwKey, label, icon }) => (
                        <div key={key} className="rounded-lg border border-[#141414]/8 bg-[#fafafa] px-2.5 py-2">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="opacity-50">{icon}</span>
                            <span className="text-[8.5px] font-black opacity-70 flex-1">{label}</span>
                            <button
                              onClick={() => (setPrinterConfig as any)((prev: any) => ({ ...prev, [autoKey]: !(prev as any)[autoKey] }))}
                              title="Impressão automática ao lançar"
                              className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[7px] font-bold transition-all ${(printerConfig as any)[autoKey] ? 'bg-green-500 text-white' : 'bg-[#141414]/8 text-[#141414]/40'}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${(printerConfig as any)[autoKey] ? 'bg-white' : 'bg-[#141414]/30'}`} />
                              Auto
                            </button>
                          </div>
                          <div className="flex gap-1.5">
                            <select
                              value={(printerConfig as any)[key] || 'none'}
                              onChange={(e) => { const v = e.target.value; (setPrinterConfig as any)((prev: any) => ({ ...prev, [key]: v })); }}
                              className="flex-1 bg-white border border-[#141414]/10 rounded-md py-1 px-1.5 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none appearance-none cursor-pointer"
                            >
                              <option value="none">— Sem impressora —</option>
                              {(printerConfig.registeredPrinters || []).filter((p: any) => p.name).map((p: any, i: number) => (
                                <option key={i} value={p.name}>{p.name}</option>
                              ))}
                            </select>
                            {pwKey && (
                              <div className="flex bg-[#141414]/5 rounded-md overflow-hidden border border-[#141414]/10">
                                {(['80mm', '48mm'] as const).map(pw => (
                                  <button
                                    key={pw}
                                    onClick={() => (setPrinterConfig as any)((prev: any) => ({ ...prev, [pwKey]: pw }))}
                                    className={`px-1.5 py-1 text-[7px] font-bold transition-all ${((printerConfig as any)[pwKey] || '80mm') === pw ? 'bg-white shadow-sm text-[#141414]' : 'opacity-35'}`}
                                  >{pw}</button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button onClick={handleSavePrinters}
                    className="w-full bg-[#141414] text-[#E4E3E0] py-2 rounded-xl font-bold hover:opacity-90 transition-opacity text-[9px] uppercase tracking-wide">
                    Salvar configurações
                  </button>
                </div>

                {/* ── Coluna 2: Comprovante + QR Code ────────────────────────── */}
                <div className="flex flex-col gap-2.5">
                <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm flex flex-col gap-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <FileText className="text-[#141414]" size={12} />
                    <h3 className="font-serif italic text-sm leading-none">Comprovante</h3>
                  </div>

                  {/* Identificação */}
                  <div>
                    <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Nome do Estabelecimento</label>
                    <input type="text" value={printerConfig.establishmentName} onChange={(e) => setPrinterConfig({...printerConfig, establishmentName: e.target.value})} className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">CNPJ / CPF</label>
                      <input type="text" value={printerConfig.cnpj || ''} onChange={(e) => setPrinterConfig({...printerConfig, cnpj: e.target.value})} placeholder="00.000.000/0001-00" className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none" />
                    </div>
                    <div>
                      <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Título do Cupom</label>
                      <input type="text" value={printerConfig.receiptTitle || ''} onChange={(e) => setPrinterConfig({...printerConfig, receiptTitle: e.target.value})} placeholder="COMPROVANTE" className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Endereço</label>
                      <input type="text" value={printerConfig.address} onChange={(e) => setPrinterConfig({...printerConfig, address: e.target.value})} className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none" />
                    </div>
                    <div>
                      <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Telefone</label>
                      <input type="text" value={printerConfig.phone} onChange={(e) => setPrinterConfig({...printerConfig, phone: e.target.value})} className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Cabeçalho (2ª linha)</label>
                      <input type="text" value={printerConfig.receiptHeader || ''} onChange={(e) => setPrinterConfig({...printerConfig, receiptHeader: e.target.value})} placeholder="Slogan ou info extra" className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none" />
                    </div>
                    <div>
                      <label className="text-[7px] uppercase font-bold opacity-45 mb-0.5 block leading-none">Mensagem de Rodapé</label>
                      <input type="text" value={printerConfig.receiptFooter} onChange={(e) => setPrinterConfig({...printerConfig, receiptFooter: e.target.value})} className="w-full bg-[#141414]/5 border-none rounded-lg py-1 px-2 font-bold text-[8.5px] focus:ring-1 focus:ring-[#141414] outline-none" />
                    </div>
                  </div>

                  {/* Layout */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[7px] uppercase font-bold opacity-45 leading-none">Papel</span>
                      <div className="flex bg-[#141414]/5 p-0.5 rounded-lg">
                        {['50mm', '80mm'].map((pw) => (
                          <button key={pw} onClick={() => setPrinterConfig({...printerConfig, paperWidth: pw})} className={`px-2 py-0.5 text-[7px] font-bold rounded transition-all ${(printerConfig.paperWidth || '80mm') === pw ? 'bg-white shadow-sm' : 'opacity-40'}`}>{pw}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[7px] uppercase font-bold opacity-45 leading-none">Fonte</span>
                      <div className="flex bg-[#141414]/5 p-0.5 rounded-lg">
                        {['10px', '12px', '14px', '16px'].map((size) => (
                          <button key={size} onClick={() => setPrinterConfig({...printerConfig, itemFontSize: size})} className={`px-2 py-0.5 text-[7px] font-bold rounded transition-all ${printerConfig.itemFontSize === size ? 'bg-white shadow-sm' : 'opacity-40'}`}>
                            {size === '10px' ? 'P' : size === '12px' ? 'M' : size === '14px' ? 'G' : 'XG'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[7px] uppercase font-bold opacity-45 leading-none">Negrito</span>
                      <div className="flex bg-[#141414]/5 p-0.5 rounded-lg">
                        <button onClick={() => setPrinterConfig({...printerConfig, boldItems: !printerConfig.boldItems})} className={`px-2 py-0.5 text-[7px] font-bold rounded transition-all ${printerConfig.boldItems ? 'bg-white shadow-sm' : 'opacity-40'}`} style={{ fontWeight: 900 }}>N</button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[7px] uppercase font-bold opacity-45 leading-none">Vias</span>
                      <div className="flex bg-[#141414]/5 p-0.5 rounded-lg">
                        {[1, 2].map((n) => (
                          <button key={n} onClick={() => setPrinterConfig({...printerConfig, printCopies: n})} className={`px-2 py-0.5 text-[7px] font-bold rounded transition-all ${(printerConfig.printCopies || 1) === n ? 'bg-white shadow-sm' : 'opacity-40'}`}>{n}x</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Opções de exibição */}
                  <div>
                    <span className="text-[7px] uppercase font-bold opacity-45 leading-none block mb-1">Exibir no Cupom</span>
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setPrinterConfig({...printerConfig, showWaiter: !printerConfig.showWaiter})} className={`flex flex-col items-center p-1.5 rounded-lg border transition-all gap-0.5 ${printerConfig.showWaiter ? 'border-[#141414] bg-[#141414]/5' : 'border-[#141414]/10 opacity-40'}`}>
                        <Users size={9} />
                        <span className="text-[5.5px] opacity-60 leading-none">Garçom</span>
                      </button>
                      <button onClick={() => setPrinterConfig({...printerConfig, showDateTime: printerConfig.showDateTime === false ? true : false})} className={`flex flex-col items-center p-1.5 rounded-lg border transition-all gap-0.5 ${printerConfig.showDateTime !== false ? 'border-[#141414] bg-[#141414]/5' : 'border-[#141414]/10 opacity-40'}`}>
                        <Clock size={9} />
                        <span className="text-[5.5px] opacity-60 leading-none">Data/Hora</span>
                      </button>
                      <button onClick={() => setPrinterConfig({...printerConfig, showPaymentMethods: printerConfig.showPaymentMethods === false ? true : false})} className={`flex flex-col items-center p-1.5 rounded-lg border transition-all gap-0.5 ${printerConfig.showPaymentMethods !== false ? 'border-[#141414] bg-[#141414]/5' : 'border-[#141414]/10 opacity-40'}`}>
                        <CreditCard size={9} />
                        <span className="text-[5.5px] opacity-60 leading-none">Pagamento</span>
                      </button>
                      <button onClick={() => setPrinterConfig({...printerConfig, showItemObs: printerConfig.showItemObs === false ? true : false})} className={`flex flex-col items-center p-1.5 rounded-lg border transition-all gap-0.5 ${printerConfig.showItemObs !== false ? 'border-[#141414] bg-[#141414]/5' : 'border-[#141414]/10 opacity-40'}`}>
                        <MessageSquare size={9} />
                        <span className="text-[5.5px] opacity-60 leading-none">Obs. Item</span>
                      </button>
                      <button onClick={() => setPrinterConfig({...printerConfig, showRemovedItems: printerConfig.showRemovedItems === false ? true : false})} className={`flex flex-col items-center p-1.5 rounded-lg border transition-all gap-0.5 ${printerConfig.showRemovedItems !== false ? 'border-[#141414] bg-[#141414]/5' : 'border-[#141414]/10 opacity-40'}`}>
                        <Trash2 size={9} />
                        <span className="text-[5.5px] opacity-60 leading-none">Removidos</span>
                      </button>
                    </div>
                  </div>

                  {/* Preview cupom */}
                  <div className="bg-gray-50 p-2 rounded-lg border border-dashed border-[#141414]/10 flex justify-center mt-1">
                    <div className="bg-white w-full max-w-[155px] shadow-sm p-2.5 text-[#141414] font-mono text-[7px] space-y-2 leading-tight overflow-hidden select-none">
                      <div className="text-center space-y-0.5">
                        <p className="font-bold text-[8.5px] uppercase truncate">{printerConfig.establishmentName}</p>
                        {printerConfig.receiptHeader && <p className="opacity-60 text-[5.5px] truncate italic">{printerConfig.receiptHeader}</p>}
                        <p className="opacity-70 text-[5.5px] truncate">{printerConfig.address}</p>
                        {printerConfig.cnpj && <p className="opacity-50 text-[5px]">CNPJ: {printerConfig.cnpj}</p>}
                        <p className="font-bold text-[6.5px] uppercase tracking-wider border-t border-dashed border-[#141414]/20 pt-1 mt-1">{printerConfig.receiptTitle || 'COMPROVANTE'}</p>
                      </div>
                      <div className="border-t border-dashed border-[#141414]/20 pt-1 space-y-0.5">
                        <div className="flex justify-between"><span>Mesa: 12</span><span>#1024</span></div>
                        {printerConfig.showWaiter && <div>Garçom: Ricardo</div>}
                        {printerConfig.showDateTime !== false && <div className="opacity-60">14/06/2026 20:30</div>}
                      </div>
                      <div className="border-t border-b border-dashed border-[#141414]/20 py-1 space-y-1">
                        <div className="flex justify-between items-start gap-2" style={{ fontSize: printerConfig.itemFontSize, fontWeight: printerConfig.boldItems ? 'bold' : 'normal' }}>
                          <span className="flex-1 leading-tight text-left">1x Porção de Tilápia</span>
                          <span className="shrink-0">R$ 32</span>
                        </div>
                        {printerConfig.showItemObs !== false && <div className="opacity-50 text-[5px] pl-2">Obs: sem pimenta</div>}
                        <div className="flex justify-between items-start gap-2" style={{ fontSize: printerConfig.itemFontSize, fontWeight: printerConfig.boldItems ? 'bold' : 'normal' }}>
                          <span className="flex-1 leading-tight text-left">2x Coca-cola Lata</span>
                          <span className="shrink-0">R$ 12</span>
                        </div>
                        {printerConfig.showRemovedItems !== false && <div className="opacity-40 text-[5px] line-through pl-2">1x Fritas</div>}
                      </div>
                      <div className="flex justify-between font-bold pt-1"><span>TOTAL:</span><span>R$ 44,00</span></div>
                      {printerConfig.showPaymentMethods !== false && <div className="flex justify-between text-[5.5px] opacity-70"><span>PIX</span><span>R$ 44,00</span></div>}
                      <div className="pt-1 text-center opacity-70 italic text-[5.5px] truncate">{printerConfig.receiptFooter}</div>
                    </div>
                  </div>
                </div>

                  {/* QR Code do Cliente por Mesa */}
                  <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <Smartphone className="text-[#141414]" size={12} />
                      <h3 className="font-serif italic text-sm leading-none">QR Code das Mesas</h3>
                    </div>
                    <p className="text-[8px] opacity-40 mb-3">Imprima e cole na mesa. O cliente acessa o menu ao escanear.</p>

                    {/* Timeout de inatividade */}
                    <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#141414]/8">
                      <div>
                        <p className="text-[8px] font-bold leading-none">Expirar sessão por inatividade</p>
                        <p className="text-[6px] opacity-40 mt-0.5">
                          {((pizzariaConfig as any).clientSessionTimeoutMin ?? 0) > 0
                            ? `Expira após ${(pizzariaConfig as any).clientSessionTimeoutMin} min sem pedido`
                            : 'Sessão expira somente ao dar baixa na mesa'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <input
                          type="number"
                          min={0}
                          max={240}
                          value={(pizzariaConfig as any).clientSessionTimeoutMin ?? 0}
                          onChange={e => updatePizzeriaConfig({ ...pizzariaConfig, clientSessionTimeoutMin: Number(e.target.value) })}
                          className="w-12 text-center text-[9px] font-bold border border-[#141414]/20 rounded-md px-1 py-1"
                        />
                        <span className="text-[8px] opacity-40">min</span>
                      </div>
                    </div>

                    {/* Seletor de mesa */}
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="text-[7px] font-black uppercase opacity-40 tracking-wider block mb-1">Número da mesa</label>
                        <select
                          value={qrMesaSelected}
                          onChange={e => setQrMesaSelected(Number(e.target.value))}
                          className="w-full bg-[#141414]/5 border-none rounded-lg py-1.5 px-2 font-bold text-[10px] focus:ring-1 focus:ring-[#141414] outline-none"
                        >
                          {Array.from({ length: pizzariaConfig.numTables ?? 10 }, (_, i) => i + 1).map(n => (
                            <option key={n} value={n}>Mesa {n}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={() => setQrMesaModal({ num: qrMesaSelected })}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#141414] text-[#E4E3E0] rounded-lg text-[9px] font-bold uppercase hover:opacity-80 transition-opacity shrink-0"
                      >
                        <QrCode size={10} /> Gerar QR Code
                      </button>
                    </div>
                  </div>
                </div>{/* fim col2 flex */}

              </div>
              )}

              {/* ── Aba: Dados ── */}
              {settingsTab === 'data' && (
              <div className="flex justify-center mb-4">
              <div className="w-full max-w-xl">

                  {/* Dados */}
                  <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <Database className="text-[#141414]" size={12} />
                      <h3 className="font-serif italic text-sm leading-none">Dados</h3>
                    </div>

                    <AnimatePresence>
                      {pendingImport && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-2">
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 space-y-1.5">
                            <p className="text-[8px] font-bold uppercase text-orange-700 leading-none">Confirmar importação {pendingImport.version ? `v${pendingImport.version}` : ''}</p>
                            <p className="text-[7px] text-orange-600 leading-tight truncate">{pendingImport.fileName}</p>
                            <div className="flex flex-wrap gap-1 text-[6px]">
                              {pendingImport.menu.length > 0 && <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">{pendingImport.menu.length} categorias</span>}
                              {pendingImport.stock.length > 0 && <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">{pendingImport.stock.length} insumos</span>}
                              {pendingImport.pizzaFlavors.length > 0 && <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">{pendingImport.pizzaFlavors.length} sabores</span>}
                              {pendingImport.pizzaCrusts.length > 0 && <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">{pendingImport.pizzaCrusts.length} bordas</span>}
                              {pendingImport.pizzariaConfig && <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">config geral</span>}
                              {pendingImport.printerConfig && <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">impressora</span>}
                              {pendingImport.finEmployees.length > 0 && <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">{pendingImport.finEmployees.length} colaboradores</span>}
                              {pendingImport.finPayments.length > 0 && <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">{pendingImport.finPayments.length} pagamentos</span>}
                              {pendingImport.finExpenses.length > 0 && <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">{pendingImport.finExpenses.length} despesas</span>}
                            </div>
                            <p className="text-[6.5px] text-orange-500 leading-tight">Cardápio, insumos, configurações e dados financeiros serão substituídos.</p>
                            <div className="flex gap-1">
                              <button disabled={importingFin} onClick={async () => {
                                socket.emit('bulk_import', { menu: pendingImport.menu, stock: pendingImport.stock, stockLog: pendingImport.stockLog, pizzaFlavors: pendingImport.pizzaFlavors, pizzaCrusts: pendingImport.pizzaCrusts, pizzariaConfig: pendingImport.pizzariaConfig });
                                if (pendingImport.printerConfig) { try { localStorage.setItem('printerConfig', JSON.stringify(pendingImport.printerConfig)); } catch {} }
                                socket.once('import_complete', (result: any) => { toast.success('Importação concluída!', { description: `${result.menuCategories} categorias · ${result.stockItems} insumos · ${result.flavors} sabores restaurados.` }); });
                                if (tenantId && (pendingImport.finEmployees.length > 0 || pendingImport.finPayments.length > 0 || pendingImport.finExpenses.length > 0)) {
                                  setImportingFin(true);
                                  try {
                                    const stamp = (rows: any[]) => rows.map(r => ({ ...r, tenant_id: tenantId }));
                                    if (pendingImport.finEmployees.length > 0) await supabase.from('fin_employees').upsert(stamp(pendingImport.finEmployees), { onConflict: 'id' });
                                    if (pendingImport.finPayments.length > 0) await supabase.from('fin_payments').upsert(stamp(pendingImport.finPayments), { onConflict: 'id' });
                                    if (pendingImport.finExpenses.length > 0) await supabase.from('fin_expenses').upsert(stamp(pendingImport.finExpenses), { onConflict: 'id' });
                                    toast.success('Dados financeiros restaurados!', { description: `${pendingImport.finEmployees.length} colaboradores · ${pendingImport.finPayments.length} pagamentos · ${pendingImport.finExpenses.length} despesas` });
                                  } catch { toast.error('Erro ao restaurar dados financeiros.'); }
                                  setImportingFin(false);
                                }
                                setPendingImport(null);
                              }} className="flex-1 py-1 bg-orange-600 text-white rounded text-[7px] font-bold uppercase hover:bg-orange-700 transition-colors disabled:opacity-50">{importingFin ? 'Restaurando...' : 'Confirmar'}</button>
                              <button onClick={() => setPendingImport(null)} className="flex-1 py-1 bg-white border border-orange-200 text-orange-600 rounded text-[7px] font-bold uppercase hover:bg-orange-50 transition-colors">Cancelar</button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { try { const parsed = JSON.parse(ev.target?.result as string); if (!parsed.menu && !parsed.stock) { toast.error('Arquivo inválido.', { description: 'O arquivo não contém dados de cardápio ou estoque.' }); return; } setPendingImport({ menu: parsed.menu ?? [], stock: parsed.stock ?? [], stockLog: parsed.stockLog ?? [], pizzaFlavors: parsed.pizzaFlavors ?? [], pizzaCrusts: parsed.pizzaCrusts ?? [], pizzariaConfig: parsed.pizzariaConfig ?? null, printerConfig: parsed.printerConfig ?? null, finEmployees: parsed.finEmployees ?? [], finPayments: parsed.finPayments ?? [], finExpenses: parsed.finExpenses ?? [], fileName: file.name, version: parsed.version }); } catch { toast.error('Erro ao ler o arquivo.', { description: 'Verifique se é um JSON válido exportado pelo sistema.' }); } }; reader.readAsText(file); e.target.value = ''; }} />

                    <div className="grid grid-cols-3 gap-1.5">
                      <button title="Gera um arquivo .json com todo o conteúdo do sistema: cardápio, insumos, pedidos, garçons e dados financeiros. Use para fazer backup manual ou transferir dados para outro dispositivo." onClick={async () => { try { let finEmployees: any[] = []; let finPayments: any[] = []; let finExpenses: any[] = []; if (tenantId) { const [eR, pR, xR] = await Promise.all([ supabase.from('fin_employees').select('*').eq('tenant_id', tenantId).order('name'), supabase.from('fin_payments').select('*').eq('tenant_id', tenantId).order('paid_at', { ascending: false }), supabase.from('fin_expenses').select('*').eq('tenant_id', tenantId).order('due_date'), ]); finEmployees = eR.data || []; finPayments = pR.data || []; finExpenses = xR.data || []; } const data = { version: '2.0', exportedAt: new Date().toISOString(), menu, pizzaFlavors, pizzaCrusts, stock, stockLog, printerConfig, pizzariaConfig, orders, waiters, finEmployees, finPayments, finExpenses }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `fechaconta_backup_${new Date().toISOString().split('T')[0]}.json`; a.click(); URL.revokeObjectURL(url); const totalItems = menu.reduce((acc: number, cat: any) => acc + (cat.items?.length ?? 0) + (cat.subcategories || []).reduce((s: number, sub: any) => s + (sub.items?.length ?? 0), 0), 0); toast.success('Backup completo exportado!', { description: `${menu.length} categorias · ${totalItems} produtos · ${orders.length} pedidos · ${waiters.length} garçons · ${finEmployees.length} colaboradores` }); } catch { toast.error('Erro ao exportar dados.'); } }} className="flex items-center justify-center space-x-1 py-1.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors">
                        <Download size={10} /><span className="text-[7px] font-bold uppercase">Exportar</span>
                      </button>
                      <button title="Carrega um arquivo .json exportado anteriormente pelo sistema. Restaura cardápio, insumos, configurações e dados financeiros. Atenção: substitui os dados atuais." onClick={() => importFileRef.current?.click()} className="flex items-center justify-center space-x-1 py-1.5 bg-orange-50 text-orange-700 rounded-lg border border-orange-100 hover:bg-orange-100 transition-colors">
                        <RefreshCcw size={10} /><span className="text-[7px] font-bold uppercase">Importar</span>
                      </button>
                      <button title="Substitui o cardápio atual pelo modelo padrão do sistema (categorias e produtos de exemplo). Use apenas para restaurar um cardápio zerado ou em testes — todas as categorias e produtos personalizados serão sobrescritos." onClick={handleSeedMenu} className="flex items-center justify-center space-x-1 py-1.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-100 hover:bg-blue-100 transition-all active:scale-95">
                        <RefreshCcw size={10} /><span className="text-[7px] font-bold uppercase">Atualizar Cardápio</span>
                      </button>
                      <button title="Libera mesas e comandas que ficaram travadas (status ocupado sem pedido ativo). Use quando uma mesa aparecer como ocupada incorretamente." onClick={handleFixTables} className="flex items-center justify-center space-x-1 py-1.5 bg-yellow-50 text-yellow-700 rounded-lg border border-yellow-100 hover:bg-yellow-100 transition-all active:scale-95">
                        <RefreshCcw size={10} /><span className="text-[7px] font-bold uppercase">Corrigir Mesas</span>
                      </button>
                      <button title="Preenche o banco de dados com os dados iniciais do sistema (mesas, cardápio padrão, configurações). Use apenas na configuração inicial ou para resetar o ambiente de testes." onClick={handleSeedDatabase} className="flex items-center justify-center space-x-1 py-1.5 bg-red-50 text-red-700 rounded-lg border border-red-100 hover:bg-red-100 transition-all active:scale-95">
                        <Database size={10} /><span className="text-[7px] font-bold uppercase">Seed DB</span>
                      </button>
                    </div>
                  </div>

                </div>
              </div>
              )}

              {settingsTab === 'fiscal' && (() => {
                // Auto-load fiscal config when tab opens
                if (fiscalConfig === null && !fiscalConfigLoading && tenantId) {
                  setFiscalConfigLoading(true);
                  fetch(`/api/fiscal/config/${tenantId}`)
                    .then(r => r.json())
                    .then(d => setFiscalConfig(d.config || {}))
                    .catch(() => setFiscalConfig({}))
                    .finally(() => setFiscalConfigLoading(false));
                }
                return null;
              })()}
              {settingsTab === 'fiscal' && (
              <div className="flex justify-center mb-4">
              <div className="w-full max-w-xl">
                <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="text-[#141414]" size={12} />
                    <h3 className="font-serif italic text-sm leading-none">Configuração Fiscal (NFC-e)</h3>
                  </div>
                  {fiscalConfigLoading ? (
                    <div className="text-center py-8 opacity-40 text-xs">Carregando configuração...</div>
                  ) : null}
                  {(() => {
                    const cfg = fiscalConfig || {};
                    const upd = (key: string, val: string) => setFiscalConfig((prev: any) => ({ ...(prev || {}), [key]: val }));
                    const field = (label: string, key: string, placeholder?: string, type = 'text', hint?: string) => (
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[7px] font-bold uppercase text-[#141414]/50">{label}{hint && <span className="normal-case font-normal ml-1 text-[#141414]/30">({hint})</span>}</label>
                        <input type={type} value={cfg[key] || ''} onChange={e => upd(key, e.target.value)} placeholder={placeholder}
                          className="border border-[#141414]/15 rounded px-2 py-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#141414]/30" />
                      </div>
                    );
                    const isHom = (cfg.ambiente || 'homologacao') === 'homologacao';
                    return (
                      <div className="space-y-3">

                        {/* Ambiente — destaque no topo */}
                        <div className={`flex items-center justify-between rounded-lg px-3 py-2 border-2 ${isHom ? 'border-amber-400 bg-amber-50' : 'border-green-500 bg-green-50'}`}>
                          <div>
                            <p className="text-[8px] font-black uppercase tracking-widest">{isHom ? '⚠ Homologação (testes)' : '✓ Produção'}</p>
                            <p className="text-[7px] text-[#141414]/50 mt-0.5">{isHom ? 'Notas não têm validade fiscal — use para configurar e testar.' : 'Notas têm validade fiscal. Troque somente com autorização do contador.'}</p>
                          </div>
                          <select value={cfg.ambiente || 'homologacao'} onChange={e => upd('ambiente', e.target.value)}
                            className="border border-[#141414]/15 rounded px-2 py-1 text-[8px] font-bold focus:outline-none ml-3 shrink-0">
                            <option value="homologacao">Homologação</option>
                            <option value="producao">Produção</option>
                          </select>
                        </div>

                        {/* Dados do emitente */}
                        <div>
                          <p className="text-[7px] font-bold uppercase text-[#141414]/50 mb-1.5">Dados do Emitente</p>
                          <div className="grid grid-cols-2 gap-2">
                            {field('CNPJ', 'cnpj', '00.000.000/0001-00')}
                            {field('Inscrição Estadual', 'ie', '0000000000000')}
                            {field('Razão Social', 'razaoSocial', 'Nome da empresa')}
                            {field('Nome Fantasia', 'nomeFantasia', 'Opcional')}
                            <div className="flex flex-col gap-0.5">
                              <label className="text-[7px] font-bold uppercase text-[#141414]/50">Regime Tributário (CRT)</label>
                              <select value={cfg.crt || cfg.regime || '1'} onChange={e => upd('crt', e.target.value)}
                                className="border border-[#141414]/15 rounded px-2 py-1 text-[9px] focus:outline-none">
                                <option value="1">1 — Simples Nacional</option>
                                <option value="2">2 — Simples Nacional Excesso</option>
                                <option value="3">3 — Regime Normal</option>
                              </select>
                            </div>
                            {field('CNAE Principal', 'cnaePrincipal', '5611201', 'text', 'restaurante=5611201')}
                            {field('Telefone', 'telefone', '(65) 99999-9999')}
                          </div>
                        </div>

                        {/* Endereço */}
                        <div className="border-t border-[#141414]/10 pt-2">
                          <p className="text-[7px] font-bold uppercase text-[#141414]/50 mb-1.5">Endereço</p>
                          <div className="grid grid-cols-2 gap-2">
                            {field('Logradouro', 'logradouro', 'Rua, Av...')}
                            {field('Número', 'numero', 'SN')}
                            {field('Bairro', 'bairro', '')}
                            {field('CEP', 'cep', '78000-000')}
                            {field('Município', 'municipio', 'Cuiabá')}
                            {field('UF', 'uf', 'MT')}
                            {field('Código IBGE', 'codigoMunicipio', '5103403', 'text', 'Cuiabá=5103403')}
                          </div>
                        </div>

                        {/* Séries e numeração */}
                        <div className="border-t border-[#141414]/10 pt-2">
                          <p className="text-[7px] font-bold uppercase text-[#141414]/50 mb-1.5">Séries e Numeração</p>
                          <div className="grid grid-cols-2 gap-2">
                            {field('Série NFC-e Homologação', 'serieNFCeHom', '1')}
                            {field('Série NFC-e Produção', 'serieNFCeProd', '1')}
                            {field('Série NF-e Homologação', 'serieNFEHom', '1')}
                            {field('Série NF-e Produção', 'serieNFEProd', '1')}
                          </div>
                          <p className="text-[7px] text-[#141414]/40 mt-1">Confirme os últimos números usados com o contador antes de ativar em produção.</p>
                        </div>

                        {/* CSC por ambiente */}
                        <div className="border-t border-[#141414]/10 pt-2">
                          <p className="text-[7px] font-bold uppercase text-[#141414]/50 mb-1.5">CSC — Código de Segurança do Contribuinte</p>
                          <p className="text-[7px] text-[#141414]/40 mb-2">Obtido no portal SEFAZ-MT. CSC e ID são diferentes para homologação e produção.</p>
                          <div className="space-y-2">
                            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2">
                              <p className="text-[7px] font-bold uppercase text-amber-700 mb-1">Homologação</p>
                              <div className="grid grid-cols-2 gap-2">
                                {field('ID CSC Homologação', 'cscHomId', '000001')}
                                {field('CSC Homologação', 'cscHom', 'Token da SEFAZ-MT')}
                              </div>
                            </div>
                            <div className="rounded-lg border border-green-200 bg-green-50/50 p-2">
                              <p className="text-[7px] font-bold uppercase text-green-700 mb-1">Produção</p>
                              <div className="grid grid-cols-2 gap-2">
                                {field('ID CSC Produção', 'cscProdId', '000001')}
                                {field('CSC Produção', 'cscProd', 'Token da SEFAZ-MT')}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Certificado A1 */}
                        <div className="border-t border-[#141414]/10 pt-2">
                          <p className="text-[7px] font-bold uppercase text-[#141414]/50 mb-1.5">Certificado Digital A1</p>
                          {cfg.certificadoCarregado && (
                            <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 mb-2">
                              <span className="text-green-600 text-[9px]">✓</span>
                              <div>
                                <p className="text-[8px] font-bold text-green-700">Certificado ativo no servidor</p>
                                {cfg.certificadoTitular && <p className="text-[7px] text-green-600">{cfg.certificadoTitular}</p>}
                                {cfg.certificadoValidadeFim && <p className="text-[7px] text-green-600">Válido até {new Date(cfg.certificadoValidadeFim).toLocaleDateString('pt-BR')}</p>}
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-1 gap-2">
                            <div className="flex flex-col gap-0.5">
                              <label className="text-[7px] font-bold uppercase text-[#141414]/50">Arquivo .pfx ou .p12</label>
                              <div className="flex items-center gap-2">
                                <label className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-[#141414]/20 rounded cursor-pointer hover:bg-[#141414]/5 transition-colors">
                                  <Upload size={12} className="opacity-40 shrink-0" />
                                  <span className="text-[9px] opacity-50 truncate">
                                    {cfg.certificadoA1Base64 ? '✓ Novo certificado selecionado — salve para aplicar' : cfg.certificadoCarregado ? 'Substituir certificado atual' : 'Clique para selecionar .pfx ou .p12'}
                                  </span>
                                  <input type="file" accept=".pfx,.p12" className="hidden" onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = (ev) => {
                                      const base64 = (ev.target?.result as string).split(',')[1];
                                      setFiscalConfig((prev: any) => ({ ...(prev || {}), certificadoA1Base64: base64 }));
                                      toast.success('Certificado selecionado. Informe a senha e salve.');
                                    };
                                    reader.readAsDataURL(file);
                                  }} />
                                </label>
                                {cfg.certificadoA1Base64 && (
                                  <button onClick={() => setFiscalConfig((prev: any) => ({ ...(prev || {}), certificadoA1Base64: '' }))} className="text-[9px] text-red-500 hover:text-red-700 shrink-0">Remover</button>
                                )}
                              </div>
                            </div>
                            {field('Senha do Certificado', 'certificadoSenha', '••••••••', 'password')}
                            <p className="text-[7px] text-[#141414]/40">A senha não é armazenada no banco após a validação. O arquivo .pfx fica criptografado no servidor.</p>
                          </div>
                        </div>

                        {/* Ações */}
                        <div className="flex gap-2 pt-1 border-t border-[#141414]/10">
                          <button
                            disabled={fiscalConfigSaving}
                            onClick={async () => {
                              if (!tenantId) { toast.error('Faça login para salvar.'); return; }
                              setFiscalConfigSaving(true);
                              try {
                                const res = await fetch(`/api/fiscal/config/${tenantId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fiscalConfig) });
                                const d = await res.json();
                                if (!res.ok) throw new Error(d.error || res.statusText);
                                toast.success(d.certificadoCarregado ? 'Configuração salva e certificado validado!' : 'Configuração fiscal salva!');
                                // Recarregar para exibir metadados do certificado
                                const r2 = await fetch(`/api/fiscal/config/${tenantId}`);
                                if (r2.ok) { const d2 = await r2.json(); setFiscalConfig((prev: any) => ({ ...(prev || {}), ...(d2.config || {}), certificadoA1Base64: prev?.certificadoA1Base64 })); }
                              } catch (e: any) { toast.error('Erro: ' + e.message); }
                              setFiscalConfigSaving(false);
                            }}
                            className="flex-1 py-1.5 bg-[#141414] text-white rounded-lg text-[8px] font-bold uppercase hover:bg-[#141414]/80 transition-colors disabled:opacity-50"
                          >{fiscalConfigSaving ? 'Salvando...' : 'Salvar Configuração'}</button>
                          <button
                            onClick={async () => {
                              if (!tenantId) return;
                              setSefazStatus(s => ({ ...s, checking: true }));
                              try {
                                const res = await fetch(`/api/fiscal/status/${tenantId}`);
                                const d = await res.json();
                                const parse = (svc: any) => svc
                                  ? { online: svc.cStat === '107', cStat: svc.cStat || '', xMotivo: svc.xMotivo || d.error || 'Sem resposta' }
                                  : { online: false, cStat: '', xMotivo: d.error || 'Sem resposta' };
                                setSefazStatus({ checking: false, nfce: parse(d.nfce), nfe: parse(d.nfe), checkedAt: new Date().toLocaleTimeString('pt-BR') });
                              } catch (e: any) {
                                const err = { online: false, cStat: '', xMotivo: e.message || 'Falha na requisição' };
                                setSefazStatus({ checking: false, nfce: err, nfe: err, checkedAt: new Date().toLocaleTimeString('pt-BR') });
                              }
                            }}
                            disabled={sefazStatus.checking}
                            className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-[8px] font-bold uppercase hover:bg-blue-100 transition-colors disabled:opacity-50"
                          >{sefazStatus.checking ? 'Verificando...' : 'Verificar SEFAZ'}</button>
                          <button
                            onClick={async () => {
                              if (!tenantId) return;
                              setFiscalConfigLoading(true);
                              try {
                                const res = await fetch(`/api/fiscal/config/${tenantId}`);
                                if (res.ok) { const d = await res.json(); setFiscalConfig(d.config || d); toast.success('Configuração carregada.'); }
                                else toast.error('Nenhuma configuração encontrada.');
                              } catch { toast.error('Erro ao carregar configuração.'); }
                              setFiscalConfigLoading(false);
                            }}
                            className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-[8px] font-bold uppercase hover:bg-gray-200 transition-colors"
                          >{fiscalConfigLoading ? '...' : 'Carregar'}</button>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Painel de status SEFAZ */}
                {(sefazStatus.nfce !== null || sefazStatus.nfe !== null || sefazStatus.checking) && (() => {
                  const allOnline = sefazStatus.nfce?.online && sefazStatus.nfe?.online;
                  const anyOnline = sefazStatus.nfce?.online || sefazStatus.nfe?.online;
                  const bg = sefazStatus.checking
                    ? 'bg-blue-50 border-blue-200'
                    : allOnline ? 'bg-green-50 border-green-200'
                    : anyOnline ? 'bg-amber-50 border-amber-200'
                    : 'bg-red-50 border-red-200';
                  const headerColor = sefazStatus.checking ? 'text-blue-700' : allOnline ? 'text-green-700' : anyOnline ? 'text-amber-700' : 'text-red-700';
                  return (
                    <div className={`mt-2 p-3 rounded-xl border ${bg}`}>
                      <div className="flex items-center justify-between mb-2">
                        <p className={`text-[9px] font-black uppercase tracking-wide ${headerColor}`}>
                          {sefazStatus.checking ? 'Verificando SEFAZ-MT...' : 'SEFAZ-MT — Status dos Serviços'}
                        </p>
                        {sefazStatus.checkedAt && <span className="text-[7px] opacity-50 shrink-0">{sefazStatus.checkedAt}</span>}
                      </div>
                      {sefazStatus.checking ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
                          <span className="text-[8px] text-blue-600">Consultando autorizadores NFC-e e NF-e em paralelo...</span>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {([
                            { label: 'NFC-e (mod. 65)', s: sefazStatus.nfce },
                            { label: 'NF-e  (mod. 55)', s: sefazStatus.nfe  },
                          ] as const).map(({ label, s }) => (
                            <div key={label} className="flex items-start gap-1.5">
                              <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${s?.online ? 'bg-green-500' : 'bg-red-500'}`} />
                              <div className="flex-1 min-w-0">
                                <span className={`text-[8px] font-bold ${s?.online ? 'text-green-700' : 'text-red-700'}`}>{label}</span>
                                <span className={`text-[7px] ml-1.5 ${s?.online ? 'text-green-600' : 'text-red-600'}`}>
                                  {s?.online ? '— Em Operação' : s?.cStat ? `— cStat ${s.cStat}` : '— Indisponível'}
                                </span>
                                {s?.xMotivo && (
                                  <p className={`text-[7px] mt-0.5 opacity-70 truncate ${s.online ? 'text-green-600' : 'text-red-600'}`}>{s.xMotivo}</p>
                                )}
                              </div>
                            </div>
                          ))}
                          {!allOnline && (
                            <div className="mt-1.5 flex items-center gap-3 pt-1 border-t border-current/10">
                              <a href="https://www.nfe.fazenda.gov.br/portal/disponibilidade.aspx" target="_blank" rel="noopener noreferrer"
                                className="text-[7px] text-red-600 underline font-bold">Ver status oficial Portal NF-e →</a>
                              <span className="text-[7px] text-red-500 opacity-70">Pode ser bloqueio de rede do servidor</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Notas Fiscais */}
                <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm mt-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="text-[#141414]" size={12} />
                      <h3 className="font-serif italic text-sm leading-none">Notas Emitidas</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setInutilizarModal(true)} className="text-[7px] font-bold uppercase text-orange-500 hover:text-orange-700 border border-orange-200 rounded px-1.5 py-0.5 transition-colors">Inutilizar</button>
                      <button onClick={async () => {
                        if (!tenantId) return;
                        const res = await fetch(`/api/fiscal/notes/${tenantId}`);
                        if (res.ok) { const d = await res.json(); setFiscalNotes(Array.isArray(d) ? d : (d.notes || [])); }
                      }} className="text-[7px] font-bold uppercase text-[#141414]/50 hover:text-[#141414] transition-colors">Atualizar</button>
                    </div>
                  </div>
                  {fiscalNotes.length === 0 ? (
                    <p className="text-[8px] text-[#141414]/40 text-center py-2">Nenhuma nota emitida.</p>
                  ) : (
                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {fiscalNotes.map((n: any) => {
                        const st = (n.status || '').toUpperCase();
                        const canCancel = st === 'AUTORIZADO' || st === 'AUTORIZADO_COM_ALERTA';
                        const statusColor =
                          st === 'AUTORIZADO' ? 'text-green-700' :
                          st === 'AUTORIZADO_COM_ALERTA' ? 'text-green-600' :
                          st === 'CANCELADO' ? 'text-red-600' :
                          st === 'REJEITADO' ? 'text-orange-600' :
                          st === 'INUTILIZADO' ? 'text-gray-500' :
                          st === 'EPEC_AUTORIZADO' ? 'text-blue-700' :
                          st === 'CONTINGENCIA_PENDENTE_TRANSMISSAO' ? 'text-amber-600' :
                          'text-yellow-600';
                        return (
                          <div key={n.id} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1 text-[7.5px]">
                            <div className="flex-1 min-w-0">
                              <span className={`font-bold ${statusColor}`}>{st}</span>
                              <span className="text-[#141414]/50 ml-1.5">#{n.order_id}</span>
                              {n.modelo && <span className="text-[#141414]/30 ml-1">mod.{n.modelo}</span>}
                              {n.chave_acesso && (
                                <span className="font-mono text-[6.5px] text-[#141414]/30 ml-1.5">{n.chave_acesso.slice(-9)}</span>
                              )}
                            </div>
                            {canCancel && (
                              <button
                                onClick={() => { setCancelModal({ chaveAcesso: n.chave_acesso, modelo: n.modelo || '65', orderId: n.order_id }); setCancelMotivo(''); }}
                                className="shrink-0 px-1.5 py-0.5 text-[6.5px] font-bold uppercase text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
                              >Cancelar</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              </div>
              )}

              </div>
              </motion.div>
            )}
        </AnimatePresence>
      </main>

      {/* Modal Cancelamento de NF-e / NFC-e */}
      <AnimatePresence>
        {cancelModal && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => { if (!cancelLoading) setCancelModal(null); }} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 z-10">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-serif italic text-xl">Cancelar Nota</h3>
                  <p className="text-[9px] opacity-40 mt-0.5">
                    Pedido #{cancelModal.orderId} · mod.{cancelModal.modelo} · …{cancelModal.chaveAcesso?.slice(-9)}
                  </p>
                </div>
                <button onClick={() => { if (!cancelLoading) setCancelModal(null); }}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={16} />
                </button>
              </div>

              <div className="mb-1">
                <label className="text-[9px] font-bold uppercase opacity-50 block mb-1">Motivo do cancelamento</label>
                <textarea
                  value={cancelMotivo}
                  onChange={e => setCancelMotivo(e.target.value)}
                  disabled={cancelLoading}
                  placeholder="Descreva o motivo (mínimo 15 caracteres)..."
                  rows={3}
                  className="w-full text-xs border border-[#141414]/15 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#141414]/20 disabled:opacity-50"
                />
                <p className={`text-[8px] mt-0.5 text-right ${cancelMotivo.length < 15 ? 'text-red-400' : 'text-green-600'}`}>
                  {cancelMotivo.length}/15 mín.
                </p>
              </div>

              <div className="flex gap-2 mt-4">
                <button onClick={() => setCancelModal(null)} disabled={cancelLoading}
                  className="flex-1 py-2 border border-[#141414]/15 rounded-xl text-xs font-bold text-[#141414]/50 hover:bg-gray-50 transition-colors disabled:opacity-50">
                  Voltar
                </button>
                <button
                  disabled={cancelLoading || cancelMotivo.length < 15}
                  onClick={async () => {
                    if (!cancelModal || !tenantId) return;
                    setCancelLoading(true);
                    try {
                      const res = await fetch(`/api/fiscal/cancel/${encodeURIComponent(cancelModal.chaveAcesso)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tenantId, motivo: cancelMotivo }),
                      });
                      const d = await res.json();
                      if (!res.ok) { toast.error(d.error || 'Erro ao cancelar nota.'); return; }
                      toast.success(`Nota cancelada — cStat ${d.cStat}`);
                      setCancelModal(null);
                      // Atualizar lista de notas
                      const r2 = await fetch(`/api/fiscal/notes/${tenantId}`);
                      if (r2.ok) { const d2 = await r2.json(); setFiscalNotes(Array.isArray(d2) ? d2 : (d2.notes || [])); }
                    } catch (e: any) {
                      toast.error(e.message || 'Erro de rede.');
                    } finally {
                      setCancelLoading(false);
                    }
                  }}
                  className="flex-1 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-colors disabled:opacity-40"
                >
                  {cancelLoading ? 'Cancelando...' : 'Confirmar Cancelamento'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Inutilização de NF-e / NFC-e */}
      <AnimatePresence>
        {inutilizarModal && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => { if (!inutilizarLoading) setInutilizarModal(false); }} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 z-10">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-serif italic text-xl">Inutilizar Numeração</h3>
                  <p className="text-[9px] opacity-40 mt-0.5">Prazo: até o 10º dia do mês seguinte</p>
                </div>
                <button onClick={() => { if (!inutilizarLoading) setInutilizarModal(false); }}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[9px] font-bold uppercase opacity-50 block mb-1">Modelo</label>
                    <select
                      value={inutilizarForm.modelo}
                      onChange={e => setInutilizarForm(f => ({ ...f, modelo: e.target.value as '55' | '65' }))}
                      disabled={inutilizarLoading}
                      className="w-full text-xs border border-[#141414]/15 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#141414]/20 disabled:opacity-50"
                    >
                      <option value="65">65 — NFC-e</option>
                      <option value="55">55 — NF-e</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[9px] font-bold uppercase opacity-50 block mb-1">Série</label>
                    <input
                      value={inutilizarForm.serie}
                      onChange={e => setInutilizarForm(f => ({ ...f, serie: e.target.value }))}
                      disabled={inutilizarLoading}
                      placeholder="ex: 1"
                      className="w-full text-xs border border-[#141414]/15 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#141414]/20 disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[9px] font-bold uppercase opacity-50 block mb-1">Nº Inicial</label>
                    <input
                      type="number" min={1}
                      value={inutilizarForm.nNFIni}
                      onChange={e => setInutilizarForm(f => ({ ...f, nNFIni: e.target.value }))}
                      disabled={inutilizarLoading}
                      placeholder="1"
                      className="w-full text-xs border border-[#141414]/15 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#141414]/20 disabled:opacity-50"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[9px] font-bold uppercase opacity-50 block mb-1">Nº Final</label>
                    <input
                      type="number" min={1}
                      value={inutilizarForm.nNFFin}
                      onChange={e => setInutilizarForm(f => ({ ...f, nNFFin: e.target.value }))}
                      disabled={inutilizarLoading}
                      placeholder="1"
                      className="w-full text-xs border border-[#141414]/15 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#141414]/20 disabled:opacity-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[9px] font-bold uppercase opacity-50 block mb-1">Justificativa</label>
                  <textarea
                    value={inutilizarForm.xJust}
                    onChange={e => setInutilizarForm(f => ({ ...f, xJust: e.target.value }))}
                    disabled={inutilizarLoading}
                    placeholder="Descreva o motivo da inutilização (mínimo 15 caracteres)..."
                    rows={3}
                    className="w-full text-xs border border-[#141414]/15 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#141414]/20 disabled:opacity-50"
                  />
                  <p className={`text-[8px] mt-0.5 text-right ${inutilizarForm.xJust.length < 15 ? 'text-red-400' : 'text-green-600'}`}>
                    {inutilizarForm.xJust.length}/15 mín.
                  </p>
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button onClick={() => setInutilizarModal(false)} disabled={inutilizarLoading}
                  className="flex-1 py-2 border border-[#141414]/15 rounded-xl text-xs font-bold text-[#141414]/50 hover:bg-gray-50 transition-colors disabled:opacity-50">
                  Voltar
                </button>
                <button
                  disabled={inutilizarLoading || inutilizarForm.xJust.length < 15 || !inutilizarForm.serie || !inutilizarForm.nNFIni || !inutilizarForm.nNFFin}
                  onClick={async () => {
                    if (!tenantId) return;
                    const nIni = Number(inutilizarForm.nNFIni);
                    const nFin = Number(inutilizarForm.nNFFin);
                    if (!nIni || !nFin || nIni > nFin) { toast.error('Faixa numérica inválida.'); return; }
                    setInutilizarLoading(true);
                    try {
                      const res = await fetch('/api/fiscal/inutilizar', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tenantId, modelo: inutilizarForm.modelo, serie: inutilizarForm.serie, nNFIni: nIni, nNFFin: nFin, xJust: inutilizarForm.xJust }),
                      });
                      const d = await res.json();
                      if (!res.ok) { toast.error(d.error || 'Erro ao inutilizar.'); return; }
                      toast.success(`Inutilização aceita — cStat ${d.cStat} (${nIni === nFin ? `nº ${nIni}` : `nºs ${nIni}–${nFin}`})`);
                      setInutilizarModal(false);
                      setInutilizarForm({ modelo: '65', serie: '', nNFIni: '', nNFFin: '', xJust: '' });
                      const r2 = await fetch(`/api/fiscal/notes/${tenantId}`);
                      if (r2.ok) { const d2 = await r2.json(); setFiscalNotes(Array.isArray(d2) ? d2 : (d2.notes || [])); }
                    } catch (e: any) {
                      toast.error(e.message || 'Erro de rede.');
                    } finally {
                      setInutilizarLoading(false);
                    }
                  }}
                  className="flex-1 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold hover:bg-orange-700 transition-colors disabled:opacity-40"
                >
                  {inutilizarLoading ? 'Inutilizando...' : 'Confirmar Inutilização'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Scan de Impressoras */}
      <AnimatePresence>
        {scanModalOpen && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setScanModalOpen(false); setScanAssigning(null); }} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 z-10">

              {/* ── Passo 2: Vincular a um canal ── */}
              {scanAssigning ? (
                <>
                  <div className="flex items-center gap-3 mb-5">
                    <button onClick={() => setScanAssigning(null)} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><ArrowLeft size={15} /></button>
                    <div>
                      <h3 className="font-serif italic text-xl">Vincular impressora</h3>
                      <p className="text-[10px] opacity-40 mt-0.5 font-bold truncate">{scanAssigning.name}</p>
                    </div>
                  </div>
                  <p className="text-[11px] opacity-50 mb-4">Escolha para qual canal de impressão esta impressora será usada:</p>
                  <div className="space-y-2">
                    {([
                      { key: 'pizzas',   label: pizzariaConfig?.enabled ? 'Pratos / Pizzas' : 'Pratos', icon: <Pizza size={14} />, desc: 'Via de produção da cozinha' },
                      { key: 'drinks',   label: 'Bebidas',  icon: <Beer size={14} />, desc: 'Via do bar / copa' },
                      { key: 'kitchen',  label: 'Lanches',  icon: <ChefHat size={14} />, desc: 'Via da lanchonete' },
                      { key: 'receipts', label: 'Recibos / Caixa', icon: <FileText size={14} />, desc: 'Comprovante de pagamento' },
                    ] as const).map(({ key, label, icon, desc }) => {
                      const current = (printerConfig as any)[key];
                      const isSet = current === scanAssigning.name;
                      return (
                        <button key={key}
                          onClick={() => {
                            (setPrinterConfig as any)((prev: any) => {
                              const updated = { ...prev, [key]: scanAssigning.name };
                              localStorage.setItem('printerConfig', JSON.stringify(updated));
                              return updated;
                            });
                            toast.success(`${scanAssigning.name} → ${label}`, { description: 'Salve as configurações para persistir.' });
                            setScanAssigning(null);
                            setScanModalOpen(false);
                            setActiveTab('settings');
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all hover:border-[#141414] ${isSet ? 'border-[#141414] bg-[#141414]/5' : 'border-[#141414]/10'}`}
                        >
                          <span className="opacity-60">{icon}</span>
                          <div className="flex-1">
                            <p className="font-bold text-sm">{label}</p>
                            <p className="text-[10px] opacity-40">{desc}{isSet ? ' · já configurado' : ''}</p>
                          </div>
                          {isSet && <CheckCircle size={14} className="text-green-500 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => { setScanAssigning(null); setScanModalOpen(false); setActiveTab('settings'); }}
                    className="w-full mt-3 py-2 border border-[#141414]/15 rounded-xl text-xs font-bold text-[#141414]/40 hover:bg-gray-50 transition-colors">
                    Pular — configurar depois
                  </button>
                </>
              ) : (
                /* ── Passo 1: Lista de impressoras encontradas ── */
                <>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-serif italic text-xl">Buscar Impressoras</h3>
                      <p className="text-[10px] uppercase tracking-widest opacity-40 mt-0.5">Windows + Rede local</p>
                    </div>
                    <button onClick={() => setScanModalOpen(false)} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><X size={16} /></button>
                  </div>

                  {scanRunning ? (
                    <div className="flex flex-col items-center py-8 gap-3">
                      <div className="w-8 h-8 border-2 border-[#141414] border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm font-semibold">Buscando impressoras...</p>
                      <p className="text-[11px] opacity-40 text-center">Consultando Windows + escaneando rede local. Aguarde.</p>
                    </div>
                  ) : scanPrinters.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-sm font-semibold mb-1">Nenhuma impressora encontrada</p>
                      <p className="text-[11px] opacity-40">Verifique se as impressoras estão instaladas e ligadas.</p>
                      <button onClick={() => { setScanPrinters([]); setScanRunning(true); socket.emit('scan_printers_request'); }}
                        className="mt-4 px-4 py-2 bg-[#141414] text-white rounded-xl text-xs font-bold hover:opacity-80 transition-opacity">
                        Tentar novamente
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                      <p className="text-[11px] font-bold uppercase opacity-40 mb-1">{scanPrinters.length} impressora(s) encontrada(s) — clique para adicionar e vincular</p>
                      {scanPrinters.map((p, i) => {
                        // Extrai IP do portName Bematech (ex: "Bematech_IP_192.168.10.137")
                        const extractedIp = p.portName?.match(/(\d{1,3}(?:\.\d{1,3}){3})/)?.[1] || '';
                        const displayName = p.localName || p.ip || '';
                        const displaySub = p.localName
                          ? (extractedIp ? `${extractedIp} · ${p.status || 'Pronta'}` : `${p.portName || '—'} · ${p.status || 'Pronta'}`)
                          : `${p.ip} · Porta ${p.port}`;
                        const alreadyAdded = (printerConfig.registeredPrinters || []).some((r: any) =>
                          r.name === displayName || (p.ip && r.ip === p.ip)
                        );
                        return (
                          <div key={i} className={`flex items-center justify-between rounded-xl px-4 py-3 gap-2 border transition-all ${alreadyAdded ? 'bg-green-50 border-green-200' : 'bg-[#F5F5F3] border-transparent hover:border-[#141414]/10'}`}>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm leading-tight truncate">{displayName}</p>
                              <p className="text-[10px] opacity-50">{displaySub}</p>
                            </div>
                            {alreadyAdded ? (
                              <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-green-600">
                                <CheckCircle size={12} /> Adicionada
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  const ip = p.ip || extractedIp;
                                  const entry = { name: displayName, ip, port: p.port || 9100, localName: p.localName, portName: p.portName };
                                  (setPrinterConfig as any)((prev: any) => {
                                    const updated = { ...prev, registeredPrinters: [...(prev.registeredPrinters || []), entry] };
                                    localStorage.setItem('printerConfig', JSON.stringify(updated));
                                    return updated;
                                  });
                                  setScanAssigning(entry);
                                }}
                                className="shrink-0 text-[11px] font-bold bg-[#141414] text-white px-3 py-1.5 rounded-lg hover:opacity-80 transition-opacity"
                              >
                                Adicionar
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <button onClick={() => { setScanPrinters([]); setScanRunning(true); socket.emit('scan_printers_request'); }}
                        className="w-full mt-2 py-2 border border-[#141414]/20 rounded-xl text-xs font-bold text-[#141414]/50 hover:bg-gray-50 transition-colors">
                        Buscar novamente
                      </button>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                    String(o.tableId) === String(targetId) &&
                    o.isComanda === isComandaSelected &&
                    o.timestamp && o.timestamp.startsWith(today)
                  ).reverse();

                  if (tableHistory.length === 0) {
                    return (
                      <div className="text-center py-20 opacity-30">
                        <Clock size={48} className="mx-auto mb-4" />
                        <p>Nenhum pedido encontrado para hoje.</p>
                      </div>
                    );
                  }

                  const reprintOrder = (order: any) => {
                    const tableType = isComandaSelected ? 'Comanda' : 'Mesa';
                    const tid = isComandaSelected ? selectedComandaId : selectedTableId;
                    const waiterName = waiters.find((w: any) => String(w.id) === String(order.waiterId))?.name || 'N/A';
                    const activeItems = (order.items || []).filter((i: any) => !i.removed);
                    const cancelledItems = (order.items || []).filter((i: any) => i.removed);
                    const total = activeItems.reduce((acc: number, i: any) => {
                      let price = i.price;
                      if (i.discount) { if (i.discountType === 'percentage') price *= (1 - i.discount / 100); else price = Math.max(0, price - i.discount); }
                      return acc + price;
                    }, 0);
                    let finalTotal = total;
                    if (order.discount) { if (order.discountType === 'percentage') finalTotal *= (1 - order.discount / 100); else finalTotal = Math.max(0, finalTotal - order.discount); }
                    const totalPaid = (order.paymentLog || []).reduce((acc: number, p: any) => acc + p.amount, 0);

                    const receiptPrinterName = printerConfig.receipts;
                    const printer = receiptPrinterName ? (printerConfig.registeredPrinters || []).find((p: any) => p.name === receiptPrinterName) : null;
                    const is50mm = (printerConfig.paperWidth || '80mm') === '50mm';

                    if (printer) {
                      const lineLen = is50mm ? 32 : 48;
                      const b: number[] = [];
                      const push = (...bytes: number[]) => b.push(...bytes);
                      const lf = () => push(0x0A);
                      const text = (s: string) => push(...escStr(s));
                      const ln = () => { text('-'.repeat(lineLen)); lf(); };
                      const center = () => push(0x1B, 0x61, 0x01);
                      const left = () => push(0x1B, 0x61, 0x00);
                      const bold = (on: boolean) => push(0x1B, 0x45, on ? 0x01 : 0x00);
                      push(0x1B, 0x40);
                      center(); bold(true); text((printerConfig.establishmentName || 'ESTABELECIMENTO').toUpperCase()); lf(); bold(false);
                      if (printerConfig.address) { text(printerConfig.address); lf(); }
                      lf(); bold(true); text('*** REIMPRESSAO ***'); lf(); bold(false); ln(); left();
                      text(`${tableType}: ${tid}`); lf();
                      text(`Garcom: ${waiterName}`); lf();
                      text(`Pedido: #${order.id}`); lf();
                      text(`Data: ${new Date(order.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`); lf();
                      ln();
                      activeItems.forEach((item: any) => {
                        const label = `${item.quantity || 1}x ${item.name}`;
                        let price = item.price;
                        if (item.discount) { if (item.discountType === 'percentage') price *= (1 - item.discount / 100); else price = Math.max(0, price - item.discount); }
                        const priceStr = `R$ ${price.toFixed(2)}`;
                        const spaces = Math.max(1, lineLen - label.length - priceStr.length);
                        if (printerConfig.boldItems) bold(true);
                        text(label + ' '.repeat(spaces) + priceStr); lf();
                        if (printerConfig.boldItems) bold(false);
                      });
                      if (cancelledItems.length > 0) {
                        ln(); bold(true); text('ITENS CANCELADOS:'); lf(); bold(false);
                        cancelledItems.forEach((item: any) => {
                          text(`  [CANCELADO] ${item.quantity || 1}x ${item.name}`); lf();
                          if (item.removedBy) { text(`    Por: ${item.removedBy}`); lf(); }
                          if (item.removalReason) { text(`    Motivo: ${item.removalReason}`); lf(); }
                        });
                      }
                      ln(); bold(true);
                      const totLabel = 'TOTAL:'; const totVal = `R$ ${finalTotal.toFixed(2)}`;
                      text(totLabel + ' '.repeat(Math.max(1, lineLen - totLabel.length - totVal.length)) + totVal); lf();
                      bold(false);
                      if (order.paymentLog?.length > 0) {
                        ln(); text('Pagamentos:'); lf();
                        (order.paymentLog || []).forEach((p: any) => { text(`  ${p.method}: R$ ${p.amount.toFixed(2)}`); lf(); });
                        if (totalPaid > 0) { text(`Pago: R$ ${totalPaid.toFixed(2)}`); lf(); }
                      }
                      if (printerConfig.receiptFooter) { lf(); center(); text(printerConfig.receiptFooter); lf(); }
                      push(0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x10);
                      if (printer.ip) {
                        socket.emit('print_escpos', { ip: printer.ip, port: printer.port || 9100, data: b });
                      } else {
                        socket.emit('print_escpos', { localName: printer.name, data: b });
                      }
                      toast.success('Reimpressão enviada', { description: `Pedido #${order.id} · ${tableType} ${tid}` });
                    } else {
                      toast.error('Nenhuma impressora de caixa configurada.', { description: 'Configure a impressora de comprovantes nas configurações.' });
                    }
                  };

                  return tableHistory.map(order => (
                    <div key={order.id} className="border border-[#141414]/10 rounded-2xl p-6 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] uppercase font-bold opacity-30">Pedido #{order.id}</p>
                          <p className="text-xs font-mono opacity-50">{new Date(order.timestamp).toLocaleTimeString()}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => reprintOrder(order)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-[#141414] text-[9px] font-bold uppercase transition-colors"
                            title="Reimprimir pedido"
                          >
                            <Printer size={10} />
                            Reimprimir
                          </button>
                          <span className={`px-2 py-1 rounded-full text-[8px] uppercase font-bold ${
                            order.status === 'finalizada' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {order.status}
                          </span>
                        </div>
                      </div>

                      {/* Convidados */}
                      {order.guests && order.guests.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pb-3 border-b border-[#141414]/8">
                          <span className="text-[9px] uppercase font-bold opacity-30 w-full">Convidados</span>
                          {order.guests.map((guest: string, gi: number) => (
                            <span key={gi} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-semibold">
                              {guest}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        {(order.items || []).map((item, idx) => (
                          <div key={idx} className={`flex flex-col space-y-0.5 pb-1.5 border-b border-[#141414]/5 last:border-0 ${item.removed ? 'opacity-40' : ''}`}>
                            <div className="flex justify-between items-start text-sm gap-2">
                              <div className="flex-1 min-w-0">
                                <span className={item.removed ? 'line-through' : ''}>
                                  {item.quantity || 1}× {item.name}
                                </span>
                                {item.guestName && (
                                  <span className="ml-1.5 text-[9px] bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded-full font-semibold">{item.guestName}</span>
                                )}
                                {item.waiterName && (
                                  <span className="ml-1.5 text-[9px] bg-[#141414]/8 px-1.5 py-0.5 rounded font-semibold opacity-60">{item.waiterName}</span>
                                )}
                                {item.observations && (
                                  <p className="text-[10px] text-blue-600 mt-0.5">Obs: {item.observations}</p>
                                )}
                                {item.removed && item.removalReason && (
                                  <p className="text-[10px] text-red-500 mt-0.5">
                                    Motivo: {item.removalReason}{item.removedBy ? ` · por ${item.removedBy}` : ''}
                                  </p>
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

                      {/* Botão NFC-e */}
                      {order.status === 'finalizada' && (
                        <button
                          onClick={() => {
                            const total = (order.items || []).filter((i: any) => !i.removed).reduce((acc: number, i: any) => {
                              let price = i.price;
                              if (i.discount) { if (i.discountType === 'percentage') price *= (1 - i.discount / 100); else price = Math.max(0, price - i.discount); }
                              return acc + price;
                            }, 0);
                            setNfceResult(null); setNfceCpf(''); setNfcePagamento('dinheiro');
                            setNfceModal({ orderId: order.id, total });
                          }}
                          className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase transition-colors"
                        >
                          <FileText size={13} />
                          Emitir NFC-e
                        </button>
                      )}
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
              className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl border-2 border-[#141414] flex flex-col h-[85vh]"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-serif italic text-2xl">Adicionar Ítem</h3>
                <button onClick={() => setIsAddItemModalOpen(false)}><X size={24} /></button>
              </div>

              {/* Guest picker */}
              {admGuestList.length > 0 && (
                <div className="mb-4 flex items-center gap-2 flex-wrap bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase shrink-0">Convidado:</span>
                  <button onClick={() => setAdmGuestForItem('')} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${!admGuestForItem ? 'bg-indigo-600 text-white border-indigo-600' : 'border-indigo-300 text-indigo-700'}`}>Nenhum</button>
                  {admGuestList.map(g => (
                    <button key={g} onClick={() => setAdmGuestForItem(g)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${admGuestForItem === g ? 'bg-indigo-600 text-white border-indigo-600' : 'border-indigo-300 text-indigo-700'}`}>{g}</button>
                  ))}
                </div>
              )}

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

                {/* Dynamic category buttons */}
                {(() => {
                  const visibleCats = menu.filter(cat => cat.visible !== false);
                  const effectiveCat = selectedCategory ? visibleCats.find(c => c.name === selectedCategory) : visibleCats[0];
                  const subcats = (effectiveCat?.subcategories || []).filter(s => s.visible !== false);
                  return (
                    <>
                      <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-hide">
                        {visibleCats.map(cat => (
                          <button
                            key={cat.name}
                            onClick={() => {
                              const firstSub = (cat.subcategories || []).filter((s: any) => s.visible !== false)[0];
                              setSelectedCategory(cat.name);
                              // Para pizza, auto-seleciona primeira subcategoria (remove "Todos")
                              setSelectedSubcategory(cat.type === 'pizzas' && firstSub ? firstSub.id : null);
                            }}
                            className={`shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                              effectiveCat?.name === cat.name && !searchTerm
                                ? 'bg-[#141414] text-[#E4E3E0] shadow-lg scale-[1.02]'
                                : 'bg-gray-100 hover:bg-gray-200 opacity-60'
                            }`}
                          >
                            {cat.name}
                          </button>
                        ))}
                      </div>
                      {subcats.length > 0 && !searchTerm && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {/* "Todos" oculto para pizza — subcategorias com/sem borda são mutuamente exclusivas */}
                          {effectiveCat?.type !== 'pizzas' && (
                            <button
                              onClick={() => setSelectedSubcategory(null)}
                              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                                selectedSubcategory === null ? 'bg-[#141414] text-white' : 'bg-white border border-[#141414]/10'
                              }`}
                            >
                              Todos
                            </button>
                          )}
                          {subcats.map(sub => (
                            <button
                              key={sub.id}
                              onClick={() => setSelectedSubcategory(sub.id)}
                              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                                selectedSubcategory === sub.id ? 'bg-[#141414] text-white' : 'bg-white border border-[#141414]/10'
                              }`}
                            >
                              {sub.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="flex flex-col overflow-y-auto flex-1 divide-y divide-[#141414]/8 rounded-xl overflow-hidden border border-[#141414]/8">
                {(() => {
                  const visibleCats = menu.filter(cat => cat.visible !== false);
                  const effectiveCat = selectedCategory ? visibleCats.find(c => c.name === selectedCategory) : visibleCats[0];
                  if (searchTerm.length > 0) {
                    const normalize = (s: string) =>
                      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
                    const tokens = normalize(searchTerm).split(/\s+/).filter(Boolean);
                    const allItems = visibleCats.flatMap(cat => [
                      ...cat.items,
                      ...(cat.subcategories || []).filter(s => s.visible !== false).flatMap(s => s.items),
                    ]);
                    return allItems.filter(item => {
                      const haystack = normalize(item.name + ' ' + (item.ingredients || ''));
                      return tokens.every(tok => haystack.includes(tok));
                    });
                  }
                  if (!effectiveCat) return [];
                  if (selectedSubcategory) {
                    const sub = (effectiveCat.subcategories || []).find(s => s.id === selectedSubcategory);
                    return (sub?.items || []).filter(i => i.visible !== false);
                  }
                  const directItems = effectiveCat.items.filter(i => i.visible !== false);
                  const subItems = (effectiveCat.subcategories || []).filter(s => s.visible !== false).flatMap(s => s.items.filter(i => i.visible !== false));
                  return [...directItems, ...subItems];
                })().map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleAddItem((isComandaSelected ? selectedComandaId : selectedTableId)!, item)}
                      className={`flex justify-between items-center px-3 py-2 transition-colors text-left w-full ${idx % 2 === 0 ? 'bg-white' : 'bg-[#F5F4F1]'} hover:bg-[#E8E7E4]`}
                    >
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="font-semibold text-sm leading-tight">{item.name}</p>
                        {item.ingredients && <p className="text-[10px] opacity-50 leading-tight truncate">{item.ingredients}</p>}
                      </div>
                      <span className="font-mono font-bold text-sm whitespace-nowrap">R$ {item.price.toFixed(2)}</span>
                    </button>
                  ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

        {isFlavorModalOpen && (() => {
          const currentSize = pizzaSizes.find((s: any) => s.name === selectedPizzaSize);
          const canConfirm = !!selectedPizzaSize && selectedFlavors.length > 0;

          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-[#E4E3E0] rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
              >
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-xl font-bold">Pizza</h3>
                    <p className="text-sm opacity-60">
                      {selectionStep === 'border_choice' ? 'Como prefere a borda?' : 'Configure seu pedido'}
                    </p>
                  </div>
                  <button onClick={() => setIsFlavorModalOpen(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                    <X size={24} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto pr-1 space-y-5 mb-6">
                  {/* ── Step 1: Borda ou Sem Borda ── */}
                  {selectionStep === 'border_choice' && (
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => { setPizzaHasBorder(false); setSelectedCrusts([]); setSelectionStep('build'); }}
                        className="flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 border-[#141414]/10 hover:border-[#141414] hover:bg-white transition-all font-bold text-base"
                      >
                        <span className="text-3xl">🍕</span>
                        Sem Borda
                      </button>
                      <button
                        onClick={() => { setPizzaHasBorder(true); setSelectionStep('build'); }}
                        className="flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 border-[#141414]/10 hover:border-[#141414] hover:bg-white transition-all font-bold text-base"
                      >
                        <span className="text-3xl">🧀</span>
                        Com Borda
                      </button>
                    </div>
                  )}

                  {/* ── Step 2: Build (borda + obs. borda → sabores → obs. geral) ── */}
                  {selectionStep === 'build' && (
                    <>
                      {/* Borda (se Com Borda) */}
                      {pizzaHasBorder && (
                        <>
                          <div className="space-y-2">
                            <p className="text-xs font-black uppercase tracking-wider opacity-40">Escolha até 2 bordas ({selectedCrusts.length}/2)</p>
                            <div className="grid grid-cols-2 gap-2">
                              {pizzaCrusts.map((crust, idx) => {
                                const isSel = selectedCrusts.includes(crust);
                                return (
                                  <button key={idx} onClick={() => {
                                    if (isSel) { setSelectedCrusts(selectedCrusts.filter(c => c !== crust)); }
                                    else if (selectedCrusts.length < 2) { setSelectedCrusts([...selectedCrusts, crust]); }
                                  }}
                                    className={`flex items-center justify-between p-3 rounded-xl border transition-all text-left font-bold text-sm ${isSel ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' : selectedCrusts.length >= 2 ? 'border-[#141414]/10 bg-white opacity-40 cursor-not-allowed' : 'border-[#141414]/10 bg-white hover:bg-gray-50'}`}>
                                    {crust}
                                    {isSel && <span className="w-5 h-5 rounded-full bg-white/20 border border-white/40 flex items-center justify-center text-[10px] font-black">✓</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-black uppercase tracking-wider opacity-40">Observações da Borda</label>
                            <textarea
                              value={crustObservations}
                              onChange={(e) => setCrustObservations(e.target.value)}
                              placeholder="Ex: Borda bem assada, catupiry extra..."
                              className="w-full h-16 p-3 bg-white border border-[#141414]/10 rounded-2xl focus:outline-none focus:border-[#141414] transition-colors text-sm resize-none"
                            />
                          </div>
                        </>
                      )}

                      {/* Sabores */}
                      <div className="space-y-2">
                        <p className="text-xs font-black uppercase tracking-wider opacity-40">
                          Sabores <span className="normal-case font-medium opacity-60">({selectedFlavors.length}/{maxFlavors})</span>
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {pizzaFlavors.map((flavor, idx) => {
                            const flavorCount = selectedFlavors.filter(f => f.name === flavor.name).length;
                            const isSel = flavorCount > 0;
                            const hasExtra = flavor.price > 0;
                            return (
                              <button key={idx}
                                onClick={() => {
                                  const total = selectedFlavors.length;
                                  if (isSel) {
                                    // já selecionado: se cabe mais do mesmo, adiciona; senão remove todos deste sabor
                                    if (total < maxFlavors) {
                                      setSelectedFlavors([...selectedFlavors, flavor]);
                                    } else {
                                      setSelectedFlavors(selectedFlavors.filter(f => f.name !== flavor.name));
                                    }
                                  } else if (total < maxFlavors) {
                                    setSelectedFlavors([...selectedFlavors, flavor]);
                                  } else {
                                    toast.error(`Máximo de ${maxFlavors} sabor${maxFlavors > 1 ? 'es' : ''} para este tamanho`);
                                  }
                                }}
                                className={`flex items-center justify-between p-3 rounded-xl border transition-all text-left ${isSel ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' : 'border-[#141414]/10 bg-white hover:bg-gray-50'}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="font-bold text-sm">{flavor.name}</p>
                                    {hasExtra && (
                                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${isSel ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>
                                        +R$ {flavor.price.toFixed(2).replace('.', ',')}
                                      </span>
                                    )}
                                  </div>
                                  <p className={`text-[10px] uppercase ${isSel ? 'opacity-70' : 'opacity-50'}`}>{flavor.ingredients}</p>
                                </div>
                                {isSel && (
                                  <span className="ml-2 shrink-0 w-7 h-7 rounded-full bg-white/20 border border-white/40 flex items-center justify-center text-xs font-black">
                                    {flavorCount}x
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Observações gerais */}
                      <div className="space-y-2">
                        <label className="text-xs font-black uppercase tracking-wider opacity-40">Observações</label>
                        <textarea
                          value={pizzaObservations}
                          onChange={(e) => setPizzaObservations(e.target.value)}
                          placeholder="Ex: Sem cebola, bem passado..."
                          className="w-full h-16 p-3 bg-white border border-[#141414]/10 rounded-2xl focus:outline-none focus:border-[#141414] transition-colors text-sm resize-none"
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Footer buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      // Sempre volta para o modal de adicionar item
                      setIsFlavorModalOpen(false);
                      setIsAddItemModalOpen(true);
                    }}
                    className="flex-1 py-4 rounded-2xl border border-[#141414] font-bold hover:bg-black/5 transition-colors"
                  >
                    Voltar
                  </button>
                  {selectionStep === 'build' && (
                    <button
                      onClick={confirmPizzaSelection}
                      disabled={!canConfirm}
                      className="flex-1 py-4 rounded-2xl bg-[#141414] text-[#E4E3E0] font-bold hover:bg-black/90 transition-colors disabled:opacity-40"
                    >
                      Confirmar
                    </button>
                  )}
                </div>
              </motion.div>
            </div>
          );
        })()}

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

                {/* Guest selector */}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold opacity-40 block px-1">Vincular a Convidado</label>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setAdmGuestForItem('')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${!admGuestForItem ? 'bg-[#141414] text-white border-[#141414]' : 'border-[#141414]/20 text-[#141414]'}`}>Nenhum</button>
                    {admGuestList.map(g => (
                      <button key={g} onClick={() => setAdmGuestForItem(g)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${admGuestForItem === g ? 'bg-indigo-600 text-white border-indigo-600' : 'border-indigo-200 text-indigo-700 bg-indigo-50'}`}>{g}</button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={admModalNewGuest} onChange={e => setAdmModalNewGuest(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && admModalNewGuest.trim()) { const n = addAdmGuestToList(admModalNewGuest); if (n) setAdmGuestForItem(n); setAdmModalNewGuest(''); } }} placeholder="Novo convidado..." className="flex-1 text-xs px-3 py-2 border border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-indigo-50" />
                    <button onClick={() => { if (!admModalNewGuest.trim()) return; const n = addAdmGuestToList(admModalNewGuest); if (n) setAdmGuestForItem(n); setAdmModalNewGuest(''); }} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1"><UserPlus size={12} /> Add</button>
                  </div>
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
              {itemToRemove?.item?.quantity > 1 && (
                <button
                  onClick={() => setRemovalQuantity(itemToRemove.item.quantity)}
                  className="w-full py-2 rounded-xl border border-red-200 text-red-600 font-bold text-sm hover:bg-red-50 transition-colors"
                >
                  Remover Todos ({itemToRemove.item.quantity} unidades)
                </button>
              )}
              {isRemoveAllTableItems ? (
                <div className="space-y-2 pt-2 border-t border-red-100">
                  <p className="text-xs text-red-600 font-bold text-center">
                    Remover TODOS os itens ativos da mesa?
                  </p>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setIsRemoveAllTableItems(false)}
                      className="flex-1 py-3 rounded-xl font-bold text-sm border border-[#141414]/10"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={confirmRemoveAllTableItems}
                      disabled={!removalReason.trim()}
                      className="flex-1 bg-red-700 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Remover Todos
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
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
                  {itemToRemove && (orders.find((o: any) => String(o.id) === String(itemToRemove.orderId))?.items || []).filter((i: any) => !i.removed && !i.paid).length > 1 && (
                    <button
                      onClick={() => setIsRemoveAllTableItems(true)}
                      className="w-full py-1.5 text-[10px] font-bold text-red-400 opacity-50 hover:opacity-100 transition-opacity uppercase tracking-wider"
                    >
                      Remover todos os itens da mesa
                    </button>
                  )}
                </div>
              )}
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
              className="bg-white w-full max-w-lg rounded-3xl p-8 space-y-6 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-center">
                <h3 className="font-serif italic text-2xl">Editar Produto</h3>
                <button onClick={() => setIsEditProductModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                <button onClick={() => setEditProductTab('geral')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${editProductTab==='geral' ? 'bg-white shadow text-[#141414]' : 'text-[#141414]/50'}`}>Geral</button>
                <button onClick={() => setEditProductTab('fiscal')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${editProductTab==='fiscal' ? 'bg-white shadow text-[#141414]' : 'text-[#141414]/50'}`}>Fiscal</button>
              </div>

              {editProductTab === 'geral' && (
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
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] h-28 resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Preço Original (opcional, para desconto)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={(editingProduct.item as any).originalPrice || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, originalPrice: parseFloat(e.target.value) || undefined } as any })}
                      placeholder="0.00 (deixe vazio se não houver desconto)"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">URL da Imagem</label>
                    <input
                      type="url"
                      value={(editingProduct.item as any).imageUrl || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, imageUrl: e.target.value } as any })}
                      placeholder="https://exemplo.com/foto.jpg"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">URL do Vídeo (opcional)</label>
                    <input
                      type="url"
                      value={(editingProduct.item as any).videoUrl || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, videoUrl: e.target.value } as any })}
                      placeholder="https://exemplo.com/video.mp4"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                    />
                  </div>
                </div>
              )}

              {editProductTab === 'fiscal' && (
                <div className="space-y-4">
                  <p className="text-[9px] opacity-40 leading-snug">Dados necessários para emissão de NFC-e / NF-e. Consulte seu contador para os códigos corretos.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">NCM</label>
                      <input
                        type="text"
                        maxLength={8}
                        value={(editingProduct.item as any).ncm || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, ncm: e.target.value } as any })}
                        placeholder="Ex: 21069090"
                        className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">CFOP</label>
                      <input
                        type="text"
                        maxLength={4}
                        value={(editingProduct.item as any).cfop || '5102'}
                        onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, cfop: e.target.value } as any })}
                        placeholder="Ex: 5102"
                        className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">CSOSN (Simples Nacional)</label>
                    <select
                      value={(editingProduct.item as any).csosn || '400'}
                      onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, csosn: e.target.value } as any })}
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm appearance-none cursor-pointer"
                    >
                      <option value="400">400 - Tributada pelo Simples Nacional</option>
                      <option value="102">102 - Tributada sem permissão de crédito</option>
                      <option value="500">500 - Com crédito de ICMS</option>
                      <option value="900">900 - Outros</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">CST (Regime Normal)</label>
                    <input
                      type="text"
                      maxLength={3}
                      value={(editingProduct.item as any).cst || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, cst: e.target.value } as any })}
                      placeholder="Ex: 00"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Unidade</label>
                      <select
                        value={(editingProduct.item as any).unidade || 'UN'}
                        onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, unidade: e.target.value } as any })}
                        className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm appearance-none cursor-pointer"
                      >
                        {['UN','KG','L','CX','PCT','DZ'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">PIS/COFINS CST</label>
                      <select
                        value={(editingProduct.item as any).pisCofinsCst || '07'}
                        onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, pisCofinsCst: e.target.value } as any })}
                        className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm appearance-none cursor-pointer"
                      >
                        <option value="07">07 - Isenta</option>
                        <option value="49">49 - Outras saídas</option>
                        <option value="99">99 - Outras operações</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Origem</label>
                    <select
                      value={(editingProduct.item as any).origem ?? '0'}
                      onChange={(e) => setEditingProduct({ ...editingProduct, item: { ...editingProduct.item, origem: e.target.value } as any })}
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm appearance-none cursor-pointer"
                    >
                      <option value="0">0 - Nacional</option>
                      <option value="1">1 - Estrangeira (importação direta)</option>
                      <option value="2">2 - Estrangeira (adquirida no mercado interno)</option>
                    </select>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  socket.emit('update_product', {
                    categoryName: editingProduct.categoryName,
                    subcategoryId: editingProduct.subcategoryId,
                    productId: editingProduct.item.id,
                    updatedData: {
                      name: editingProduct.item.name,
                      price: editingProduct.item.price,
                      ingredients: editingProduct.item.ingredients,
                      originalPrice: (editingProduct.item as any).originalPrice || undefined,
                      imageUrl: (editingProduct.item as any).imageUrl || null,
                      videoUrl: (editingProduct.item as any).videoUrl || null,
                      ncm: (editingProduct.item as any).ncm || undefined,
                      cfop: (editingProduct.item as any).cfop || '5102',
                      csosn: (editingProduct.item as any).csosn || '400',
                      cst: (editingProduct.item as any).cst || undefined,
                      unidade: (editingProduct.item as any).unidade || 'UN',
                      origem: (editingProduct.item as any).origem ?? '0',
                      pisCofinsCst: (editingProduct.item as any).pisCofinsCst || '07',
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
              className="bg-white w-full max-w-lg rounded-3xl p-8 space-y-6 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-serif italic text-2xl">Novo Produto</h3>
                  {newProductSubcategoryId && (
                    <p className="text-xs opacity-50 mt-0.5">
                      {newProductCategory} › {menu.find(c => c.name === newProductCategory)?.subcategories?.find(s => s.id === newProductSubcategoryId)?.name}
                    </p>
                  )}
                </div>
                <button onClick={() => setIsAddProductModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                <button onClick={() => setAddProductTab('geral')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${addProductTab==='geral' ? 'bg-white shadow text-[#141414]' : 'text-[#141414]/50'}`}>Geral</button>
                <button onClick={() => setAddProductTab('fiscal')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${addProductTab==='fiscal' ? 'bg-white shadow text-[#141414]' : 'text-[#141414]/50'}`}>Fiscal</button>
              </div>

              {addProductTab === 'geral' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Categoria</label>
                    <select
                      value={newProductCategory}
                      onChange={(e) => { setNewProductCategory(e.target.value); setNewProductSubcategoryId(null); }}
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] appearance-none cursor-pointer"
                    >
                      {menu.map(cat => (
                        <option key={cat.name} value={cat.name}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                  {(() => {
                    const subcats = menu.find(c => c.name === newProductCategory)?.subcategories || [];
                    if (subcats.length === 0) return null;
                    return (
                      <div>
                        <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Subcategoria</label>
                        <select
                          value={newProductSubcategoryId || ''}
                          onChange={(e) => setNewProductSubcategoryId(e.target.value || null)}
                          className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] appearance-none cursor-pointer"
                        >
                          <option value="">— Sem subcategoria —</option>
                          {subcats.map(sub => (
                            <option key={sub.id} value={sub.id}>{sub.name}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}
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
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414] h-28 resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Preço Original (opcional, para desconto)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={(newProductData as any).originalPrice || ''}
                      onChange={(e) => setNewProductData({ ...newProductData, originalPrice: parseFloat(e.target.value) || undefined } as any)}
                      placeholder="0.00 (deixe vazio se não houver desconto)"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">URL da Imagem</label>
                    <input
                      type="url"
                      value={(newProductData as any).imageUrl || ''}
                      onChange={(e) => setNewProductData({ ...newProductData, imageUrl: e.target.value } as any)}
                      placeholder="https://exemplo.com/foto.jpg"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">URL do Vídeo (opcional)</label>
                    <input
                      type="url"
                      value={(newProductData as any).videoUrl || ''}
                      onChange={(e) => setNewProductData({ ...newProductData, videoUrl: e.target.value } as any)}
                      placeholder="https://exemplo.com/video.mp4"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                    />
                  </div>
                </div>
              )}

              {addProductTab === 'fiscal' && (
                <div className="space-y-4">
                  <p className="text-[9px] opacity-40 leading-snug">Dados necessários para emissão de NFC-e / NF-e. Consulte seu contador para os códigos corretos.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">NCM</label>
                      <input
                        type="text"
                        maxLength={8}
                        value={(newProductData as any).ncm || ''}
                        onChange={(e) => setNewProductData({ ...newProductData, ncm: e.target.value } as any)}
                        placeholder="Ex: 21069090"
                        className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">CFOP</label>
                      <input
                        type="text"
                        maxLength={4}
                        value={(newProductData as any).cfop || '5102'}
                        onChange={(e) => setNewProductData({ ...newProductData, cfop: e.target.value } as any)}
                        placeholder="Ex: 5102"
                        className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">CSOSN (Simples Nacional)</label>
                    <select
                      value={(newProductData as any).csosn || '400'}
                      onChange={(e) => setNewProductData({ ...newProductData, csosn: e.target.value } as any)}
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm appearance-none cursor-pointer"
                    >
                      <option value="400">400 - Tributada pelo Simples Nacional</option>
                      <option value="102">102 - Tributada sem permissão de crédito</option>
                      <option value="500">500 - Com crédito de ICMS</option>
                      <option value="900">900 - Outros</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">CST (Regime Normal)</label>
                    <input
                      type="text"
                      maxLength={3}
                      value={(newProductData as any).cst || ''}
                      onChange={(e) => setNewProductData({ ...newProductData, cst: e.target.value } as any)}
                      placeholder="Ex: 00"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Unidade</label>
                      <select
                        value={(newProductData as any).unidade || 'UN'}
                        onChange={(e) => setNewProductData({ ...newProductData, unidade: e.target.value } as any)}
                        className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm appearance-none cursor-pointer"
                      >
                        {['UN','KG','L','CX','PCT','DZ'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">PIS/COFINS CST</label>
                      <select
                        value={(newProductData as any).pisCofinsCst || '07'}
                        onChange={(e) => setNewProductData({ ...newProductData, pisCofinsCst: e.target.value } as any)}
                        className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm appearance-none cursor-pointer"
                      >
                        <option value="07">07 - Isenta</option>
                        <option value="49">49 - Outras saídas</option>
                        <option value="99">99 - Outras operações</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Origem</label>
                    <select
                      value={(newProductData as any).origem ?? '0'}
                      onChange={(e) => setNewProductData({ ...newProductData, origem: e.target.value } as any)}
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-3 font-bold outline-none focus:border-[#141414] text-sm appearance-none cursor-pointer"
                    >
                      <option value="0">0 - Nacional</option>
                      <option value="1">1 - Estrangeira (importação direta)</option>
                      <option value="2">2 - Estrangeira (adquirida no mercado interno)</option>
                    </select>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  if (!newProductData.name || !newProductData.price) {
                    toast.error('Por favor, preencha o nome e o preço.');
                    return;
                  }
                  socket.emit('add_product', {
                    categoryName: newProductCategory,
                    subcategoryId: newProductSubcategoryId || undefined,
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

        {/* Add Subcategory Modal */}
        {isAddSubcategoryModalOpen && (
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
                  <h3 className="font-serif italic text-2xl">Nova Subcategoria</h3>
                  <p className="text-xs opacity-50 mt-0.5">Categoria: {newSubcategoryData.categoryName}</p>
                </div>
                <button onClick={() => setIsAddSubcategoryModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={24} /></button>
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Nome da Subcategoria</label>
                <input
                  type="text"
                  placeholder="Ex: Mini, Refrigerantes..."
                  value={newSubcategoryData.name}
                  onChange={(e) => setNewSubcategoryData({ ...newSubcategoryData, name: e.target.value })}
                  className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setIsAddSubcategoryModalOpen(false)} className="flex-1 bg-gray-100 p-4 rounded-xl font-bold hover:bg-gray-200">Cancelar</button>
                <button
                  onClick={() => {
                    if (!newSubcategoryData.name) return toast.error('Nome obrigatório');
                    socket.emit('add_subcategory', { categoryName: newSubcategoryData.categoryName, subcategoryData: { name: newSubcategoryData.name } });
                    setNewSubcategoryData({ categoryName: '', name: '' });
                    setIsAddSubcategoryModalOpen(false);
                    toast.success('Subcategoria adicionada!');
                  }}
                  className="flex-1 bg-[#141414] text-[#E4E3E0] p-4 rounded-xl font-bold hover:opacity-90"
                >
                  Confirmar
                </button>
              </div>
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
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Valor adicional <span className="normal-case font-normal">(opcional — deixe 0 se não cobrar a mais)</span></label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold opacity-40">R$</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={editingFlavor.price || ''}
                      onChange={(e) => setEditingFlavor({ ...editingFlavor, price: parseFloat(e.target.value) || 0 })}
                      placeholder="0,00"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 pl-10 font-bold outline-none focus:border-[#141414]"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  socket.emit('update_pizza_flavor', {
                    flavorName: editingFlavor.name,
                    updatedData: {
                      name: editingFlavor.name,
                      ingredients: editingFlavor.ingredients,
                      price: editingFlavor.price || 0,
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
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Valor adicional <span className="normal-case font-normal">(opcional — deixe 0 se não cobrar a mais)</span></label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold opacity-40">R$</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={newFlavorData.price || ''}
                      onChange={(e) => setNewFlavorData({ ...newFlavorData, price: parseFloat(e.target.value) || 0 })}
                      placeholder="0,00"
                      className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 pl-10 font-bold outline-none focus:border-[#141414]"
                    />
                  </div>
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
                      <div className="flex items-center gap-3">
                        <p className="font-bold">{cat.name}</p>
                        {!(cat.visible ?? true) && <span className="text-[10px] text-red-500 font-bold uppercase bg-red-50 px-2 py-0.5 rounded-full">Oculto</span>}
                      </div>
                      <div className="flex space-x-2">
                        <button onClick={() => socket.emit('toggle_category_visibility', { categoryName: cat.name, visible: !(cat.visible ?? true) })} className="p-2 hover:bg-gray-100 rounded-lg">
                          {(cat.visible ?? true) ? <Eye size={18} /> : <EyeOff size={18} className="text-red-400" />}
                        </button>
                        <button
                          onClick={() => setEditingCategory({ oldName: cat.name, name: cat.name, visible: cat.visible ?? true })}
                          className="p-2 hover:bg-gray-100 rounded-lg text-blue-500"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Excluir "${cat.name}"?`)) { socket.emit('delete_category', cat.name); toast.success('Categoria excluída!'); }}}
                          className="p-2 hover:bg-gray-100 rounded-lg text-red-500"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
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

                        const _showObs = printerConfig.showItemObs !== false;
                        const _showRemoved = printerConfig.showRemovedItems !== false;
                        const _showWaiterItem = printerConfig.showWaiter;
                        const _showDateTime = printerConfig.showDateTime !== false;
                        const _showPayments = printerConfig.showPaymentMethods !== false;
                        const _boldW = printerConfig.boldItems ? '700' : '400';

                        const itemsHtml = activeItems.map((i: any) => {
                          const price = calcPrice(i);
                          const obs = (_showObs && i.observations) ? `<div style="font-size:10px;color:#666;margin-top:1px">Obs: ${i.observations}</div>` : '';
                          const waiter = (_showWaiterItem && i.waiterName) ? `<span style="font-size:9px;background:#f0f0f0;padding:1px 5px;border-radius:3px">${i.waiterName}</span>` : '';
                          return `<tr>
                            <td style="padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top">
                              <div style="font-weight:${_boldW}">${i.quantity || 1}× ${i.name}</div>
                              ${i.flavors?.length ? `<div style="font-size:10px;color:#888">${i.flavors.join(', ')}</div>` : ''}
                              ${obs}
                              ${waiter}
                            </td>
                            <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:700;vertical-align:top;white-space:nowrap">R$ ${price.toFixed(2)}</td>
                          </tr>`;
                        }).join('');

                        const removedHtml = (_showRemoved && removedItems.length > 0)
                          ? `<tr><td colspan="2" style="padding:6px 8px 2px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#dc2626;background:#fff5f5">Itens Removidos</td></tr>` +
                            removedItems.map((i: any) => `<tr style="opacity:.5"><td style="padding:4px 8px;border-bottom:1px dashed #eee;text-decoration:line-through;font-size:11px">${i.quantity || 1}× ${i.name}${i.removalReason ? ` — ${i.removalReason}` : ''}</td><td style="padding:4px 8px;border-bottom:1px dashed #eee;text-align:right;font-family:monospace;font-size:11px;text-decoration:line-through;white-space:nowrap">R$ ${Number(i.price || 0).toFixed(2)}</td></tr>`).join('')
                          : '';

                        const discountHtml = activeOrder.discount > 0
                          ? `<tr><td style="padding:5px 8px;color:#d97706;font-size:11px">Desconto</td><td style="padding:5px 8px;text-align:right;font-family:monospace;color:#d97706;font-size:11px;white-space:nowrap">-${activeOrder.discountType === 'percentage' ? `${activeOrder.discount}%` : `R$ ${Number(activeOrder.discount).toFixed(2)}`}</td></tr>`
                          : '';

                        const methodColors: Record<string, string> = { 'Dinheiro': '#16a34a', 'PIX': '#2563eb', 'Crédito': '#7c3aed', 'Débito': '#ea580c' };
                        const paymentsHtml = _showPayments ? (activeOrder.paymentLog || []).map((p: any) => {
                          const color = methodColors[p.method] || '#555';
                          const payer = p.payer ? ` — ${p.payer}` : '';
                          const partial = p.type === 'partial' ? ` <span style="font-size:8px;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:3px;font-weight:700">PARCIAL</span>` : '';
                          return `<tr>
                            <td style="padding:5px 8px;border-bottom:1px solid #eee">
                              <span style="color:${color};font-weight:700">${p.method}</span>${partial}${payer ? `<span style="font-size:10px;color:#888">${payer}</span>` : ''}
                            </td>
                            <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:700;color:${color};white-space:nowrap">R$ ${Number(p.amount).toFixed(2)}</td>
                          </tr>`;
                        }).join('') : '';

                        const _rcptPw = (printerConfig.paperWidth || '80mm') === '50mm' ? '192px' : '304px';
                        const _rcptFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '11px' : '13px';
                        const _rcptHdFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '13px' : '15px';
                        const _rcptTotalFs = (printerConfig.paperWidth || '80mm') === '50mm' ? '13px' : '16px';
                        const _copies = printerConfig.printCopies || 1;
                        const _title = printerConfig.receiptTitle || 'COMPROVANTE';

                        const printOnePage = () => {
                          const w = window.open('', '_blank');
                          if (w) {
                            w.document.write(`<html><head><title>${_title} — ${tableLabel}</title><style>
                              *{box-sizing:border-box}
                              body{font-family:sans-serif;padding:12px;max-width:${_rcptPw};margin:0 auto;color:#141414;font-size:${_rcptFs}}
                              .center{text-align:center}
                              .sep{border-top:1px dashed #ccc;margin:8px 0}
                              table{width:100%;border-collapse:collapse}
                              @media print{body{padding:6px;max-width:100%}}
                            </style></head><body>
                              <div class="center" style="margin-bottom:10px">
                                <div style="font-weight:900;font-size:${_rcptHdFs};text-transform:uppercase">${printerConfig.establishmentName || ''}</div>
                                ${printerConfig.receiptHeader ? `<div style="font-size:10px;color:#555;font-style:italic">${printerConfig.receiptHeader}</div>` : ''}
                                ${printerConfig.address ? `<div style="font-size:9px;color:#666">${printerConfig.address}</div>` : ''}
                                ${printerConfig.phone ? `<div style="font-size:9px;color:#666">Tel: ${printerConfig.phone}</div>` : ''}
                                ${printerConfig.cnpj ? `<div style="font-size:9px;color:#666">CNPJ: ${printerConfig.cnpj}</div>` : ''}
                                <div style="margin-top:6px;font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;border:1px solid #ccc;display:inline-block;padding:2px 10px;border-radius:3px">${_title}</div>
                              </div>
                              <div class="sep"></div>
                              <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                                <span style="font-weight:700;font-size:${_rcptHdFs}">${tableLabel}</span>
                                ${printerConfig.showWaiter ? `<span style="font-size:9px;color:#666">Garçom: ${waiterName}</span>` : ''}
                              </div>
                              ${_showDateTime ? `<div style="font-size:9px;color:#888;margin-bottom:2px">Abertura: ${openedAt}</div><div style="font-size:9px;color:#888;margin-bottom:10px">Fechamento: ${closedAt}</div>` : ''}
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
                              ${_showPayments ? `<table style="margin-bottom:10px">${paymentsHtml}</table>` : ''}
                              <div class="sep"></div>
                              <div class="center" style="font-size:9px;color:#999;margin-top:6px">${printerConfig.receiptFooter || ''}</div>
                              <script>window.onload=()=>{window.print();window.close()}</script>
                            </body></html>`);
                            w.document.close();
                          }
                        };
                        for (let _c = 0; _c < _copies; _c++) {
                          setTimeout(() => printOnePage(), _c * 600);
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

              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 mb-1 block">Nome da Categoria</label>
                <input
                  type="text"
                  placeholder="Ex: Porções, Sobremesas..."
                  value={newCategoryData.name}
                  onChange={(e) => setNewCategoryData(d => ({ ...d, name: e.target.value }))}
                  className="w-full bg-gray-50 border border-[#141414]/10 rounded-xl p-4 font-bold outline-none focus:border-[#141414]"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 mb-2 block">Tipo de Categoria</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'lanches',  label: 'Lanche',       icon: <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14c0-1.1.9-2 2-2h12a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1z"/><path d="M6 12c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M4 16h16"/><path d="M6 18h12a1 1 0 0 1 1 1v.5H5V19a1 1 0 0 1 1-1z"/><path d="M9 10h.01M12 9h.01M15 10h.01"/><path d="M7 12c.5-.8 1.5-1.5 3-1.5s2.5.7 3 1.5 1.5 1.5 3 1.5"/></svg> },
                    { key: 'pizzas',   label: 'Pizza',        icon: <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><path d="M5.6 5.6 18.4 18.4M18.4 5.6 5.6 18.4"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1.3"/><circle cx="8" cy="16" r="1.3"/><circle cx="16" cy="16" r="1"/></svg> },
                    { key: 'porcoes',  label: 'Porção',       icon: <Salad size={16} /> },
                    { key: 'lacarte',  label: 'À la carte',   icon: <Soup size={16} /> },
                    { key: 'bebidas',  label: 'Bebida',       icon: <Beer size={16} /> },
                  ] as { key: string; label: string; icon: React.ReactNode }[]).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setNewCategoryData(d => ({ ...d, type: opt.key }))}
                      className={`flex items-center gap-2 p-3 rounded-xl border-2 font-bold text-sm transition-all ${newCategoryData.type === opt.key ? 'border-[#141414] bg-[#141414] text-white' : 'border-[#141414]/10 bg-gray-50 text-[#141414] hover:border-[#141414]/30'}`}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
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
                    socket.emit('add_category', { name: newCategoryData.name, type: newCategoryData.type });
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

      {/* Modal: QR Code da Mesa */}
      {qrMesaModal && (() => {
        const num = qrMesaModal.num;
        const baseUrl = window.location.origin;
        const url = `${baseUrl}/mesa/${tenantId}/${num}`;
        const printUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
        return (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setQrMesaModal(null); }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden">
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[#141414]/10">
                <div className="flex items-center gap-2">
                  <QrCode size={14} className="text-[#141414]" />
                  <h2 className="font-serif italic text-base">QR Code — Mesa {num}</h2>
                </div>
                <button onClick={() => setQrMesaModal(null)} className="p-1 rounded-lg text-[#141414]/30 hover:text-[#141414] hover:bg-[#141414]/10 transition-colors"><X size={14} /></button>
              </div>
              <div className="px-5 py-6 flex flex-col items-center gap-4">
                <div className="p-3 bg-white border-2 border-[#141414]/10 rounded-2xl shadow-inner">
                  <QRCodeSVG value={url} size={160} fgColor="#141414" bgColor="#ffffff" includeMargin />
                </div>
                <div className="text-center">
                  <p className="font-bold text-sm">Mesa {num}</p>
                  <p className="text-[9px] opacity-40 font-mono break-all mt-0.5">{url}</p>
                </div>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = printUrl;
                      a.download = `qr-mesa-${num}.png`;
                      a.click();
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-[#141414]/15 text-[#141414] text-[10px] font-bold uppercase hover:bg-[#141414]/5 transition-colors"
                  >
                    <Download size={11} /> Baixar
                  </button>
                  <button
                    onClick={() => {
                      const w = window.open('', '_blank');
                      if (w) {
                        w.document.write(`<html><head><title>QR Mesa ${num}</title><style>*{box-sizing:border-box}body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fff}.card{border:2px solid #141414;border-radius:20px;padding:28px 24px;text-align:center}h2{font-size:20px;margin:14px 0 4px;font-weight:700}p{font-size:12px;opacity:.4;margin:0}@media print{body{margin:0}.card{border-color:#000}}</style></head><body><div class="card"><img src="${printUrl}" width="180" height="180"/><h2>Mesa ${num}</h2><p>Escaneie para acessar o menu</p></div><script>window.onload=()=>{window.focus();window.print()}<\/script></body></html>`);
                        w.document.close();
                      }
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase hover:opacity-80 transition-opacity"
                  >
                    <Printer size={11} /> Imprimir
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Popup: Alerta de estoque mínimo */}
      {stockLowAlerts.length > 0 && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border-b border-amber-200">
              <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <p className="font-bold text-sm text-amber-800">Estoque mínimo atingido</p>
                <p className="text-xs text-amber-600">{stockLowAlerts.length} item{stockLowAlerts.length > 1 ? 'ns' : ''} abaixo do mínimo</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-2 max-h-64 overflow-y-auto">
              {stockLowAlerts.map((alert, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-100">
                  <p className="text-sm font-bold text-[#141414]">{alert.name}</p>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-base font-black text-amber-600">{alert.quantity} un.</p>
                    <p className="text-[10px] text-[#141414]/40">mín. {alert.minQuantity}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-[#141414]/10">
              <button
                onClick={() => setStockLowAlerts([])}
                className="w-full py-3 rounded-xl bg-[#141414] text-[#E4E3E0] font-bold text-sm hover:opacity-80 transition-opacity"
              >
                OK — Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup: Confirmar transferência de mesa/comanda (drag & drop) */}
      {transferPopup !== null && (() => {
        const isCmd = !!transferPopup.isComanda;
        const label = isCmd ? 'Comanda' : 'Mesa';
        const srcOrder = orders.find((o: any) => {
          if (isCmd) {
            const cmd = comandas.find((c: any) => String(c.id) === String(transferPopup.source));
            return cmd?.currentOrder && String(o.id) === String(cmd.currentOrder);
          }
          const tbl = tables.find((t: any) => String(t.id) === String(transferPopup.source));
          return tbl?.currentOrder && String(o.id) === String(tbl.currentOrder);
        });
        const transferableItems = (srcOrder?.items || []).filter((i: any) => !i.removed && !i.paid);
        const selectedCount = Object.values(dragSelectedIds).filter(Boolean).length;

        const doTransfer = () => {
          if (dragTransferMode === 'all') {
            socket.emit('transfer_table', { sourceTableId: transferPopup.source, targetTableId: transferPopup.target, isComanda: isCmd, reason: `Transferência de ${label.toLowerCase()}` });
          } else {
            const ids = Object.entries(dragSelectedIds).filter(([,v]) => v).map(([k]) => k);
            if (ids.length === 0) return;
            socket.emit('transfer_items', { sourceTableId: transferPopup.source, targetTableId: transferPopup.target, isComanda: isCmd, itemIds: ids });
          }
          setTransferPopup(null);
        };

        return (
          <div className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#141414]/10">
                <div>
                  <h2 className="font-bold text-base text-[#141414]">Transferir {label}</h2>
                  <p className="text-xs text-[#141414]/50 mt-0.5">
                    {label} <strong>{transferPopup.source}</strong> → {label} <strong>{transferPopup.target}</strong>
                  </p>
                </div>
                <button onClick={() => setTransferPopup(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#141414]/5 transition-colors text-[#141414]/40 hover:text-[#141414]">
                  <X size={16} />
                </button>
              </div>

              {/* Mode toggle */}
              <div className="px-5 pt-4">
                <div className="flex rounded-xl border border-[#141414]/10 overflow-hidden text-xs font-bold">
                  <button
                    onClick={() => setDragTransferMode('all')}
                    className={`flex-1 py-2 transition-colors ${dragTransferMode === 'all' ? 'bg-[#141414] text-white' : 'bg-white text-[#141414]/50 hover:text-[#141414]'}`}
                  >
                    Toda a mesa
                  </button>
                  <button
                    onClick={() => setDragTransferMode('items')}
                    className={`flex-1 py-2 transition-colors ${dragTransferMode === 'items' ? 'bg-[#141414] text-white' : 'bg-white text-[#141414]/50 hover:text-[#141414]'}`}
                  >
                    Itens específicos
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {dragTransferMode === 'all' ? (
                  <div className="text-center py-4">
                    <div className="w-14 h-14 rounded-2xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center mx-auto mb-3">
                      <svg viewBox="0 0 24 24" className="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </div>
                    <p className="text-sm text-[#141414]/60">
                      Todos os <strong>{transferableItems.length} itens</strong> em aberto da {label} <strong>{transferPopup.source}</strong> serão movidos para a {label} <strong>{transferPopup.target}</strong>.
                    </p>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const allSel = transferableItems.every((i: any) => dragSelectedIds[i.id]);
                        const next: Record<string, boolean> = {};
                        if (!allSel) transferableItems.forEach((i: any) => { next[i.id] = true; });
                        setDragSelectedIds(next);
                      }}
                      className="text-xs font-bold text-[#141414]/50 hover:text-[#141414] transition-colors"
                    >
                      {transferableItems.every((i: any) => dragSelectedIds[i.id]) ? 'Desmarcar tudo' : 'Marcar tudo'}
                    </button>
                    {transferableItems.map((item: any) => (
                      <label key={item.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${dragSelectedIds[item.id] ? 'border-[#141414] bg-[#141414]/5' : 'border-[#141414]/10 hover:bg-gray-50'}`}>
                        <input
                          type="checkbox"
                          checked={!!dragSelectedIds[item.id]}
                          onChange={() => setDragSelectedIds(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                          className="rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">{item.name}</p>
                          <p className="text-xs text-[#141414]/50">R$ {Number(item.price).toFixed(2).replace('.', ',')}</p>
                        </div>
                      </label>
                    ))}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex gap-3 px-5 py-4 border-t border-[#141414]/10">
                <button
                  onClick={() => setTransferPopup(null)}
                  className="flex-1 py-3 rounded-xl border border-[#141414]/20 text-[#141414]/60 font-bold text-sm hover:opacity-80 transition-opacity"
                >
                  Cancelar
                </button>
                <button
                  onClick={doTransfer}
                  disabled={dragTransferMode === 'items' && selectedCount === 0}
                  className="flex-1 py-3 rounded-xl bg-[#141414] text-[#E4E3E0] font-bold text-sm hover:opacity-80 transition-opacity disabled:opacity-40"
                >
                  {dragTransferMode === 'items' ? `Mover ${selectedCount} item${selectedCount !== 1 ? 's' : ''}` : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Popup: Mesa chamando garçom */}
      {callingTablePopup !== null && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden">
            <div className="flex flex-col items-center px-6 py-8 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-orange-50 border-2 border-orange-200 flex items-center justify-center">
                <BellRing size={32} className="text-orange-500 animate-bounce" />
              </div>
              <div>
                <h2 className="font-serif italic text-2xl text-[#141414]">Mesa {callingTablePopup} Chamando</h2>
                <p className="text-xs text-[#141414]/50 mt-1">O cliente solicitou atendimento</p>
              </div>
              <button
                onClick={() => { if (callingAudioRef.current) { callingAudioRef.current.pause(); callingAudioRef.current = null; } setCallingTablePopup(prev => { setCallingTables(s => { const ns = new Set(s); ns.delete(prev!); return ns; }); return null; }); }}
                className="w-full py-3 rounded-xl bg-[#141414] text-[#E4E3E0] font-bold text-sm hover:opacity-80 transition-opacity"
              >
                OK — Já vou atender
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Chama Garçom — gerador de QR Code */}
      {callWaiterModal && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/50"
          onClick={e => { if (e.target === e.currentTarget) setCallWaiterModal(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[#141414]/10">
              <div className="flex items-center gap-2">
                <BellRing size={14} className="text-orange-500" />
                <h2 className="font-serif italic text-base">Chama Garçom</h2>
              </div>
              <button onClick={() => setCallWaiterModal(false)} className="p-1 rounded-lg text-[#141414]/30 hover:text-[#141414] hover:bg-[#141414]/10 transition-colors">
                <X size={14} />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Número da Mesa</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={callWaiterTable}
                    onChange={e => setCallWaiterTable(Math.max(1, Number(e.target.value)))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#141414]/20 text-sm font-bold text-center focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Intervalo mínimo (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={callWaiterRateLimit}
                    onChange={e => setCallWaiterRateLimit(Math.max(1, Number(e.target.value)))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#141414]/20 text-sm font-bold text-center focus:outline-none focus:border-orange-400"
                  />
                </div>
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="p-3 bg-white rounded-xl border border-[#141414]/10 shadow-sm">
                  <QRCodeSVG value={callWaiterUrl} size={160} includeMargin />
                </div>
                <p className="text-[9px] text-center opacity-40 break-all px-2">{callWaiterUrl}</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { navigator.clipboard.writeText(callWaiterUrl); toast.success('Link copiado!'); }}
                  className="flex-1 py-2 rounded-xl border border-[#141414]/20 text-[10px] font-bold uppercase hover:bg-[#141414]/5 transition-colors"
                >
                  Copiar link
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex-1 py-2 rounded-xl bg-[#141414] text-white text-[10px] font-bold uppercase hover:opacity-80 transition-opacity"
                >
                  Imprimir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isCrustModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-[#E4E3E0] rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-4">{editingCrustOriginal ? 'Editar Borda' : 'Nova Borda'}</h3>
            <input
              type="text"
              value={editingCrustOriginal ? editingCrustName : newCrustName}
              onChange={e => editingCrustOriginal ? setEditingCrustName(e.target.value) : setNewCrustName(e.target.value)}
              placeholder="Nome da borda (ex: Catupiry)"
              className="w-full border border-[#141414]/20 rounded-xl px-4 py-3 mb-4 bg-white text-sm"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setIsCrustModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-[#141414]/20 text-sm font-bold">Cancelar</button>
              <button
                onClick={() => {
                  const val = editingCrustOriginal ? editingCrustName.trim() : newCrustName.trim();
                  if (!val) return;
                  if (editingCrustOriginal) {
                    socket.emit('update_pizza_crust', { oldName: editingCrustOriginal, newName: val });
                    toast.success('Borda atualizada!');
                  } else {
                    socket.emit('add_pizza_crust', val);
                    toast.success('Borda adicionada!');
                  }
                  setIsCrustModalOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#141414] text-[#E4E3E0] text-sm font-bold"
              >Salvar</button>
            </div>
          </div>
        </div>
      )}

      {isSizeModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-[#E4E3E0] rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-4">{editingSize ? 'Editar Tamanho' : 'Novo Tamanho'}</h3>
            <div className="space-y-3 mb-4">
              <input type="text" value={sizeForm.name} onChange={e => setSizeForm(f => ({...f, name: e.target.value}))} placeholder="Nome (ex: Grande)" className="w-full border border-[#141414]/20 rounded-xl px-4 py-3 bg-white text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" value={sizeForm.slices} onChange={e => setSizeForm(f => ({...f, slices: +e.target.value}))} placeholder="Fatias" className="border border-[#141414]/20 rounded-xl px-4 py-3 bg-white text-sm" />
                <input type="number" value={sizeForm.maxFlavors} onChange={e => setSizeForm(f => ({...f, maxFlavors: +e.target.value}))} placeholder="Máx. sabores" className="border border-[#141414]/20 rounded-xl px-4 py-3 bg-white text-sm" />
              </div>
              <input type="text" value={sizeForm.dim} onChange={e => setSizeForm(f => ({...f, dim: e.target.value}))} placeholder="Dimensão (ex: 35cm)" className="w-full border border-[#141414]/20 rounded-xl px-4 py-3 bg-white text-sm" />
              <input type="text" value={sizeForm.people} onChange={e => setSizeForm(f => ({...f, people: e.target.value}))} placeholder="Pessoas (ex: 3-4 pessoas)" className="w-full border border-[#141414]/20 rounded-xl px-4 py-3 bg-white text-sm" />
              <input type="text" value={sizeForm.detail} onChange={e => setSizeForm(f => ({...f, detail: e.target.value}))} placeholder="Detalhe (ex: até 4 sabores)" className="w-full border border-[#141414]/20 rounded-xl px-4 py-3 bg-white text-sm" />
              <input type="number" value={sizeForm.basePrice} onChange={e => setSizeForm(f => ({...f, basePrice: +e.target.value}))} placeholder="Preço base (R$)" className="w-full border border-[#141414]/20 rounded-xl px-4 py-3 bg-white text-sm" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setIsSizeModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-[#141414]/20 text-sm font-bold">Cancelar</button>
              <button
                onClick={() => {
                  if (!sizeForm.name.trim()) return;
                  if (editingSize) {
                    socket.emit('update_pizza_size', { index: editingSizeIndex, updatedData: sizeForm });
                    toast.success('Tamanho atualizado!');
                  } else {
                    socket.emit('add_pizza_size', sizeForm);
                    toast.success('Tamanho adicionado!');
                  }
                  setIsSizeModalOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#141414] text-[#E4E3E0] text-sm font-bold"
              >Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal NFC-e */}
      <AnimatePresence>
        {nfceModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget && !nfceEmitting) { setNfceModal(null); setNfceResult(null); setNfceContingenciaMode('normal'); setNfceDhCont(''); setNfceXJust(''); } }}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className={`${nfceContingenciaMode === 'normal' ? 'bg-blue-600' : 'bg-amber-600'} p-4 flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  <FileText className="text-white" size={16} />
                  <h2 className="text-white font-bold text-sm">{nfceContingenciaMode === 'normal' ? 'Emitir NFC-e' : nfceContingenciaMode === 'offline' ? 'NFC-e Offline' : nfceContingenciaMode === 'epec' ? 'NF-e EPEC' : 'NF-e SVC-RS'}</h2>
                </div>
                <button onClick={() => { if (!nfceEmitting) { setNfceModal(null); setNfceResult(null); setNfceContingenciaMode('normal'); setNfceDhCont(''); setNfceXJust(''); } }} className="text-white/70 hover:text-white p-1"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-3">
                {nfceResult ? (
                  <div className="space-y-3">
                    {(() => {
                      const ok = nfceResult.status === 'AUTORIZADO' || nfceResult.status === 'AUTORIZADO_COM_ALERTA';
                      const labels: Record<string, string> = {
                        AUTORIZADO: '✓ Autorizado pela SEFAZ!',
                        AUTORIZADO_COM_ALERTA: '✓ Autorizado com alerta',
                        REJEITADO: '✗ Rejeitado pela SEFAZ',
                        RESULTADO_DESCONHECIDO: '⚠ Em processamento — consulte pela chave',
                        RETORNO_NAO_CLASSIFICADO: '⚠ Retorno não classificado',
                        EPEC_AUTORIZADO: '✓ EPEC autorizado — NF-e pendente transmissão',
                        CONTINGENCIA_PENDENTE_TRANSMISSAO: '✓ Offline gerada — pendente transmissão',
                      };
                      return (
                        <>
                          <div className={`text-center py-2 rounded-lg font-bold text-sm ${ok ? 'bg-green-50 text-green-700' : nfceResult.status?.startsWith('AUTORIZADO') ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'}`}>
                            {labels[nfceResult.status] || nfceResult.status}
                          </div>
                          {nfceResult.cStat && (
                            <div className="bg-gray-50 rounded px-3 py-2 space-y-0.5">
                              <p className="text-[7px] font-bold uppercase text-[#141414]/40">Retorno SEFAZ</p>
                              <p className="text-[9px] font-mono text-[#141414]"><span className="font-bold">cStat {nfceResult.cStat}</span> — {nfceResult.xMotivo || '(sem motivo)'}</p>
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {nfceResult.chaveAcesso && <p className="text-[7px] font-mono text-[#141414]/50 break-all bg-gray-50 p-2 rounded">{nfceResult.chaveAcesso}</p>}
                    {nfceResult.qrCode && (
                      <div className="flex justify-center">
                        <QRCodeSVG value={nfceResult.qrCode} size={120} />
                      </div>
                    )}
                    {nfceResult.urlDanfe && <a href={nfceResult.urlDanfe} target="_blank" rel="noopener noreferrer" className="block text-center text-[9px] text-blue-600 underline">Abrir DANFE</a>}
                    <button onClick={() => { setNfceModal(null); setNfceResult(null); setNfceContingenciaMode('normal'); setNfceDhCont(''); setNfceXJust(''); }} className="w-full py-2 bg-[#141414] text-white rounded-lg text-[9px] font-bold uppercase">Fechar</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <p className="text-[8px] text-[#141414]/50 uppercase font-bold">Pedido #{nfceModal.orderId}</p>
                      <p className="text-lg font-bold text-[#141414]">R$ {nfceModal.total.toFixed(2)}</p>
                    </div>
                    <div>
                      <label className="text-[7px] font-bold uppercase text-[#141414]/50 block mb-1">Modo de Emissão</label>
                      <select value={nfceContingenciaMode} onChange={e => setNfceContingenciaMode(e.target.value as any)} className="w-full border border-[#141414]/15 rounded px-2 py-1.5 text-[9px] focus:outline-none">
                        <option value="normal">Normal (NFC-e)</option>
                        <option value="offline">Contingência Offline (NFC-e tpEmis=9)</option>
                        <option value="epec">Contingência EPEC (NF-e tpEmis=4)</option>
                        <option value="svcrs">Contingência SVC-RS (NF-e tpEmis=7)</option>
                      </select>
                    </div>
                    {nfceContingenciaMode === 'normal' && (
                      <>
                        <div>
                          <label className="text-[7px] font-bold uppercase text-[#141414]/50 block mb-1">CPF do Consumidor (opcional)</label>
                          <input value={nfceCpf} onChange={e => setNfceCpf(e.target.value)} placeholder="000.000.000-00" className="w-full border border-[#141414]/15 rounded px-2 py-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </div>
                        <div>
                          <label className="text-[7px] font-bold uppercase text-[#141414]/50 block mb-1">Forma de Pagamento</label>
                          <select value={nfcePagamento} onChange={e => setNfcePagamento(e.target.value as any)} className="w-full border border-[#141414]/15 rounded px-2 py-1.5 text-[9px] focus:outline-none">
                            <option value="dinheiro">Dinheiro</option>
                            <option value="cartao_credito">Cartão de Crédito</option>
                            <option value="cartao_debito">Cartão de Débito</option>
                            <option value="pix">PIX</option>
                            <option value="outros">Outros</option>
                          </select>
                        </div>
                      </>
                    )}
                    {nfceContingenciaMode !== 'normal' && (
                      <>
                        <div className="bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                          <p className="text-[7px] text-amber-700 font-bold uppercase">Modo contingência — {nfceContingenciaMode === 'offline' ? 'NFC-e gerada offline, transmitida ao SEFAZ automaticamente quando o serviço voltar.' : nfceContingenciaMode === 'epec' ? 'Evento EPEC enviado ao SVC-RS; NF-e re-transmitida ao SEFAZ-MT quando voltar.' : 'NF-e completa enviada ao SVC-RS para autorização imediata.'}</p>
                        </div>
                        <div>
                          <label className="text-[7px] font-bold uppercase text-[#141414]/50 block mb-1">Início da Contingência</label>
                          <input type="datetime-local" value={nfceDhCont} onChange={e => setNfceDhCont(e.target.value)} className="w-full border border-amber-300 rounded px-2 py-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
                        </div>
                        <div>
                          <label className="text-[7px] font-bold uppercase text-[#141414]/50 block mb-1">Justificativa (mín. 15 chars)</label>
                          <textarea value={nfceXJust} onChange={e => setNfceXJust(e.target.value)} rows={2} placeholder="Descreva o motivo da contingência..." className="w-full border border-amber-300 rounded px-2 py-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none" />
                          {nfceXJust.length > 0 && nfceXJust.length < 15 && <p className="text-[7px] text-red-500 mt-0.5">{15 - nfceXJust.length} caracteres restantes</p>}
                        </div>
                      </>
                    )}
                    <button
                      disabled={nfceEmitting}
                      onClick={async () => {
                        if (!tenantId) { toast.error('Faça login.'); return; }
                        if (nfceContingenciaMode !== 'normal') {
                          if (!nfceDhCont) { toast.error('Informe o início da contingência.'); return; }
                          if (nfceXJust.length < 15) { toast.error('Justificativa deve ter pelo menos 15 caracteres.'); return; }
                        }
                        setNfceEmitting(true);
                        try {
                          const orderId = nfceModal!.orderId;
                          let endpoint: string;
                          let body: object;
                          if (nfceContingenciaMode === 'normal') {
                            endpoint = `/api/fiscal/nfce/${orderId}`;
                            body = { tenantId, pagamento: nfcePagamento, cpfConsumidor: nfceCpf || undefined };
                          } else if (nfceContingenciaMode === 'offline') {
                            endpoint = `/api/fiscal/nfce-offline/${orderId}`;
                            body = { tenantId, dhCont: nfceDhCont, xJust: nfceXJust };
                          } else if (nfceContingenciaMode === 'epec') {
                            endpoint = `/api/fiscal/nfe-epec/${orderId}`;
                            body = { tenantId, dhCont: nfceDhCont, xJust: nfceXJust };
                          } else {
                            endpoint = `/api/fiscal/nfe-svcrs/${orderId}`;
                            body = { tenantId, dhCont: nfceDhCont, xJust: nfceXJust };
                          }
                          const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || data.detail || 'Erro ao emitir');
                          setNfceResult(data);
                          if (data.status === 'AUTORIZADO' || data.status === 'AUTORIZADO_COM_ALERTA') {
                            toast.success('Documento autorizado pela SEFAZ!');
                          } else if (data.status === 'EPEC_AUTORIZADO') {
                            toast.success('EPEC autorizado pelo SVC-RS!');
                          } else if (data.status === 'CONTINGENCIA_PENDENTE_TRANSMISSAO') {
                            toast.success('NFC-e offline gerada — pendente transmissão.');
                          } else {
                            toast.warning(`Transmissão — cStat ${data.cStat || '?'}: ${data.xMotivo || data.status}`);
                          }
                        } catch (e: any) { toast.error('Erro: ' + e.message); }
                        setNfceEmitting(false);
                      }}
                      className={`w-full py-2 ${nfceContingenciaMode === 'normal' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-600 hover:bg-amber-700'} text-white rounded-lg text-[9px] font-bold uppercase transition-colors disabled:opacity-50`}
                    >{nfceEmitting ? 'Emitindo...' : nfceContingenciaMode === 'normal' ? 'Emitir NFC-e' : nfceContingenciaMode === 'offline' ? 'Emitir Offline' : nfceContingenciaMode === 'epec' ? 'Emitir via EPEC' : 'Emitir via SVC-RS'}</button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Em aberto — barra full-width na base */}
      {activeTab === 'overview' && (() => {
        const openOrders = orders.filter((o: any) => o.status !== 'finalizada');
        const openTablesCount = tables.filter((t: any) => t.status !== 'free').length;
        const totalOpen = openOrders.reduce((acc: number, o: any) => acc + (o.items || []).filter((i: any) => !i.removed && !i.paid).reduce((s: number, i: any) => s + (i.price || 0), 0), 0);
        return (
          <div className="fixed bottom-0 left-0 right-0 z-40 select-none pointer-events-none">
            <div className="flex items-center justify-between bg-[#141414] px-4 py-3 gap-4">
              <div className="flex items-center gap-2">
                <Wallet size={14} className="text-white/50 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Em aberto</span>
              </div>
              <span className="text-[9px] font-mono text-white/20 hidden sm:block">PR #{LATEST_PR} · {__BUILD_TS__}</span>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <Users size={13} className="text-white/40 shrink-0" />
                  <span className="text-[11px] font-bold text-white/70">{openTablesCount} mesa{openTablesCount !== 1 ? 's' : ''}</span>
                </div>
                <span className="text-[15px] font-black text-white tracking-tight">R$ {totalOpen.toFixed(2).replace('.', ',')}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Badge de versão — dentro da barra inferior (visível apenas fora do overview) */}
      {activeTab !== 'overview' && (
        <div className="fixed bottom-2 left-2 z-50 select-none pointer-events-none">
          <span className="text-[10px] font-mono text-[#141414]/40 tracking-wide bg-white/60 px-1.5 py-0.5 rounded">
            PR #{LATEST_PR} · {__BUILD_TS__}
          </span>
        </div>
      )}
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
