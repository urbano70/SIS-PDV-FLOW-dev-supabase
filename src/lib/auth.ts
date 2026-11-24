import { supabase } from './supabase';

export async function signInOwner(email: string, password: string) {
  const res = await fetch('/api/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await res.json();
  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error || 'Email ou senha incorretos.');
  }
  // Persist session in localStorage so getSession() picks it up on mount
  try {
    const sbKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      || 'sb-iagflqaopurjnnzkunph-auth-token';
    localStorage.setItem(sbKey, JSON.stringify({
      access_token: payload.access_token,
      token_type: payload.token_type || 'bearer',
      expires_in: payload.expires_in || 3600,
      expires_at: Math.floor(Date.now() / 1000) + (payload.expires_in || 3600),
      refresh_token: payload.refresh_token,
      user: payload.user,
    }));
  } catch {}
  // Notify the SDK so onAuthStateChange fires (no network call for a fresh token)
  try { await supabase.auth.setSession({ access_token: payload.access_token, refresh_token: payload.refresh_token }); } catch {}
  return { user: payload.user, session: payload };
}

export async function signUpOwner(email: string, password: string, establishmentName: string, plan?: string) {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, establishment_name: establishmentName, plan: plan || 'premium' }),
  });
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload.error || 'Erro ao criar conta.');
  }
  // Raw Supabase signup response has user fields at top level; wrap to match SDK interface
  const user = payload.id ? payload : (payload.user || null);
  return { user, session: payload.session || null };
}

export async function signOutOwner() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {}
  // Fallback: se o SDK não limpou por falha de rede, remove as chaves manualmente
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-'))
      .forEach(k => localStorage.removeItem(k));
  } catch {}
}

/** Clears the local Supabase session without a server round-trip.
 * Use when the token is already invalid (expired, revoked) so the
 * global signOut HTTP call would fail and leave the cache dirty. */
export async function forceLocalSignOut() {
  await supabase.auth.signOut({ scope: 'local' });
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function forceRefreshSession() {
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) return null;
  return data.session;
}

/**
 * Renova o token via endpoint proxy no próprio servidor, contornando extensões
 * de browser que bloqueiam requisições diretas ao domínio do Supabase.
 * Atualiza o localStorage diretamente para que os fallbacks subsequentes
 * encontrem o novo access_token sem depender do SDK.
 */
let proxyRefreshInFlight: {
  key: string; token: string; userId: string; promise: Promise<{ access_token: string } | null>;
} | null = null;

export function refreshViaProxy(): Promise<{ access_token: string } | null> {
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return Promise.resolve(null);
    const session = JSON.parse(localStorage.getItem(key) || 'null');
    const token = session?.refresh_token;
    const userId = session?.user?.id;
    if (!token || !userId) return Promise.resolve(null);
    if (proxyRefreshInFlight?.key === key && proxyRefreshInFlight.token === token &&
        proxyRefreshInFlight.userId === userId) return proxyRefreshInFlight.promise;
    const operation = { key, token, userId, promise: performProxyRefresh() };
    operation.promise = operation.promise.finally(() => {
      if (proxyRefreshInFlight === operation) proxyRefreshInFlight = null;
    });
    proxyRefreshInFlight = operation;
    return operation.promise;
  } catch { return Promise.resolve(null); }
}

async function performProxyRefresh(): Promise<{ access_token: string } | null> {
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return null;
    const raw = localStorage.getItem(key);
    const stored = raw ? JSON.parse(raw) : null;
    const refresh_token: string | undefined = stored?.refresh_token;
    if (!refresh_token) return null;

    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    const data = await res.json();

    // A user supplied by the authenticated grant must belong to this session.
    if (data.user && data.user.id !== stored?.user?.id) return null;
    // A logout/login or another tab may have changed the session while the
    // proxy was refreshing. Never put the previous account back into storage.
    const currentRaw = localStorage.getItem(key);
    const current = currentRaw ? JSON.parse(currentRaw) : null;
    if (!current || current.refresh_token !== refresh_token ||
        current.user?.id !== stored?.user?.id) return null;

    if (!res.ok) {
      // A successful upstream grant may rotate the refresh token before a
      // transient Storage/Auth error. Keep only that recovery capability, not
      // a legacy JWT, and never restore another account or report success.
      if (data?.recovery_pending === true && data.user_id === stored.user?.id &&
          typeof data.refresh_token === 'string' && data.refresh_token) {
        localStorage.setItem(key, JSON.stringify({ ...current, refresh_token: data.refresh_token }));
      }
      return null;
    }
    if (!data?.access_token) return null;
    // Persiste os novos tokens no localStorage para os fallbacks do SDK
    if (stored) {
      stored.access_token = data.access_token;
      if (data.user) stored.user = data.user;
      if (data.refresh_token) stored.refresh_token = data.refresh_token;
      if (data.expires_in) {
        stored.expires_in = data.expires_in;
        stored.expires_at = Math.floor(Date.now() / 1000) + data.expires_in;
      }
      localStorage.setItem(key, JSON.stringify(stored));
    }
    if (data.user && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('establishment-profile-updated', {
        detail: { tenantId: data.user.id, profile: data.user.user_metadata, user: data.user },
      }));
    }
    return { access_token: data.access_token };
  } catch {
    return null;
  }
}

export function onAuthStateChange(callback: (user: any) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/login?mode=reset`,
  });
  if (error) throw error;
}

export async function updateUserPassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function updateUserMetadata(data: Record<string, any>) {
  if ('logo_url' in data && (typeof data.logo_url !== 'string' ||
      /^data:/i.test(data.logo_url) || data.logo_url.length > 2048)) {
    throw new Error('Use o formulário do estabelecimento para enviar a logo com segurança.');
  }
  const { error } = await supabase.auth.updateUser({ data });
  if (error) throw error;
}
