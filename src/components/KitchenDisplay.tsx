import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Order, MenuCategory } from '../types';
import socket from '../lib/socket';
import { Clock, ChefHat, Pizza, Sandwich, CheckCircle2, Flame, BellRing, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { usePWA } from '../hooks/usePWA';
import {
  isKitchenTracked,
  resolveKitchenItemType,
  type ItemActionAck,
  type KitchenEvent,
} from '../lib/kitchenStatus';

interface KitchenDisplayProps {
  orders: Order[];
  menu: MenuCategory[];
  kdsEnabled?: boolean;
  canMutate?: () => boolean;
}

interface KitchenItem {
  orderId: string | number;
  itemId: string;
  tableId: string | number;
  isComanda: boolean;
  name: string;
  flavors: string[];
  ingredients: string;
  observations: string;
  crust?: string;
  quantity?: number;
  timestamp: string;
  type: 'pizzas' | 'lanches';
  kitchenStatus: 'waiting' | 'preparing' | 'oven' | 'ready';
}

const MAX_LARGE = 6;
const MAX_MINI = 4;
const ACK_TIMEOUT_MS = 8_000;

function getElapsed(timestamp: string, now: number) {
  const diff = Math.floor((now - new Date(timestamp).getTime()) / 1000);
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  return { text: `${mins}:${secs.toString().padStart(2, '0')}`, isLate: mins >= 15 };
}

function actionKey(orderId: string | number, itemId: string): string {
  return `${String(orderId)}:${itemId}`;
}

/* ─── Large card ─────────────────────────────────────────────────────────── */
const ItemCard = React.memo(({ item, now, onStart, onOven, onFinish, pendingAction, actionError }: {
  item: KitchenItem;
  now: number;
  onStart: (orderId: string | number, itemId: string) => void;
  onOven: (orderId: string | number, itemId: string) => void;
  onFinish: (orderId: string | number, itemId: string) => void;
  pendingAction?: KitchenEvent;
  actionError?: string;
}) => {
  const { text: timerText, isLate } = getElapsed(item.timestamp, now);
  const late = isLate && item.kitchenStatus !== 'ready';
  const isPizza = item.type === 'pizzas';
  const busy = Boolean(pendingAction);

  const cardBg =
    late ? 'bg-red-50 border-red-400'
      : item.kitchenStatus === 'ready' ? 'bg-green-50 border-green-400'
        : item.kitchenStatus === 'oven' ? 'bg-orange-50 border-orange-400'
          : item.kitchenStatus === 'preparing' ? 'bg-amber-50 border-amber-300'
            : 'bg-[#E4E3E0] border-transparent';

  const timerBg =
    late ? 'bg-red-600 text-white animate-pulse'
      : item.kitchenStatus === 'ready' ? 'bg-green-600 text-white animate-pulse'
        : item.kitchenStatus === 'oven' ? 'bg-orange-600 text-white animate-pulse'
          : item.kitchenStatus === 'preparing' ? 'bg-amber-500 text-white'
            : 'bg-[#141414]/15 text-[#141414]';

  const statusLabel =
    late ? '⚠ Atrasado'
      : item.kitchenStatus === 'ready' ? 'Pronto — Aguardando Garçom'
        : item.kitchenStatus === 'oven' ? 'No Forno'
          : item.kitchenStatus === 'preparing' ? 'Em Preparação'
            : 'Aguardando Preparo';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.88 }}
      className={`rounded-2xl border-2 flex flex-col overflow-hidden ${cardBg}`}
    >
      <div className={`flex items-center justify-between px-3 py-2 ${timerBg}`}>
        <span className="text-[10px] font-black uppercase tracking-widest">{statusLabel}</span>
        <div className="flex items-center gap-1 font-mono font-black text-base">
          <Clock size={12} />
          {timerText}
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1 min-h-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-bold opacity-50 leading-none">
            {item.isComanda ? 'Comanda' : 'Mesa'}
          </span>
          <span className="text-2xl font-black leading-none">{item.tableId}</span>
        </div>

        <div className="flex-1">
          <p className="font-black text-base leading-snug">
            {item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}
          </p>
          {item.observations && (
            <div className="mt-2 bg-blue-600 text-white px-2.5 py-1.5 rounded-lg">
              <p className="text-[10px] font-black uppercase tracking-wide opacity-70 mb-0.5">Obs</p>
              <p className="text-sm font-bold leading-snug">{item.observations}</p>
            </div>
          )}
        </div>

        {item.kitchenStatus === 'waiting' && (
          <button
            onClick={() => onStart(item.orderId, item.itemId)}
            disabled={busy}
            className="w-full py-3 rounded-xl bg-zinc-500 hover:bg-zinc-600 text-white font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all shrink-0 disabled:opacity-50 disabled:cursor-wait"
          >
            <ChefHat size={15} /> {pendingAction === 'kitchen_start_item' ? 'Aguardando confirmação...' : 'Preparar'}
          </button>
        )}
        {item.kitchenStatus === 'preparing' && isPizza && (
          <button
            onClick={() => onOven(item.orderId, item.itemId)}
            disabled={busy}
            className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all shrink-0 disabled:opacity-50 disabled:cursor-wait"
          >
            <Flame size={15} /> {pendingAction === 'kitchen_oven_item' ? 'Aguardando confirmação...' : 'Forno'}
          </button>
        )}
        {item.kitchenStatus === 'preparing' && !isPizza && (
          <button
            onClick={() => onFinish(item.orderId, item.itemId)}
            disabled={busy}
            className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all shrink-0 disabled:opacity-50 disabled:cursor-wait"
          >
            <CheckCircle2 size={15} /> {pendingAction === 'kitchen_finish_item' ? 'Aguardando confirmação...' : 'Pronto'}
          </button>
        )}
        {item.kitchenStatus === 'oven' && (
          <button
            onClick={() => onFinish(item.orderId, item.itemId)}
            disabled={busy}
            className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all shrink-0 disabled:opacity-50 disabled:cursor-wait"
          >
            <CheckCircle2 size={15} /> {pendingAction === 'kitchen_finish_item' ? 'Aguardando confirmação...' : 'Pronto'}
          </button>
        )}
        {item.kitchenStatus === 'ready' && (
          <div className="w-full py-3 rounded-xl bg-green-100 border-2 border-green-400 text-green-700 font-black text-sm flex items-center justify-center gap-2 shrink-0">
            <BellRing size={15} /> Aguardando Garçom
          </div>
        )}
        {actionError && (
          <p className="text-[10px] font-semibold text-red-700" role="alert">{actionError}</p>
        )}
      </div>
    </motion.div>
  );
});

