import { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, X, Trash2 } from 'lucide-react';
import type { OrderNotification, NotificationMode } from '../hooks/useOrderNotifications';

interface Props {
  notifications: OrderNotification[];
  unreadCount: number;
  mode: NotificationMode;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  newNotifications: OrderNotification[];
}

// ─── Toast individual com animação própria ─────────────────────────────────
interface ToastItemProps {
  notif: OrderNotification;
  onDismiss: (id: string) => void;
}

const TOAST_DURATION = 10000;
const ANIM_MS = 380;

function ToastItem({ notif, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = useState(false);   // controla enter
  const [leaving, setLeaving] = useState(false);   // controla exit
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setLeaving(true);
    setTimeout(() => onDismiss(notif.id), ANIM_MS);
  }, [notif.id, onDismiss]);

  useEffect(() => {
    // rAF duplo garante que o browser pintou o estado inicial (opacity 0)
    // antes de transicionar para visible (opacity 1)
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });

    const autoTimer = setTimeout(dismiss, TOAST_DURATION);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(autoTimer);
    };
  }, [dismiss]);

  const opacity = leaving ? 0 : visible ? 1 : 0;
  const transform = leaving
    ? 'translateY(10px) scale(0.95)'
    : visible
      ? 'translateY(0) scale(1)'
      : 'translateY(14px) scale(0.94)';

  return (
    <div
      style={{
        transition: `opacity ${ANIM_MS}ms ease, transform ${ANIM_MS}ms cubic-bezier(0.34,1.4,0.64,1)`,
        opacity,
        transform,
      }}
      className="flex items-start gap-2.5 bg-[#141414]/70 backdrop-blur-sm text-[#E4E3E0] px-3.5 py-2.5 rounded-xl shadow-xl max-w-xs border border-white/10"
    >
      <Bell size={12} className="shrink-0 mt-0.5 text-orange-400" />
      <span className="text-[10px] leading-snug flex-1">{notif.message}</span>
      <button
        onClick={dismiss}
        className="ml-auto shrink-0 opacity-40 hover:opacity-100 transition-opacity"
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ─── Bell + painel + fila de toasts ───────────────────────────────────────
export function OrderNotificationBell({ notifications, unreadCount, mode, onMarkAllRead, onClearAll, newNotifications }: Props) {
  const [open, setOpen] = useState(false);
  // Fila de toasts com IDs únicos para evitar duplicatas
  const [queue, setQueue] = useState<OrderNotification[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  // Enfileira novos toasts
  useEffect(() => {
    if (mode !== 'full' || newNotifications.length === 0) return;
    const fresh = newNotifications.filter(n => !seenIdsRef.current.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach(n => seenIdsRef.current.add(n.id));
    setQueue(prev => [...fresh, ...prev].slice(0, 5));
  }, [newNotifications, mode]);

  const removeToast = useCallback((id: string) => {
    setQueue(prev => prev.filter(n => n.id !== id));
  }, []);

  // Fecha painel ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    setOpen(v => !v);
    if (!open) onMarkAllRead();
  };

  if (mode === 'disabled') return null;

  return (
    <>
      {/* Botão sino */}
      <div className="relative" ref={panelRef}>
        <button
          onClick={handleOpen}
          title="Notificações de lançamentos"
          className="relative p-1.5 rounded-lg text-[#141414]/30 hover:text-[#141414] hover:bg-[#141414]/10 transition-all shrink-0"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-4 h-4 px-0.5 text-[9px] font-bold text-white bg-orange-500 rounded-full">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Painel dropdown */}
        {open && (
          <div className="absolute right-0 top-full mt-1.5 w-72 bg-white rounded-xl border border-[#141414]/10 shadow-lg z-[300] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#141414]/10">
              <span className="text-[10px] font-bold uppercase opacity-60">Lançamentos</span>
              <button onClick={onClearAll} title="Limpar" className="p-0.5 rounded text-[#141414]/30 hover:text-red-500 transition-colors">
                <Trash2 size={11} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-[10px] text-center opacity-40 py-4">Nenhum lançamento</p>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className={`px-3 py-2 border-b border-[#141414]/5 text-[10px] leading-snug ${n.read ? 'opacity-50' : ''}`}>
                    <p className="font-medium">{n.message}</p>
                    <p className="opacity-40 mt-0.5">{new Date(n.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toasts flutuantes */}
      {mode === 'full' && queue.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[400] flex flex-col-reverse gap-2 pointer-events-none">
          {queue.map(n => (
            <div key={n.id} className="pointer-events-auto">
              <ToastItem notif={n} onDismiss={removeToast} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
