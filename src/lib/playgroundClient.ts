import { io, type Socket } from 'socket.io-client';
import type {
  PlaygroundAck,
  PlaygroundData,
  PlaygroundLaunch,
  PlaygroundOperator,
} from './playgroundTypes';

export const PLAYGROUND_APP = 'parquinho';
export const PLAYGROUND_TOKEN_PREFIX = 'playground:token:';
export const PLAYGROUND_FORM_PREFIX = 'playground:form:';
export const PLAYGROUND_TIMEOUT_MS = 12_000;

export interface PlaygroundPendingForm {
  requestId: string;
  tenantId: string;
  tableId: number;
  childName: string;
  buildId?: string;
  submittedAt?: string;
}

export type PlaygroundSocket = Socket;

function browserSessionStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function scopedKey(prefix: string, tenantId: string): string {
  return `${prefix}${encodeURIComponent(String(tenantId).trim())}`;
}

export function createPlaygroundSocket(tenantId: string): PlaygroundSocket {
  const normalizedTenant = String(tenantId || '').trim();
  return io(window.location.origin, {
    query: { tenant: normalizedTenant, app: PLAYGROUND_APP },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 20_000,
    autoConnect: true,
  });
}

export function emitPlaygroundAck(
  socket: PlaygroundSocket,
  event: string,
  payload?: unknown,
  timeoutMs = PLAYGROUND_TIMEOUT_MS,
): Promise<PlaygroundAck> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (ack?: PlaygroundAck) => {
      if (settled) return;
      settled = true;
      resolve(ack && typeof ack === 'object' ? ack : { ok: false, message: 'O servidor não confirmou a operação.' });
    };
    const timer = window.setTimeout(() => finish({ ok: false, message: 'Tempo limite de comunicação com o servidor.' }), timeoutMs);
    const callback = (ack: PlaygroundAck) => {
      window.clearTimeout(timer);
      finish(ack);
    };
    try {
      if (payload === undefined) socket.emit(event, callback);
      else socket.emit(event, payload, callback);
    } catch (error) {
      window.clearTimeout(timer);
      finish({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível enviar a operação.' });
    }
  });
}

export function normalizeTenantId(tenantId: string | null | undefined): string {
  return String(tenantId || '').trim();
}

export function isValidPlaygroundPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parsePlaygroundPriceInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return isValidPlaygroundPrice(parsed) ? parsed : null;
}

export function trimChildName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateChildName(value: unknown, required: boolean): string | null {
  const trimmed = trimChildName(value);
  if (!required || trimmed.length > 0) return trimmed || null;
  return null;
}

export function getPlaygroundLaunchError(
  data: Pick<PlaygroundData, 'config' | 'ready' | 'isCashRegisterOpen'> | null | undefined,
  childName: unknown,
): string | null {
  if (!data?.ready) return 'Aguarde a sincronização do Parquinho.';
  if (!data.config.parquinhoEnabled) return 'O Modo Parquinho está desativado.';
  if (!isValidPlaygroundPrice(data.config.parquinhoPrice)) return 'Configure um preço válido para lançar o Parquinho.';
  if (!data.isCashRegisterOpen) return 'O caixa está fechado. Peça ao gerente para abrir o caixa.';
  if (data.config.parquinhoChildNameRequired && trimChildName(childName).length === 0) {
    return 'Informe o nome da criança.';
  }
  return null;
}

export function makePlaygroundLaunch(
  tableId: number,
  childName: unknown,
  requestId: string,
  buildId?: string,
): PlaygroundLaunch {
  const payload: PlaygroundLaunch = {
    requestId,
    tableId,
    childName: trimChildName(childName),
  };
  if (buildId) payload.buildId = buildId;
  return payload;
}

export function createRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall through to a sufficiently unique browser-safe identifier.
  }
  return `parq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function readPlaygroundToken(tenantId: string): string | null {
  const storage = browserSessionStorage();
  if (!storage || !tenantId) return null;
  try {
    return storage.getItem(scopedKey(PLAYGROUND_TOKEN_PREFIX, tenantId));
  } catch {
    return null;
  }
}

export function writePlaygroundToken(tenantId: string, token: string): void {
  const storage = browserSessionStorage();
  if (!storage || !tenantId || !token) return;
  try { storage.setItem(scopedKey(PLAYGROUND_TOKEN_PREFIX, tenantId), token); } catch { /* private mode */ }
}

export function clearPlaygroundToken(tenantId: string): void {
  const storage = browserSessionStorage();
  if (!storage || !tenantId) return;
  try { storage.removeItem(scopedKey(PLAYGROUND_TOKEN_PREFIX, tenantId)); } catch { /* private mode */ }
}

export function readPendingPlaygroundForm(tenantId: string): PlaygroundPendingForm | null {
  const storage = browserSessionStorage();
  if (!storage || !tenantId) return null;
  try {
    const raw = storage.getItem(scopedKey(PLAYGROUND_FORM_PREFIX, tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaygroundPendingForm;
    if (!parsed || parsed.tenantId !== tenantId || !parsed.requestId || !Number.isFinite(Number(parsed.tableId))) return null;
    return {
      requestId: String(parsed.requestId),
      tenantId,
      tableId: Number(parsed.tableId),
      childName: trimChildName(parsed.childName),
      ...(parsed.buildId ? { buildId: String(parsed.buildId) } : {}),
      ...(parsed.submittedAt ? { submittedAt: String(parsed.submittedAt) } : {}),
    };
  } catch {
    return null;
  }
}

export function writePendingPlaygroundForm(form: PlaygroundPendingForm): void {
  const storage = browserSessionStorage();
  if (!storage || !form.tenantId || !form.requestId) return;
  try { storage.setItem(scopedKey(PLAYGROUND_FORM_PREFIX, form.tenantId), JSON.stringify(form)); } catch { /* private mode */ }
}

export function clearPendingPlaygroundForm(tenantId: string): void {
  const storage = browserSessionStorage();
  if (!storage || !tenantId) return;
  try { storage.removeItem(scopedKey(PLAYGROUND_FORM_PREFIX, tenantId)); } catch { /* private mode */ }
}

export function formatPlaygroundMoney(value: number | null | undefined): string {
  if (!isValidPlaygroundPrice(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function isPlaygroundManagedProductId(productId: unknown, tenantId?: string): boolean {
  if (typeof productId !== 'string' || !productId.startsWith('parquinho:')) return false;
  return !tenantId || productId === `parquinho:${tenantId}`;
}

export function isPlaygroundItem(item: { id?: unknown; source?: unknown; isParquinho?: unknown; menuItemId?: unknown } | null | undefined, tenantId?: string): boolean {
  if (!item) return false;
  return item.source === 'parquinho' || item.isParquinho === true || isPlaygroundManagedProductId(item.menuItemId, tenantId) || isPlaygroundManagedProductId(item.id, tenantId);
}

export function playgroundStatusLabel(status: PlaygroundOperator['status'] | string): string {
  if (status === 'approved') return 'Aprovado';
  if (status === 'inactive') return 'Inativo';
  return 'Aguardando aprovação';
}

export function playgroundEntryStatusLabel(status: string): string {
  if (status === 'active') return 'Ativo';
  if (status === 'paid') return 'Pago';
  if (status === 'finalized') return 'Finalizado';
  if (status === 'removed') return 'Removido';
  if (status === 'cancelled') return 'Cancelado';
  return status || '—';
}
