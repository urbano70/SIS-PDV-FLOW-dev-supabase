import { useEffect, useRef, useState, useCallback } from 'react';

export type NotificationMode = 'full' | 'badge' | 'disabled';

export interface OrderNotification {
  id: string;
  message: string;
  timestamp: number;
  read: boolean;
}

const STORAGE_KEY = 'orderNotificationMode_v1';

export function loadNotificationMode(): NotificationMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'full' || v === 'badge' || v === 'disabled') return v;
  } catch {}
  return 'full';
}

export function saveNotificationMode(mode: NotificationMode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
}

export function useOrderNotifications(orders: any[], mode: NotificationMode) {
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevItemIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      // Seed known item IDs on first load — don't notify for existing items
      const ids = new Set<string>();
      orders.forEach((o: any) => (o.items || []).forEach((item: any) => {
        if (item.id) ids.add(String(item.id));
      }));
      prevItemIdsRef.current = ids;
      initializedRef.current = true;
      return;
    }

    if (mode === 'disabled') return;

    const currentIds = new Set<string>();
    const newNotifs: OrderNotification[] = [];

    orders.forEach((order: any) => {
      (order.items || []).forEach((item: any) => {
        const key = String(item.id);
        currentIds.add(key);
        if (!prevItemIdsRef.current.has(key)) {
          const waiter = item.waiterName || 'Garçom';
          const qty = item.quantity ?? 1;
          const itemName = item.name || 'Item';
          const table = order.isComanda ? `comanda ${order.tableId}` : `mesa ${order.tableId}`;
          newNotifs.push({
            id: `${key}-${Date.now()}`,
            message: `${waiter} lançou ${qty}x ${itemName} na ${table}`,
            timestamp: Date.now(),
            read: false,
          });
        }
      });
    });

    prevItemIdsRef.current = currentIds;

    if (newNotifs.length > 0) {
      setNotifications(prev => [...newNotifs.reverse(), ...prev].slice(0, 100));
      setUnreadCount(c => c + newNotifs.length);
    }
  }, [orders, mode]);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, markAllRead, clearAll };
}
