import type { PizzaItem } from '../types.ts';
import {
  canAdvanceKitchenStage,
  getKitchenStage,
  isKitchenTracked,
  isPlaygroundItem,
  kitchenTargetStage,
  needsKitchenReadyForDelivery,
  type KitchenEvent,
  type KitchenStage,
} from '../lib/kitchenStatus.ts';

export interface KitchenServerDeps {
  socket: any;
  io: any;
  getTenantId: () => string;
  getState: (tenantId: string) => any;
  withTenantCommand: <T>(tenantId: string, operation: () => Promise<T>) => Promise<T>;
  saveOrder: (order: any, orderId: string, tenantId: string) => Promise<void>;
  isAdmin: () => boolean;
}

const CLOSED_ORDER_STATUSES = new Set(['finalizada', 'finalized', 'paid', 'cancelled', 'cancelada', 'canceled']);
const PREP_EVENTS: KitchenEvent[] = ['kitchen_start_item', 'kitchen_oven_item', 'kitchen_finish_item'];

const clone = <T>(value: T): T => value === undefined || value === null ? value : JSON.parse(JSON.stringify(value));
const text = (value: unknown): string => String(value ?? '').trim();

const readPayloadAndAck = (rawPayload: any, rawAck: any): { payload: any; callback: ((value: any) => void) | null } => {
  if (typeof rawPayload === 'function') return { payload: {}, callback: rawPayload };
  return { payload: rawPayload || {}, callback: typeof rawAck === 'function' ? rawAck : null };
};

const sendAck = (socket: any, event: string, callback: ((value: any) => void) | null, response: any) => {
  const ack = { ok: response?.ok === true, ...response };
  if (callback) callback(ack);
  socket.emit(`${event}_ack`, ack);
  return ack;
};

const adminOrApprovedWaiter = (deps: KitchenServerDeps, state: any): { ok: true; name: string } | { ok: false; message: string } => {
  if (deps.isAdmin()) return { ok: true, name: 'ADM' };
  const waiterId = text(deps.socket?.waiterId);
  const waiter = (state?.waiters || []).find((candidate: any) => String(candidate?.id) === waiterId);
  if (!waiter || waiter.status !== 'approved') return { ok: false, message: 'Garçom aprovado obrigatório.' };
  return { ok: true, name: text(waiter.name) || text(deps.socket?.waiterName) || 'Garçom' };
};

const adminKds = (deps: KitchenServerDeps): { ok: true } | { ok: false; message: string } => {
  if (!deps.isAdmin()) return { ok: false, message: 'Somente a cozinha autorizada pode alterar o preparo.' };
  return { ok: true };
};

const tenantAndState = (deps: KitchenServerDeps): { tenantId: string; state: any } => {
  const tenantId = text(deps.getTenantId());
  if (!tenantId) throw new Error('Tenant inválido.');
  return { tenantId, state: deps.getState(tenantId) };
};

const orderAndItem = (state: any, payload: any): { order: any; item: any } => {
  const orderId = text(payload?.orderId);
  const itemId = text(payload?.itemId);
  if (!orderId || !itemId) throw new Error('Pedido e item são obrigatórios.');
  const order = (state?.orders || []).find((candidate: any) => String(candidate?.id) === orderId);
  if (!order) throw new Error('Pedido não encontrado.');
  const item = (order.items || []).find((candidate: any) => String(candidate?.id) === itemId);
  if (!item) throw new Error('Item não encontrado neste pedido.');
  if (CLOSED_ORDER_STATUSES.has(String(order.status || '').toLowerCase())) throw new Error('Pedido encerrado.');
  return { order, item };
};

const menuOf = (state: any): any[] => Array.isArray(state?.menu) ? state.menu : [];
const kdsIsEnabled = (state: any): boolean => state?.pizzariaConfig?.kdsEnabled === true;

const persistThenBroadcast = async (
  deps: KitchenServerDeps,
  tenantId: string,
  order: any,
  before: any,
): Promise<void> => {
  try {
    // saveOrder is awaited: no update_orders or success ACK can precede durable state.
    await deps.saveOrder(order, String(order.id), tenantId);
  } catch (error) {
    Object.assign(order, before);
    throw error;
  }
  deps.io.to(`tenant:${tenantId}`).emit('update_orders', deps.getState(tenantId).orders || []);
};

