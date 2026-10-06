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

interface ToastState {
  notif: OrderNotification;
  phase: 'in' | 'visible' | 'out';
}

const TOAST_DURATION = 10000;
const ANIM_IN = 350;
const ANIM_OUT = 400;

export function OrderNotificationBell({ notifications, unreadCount, mode, onMarkAllRead, onClearAll, newNotifications }: Props) {
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.notif.id === id ? { ...t, phase: 'out' } : t));
    const removeTimer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.notif.id !== id));
    }, ANIM_OUT);
    timersRef.current.set(`remove-${id}`, removeTimer);
  }, []);

  // Show toast popups in 'full' mode
  useEffect(() => {
    if (mode !== 'full' || newNotifications.length === 0) return;

    const incoming = newNotifications.slice(0, 5);

    incoming.forEach(n => {
      // Start in 'in' phase
      setToasts(prev => {
        if (prev.find(t => t.notif.id === n.id)) return prev;
        return [{ notif: n, phase: 'in' }, ...prev].slice(0, 5);
      });

      // Transition to 'visible' after enter animation
      const visTimer = setTimeout(() => {
        setToasts(prev => prev.map(t => t.notif.id === n.id ? { ...t, phase: 'visible' } : t));
      }, ANIM_IN);
      timersRef.current.set(`vis-${n.id}`, visTimer);

      // Start exit animation after duration
      const outTimer = setTimeout(() => dismissToast(n.id), ANIM_IN + TOAST_DURATION);
      timersRef.current.set(`out-${n.id}`, outTimer);
    });

    return () => {
      incoming.forEach(n => {
        ['vis', 'out', 'remove'].forEach(k => {
          const t = timersRef.current.get(`${k}-${n.id}`);
          if (t) clearTimeout(t);
        });
      });
    };
  }, [newNotifications, mode, dismissToast]);

  // Close panel on outside click
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
      {/* Bell button */}
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

        {/* Dropdown panel */}
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

      {/* Toast popups */}
      {mode === 'full' && (
        <div className="fixed bottom-4 right-4 z-[400] flex flex-col-reverse gap-2 pointer-events-none">
          {toasts.map(({ notif: t, phase }) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start gap-2 bg-[#141414] text-[#E4E3E0] px-3 py-2.5 rounded-xl shadow-xl max-w-xs"
              style={{
                transition: `opacity ${phase === 'in' ? ANIM_IN : ANIM_OUT}ms ease, transform ${phase === 'in' ? ANIM_IN : ANIM_OUT}ms cubic-bezier(0.34,1.56,0.64,1)`,
                opacity: phase === 'visible' ? 1 : 0,
                transform: phase === 'visible' ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.96)',
              }}
            >
              <Bell size={12} className="shrink-0 mt-0.5 text-orange-400" />
              <span className="text-[10px] leading-snug flex-1">{t.message}</span>
              <button
                onClick={() => dismissToast(t.id)}
                className="ml-auto shrink-0 opacity-40 hover:opacity-100 transition-opacity"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
