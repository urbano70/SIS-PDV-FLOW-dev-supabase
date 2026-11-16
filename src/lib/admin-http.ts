import { supabase } from './supabase';

const PRIVATE_ADMIN_API = /^\/api\/(?:fiscal(?:\/|$)|backup(?:\/|$)|seed(?:[/?]|$)|seed-menu(?:[/?]|$)|agent-config(?:[/?]|$)|fix-tables(?:[/?]|$)|admin\/create-waiter(?:[/?]|$))/;

function getRequestUrl(input: RequestInfo | URL): URL | null {
  if (typeof window === 'undefined') return null;
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  try {
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

/** True only for the same-origin owner APIs guarded by server.ts. */
export function isPrivateAdminRequest(input: RequestInfo | URL): boolean {
  const url = getRequestUrl(input);
  return !!url && url.origin === window.location.origin && PRIVATE_ADMIN_API.test(url.pathname);
}

function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const fetchImpl = typeof window !== 'undefined' && window.fetch
    ? window.fetch.bind(window)
    : globalThis.fetch.bind(globalThis);
  return fetchImpl(input, init);
}

export async function getAdminAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

/**
 * Fetch for owner-only HTTP APIs. The access token is sent in the header and
 * never appended to a URL, so links/window.open cannot leak it via history,
 * referrers, or server access logs.
 */
export async function adminFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!isPrivateAdminRequest(input)) {
    throw new Error('adminFetch aceita apenas APIs privadas same-origin');
  }
  const token = await getAdminAccessToken();
  if (!token) throw new Error('Sessão administrativa indisponível');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return nativeFetch(input, { ...init, headers });
}

/**
 * Dispatcher seguro para componentes que também fazem requests públicos:
 * somente a allowlist privada recebe Bearer; health, arquivos, impressora e
 * origens externas continuam usando o fetch nativo sem credenciais extras.
 */
export function fetchWithAdminAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return isPrivateAdminRequest(input) ? adminFetch(input, init) : nativeFetch(input, init);
}

/** Baixa uma resposta privada sem transformar o Bearer em URL/âncora. */
export async function downloadAdminFile(input: RequestInfo | URL, filename?: string): Promise<void> {
  const response = await adminFetch(input);
  if (!response.ok) {
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const data = await response.clone().json() as { error?: string };
      if (data.error) message = data.error;
    } catch { /* resposta pode ser binária/texto */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  if (filename) anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
