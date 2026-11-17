export type WaiterStatus = 'pending' | 'approved' | 'inactive' | 'rejected';

export type WaiterAuthAck = {
  ok: boolean;
  status?: WaiterStatus;
  waiter?: Record<string, unknown>;
  message?: string;
};

export type AuthActor = {
  role: 'admin' | 'waiter';
  tenantId: string;
  waiterId?: string;
  credentialsValidated?: boolean;
};

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/**
 * Removes credentials and returns a detached profile. Socket payloads must use
 * this projection even for the authenticated waiter's own profile.
 */
export const sanitizeWaiter = (waiter: unknown): Record<string, unknown> | null => {
  if (!isRecord(waiter)) return null;
  const { password: _password, ...safeWaiter } = waiter;
  return { ...safeWaiter };
};

export const safeWaiter = sanitizeWaiter;

export const sanitizeWaiters = (waiters: unknown): Record<string, unknown>[] =>
  Array.isArray(waiters)
    ? waiters.map(sanitizeWaiter).filter((waiter): waiter is Record<string, unknown> => waiter !== null)
    : [];

export const publicWaiters = sanitizeWaiters;

export const waiterCredentialsMatch = (
  waiter: unknown,
  name: unknown,
  password: unknown,
): boolean => {
  if (!isRecord(waiter)) return false;
  return typeof name === 'string' && typeof password === 'string' &&
    waiter.name === name && waiter.password === password;
};

export const findWaiterByCredentials = (
  waiters: unknown,
  name: unknown,
  password: unknown,
): Record<string, any> | undefined => {
  if (!Array.isArray(waiters)) return undefined;
  return waiters.find((waiter) => waiterCredentialsMatch(waiter, name, password));
};

export const waiterStatus = (waiter: unknown): WaiterStatus | undefined => {
  if (!isRecord(waiter)) return undefined;
  const status = String(waiter.status || '');
  return ['pending', 'approved', 'inactive', 'rejected'].includes(status)
    ? status as WaiterStatus
    : undefined;
};

export const isApprovedWaiter = (waiter: unknown): boolean => waiterStatus(waiter) === 'approved';

export const buildWaiterAuthAck = (
  ok: boolean,
  waiter: unknown,
  message?: string,
): WaiterAuthAck => {
  const safe = sanitizeWaiter(waiter);
  const status = waiterStatus(waiter);
  return {
    ok,
    ...(status ? { status } : {}),
    ...(safe ? { waiter: safe } : {}),
    ...(message ? { message } : {}),
  };
};

/** Only the role, tenant and server-established waiter identity are trusted. */
export const authActorSafe = (actor: unknown): AuthActor | null => {
  if (!isRecord(actor)) return null;
  const role = actor.role === 'admin' || actor.role === 'waiter' ? actor.role : null;
  const tenantId = typeof actor.tenantId === 'string' ? actor.tenantId.trim() : '';
  if (!role || !tenantId) return null;
  if (role === 'admin') return { role, tenantId };
  const waiterId = typeof actor.waiterId === 'string' ? actor.waiterId.trim() : '';
  if (!waiterId || actor.credentialsValidated !== true) return null;
  return { role, tenantId, waiterId, credentialsValidated: true };
};

/**
 * An admin may see the complete password-free roster. A waiter may see only
 * their own password-free profile; an untrusted actor receives no roster.
 */
export const projectWaitersForActor = (
  waiters: unknown,
  actor: unknown,
): Record<string, unknown>[] => {
  const safeActor = authActorSafe(actor);
  if (!safeActor) return [];
  const safe = sanitizeWaiters(waiters);
  if (safeActor.role === 'admin') return safe;
  return safe.filter((waiter) => String(waiter.id || '') === safeActor.waiterId);
};

export const isWaiterActorForTenant = (
  actor: unknown,
  tenantId: unknown,
  waiter: unknown,
): boolean => {
  const safeActor = authActorSafe(actor);
  return Boolean(
    safeActor && safeActor.role === 'waiter' &&
    safeActor.tenantId === String(tenantId || '') &&
    safeActor.waiterId === String((waiter as any)?.id || '') &&
    safeActor.credentialsValidated === true,
  );
};
