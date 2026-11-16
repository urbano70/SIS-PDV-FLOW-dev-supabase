export type PlaygroundOperatorStatus = 'pending' | 'approved' | 'inactive';
export type PlaygroundEntryStatus = 'active' | 'paid' | 'finalized' | 'removed' | 'cancelled';

export interface PlaygroundOperator {
  id: string;
  name: string;
  status: PlaygroundOperatorStatus;
  phone?: string;
  cpf?: string;
  birthDate?: string;
}

export interface PlaygroundConfig {
  parquinhoEnabled: boolean;
  parquinhoChildNameRequired: boolean;
  parquinhoPrice: number | null;
  parquinhoProductId: string;
}

export interface PlaygroundEntry {
  id: string;
  orderId: string;
  orderItemId: string;
  tableId: number;
  productId: string;
  productName: string;
  childName: string | null;
  operatorId: string;
  operatorName: string;
  createdAt: string;
  shiftStartedAt: string;
  quantity: 1;
  unitPrice: number;
  totalPrice: number;
  status: PlaygroundEntryStatus;
  removedBy?: string | null;
  removalReason?: string | null;
}

export interface PlaygroundTable {
  id: number;
  occupied: boolean;
  currentOrderId: string | null;
  activeEntryIds: string[];
}

export interface PlaygroundData {
  tenantId: string;
  ready: boolean;
  buildId: string;
  config: PlaygroundConfig;
  tables: PlaygroundTable[];
  entries: PlaygroundEntry[];
  isCashRegisterOpen: boolean;
  shiftStartedAt: string;
  serverNow: string;
}

export interface PlaygroundAck {
  ok: boolean;
  message?: string;
  token?: string;
  operator?: PlaygroundOperator;
  data?: PlaygroundData;
  entry?: PlaygroundEntry;
  operators?: PlaygroundOperator[];
  entries?: PlaygroundEntry[];
  shiftStartedAt?: string;
  shifts?: string[];
}

export interface PlaygroundLaunch {
  requestId: string;
  tableId: number;
  childName: string;
  buildId?: string;
}

export function getPlaygroundProductId(tenantId: string): string {
  return `parquinho:${tenantId}`;
}
