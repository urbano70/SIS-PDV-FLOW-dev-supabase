import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getPlaygroundProductId } from '../lib/playgroundTypes.ts';

const scrypt = promisify(nodeScrypt) as unknown as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

export const PLAYGROUND_OPERATOR_ROLE = 'playground_operator' as const;
export const PLAYGROUND_PRODUCT_NAME = 'Parquinho';
export const PLAYGROUND_PRODUCT_TYPE = 'outros';
export const PLAYGROUND_ITEM_SOURCE = 'parquinho' as const;
export const PLAYGROUND_PRODUCT_UNIT = 'criança' as const;

export type PlaygroundStatus = 'pending' | 'approved' | 'inactive';
export type PlaygroundEntryStatus = 'active' | 'paid' | 'finalized' | 'removed' | 'cancelled';

export interface PlaygroundOperatorPublic {
  id: string;
  name: string;
  status: PlaygroundStatus;
  phone?: string;
  cpf?: string;
  birthDate?: string;
}

export interface PlaygroundConfigValue {
  parquinhoEnabled: boolean;
  parquinhoChildNameRequired: boolean;
  parquinhoPrice: number | null;
  parquinhoProductId: string;
}

export interface PlaygroundProjectionState {
  orders?: any[];
  tables?: any[];
  menu?: any[];
  isCashRegisterOpen?: boolean;
  shiftStartedAt?: string;
  pizzariaConfig?: any;
}

export interface PlaygroundDataProjection {
  tenantId: string;
  ready: boolean;
  buildId: string;
  config: PlaygroundConfigValue;
  tables: Array<{ id: number; occupied: boolean; currentOrderId: string | null; activeEntryIds: string[] }>;
  entries: any[];
  isCashRegisterOpen: boolean;
  shiftStartedAt: string;
  serverNow: string;
}

export const normalizeOperatorName = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ');
export const normalizeChildName = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ');

export const isNonEmptyName = (value: unknown): boolean => normalizeChildName(value).length > 0;

export const canonicalMoney = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100) / 100;
};

export const normalizePlaygroundConfig = (tenantId: string, config: any = {}): PlaygroundConfigValue => ({
  parquinhoEnabled: config?.parquinhoEnabled === true,
  parquinhoChildNameRequired: config?.parquinhoChildNameRequired === true,
  parquinhoPrice: canonicalMoney(config?.parquinhoPrice),
  parquinhoProductId: getPlaygroundProductId(tenantId),
});

/**
 * A reserved item is identified by its server-owned source/flag or by the
 * tenant-scoped managed id.  The source check is intentionally independent of
 * the id: an imported/copied item must not become a normal menu charge merely
 * because somebody changed its id in the browser.
 */
export const isPlaygroundReservedItem = (item: any, tenantId?: string): boolean => {
  if (!item || typeof item !== 'object') return false;
  if (item.source === PLAYGROUND_ITEM_SOURCE || item.isParquinho === true) return true;
  const values = [item.id, item.menuItemId, item.productId].map((value) => String(value ?? ''));
  const canonicalId = tenantId ? getPlaygroundProductId(tenantId) : '';
  return values.some((value) => value === canonicalId || value.startsWith('parquinho:'));
};

export const playgroundCatalogItems = (menu: any[] = []): any[] => (Array.isArray(menu) ? menu : []).flatMap((category: any) => [
  ...(Array.isArray(category?.items) ? category.items : []),
  ...(Array.isArray(category?.subcategories) ? category.subcategories.flatMap((subcategory: any) => (
    Array.isArray(subcategory?.items) ? subcategory.items : []
  )) : []),
]);

export const hashPlaygroundPassword = async (password: unknown): Promise<string> => {
  const value = String(password ?? '');
  if (value.length < 4 || value.length > 256) throw new Error('Senha inválida.');
  const salt = randomBytes(16);
  const derived = await scrypt(value, salt, 64, { N: 16_384, r: 8, p: 1 }) as Buffer;
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
};

export const verifyPlaygroundPassword = async (password: unknown, encoded: unknown): Promise<boolean> => {
  try {
    const [scheme, n, r, p, saltText, hashText] = String(encoded ?? '').split('$');
    if (scheme !== 'scrypt' || !n || !r || !p || !saltText || !hashText) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    if (!salt.length || !expected.length) return false;
    const derived = await scrypt(String(password ?? ''), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    }) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
};

export const publicOperator = (row: any): PlaygroundOperatorPublic => {
  const result: PlaygroundOperatorPublic = {
    id: String(row?.id ?? ''),
    name: normalizeOperatorName(row?.name),
    status: (row?.status || 'pending') as PlaygroundStatus,
  };
  if (row?.phone) result.phone = String(row.phone);
  if (row?.cpf) result.cpf = String(row.cpf);
  if (row?.birth_date || row?.birthDate) result.birthDate = String(row.birth_date ?? row.birthDate);
  return result;
};