/* ─── Mini card (queue) ──────────────────────────────────────────────────── */
const MiniCard = React.memo(({ item, now }: { item: KitchenItem; now: number }) => {
  const { text: timerText, isLate } = getElapsed(item.timestamp, now);
  const late = isLate && item.kitchenStatus !== 'ready';

  const bg =
    late ? 'bg-red-900/60 border-red-500'
      : item.kitchenStatus === 'ready' ? 'bg-green-900/60 border-green-500'
        : item.kitchenStatus === 'oven' ? 'bg-orange-900/60 border-orange-500'
          : item.kitchenStatus === 'preparing' ? 'bg-amber-900/60 border-amber-500'
            : 'bg-white/10 border-white/20';

  const statusLabel =
    item.kitchenStatus === 'ready' ? 'Pronto'
      : item.kitchenStatus === 'oven' ? 'No Forno'
        : item.kitchenStatus === 'preparing' ? 'Preparo'
          : 'Fila';

  const statusColor =
    item.kitchenStatus === 'ready' ? 'bg-green-600'
      : item.kitchenStatus === 'oven' ? 'bg-orange-600'
        : item.kitchenStatus === 'preparing' ? 'bg-amber-500'
          : 'bg-zinc-600';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85 }}
      className={`flex-1 min-w-0 rounded-xl border px-3 py-2.5 flex flex-col gap-1.5 ${bg}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-white font-black text-2xl leading-none">{item.tableId}</span>
        <span className="font-mono text-[10px] text-white/60 flex items-center gap-0.5">
          <Clock size={9} />{timerText}
        </span>
      </div>
      <p className="text-white font-black text-xs leading-snug line-clamp-2">{item.name}</p>
      <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded self-start text-white ${statusColor}`}>
        {statusLabel}
      </span>
    </motion.div>
  );
});

