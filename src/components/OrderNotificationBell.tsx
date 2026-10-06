import { useEffect, useRef, useState } from 'react';
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

export function OrderNotificationBell({ notifications, unreadCount, mode, onMarkAllRead, onClearAll, newNotifications }: Props) {
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<OrderNotification[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Show toast popups in 'full' mode
  useEffect(() => {
    if (mode !== 'full' || newNotifications.length === 0) return;
    setToasts(prev => [...newNotifications, ...prev].slice(0, 5));
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => !newNotifications.find(n => n.id === t.id)));
    }, 4000);
    return () => clearTimeout(timer);
  }, [newNotifications, mode]);

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
        <div className="fixed bottom-4 right-4 z-[400] flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <div key={t.id} className="pointer-events-auto flex items-start gap-2 bg-[#141414] text-[#E4E3E0] px-3 py-2.5 rounded-xl shadow-lg max-w-xs animate-fade-in-up">
              <Bell size={12} className="shrink-0 mt-0.5 text-orange-400" />
              <span className="text-[10px] leading-snug">{t.message}</span>
              <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="ml-auto shrink-0 opacity-50 hover:opacity-100">
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
