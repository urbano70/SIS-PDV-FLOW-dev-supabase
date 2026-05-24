export interface PizzaItem {
  id: string;
  menuItemId?: string;
  name: string;
  type?: 'pizzas' | 'lanches' | 'bebidas';
  flavors: string[];
  size: 'P' | 'M' | 'G';
  crust?: string;
  extras: string[];
  observations: string;
  price: number;
  quantity?: number;
  removed?: boolean;
  removedBy?: string; // Waiter name
  removalReason?: string;
  paid?: boolean;
  waiterName?: string; // Waiter who added the item
  ingredients?: string;
  timestamp?: string; // ISO string for order tracking
  discount?: number;
  discountType?: 'percentage' | 'value';
  deliveredAt?: string; // ISO string when item was marked as delivered
  deliveredBy?: string; // Waiter who marked as delivered
}

export interface DeliveryRecord {
  itemId: string;
  itemName: string;
  orderedAt?: string;
  deliveredAt: string;
  durationMinutes: number | null;
  tableId: number | string;
  isComanda?: boolean;
  waiterName?: string;
}

export interface PizzeriaConfig {
  enabled: boolean;
  yellowMinutes: number;
  orangeMinutes: number;
  redMinutes: number;
}

export interface Order {
  id: number | string;
  tableId: number;
  items: PizzaItem[];
  status: 'pending' | 'preparing' | 'ready' | 'finalizada';
  timestamp: string; // ISO string
  waiterId: string;
  waiterName?: string;
  observations?: string;
  isComanda?: boolean;
  discount?: number;
  discountType?: 'percentage' | 'value';
  partialPayments?: { amount: number, method: string, timestamp: string }[];
  paymentLog?: { amount: number, method: string, timestamp: string, type: 'partial' | 'items', payer?: string }[];
  deliveryLog?: DeliveryRecord[];
}

export interface Table {
  id: number;
  status: 'free' | 'occupied' | 'bill_requested' | 'linked';
  currentOrder: number | string | null;
  linkedTo?: number | null;
}

export interface Waiter {
  id: string; // This will be the socketId
  socketId: string;
  name: string;
  password?: string;
  phone?: string;
  cpf?: string;
  birthDate?: string;
  status: 'pending' | 'approved' | 'inactive';
}

export interface StockItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  minQuantity: number;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  ingredients?: string;
  trackStock?: boolean;
}

export interface MenuCategory {
  name: string;
  type: 'pizzas' | 'lanches' | 'bebidas';
  items: MenuItem[];
}
