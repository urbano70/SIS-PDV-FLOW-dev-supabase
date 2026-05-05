import { supabase } from './supabase';
import { Table, Order, Waiter, StockItem, MenuCategory } from '../types';

// --- Transformers: DB (snake_case) → App (camelCase) ---

const toTable = (row: any): Table => ({
  id: row.id,
  status: row.status,
  currentOrder: row.current_order,
  linkedTo: row.linked_to,
});

const toOrder = (row: any): Order => ({
  id: row.id,
  tableId: row.table_id,
  items: row.items ?? [],
  status: row.status,
  timestamp: row.timestamp,
  waiterId: row.waiter_id,
  waiterName: row.waiter_name,
  observations: row.observations,
  isComanda: row.is_comanda,
  discount: row.discount,
  discountType: row.discount_type,
  partialPayments: row.partial_payments,
  paymentLog: row.payment_log,
});

const toWaiter = (row: any): Waiter => ({
  id: row.id,
  socketId: row.socket_id ?? row.id,
  name: row.name,
  password: row.password,
  phone: row.phone,
  cpf: row.cpf,
  status: row.status,
});

const toStock = (row: any): StockItem => ({
  id: row.id,
  name: row.name,
  quantity: row.quantity,
  unit: row.unit,
  minQuantity: row.min_quantity,
});

const toMenu = (row: any): MenuCategory => ({
  name: row.name,
  type: row.type,
  items: row.items ?? [],
});

const transformers: Record<string, (row: any) => any> = {
  tables: toTable,
  comandas: toTable,
  orders: toOrder,
  waiters: toWaiter,
  stock: toStock,
  menu: toMenu,
};

// --- syncCollection: initial load + real-time ---

export const syncCollection = (collectionName: string, setter: (data: any[]) => void) => {
  const transform = transformers[collectionName] ?? ((r: any) => r);

  // Initial load
  supabase.from(collectionName).select('*').then(({ data, error }) => {
    if (error) console.error(`[Supabase] Error loading ${collectionName}:`, error.message);
    if (data) setter(data.map(transform));
  });

  // Real-time subscription — refetch collection on any change
  const channel = supabase
    .channel(`realtime:${collectionName}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: collectionName }, async () => {
      const { data } = await supabase.from(collectionName).select('*');
      if (data) setter(data.map(transform));
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
};

// --- Generic update ---

export const updateDocument = async (table: string, id: string, data: any) => {
  const { error } = await supabase.from(table).update(data).eq('id', id);
  if (error) console.error(`[Supabase] updateDocument ${table}/${id}:`, error.message);
};

// --- Generic create/upsert ---

export const createDocument = async (table: string, data: any, id?: string) => {
  if (id) {
    const { error } = await supabase.from(table).upsert({ ...data, id });
    if (error) console.error(`[Supabase] createDocument ${table}:`, error.message);
    return id;
  }
  const { data: row, error } = await supabase.from(table).insert(data).select('id').single();
  if (error) console.error(`[Supabase] createDocument ${table}:`, error.message);
  return row?.id;
};

// --- Order ---

export const saveOrder = async (order: any) => {
  const row = {
    id: order.id?.toString(),
    table_id: order.tableId,
    items: order.items,
    status: order.status,
    timestamp: order.timestamp,
    waiter_id: order.waiterId,
    waiter_name: order.waiterName,
    observations: order.observations ?? null,
    is_comanda: order.isComanda ?? false,
    discount: order.discount ?? null,
    discount_type: order.discountType ?? null,
    partial_payments: order.partialPayments ?? [],
    payment_log: order.paymentLog ?? [],
  };
  const { error } = await supabase.from('orders').upsert(row);
  if (error) throw new Error(error.message);
  return row.id;
};

// --- Table status ---

export const updateTableStatus = async (tableId: number, status: string, orderId: string | null = null) => {
  const { error } = await supabase
    .from('tables')
    .update({ status, current_order: orderId })
    .eq('id', tableId);
  if (error) console.error(`[Supabase] updateTableStatus:`, error.message);
};
