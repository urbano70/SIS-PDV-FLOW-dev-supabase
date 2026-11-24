#!/usr/bin/env node
'use strict';
// Real auth helper; memory-only storage/fetch, no live session or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const code = esbuild.transformSync(fs.readFileSync(path.join(__dirname, '../src/lib/auth.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const key = 'sb-fixture-auth-token';
const fields = { establishment_name: 'Loja', address: 'Novo endereço' };
const legacy = { user: { id: 'tenant-a', user_metadata: { logo_url: 'data:image/jpeg;base64,old', plan: 'premium' } }, access_token: 'X'.repeat(375928), refresh_token: 'abcdefghijkl' };
const freshUser = { id: 'tenant-a', user_metadata: { ...fields, logo_url: '', plan: 'premium' } };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const data = new Map([[key, JSON.stringify(legacy)]]), calls = [], events = [], responses = [];
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    localStorage: { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v), get [key]() { return data.get(key); } },
    require: name => { assert.equal(name, './supabase'); return { supabase: { auth: {} } }; },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { dispatchEvent: e => events.push(e) },
    fetch: (url, init) => {
      assert.equal(url, '/api/auth/refresh');
      assert.equal(init.headers.Authorization, undefined);
      calls.push(JSON.parse(init.body));
      return new Promise(resolve => responses.push((ok, payload) => resolve({ ok, json: async () => payload })));
    },
  });
  return { api: module.exports, data, calls, events, responses };
}
(async () => {
  const f = fixture();
  const refreshing = f.api.refreshViaProxy();
  const removing = f.api.removeEstablishmentLogoViaProxy(fields);
  assert.equal(f.calls.length, 1, 'removal waits for the current refresh');
  f.responses[0](false, { error: 'Storage indisponível', recovery_pending: true, user_id: 'tenant-a', refresh_token: 'rotated12abc' });
  assert.equal(await refreshing, null);
  await flush();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1], { refresh_token: 'rotated12abc', removeLogo: true, fields });
  f.responses[1](true, { ok: true, access_token: 'clean-token', refresh_token: 'clean12token', expires_in: 3600, user: freshUser, profile: { ...fields, logo_url: '' } });
  const result = await removing;
  assert.equal(result.profile.logo_url, '');
  assert.equal(JSON.parse(f.data.get(key)).user.user_metadata.logo_url, '');
  assert.equal(JSON.parse(f.data.get(key)).user.user_metadata.plan, 'premium');
  assert.equal(f.events.length, 1);
  assert.equal(f.api.getProxyRefreshError(), null);

  const switched = fixture();
  const initial = switched.api.refreshViaProxy();
  const queued = switched.api.removeEstablishmentLogoViaProxy(fields);
  switched.data.set(key, JSON.stringify({ user: { id: 'tenant-b' }, access_token: 'b', refresh_token: 'bbbbbbbbbbbb' }));
  switched.responses[0](true, { access_token: 'clean-token', user: freshUser });
  assert.equal(await initial, null);
  await assert.rejects(queued, /confirmar a remoção/);
  assert.equal(switched.calls.length, 1, 'queued removal cannot cross a logout/account switch');
  assert.equal(switched.events.length, 0);
  assert.equal(JSON.parse(switched.data.get(key)).user.id, 'tenant-b');

  const failed = fixture();
  const operation = failed.api.removeEstablishmentLogoViaProxy(fields);
  failed.responses[0](false, { error: 'O Auth não confirmou a persistência do perfil.', recovery_pending: true, user_id: 'tenant-a', refresh_token: 'rotated12abc' });
  await assert.rejects(operation, /não confirmou a persistência/);
  const retained = JSON.parse(failed.data.get(key));
  assert.equal(retained.refresh_token, 'rotated12abc');
  assert.equal(retained.user.user_metadata.logo_url, legacy.user.user_metadata.logo_url);
  assert.equal(failed.events.length, 0, 'failed removal does not emit success/profile update');
  console.log('logo removal session: serialized refresh/removal, rotated recovery token, clean cache, account-switch guard and explicit failure passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