const clone = <T>(value: T): T => value === undefined || value === null ? value : JSON.parse(JSON.stringify(value));

/**
 * Ensures the managed product exists exactly once. This intentionally does not
 * search by name: PLAY KIDS and any customer-created product are unrelated.
 */
export const ensurePlaygroundProduct = (menu: any[] = [], tenantId: string, price: number | null): { menu: any[]; changed: boolean } => {
  const productId = getPlaygroundProductId(tenantId);
  const next = clone(Array.isArray(menu) ? menu : []);
  let changed = false;
  let categoryIndex = next.findIndex((cat: any) => cat?.type === PLAYGROUND_PRODUCT_TYPE || String(cat?.name ?? '').trim().toLowerCase() === 'outros');
  if (categoryIndex < 0) {
    next.push({ name: 'Outros', type: PLAYGROUND_PRODUCT_TYPE, visible: true, items: [], subcategories: [] });
    categoryIndex = next.length - 1;
    changed = true;
  }
  let canonicalKept = false;
  for (const [catIndex, cat] of next.entries()) {
    const before = JSON.stringify(cat);
    cat.items = (Array.isArray(cat.items) ? cat.items : []).filter((item: any) => {
      if (!isPlaygroundReservedItem(item, tenantId)) return true;
      if (catIndex === categoryIndex && !canonicalKept && String(item?.id ?? '') === productId) {
        canonicalKept = true;
        return true;
      }
      return false;
    });
    cat.subcategories = (Array.isArray(cat.subcategories) ? cat.subcategories : []).map((sub: any) => ({
      ...sub,
      items: (Array.isArray(sub.items) ? sub.items : []).filter((item: any) => {
        if (!isPlaygroundReservedItem(item, tenantId)) return true;
        return false;
      }),
    }));
    if (JSON.stringify(cat) !== before) changed = true;
  }

  const category = next[categoryIndex];
  category.items = Array.isArray(category.items) ? category.items : [];
  category.subcategories = Array.isArray(category.subcategories) ? category.subcategories : [];
  const managed = {
    id: productId,
    name: PLAYGROUND_PRODUCT_NAME,
    type: PLAYGROUND_PRODUCT_TYPE,
    source: PLAYGROUND_ITEM_SOURCE,
    isParquinho: true,
    managed: true,
    price: canonicalMoney(price),
    unidade: PLAYGROUND_PRODUCT_UNIT,
    unit: PLAYGROUND_PRODUCT_UNIT,
    quantity: 1,
    visible: true,
  };
  const currentIndex = category.items.findIndex((item: any) => item?.id === productId);
  const current = currentIndex >= 0 ? category.items[currentIndex] : null;
  if (!current || JSON.stringify(current) !== JSON.stringify(managed)) changed = true;
  if (currentIndex >= 0) category.items[currentIndex] = managed;
  else category.items.push(managed);
  return { menu: next, changed };
};

/**
 * Reconcile a validated config/import snapshot with the managed catalog item.
 * Disabling the module never deletes the product, and therefore never rewrites
 * existing order history.  Enabling it materializes exactly one canonical item
 * in Outros and applies only the current price to that catalog item.
 */
export const synchronizePlaygroundCatalog = (
  menu: any[] = [],
  tenantId: string,
  config: any = {},
): { menu: any[]; changed: boolean } => {
  const normalized = normalizePlaygroundConfig(tenantId, config);
  if (!normalized.parquinhoEnabled) return { menu: clone(Array.isArray(menu) ? menu : []), changed: false };
  return ensurePlaygroundProduct(menu, tenantId, normalized.parquinhoPrice);
};

export const isPlaygroundItem = (item: any, tenantId?: string): boolean =>
  item?.source === PLAYGROUND_ITEM_SOURCE && (!tenantId || item?.menuItemId === getPlaygroundProductId(tenantId) || item?.productId === getPlaygroundProductId(tenantId));

export const effectivePlaygroundEntryStatus = (item: any, order: any): PlaygroundEntryStatus => {
  if (item?.removed) return 'removed';
  const orderStatus = String(order?.status ?? '').toLowerCase();
  if (orderStatus === 'cancelled' || orderStatus === 'cancelada' || orderStatus === 'canceled') return 'cancelled';
  if (orderStatus === 'finalizada' || orderStatus === 'finalized' || orderStatus === 'paid') return 'finalized';
  if (item?.paid) return 'paid';
  return 'active';
};

