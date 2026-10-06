import { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, BellRing, X, Trash2 } from 'lucide-react';
import type { OrderNotification, NotificationMode } from '../hooks/useOrderNotifications';

interface Props {
  notifications: OrderNotification[];
  unreadCount: number;
  mode: NotificationMode;
  onMarkAllRead: () => void;
  onClearAll: () => void;
}

const TOAST_DURATION = 10000;
const ANIM_MS = 380;
const R = 7;
const CIRC = 2 * Math.PI * R;

// ─── Toast individual ──────────────────────────────────────────────────────
interface ToastItemProps {
  notif: OrderNotification;
  onDismiss: (id: string) => void;
}

function ToastItem({ notif, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const dismissedRef = useRef(false);
  const isCall = notif.type === 'call';

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setLeaving(true);
    setTimeout(() => onDismiss(notif.id), ANIM_MS);
  }, [notif.id, onDismiss]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
    const autoTimer = setTimeout(dismiss, TOAST_DURATION);
    return () => { cancelAnimationFrame(raf); clearTimeout(autoTimer); };
  }, [dismiss]);

  const opacity = leaving ? 0 : visible ? 1 : 0;
  const transform = leaving
    ? 'translateX(-10px) scale(0.95)'
    : visible ? 'translateX(0) scale(1)' : 'translateX(-14px) scale(0.94)';

  return (
    <div
      style={{
        transition: `opacity ${ANIM_MS}ms ease, transform ${ANIM_MS}ms cubic-bezier(0.34,1.4,0.64,1)`,
        opacity,
        transform,
      }}
      className={`flex items-start gap-2.5 pl-2.5 pr-3 py-2.5 rounded-xl shadow-xl max-w-xs border backdrop-blur-sm ${
        isCall
          ? 'bg-orange-500/90 text-white border-orange-400/40'
          : 'bg-[#141414]/70 text-[#E4E3E0] border-white/10'
      }`}
    >
      {/* Anel de progresso */}
      <div className="shrink-0 mt-0.5 relative flex items-center justify-center" style={{ width: 18, height: 18 }}>
        <svg width="18" height="18" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="9" cy="9" r={R} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
          <circle
            cx="9" cy="9" r={R} fill="none"
            stroke={isCall ? 'white' : '#fb923c'}
            strokeWidth="2" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={0}
            style={{ animation: visible && !leaving ? `toast-countdown ${TOAST_DURATION}ms linear forwards` : 'none' }}
          />
        </svg>
        {isCall
          ? <BellRing size={9} className="absolute text-white" />
          : <Bell size={9} className="absolute text-orange-300" />
        }
      </div>

      {/* Texto */}
      {isCall ? (
        <span className="text-[10px] leading-snug flex-1 font-bold">
          Mesa <span className="text-xl font-black leading-none">{notif.tableId}</span>{' '}
          está chamando!
        </span>
      ) : (
        <span className="text-[10px] leading-snug flex-1">{notif.message}</span>
      )}

      <button onClick={dismiss} className="ml-auto shrink-0 opacity-40 hover:opacity-100 transition-opacity">
        <X size={11} />
      </button>
    </div>
  );
}

// ─── Bell + painel + fila de toasts ───────────────────────────────────────
export function OrderNotificationBell({ notifications, unreadCount, mode, onMarkAllRead, onClearAll }: Props) {
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<OrderNotification[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Na primeira execução, apenas semeia os IDs existentes sem gerar toasts
    if (!initializedRef.current) {
      notifications.forEach(n => seenIdsRef.current.add(n.id));
      initializedRef.current = true;
      return;
    }
    if (mode === 'disabled') return;
    const fresh = notifications.filter(n => !seenIdsRef.current.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach(n => seenIdsRef.current.add(n.id));
    // Chamadas de garçom sempre aparecem como toast, independente do modo
    const toShow = mode === 'full' ? fresh : fresh.filter(n => n.type === 'call');
    if (toShow.length > 0) setQueue(prev => [...toShow, ...prev].slice(0, 5));
  }, [notifications, mode]);

  const removeToast = useCallback((id: string) => {
    setQueue(prev => prev.filter(n => n.id !== id));
  }, []);

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
              <span className="text-[10px] font-bold uppercase opacity-60">Notificações</span>
              <button onClick={onClearAll} title="Limpar" className="p-0.5 rounded text-[#141414]/30 hover:text-red-500 transition-colors">
                <Trash2 size={11} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-[10px] text-center opacity-40 py-4">Nenhuma notificação</p>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={`px-3 py-2 border-b border-[#141414]/5 text-[10px] leading-snug ${n.read ? 'opacity-50' : ''} ${
                      n.type === 'call' ? 'bg-orange-50 border-l-2 border-l-orange-400' : ''
                    }`}
                  >
                    {n.type === 'call' ? (
                      <p className="font-black text-orange-600 flex items-center gap-1.5">
                        <BellRing size={10} />
                        Mesa <span className="text-base leading-none">{n.tableId}</span> está chamando!
                      </p>
                    ) : (
                      <p className="font-medium">{n.message}</p>
                    )}
                    <p className="opacity-40 mt-0.5">
                      {new Date(n.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toasts — canto inferior esquerdo */}
      {queue.length > 0 && (
        <div className="fixed bottom-4 left-4 z-[400] flex flex-col-reverse gap-2 pointer-events-none">
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
