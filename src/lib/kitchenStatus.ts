import type { MenuCategory, PizzaItem } from '../types';

export type KitchenStage = 'waiting' | 'preparing' | 'oven' | 'ready';
export type KitchenEvent = 'kitchen_start_item' | 'kitchen_oven_item' | 'kitchen_finish_item';

export interface ItemActionAck {
  ok: boolean;
  message?: string;
  item?: PizzaItem;
  orderId?: string | number;
  alreadyDelivered?: boolean;
}

export const KITCHEN_STAGE_LABELS: Record<KitchenStage, string> = {
  waiting: 'Na fila',
  preparing: 'Em preparo',
  oven: 'No forno',
  ready: 'Pronto — retirar',
};

export function isPlaygroundItem(item: Pick<PizzaItem, 'menuItemId' | 'source'> & { isParquinho?: boolean }): boolean {
  return item.source === 'parquinho' || item.isParquinho === true || Boolean(item.menuItemId?.startsWith('parquinho:'));
}

// Reuse the KDS's existing pizza/sandwich lanes, including catalogue resolution
// of stale type values. Other products are not forced into this workflow.
export function resolveKitchenItemType(item: PizzaItem, menu: MenuCategory[] = []): string | undefined {
  if (isPlaygroundItem(item)) return 'outros';
  if (item.type === 'pizzas') return 'pizzas';
  const category = menu.find((candidate) => {
    const products = [...(candidate.items || []), ...(candidate.subcategories || []).flatMap((group) => group.items || [])];
    return products.some((product) => item.menuItemId ? product.id === item.menuItemId : product.name === item.name);
  });
  return category?.type || item.type;
}

export function isKitchenTracked(item: PizzaItem, menu: MenuCategory[] = []): boolean {
  const type = resolveKitchenItemType(item, menu);
  return type === 'pizzas' || type === 'lanches';
}

export function getKitchenStage(item: PizzaItem): KitchenStage {
  return item.kitchenStatus === 'preparing' || item.kitchenStatus === 'oven' || item.kitchenStatus === 'ready'
    ? item.kitchenStatus : 'waiting';
}

export function kitchenTargetStage(event: KitchenEvent): KitchenStage {
  return event === 'kitchen_start_item' ? 'preparing' : event === 'kitchen_oven_item' ? 'oven' : 'ready';
}

export function canAdvanceKitchenStage(item: PizzaItem, target: KitchenStage, menu: MenuCategory[] = []): boolean {
  if (item.removed || item.deliveredAt || !isKitchenTracked(item, menu)) return false;
  const current = getKitchenStage(item);
  if (target === current) return true;
  if (target === 'preparing') return current === 'waiting';
  const pizza = resolveKitchenItemType(item, menu) === 'pizzas';
  if (target === 'oven') return pizza && current === 'preparing';
  if (target === 'ready') return pizza ? current === 'oven' : current === 'preparing';
  return false;
}

export function needsKitchenReadyForDelivery(item: PizzaItem, kdsEnabled: boolean, menu: MenuCategory[] = []): boolean {
  return kdsEnabled && isKitchenTracked(item, menu) && !item.deliveredAt && getKitchenStage(item) !== 'ready';
}
