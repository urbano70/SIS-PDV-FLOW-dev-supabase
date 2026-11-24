#!/usr/bin/env node
'use strict';
// Supabase SDK real, storage local em memória e fetch simulado. Sem rede real.
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const key = 'sb-fixture-auth-token';
const store = new Map();
const token = marker => {
 const encode = o => Buffer.from(JSON.stringify(o)).toString('base64url');
 return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'fixture-user', exp: Math.floor(Date.now() / 1000) + 3600, marker })}.fictitious`;
};
const oldToken = token('old');
const newToken = token('new');
const oldUser = { id: 'fixture-user', aud: 'authenticated', user_metadata: { logo_url: 'data:image/jpeg;base64,' + 'A'.repeat(1000) } };
const newUser = { id: 'fixture-user', aud: 'authenticated', user_metadata: { logo_url: 'https://assets.fixture.test/logo.jpg' } };
const sdk = createClient('https://sdk.fixture.test', 'fixture-anon-not-real', {
 auth: { storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
  storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
 },
 global: { fetch: async (url, init) => {
  const bearer = new Headers(init.headers).get('authorization');
  assert.equal(bearer, `Bearer ${url.endsWith('/user') && init.method === 'GET' && !store.has(key) ? oldToken : newToken}`);
  return new Response(JSON.stringify(newUser), { status: 200, headers: { 'Content-Type': 'application/json' } });
 } },
});
(async () => {
 // Seed storage as a browser initially authenticated before migration.
 store.set(key, JSON.stringify({ access_token: oldToken, refresh_token: 'old-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: oldUser }));
 const before = await sdk.auth.getSession();
 assert.equal(before.data.session.access_token, oldToken);
 // Same mechanism used by the guarded same-origin proxy refresh helper.
 store.set(key, JSON.stringify({ access_token: newToken, refresh_token: 'new-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: newUser }));
 const after = await sdk.auth.getSession();
 assert.equal(after.data.session.access_token, newToken);
 assert.equal(after.data.session.user.user_metadata.logo_url, newUser.user_metadata.logo_url);
 const update = await sdk.auth.updateUser({ data: { establishment_name: 'Fixture' } });
 assert.equal(update.error, null, 'updateUser reads the cleaned persisted session');
 console.log('real Supabase SDK: getSession and updateUser use clean externally refreshed storage; no stale in-memory Bearer');
 sdk.auth.stopAutoRefresh();
})().catch(error => { console.error(error); process.exitCode = 1; sdk.auth.stopAutoRefresh(); });