export const entryFromOrderItem = (item: any, order: any, tenantId: string, fallbackEntryId?: string): any | null => {
  if (!isPlaygroundItem(item, tenantId)) return null;
  const id = String(item?.parquinhoEntryId || fallbackEntryId || '');
  if (!id) return null;
  const quantity = Number(item?.quantity ?? 1);
  const totalPrice = canonicalMoney(item?.price) ?? 0;
  const unitPrice = canonicalMoney(item?.unitPrice) ?? (quantity === 1 ? totalPrice : canonicalMoney(totalPrice / Math.max(quantity, 1)) ?? 0);
  return {
    id,
    orderId: String(order?.id ?? ''),
    orderItemId: String(item?.id ?? ''),
    tableId: Number(order?.tableId),
    productId: String(item?.menuItemId || item?.productId || getPlaygroundProductId(tenantId)),
    productName: String(item?.name || PLAYGROUND_PRODUCT_NAME),
    childName: item?.childName ? normalizeChildName(item.childName) : null,
    operatorId: String(item?.operatorId || ''),
    operatorName: normalizeOperatorName(item?.operatorName || item?.waiterName || ''),
    createdAt: String(item?.timestamp || order?.timestamp || new Date().toISOString()),
    shiftStartedAt: String(item?.shiftStartedAt || ''),
    quantity: 1,
    unitPrice,
    totalPrice,
    status: effectivePlaygroundEntryStatus(item, order),
    removedBy: item?.removedBy ?? null,
    removalReason: item?.removalReason ?? null,
  };
};

const entryFromRow = (row: any, tenantId: string): any => ({
  id: String(row.id),
  orderId: String(row.order_id),
  orderItemId: String(row.order_item_id),
  tableId: Number(row.table_id),
  productId: String(row.product_id || getPlaygroundProductId(tenantId)),
  productName: String(row.product_name || PLAYGROUND_PRODUCT_NAME),
  childName: row.child_name ? normalizeChildName(row.child_name) : null,
  operatorId: String(row.operator_id),
  operatorName: normalizeOperatorName(row.operator_name),
  createdAt: String(row.created_at),
  shiftStartedAt: String(row.shift_started_at),
  quantity: 1,
  unitPrice: canonicalMoney(row.unit_price ?? row.original_price) ?? 0,
  totalPrice: canonicalMoney(row.total_price ?? row.original_price) ?? 0,
  status: row.status as PlaygroundEntryStatus,
  removedBy: row.removed_by ?? null,
  removalReason: row.reason ?? null,
});

export const mapPlaygroundEntryRow = entryFromRow;

export const projectPlaygroundData = ({
  tenantId,
  state,
  buildId,
  persistedEntries = [],
  now = new Date().toISOString(),
}: {
  tenantId: string;
  state: PlaygroundProjectionState;
  buildId: string;
  persistedEntries?: any[];
  now?: string;
}): PlaygroundDataProjection => {
  const config = normalizePlaygroundConfig(tenantId, state.pizzariaConfig || {});
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const entriesById = new Map<string, any>();
  for (const row of persistedEntries || []) {
    const mapped = row?.order_id ? entryFromRow(row, tenantId) : row;
    if (mapped?.id) entriesById.set(String(mapped.id), mapped);
  }
  for (const order of orders) {
    for (const item of order?.items || []) {
      const entry = entryFromOrderItem(item, order, tenantId);
      if (entry && !entriesById.has(entry.id)) entriesById.set(entry.id, entry);
    }
  }
  const entries = [...entriesById.values()].filter((entry: any) => entry?.productId === config.parquinhoProductId || entry?.productId === getPlaygroundProductId(tenantId));
  const tables = (Array.isArray(state.tables) ? state.tables : []).map((table: any) => {
    const currentOrder = orders.find((order: any) => String(order?.id) === String(table?.currentOrder));
    const orderIsOpen = currentOrder && !['finalizada', 'finalized', 'paid', 'cancelled', 'cancelada', 'canceled'].includes(String(currentOrder.status || '').toLowerCase());
    const activeEntries = orderIsOpen ? entries.filter((entry: any) => String(entry.orderId) === String(currentOrder.id) && ['active', 'paid'].includes(entry.status)) : [];
    return {
      id: Number(table.id),
      occupied: activeEntries.length > 0,
      currentOrderId: orderIsOpen ? String(currentOrder.id) : null,
      activeEntryIds: activeEntries.map((entry: any) => String(entry.id)),
    };
  });
  return {
    tenantId,
    ready: true,
    buildId,
    config,
    tables,
    entries,
    isCashRegisterOpen: state.isCashRegisterOpen === true,
    shiftStartedAt: String(state.shiftStartedAt || ''),
    serverNow: now,
  };
};

export const playgroundEventAllowedForOperator = (event: string): boolean => new Set([
  'parquinho_register', 'parquinho_login', 'parquinho_resume', 'parquinho_logout', 'parquinho_request_data', 'parquinho_add_entry',
]).has(event);

export const isValidPlaygroundStatus = (status: unknown): status is PlaygroundStatus =>
  status === 'pending' || status === 'approved' || status === 'inactive';

export const isValidEntryStatus = (status: unknown): status is PlaygroundEntryStatus =>
  status === 'active' || status === 'paid' || status === 'finalized' || status === 'removed' || status === 'cancelled';
