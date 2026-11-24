#!/usr/bin/env node
'use strict';
// Only real helpers + mocked storage/Auth/fetch. No application server or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const compile = file => esbuild.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const key = 'sb-fixture-auth-token';
const legacy = { user: { id: 'tenant-a', user_metadata: { logo_url: 'data:image/jpeg;base64,' + 'A'.repeat(281728), name: 'preserved' } }, access_token: 'X'.repeat(375928), refresh_token: 'refresh-a' };
const freshUser = { id: 'tenant-a', user_metadata: { logo_url: 'https://fixture.test/logo.jpg', name: 'preserved' } };
const events = [];
const data = { [key]: JSON.stringify(legacy) };
const storage = { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
Object.defineProperty(storage, key, { enumerable: true, get: () => data[key] });
let responseUser = freshUser;
let mutateWhileRefreshing;
const sdk = { auth: { getSession: async () => ({ data: { session: JSON.parse(data[key]) }, error: null }), updateUser: async () => ({ error: null }) } };
const authModule = { exports: {} };
vm.runInNewContext(compile('src/lib/auth.ts'), {
 module: authModule, exports: authModule.exports,
 require: name => { assert.equal(name, './supabase'); return { supabase: sdk }; }, localStorage: storage,
 window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
 fetch: async (url, options) => {
  assert.equal(url, '/api/auth/refresh');
  assert.equal(JSON.parse(options.body).refresh_token, 'refresh-a');
  assert.equal(options.headers.Authorization, undefined, 'legacy JWT is never sent as a header for recovery');
  mutateWhileRefreshing?.();
  return { ok: true, json: async () => ({ access_token: 'short-confirmed-token', refresh_token: 'rotated-a', expires_in: 3600, user: responseUser }) };
 },
});
const httpModule = { exports: {} };
vm.runInNewContext(compile('src/lib/admin-http.ts'), {
 module: httpModule, exports: httpModule.exports,
 require: name => name === './supabase' ? { supabase: sdk } : name === './auth' ? authModule.exports : assert.fail(name),
 URL, Headers, window: { location: { origin: 'https://pdv.fixture.test' }, fetch: async (_url, init) => {
  assert.equal(init.headers.get('Authorization'), 'Bearer short-confirmed-token');
  return { ok: true };
 } },
});
(async () => {
 assert.equal(httpModule.exports.isPrivateAdminRequest('/api/establishment/profile'), true);
 assert.equal(httpModule.exports.isPrivateAdminRequest('https://other.fixture.test/api/establishment/profile'), false);
 assert.equal(httpModule.exports.isPrivateAdminRequest('/api/auth/refresh'), false);
 await httpModule.exports.adminFetch('/api/establishment/profile');
 const cleaned = JSON.parse(data[key]);
 assert.equal(cleaned.access_token, 'short-confirmed-token');
 assert.deepEqual(cleaned.user, freshUser);
 assert.equal(cleaned.refresh_token, 'rotated-a');
 assert.ok(!JSON.stringify(cleaned).includes('data:image'));
 assert.equal(events.length, 1);
 assert.equal(events[0].detail.tenantId, 'tenant-a');
 assert.deepEqual(events[0].detail.profile, freshUser.user_metadata);
 await assert.rejects(() => authModule.exports.updateUserMetadata({ logo_url: 'data:image/png;base64,AA==' }), /formulário/);
 data[key] = JSON.stringify(legacy);
 responseUser = { id: 'tenant-b', user_metadata: { logo_url: '' } };
 assert.equal(await authModule.exports.refreshViaProxy(), null, 'wrong upstream user cannot replace owner');
 assert.deepEqual(JSON.parse(data[key]), legacy);
 responseUser = freshUser;
 mutateWhileRefreshing = () => { data[key] = JSON.stringify({ user: { id: 'tenant-b' }, refresh_token: 'refresh-b' }); };
 assert.equal(await authModule.exports.refreshViaProxy(), null);
 assert.equal(JSON.parse(data[key]).user.id, 'tenant-b');
 assert.equal(events.length, 1, 'no old-tenant profile event after session switch');
 console.log('logo auth session: legacy recovery before Bearer, clean user cache, metadata guard, same-origin and tenant races passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
