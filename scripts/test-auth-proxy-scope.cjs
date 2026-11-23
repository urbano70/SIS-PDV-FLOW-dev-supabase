#!/usr/bin/env node
'use strict';
// Actual auth helper, fake fetch/storage. Never sends a request to Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/auth.ts'), 'utf8');
const code = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const key = 'sb-fixture-auth-token';
const sessionA = { user: { id: 'tenant-a' }, refresh_token: 'refresh-a', access_token: 'access-a' };
const sessionB = { user: { id: 'tenant-b' }, refresh_token: 'refresh-b', access_token: 'access-b' };
async function run(changeSession) {
  const storage = { [key]: JSON.stringify(sessionA) };
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) { assert.equal(name, './supabase'); return { supabase: {} }; },
    localStorage: Object.assign(storage, {
      getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; },
    }),
    fetch: async () => response,
  });
  const refresh = module.exports.refreshViaProxy();
  changeSession?.(storage);
  release({ ok: true, json: async () => ({ access_token: 'fresh-a', refresh_token: 'rotated-a', expires_in: 3600 }) });
  return { result: await refresh, stored: storage[key] ? JSON.parse(storage[key]) : null };
}
(async () => {
  const unchanged = await run();
  assert.equal(unchanged.result.access_token, 'fresh-a');
  assert.equal(unchanged.stored.access_token, 'fresh-a');
  assert.equal(unchanged.stored.refresh_token, 'rotated-a');
  const switched = await run(storage => { storage[key] = JSON.stringify(sessionB); });
  assert.equal(switched.result, null);
  assert.deepEqual(switched.stored, sessionB, 'old refresh must not restore the previous account');
  const logout = await run(storage => { delete storage[key]; });
  assert.equal(logout.result, null);
  assert.equal(logout.stored, null, 'old refresh must not resurrect a logged-out session');
  const rotated = await run(storage => { storage[key] = JSON.stringify({ ...sessionA, refresh_token: 'newer-tab-token' }); });
  assert.equal(rotated.result, null);
  assert.equal(rotated.stored.refresh_token, 'newer-tab-token');
  console.log('auth proxy scope: ordinary refresh, tenant switch, logout and token rotation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
