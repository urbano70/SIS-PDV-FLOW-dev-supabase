export interface AdminHttpRequest {
  headers?: Record<string, string | string[] | undefined> | { get?: (name: string) => string | null | undefined };
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

export interface AuthenticatedAdminUser {
  id: string;
  [key: string]: unknown;
}

export interface AdminAuthFailure {
  ok: false;
  status: 400 | 401 | 403 | 503;
  code: 'TENANT_REQUIRED' | 'AUTH_REQUIRED' | 'AUTH_INVALID' | 'TENANT_FORBIDDEN' | 'AUTH_UNAVAILABLE';
  error: string;
}

export interface AdminAuthSuccess {
  ok: true;
  user: AuthenticatedAdminUser;
  userId: string;
  accessToken: string;
  tenantId: string | undefined;
}

export type AdminAuthResult = AdminAuthFailure | AdminAuthSuccess;

export interface AdminAuthOptions {
  getUser?: (accessToken: string) => Promise<{
    data?: { user?: { id?: unknown; [key: string]: unknown } | null } | null;
    error?: unknown;
  }>;
  tenantIds?: unknown[];
  requireTenant?: boolean;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function readHeader(request: AdminHttpRequest, name: string): string | null {
  const headers = request.headers;
  if (!headers) return null;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return asNonEmptyString((headers as { get: (key: string) => string | null | undefined }).get(name));
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? record[key] : undefined;
  return Array.isArray(value) ? asNonEmptyString(value[0]) : asNonEmptyString(value);
}

function readField(container: unknown, field: string): string | null {
  if (!container || typeof container !== 'object') return null;
  return asNonEmptyString((container as Record<string, unknown>)[field]);
}

/**
 * Extracts the access token without interpreting its payload. Authorization is
 * preferred; body/query token fields remain only as a compatibility transport
 * for existing fiscal clients. Every extracted value is still verified by
 * Supabase Auth getUser before it can authorize anything.
 */
export function extractAdminAccessToken(request: AdminHttpRequest): string | null {
  const authorization = readHeader(request, 'authorization');
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    return match ? asNonEmptyString(match[1]) : null;
  }
  return readField(request.body, 'token')
    ?? readField(request.query, 'token')
    ?? readField(request.params, 'token');
}

function tenantIdsFrom(values: unknown[] | undefined): string[] {
  return Array.from(new Set((values || [])
    .map(asNonEmptyString)
    .filter((value): value is string => Boolean(value))));
}

function failure(
  status: AdminAuthFailure['status'],
  code: AdminAuthFailure['code'],
  error: string,
): AdminAuthFailure {
  return { ok: false, status, code, error };
}

/**
 * Authorizes a private HTTP request as the Supabase owner of one tenant.
 *
 * This deliberately does not decode JWTs, inspect profile metadata, accept
 * playground/operator tokens, or fall back when the auth client is absent.
 * The server must ask Supabase Auth for the user on every request.
 */
export async function authorizeAdminRequest(
  request: AdminHttpRequest,
  options: AdminAuthOptions = {},
): Promise<AdminAuthResult> {
  const claimedTenants = tenantIdsFrom(options.tenantIds);
  const requireTenant = options.requireTenant !== false;
  if (requireTenant && claimedTenants.length === 0) {
    return failure(400, 'TENANT_REQUIRED', 'tenantId obrigatório');
  }

  const accessToken = extractAdminAccessToken(request);
  if (!accessToken) {
    return failure(401, 'AUTH_REQUIRED', 'Autenticação administrativa obrigatória');
  }
  if (typeof options.getUser !== 'function') {
    return failure(503, 'AUTH_UNAVAILABLE', 'Autenticação administrativa indisponível');
  }

  let result: {
    data?: { user?: { id?: unknown; [key: string]: unknown } | null } | null;
    error?: unknown;
  };
  try {
    result = await options.getUser(accessToken);
  } catch {
    return failure(401, 'AUTH_INVALID', 'Token administrativo inválido');
  }

  const user = result?.data?.user;
  const userId = asNonEmptyString(user?.id);
  if (result?.error || !user || !userId) {
    return failure(401, 'AUTH_INVALID', 'Token administrativo inválido');
  }

  if (claimedTenants.some((tenantId) => tenantId !== userId)) {
    return failure(403, 'TENANT_FORBIDDEN', 'Tenant não pertence ao usuário autenticado');
  }

  return {
    ok: true,
    user: user as AuthenticatedAdminUser,
    userId,
    accessToken,
    tenantId: claimedTenants[0] ?? userId,
  };
}

export function sendAdminAuthFailure(
  response: { status: (statusCode: number) => { json: (payload: unknown) => unknown } },
  result: AdminAuthFailure,
): unknown {
  return response.status(result.status).json({ error: result.error, code: result.code });
}