const applyKitchenStage = async (
  deps: KitchenServerDeps,
  event: KitchenEvent,
  payload: any,
): Promise<{ item: PizzaItem; stage: KitchenStage }> => {
  const { tenantId, state } = tenantAndState(deps);
  const authorization = adminKds(deps);
  if (!authorization.ok) throw new Error('message' in authorization ? authorization.message : 'Acesso negado.');
  if (!kdsIsEnabled(state)) throw new Error('KDS desativado neste estabelecimento.');
  const { order, item } = orderAndItem(state, payload);
  if (isPlaygroundItem(item)) throw new Error('Parquinho não utiliza o KDS.');
  if (!isKitchenTracked(item, menuOf(state))) throw new Error('Item fora das filas da cozinha.');
  if (item.deliveredAt) throw new Error('Item já entregue.');
  const target = kitchenTargetStage(event);
  const current = getKitchenStage(item);
  if (!canAdvanceKitchenStage(item, target, menuOf(state))) {
    throw new Error(`Transição inválida: ${current} para ${target}.`);
  }
  const before = clone(order);
  if (target !== current) item.kitchenStatus = target;
  if (target !== current) await persistThenBroadcast(deps, tenantId, order, before);
  return { item, stage: target };
};

const applyDelivery = async (deps: KitchenServerDeps, payload: any): Promise<{ item: PizzaItem; alreadyDelivered?: boolean }> => {
  const { tenantId, state } = tenantAndState(deps);
  const authorization = adminOrApprovedWaiter(deps, state);
  if (!authorization.ok) throw new Error('message' in authorization ? authorization.message : 'Acesso negado.');
  const { order, item } = orderAndItem(state, payload);
  if (item.removed) throw new Error('Item removido não pode ser entregue.');
  if (isPlaygroundItem(item)) throw new Error('Parquinho não utiliza confirmação de entrega da cozinha.');
  if (item.deliveredAt) return { item, alreadyDelivered: true };
  const tracked = isKitchenTracked(item, menuOf(state)) && !isPlaygroundItem(item);
  if (needsKitchenReadyForDelivery(item, kdsIsEnabled(state), menuOf(state))) {
    throw new Error('Item ainda não está pronto para entrega.');
  }
  if (tracked && kdsIsEnabled(state) && getKitchenStage(item) !== 'ready') {
    throw new Error('Item ainda não está pronto para entrega.');
  }
  const before = clone(order);
  const now = new Date().toISOString();
  const durationMinutes = item.timestamp
    ? Math.round((new Date(now).getTime() - new Date(item.timestamp).getTime()) / 60000)
    : null;
  item.deliveredAt = now;
  item.deliveredBy = authorization.name;
  const deliveryLog = Array.isArray(order.deliveryLog) ? order.deliveryLog : [];
  if (!deliveryLog.some((record: any) => String(record?.itemId) === String(item.id))) {
    deliveryLog.push({
      itemId: item.id,
      itemName: item.name,
      orderedAt: item.timestamp || null,
      deliveredAt: now,
      durationMinutes,
      tableId: order.tableId,
      isComanda: order.isComanda || false,
      waiterName: authorization.name,
    });
  }
  order.deliveryLog = deliveryLog;
  await persistThenBroadcast(deps, tenantId, order, before);
  return { item };
};

const runCommand = <T>(deps: KitchenServerDeps, tenantId: string, operation: () => Promise<T>): Promise<T> =>
  deps.withTenantCommand(tenantId, async () => {
    if (text(deps.getTenantId()) !== tenantId) throw new Error('A sessão mudou de estabelecimento. Tente novamente.');
    return operation();
  });

export const registerKitchenSocketHandlers = (deps: KitchenServerDeps): void => {
  for (const event of PREP_EVENTS) {
    deps.socket.on(event, async (rawPayload: any, rawAck: any) => {
      const { payload, callback } = readPayloadAndAck(rawPayload, rawAck);
      const tenantId = text(deps.getTenantId());
      try {
        const result = await runCommand(deps, tenantId, () => applyKitchenStage(deps, event, payload));
        sendAck(deps.socket, event, callback, { ok: true, message: 'Status de preparo salvo.', item: result.item });
      } catch (error: any) {
        sendAck(deps.socket, event, callback, { ok: false, message: error?.message || 'Não foi possível atualizar o preparo.' });
      }
    });
  }

  deps.socket.on('deliver_item', async (rawPayload: any, rawAck: any) => {
    const { payload, callback } = readPayloadAndAck(rawPayload, rawAck);
    const tenantId = text(deps.getTenantId());
    try {
      const result = await runCommand(deps, tenantId, () => applyDelivery(deps, payload));
      sendAck(deps.socket, 'deliver_item', callback, {
        ok: true,
        message: result.alreadyDelivered ? 'Item já entregue.' : 'Entrega registrada.',
        item: result.item,
        alreadyDelivered: result.alreadyDelivered === true,
      });
    } catch (error: any) {
      sendAck(deps.socket, 'deliver_item', callback, { ok: false, message: error?.message || 'Não foi possível registrar a entrega.' });
    }
  });
};

export const kitchenHandlerInternals = {
  applyKitchenStage,
  applyDelivery,
  adminOrApprovedWaiter,
  adminKds,
};