/* ─── Section ────────────────────────────────────────────────────────────── */
const Section = React.memo(({
  title, Icon, items, accentClass, now, onStart, onOven, onFinish, pendingActions, actionErrors,
}: {
  title: string;
  Icon: React.ElementType;
  items: KitchenItem[];
  accentClass: string;
  now: number;
  onStart: (orderId: string | number, itemId: string) => void;
  onOven: (orderId: string | number, itemId: string) => void;
  onFinish: (orderId: string | number, itemId: string) => void;
  pendingActions: Record<string, KitchenEvent>;
  actionErrors: Record<string, string>;
}) => {
  const largeItems = items.slice(0, MAX_LARGE);
  const queueItems = items.slice(MAX_LARGE);
  const visibleMini = queueItems.slice(0, MAX_MINI);
  const hiddenCount = Math.max(0, queueItems.length - MAX_MINI);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className={`px-5 py-3 flex items-center gap-3 shrink-0 ${accentClass}`}>
        <Icon className="text-white w-5 h-5" />
        <h2 className="font-serif italic text-xl text-white">{title}</h2>
        <div className="ml-auto flex items-center gap-2">
          {queueItems.length > 0 && (
            <span className="bg-white/30 text-white text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse">
              +{queueItems.length} na fila
            </span>
          )}
          <span className="bg-white/20 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            {items.length}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3 grid grid-cols-3 gap-3 content-start overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {largeItems.map(item => {
            const key = actionKey(item.orderId, item.itemId);
            return (
              <ItemCard
                key={item.itemId}
                item={item}
                now={now}
                onStart={onStart}
                onOven={onOven}
                onFinish={onFinish}
                pendingAction={pendingActions[key]}
                actionError={actionErrors[key]}
              />
            );
          })}
        </AnimatePresence>

        {items.length === 0 && (
          <div className="col-span-3 flex flex-col items-center justify-center py-20 text-white/15">
            <Icon size={48} className="mb-3 opacity-30" />
            <p className="font-serif italic text-lg">Sem itens pendentes</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {queueItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 px-3 pb-3 flex gap-2 overflow-hidden"
          >
            <AnimatePresence mode="popLayout">
              {visibleMini.map(item => <MiniCard key={item.itemId} item={item} now={now} />)}
            </AnimatePresence>
            {hiddenCount > 0 && (
              <div className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/5 flex items-center justify-center">
                <span className="text-white/50 font-black text-sm">+{hiddenCount}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/* ─── Root ───────────────────────────────────────────────────────────────── */
export default function KitchenDisplay({ orders, menu, kdsEnabled = true, canMutate }: KitchenDisplayProps) {
  const { canInstall, install } = usePWA('kds');
  const [now, setNow] = useState(Date.now());
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [pendingActions, setPendingActions] = useState<Record<string, KitchenEvent>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const actionTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => () => {
    for (const timeout of actionTimeoutsRef.current.values()) clearTimeout(timeout);
    actionTimeoutsRef.current.clear();
  }, []);

  const offline = !socketConnected || !browserOnline;

  const emitKitchenAction = useCallback((event: KitchenEvent, orderId: string | number, itemId: string) => {
    const key = actionKey(orderId, itemId);
    if (pendingActions[key]) return;
    if (!kdsEnabled) {
      setActionErrors(previous => ({ ...previous, [key]: 'O Modo KDS está desativado neste estabelecimento.' }));
      return;
    }
    if (offline || (canMutate && !canMutate())) {
      setActionErrors(previous => ({ ...previous, [key]: 'Sem conexão autorizada com o servidor. A alteração não foi enviada.' }));
      return;
    }

    setPendingActions(previous => ({ ...previous, [key]: event }));
    setActionErrors(previous => {
      const next = { ...previous };
      delete next[key];
      return next;
    });

    let settled = false;
    const settle = (ack?: ItemActionAck) => {
      if (settled) return;
      settled = true;
      const timeout = actionTimeoutsRef.current.get(key);
      if (timeout) clearTimeout(timeout);
      actionTimeoutsRef.current.delete(key);
      setPendingActions(previous => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      if (!ack?.ok) {
        setActionErrors(previous => ({
          ...previous,
          [key]: ack?.message || 'O servidor não confirmou esta alteração.',
        }));
      }
    };

    socket.emit(event, { orderId, itemId }, settle);
    actionTimeoutsRef.current.set(key, setTimeout(() => {
      settle({ ok: false, message: 'O servidor não respondeu. A etapa continua pendente.' });
    }, ACK_TIMEOUT_MS));
  }, [canMutate, kdsEnabled, offline, pendingActions]);

  const startItem = useCallback((orderId: string | number, itemId: string) => {
    emitKitchenAction('kitchen_start_item', orderId, itemId);
  }, [emitKitchenAction]);

  const ovenItem = useCallback((orderId: string | number, itemId: string) => {
    emitKitchenAction('kitchen_oven_item', orderId, itemId);
  }, [emitKitchenAction]);

  const finishItem = useCallback((orderId: string | number, itemId: string) => {
    emitKitchenAction('kitchen_finish_item', orderId, itemId);
  }, [emitKitchenAction]);

  const kitchenItems: KitchenItem[] = [];
  if (kdsEnabled) {
    for (const order of orders) {
      if (order.status === 'finalizada' || (order as any).status === 'final') continue;
      for (const item of (order.items || [])) {
        if (item.removed || item.deliveredAt) continue;
        const effectiveType = resolveKitchenItemType(item, menu);
        if (!isKitchenTracked(item, menu) || (effectiveType !== 'pizzas' && effectiveType !== 'lanches')) continue;
        kitchenItems.push({
          orderId: order.id,
          itemId: item.id,
          tableId: order.tableId,
          isComanda: (order as any).isComanda ?? false,
          name: item.name,
          flavors: item.flavors || [],
          ingredients: (item as any).ingredients || '',
          observations: item.observations || '',
          crust: (item as any).crust,
          quantity: item.quantity,
          timestamp: item.timestamp || order.timestamp,
          type: effectiveType,
          kitchenStatus: (item as any).kitchenStatus || 'waiting',
        });
      }
    }
  }

  kitchenItems.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const pizzaItems = kitchenItems.filter(i => i.type === 'pizzas');
  const lancheItems = kitchenItems.filter(i => i.type === 'lanches');
  const waitingCount = kitchenItems.filter(i => i.kitchenStatus === 'waiting').length;
  const preparingCount = kitchenItems.filter(i => i.kitchenStatus === 'preparing' || i.kitchenStatus === 'oven').length;
  const readyCount = kitchenItems.filter(i => i.kitchenStatus === 'ready').length;

  return (
    <div className="h-screen flex flex-col bg-[#141414]">
      <header className="px-8 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <ChefHat className="text-[#E4E3E0] w-7 h-7" />
          <h1 className="font-serif italic text-2xl text-[#E4E3E0]">KDS Digital</h1>
          {canInstall && (
            <button
              onClick={install}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg transition-colors ml-2"
              title="Instalar KDS na tela inicial"
            >
              <Download size={12} />
              Instalar
            </button>
          )}
        </div>
        <div className="flex items-center gap-5 text-sm">
          <div className={`flex items-center gap-1.5 ${offline ? 'text-red-300' : 'text-green-400'}`} role="status">
            <span className={`w-2 h-2 rounded-full ${offline ? 'bg-red-500' : 'bg-green-500'}`} />
            <span className="font-bold">{offline ? 'Offline' : 'Online'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-zinc-500" />
            <span className="font-bold">{waitingCount}</span>
            <span className="opacity-50 text-xs">aguardando</span>
          </div>
          <div className="flex items-center gap-1.5 text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="font-bold">{preparingCount}</span>
            <span className="opacity-50 text-xs">em preparo</span>
          </div>
          <div className={`flex items-center gap-1.5 text-green-400 ${readyCount > 0 ? 'animate-pulse' : ''}`}>
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="font-bold">{readyCount}</span>
            <span className="opacity-50 text-xs">prontos</span>
          </div>
        </div>
      </header>

      {(!kdsEnabled || offline) && (
        <div className={`px-5 py-2 text-center text-xs font-semibold ${!kdsEnabled ? 'bg-zinc-800 text-zinc-300' : 'bg-red-950 text-red-200'}`} role="status">
          {!kdsEnabled ? 'Modo KDS desativado neste estabelecimento.' : 'Sem conexão com o servidor. As alterações não serão concluídas sem confirmação.'}
        </div>
      )}

      <div className="flex-1 flex min-h-0 divide-x divide-white/10">
        <Section
          title="Pizzas"
          Icon={Pizza}
          items={pizzaItems}
          accentClass="bg-orange-950/60"
          now={now}
          onStart={startItem}
          onOven={ovenItem}
          onFinish={finishItem}
          pendingActions={pendingActions}
          actionErrors={actionErrors}
        />
        <Section
          title="Lanches"
          Icon={Sandwich}
          items={lancheItems}
          accentClass="bg-yellow-950/60"
          now={now}
          onStart={startItem}
          onOven={ovenItem}
          onFinish={finishItem}
          pendingActions={pendingActions}
          actionErrors={actionErrors}
        />
      </div>
    </div>
  );
}
