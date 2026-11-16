#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'src/lib/admin-http.ts'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'src/components/Dashboard.tsx'), 'utf8');

// Fixture do contrato: não faz login nem toca no banco. Ele modela somente a
// decisão de transporte que o helper deve tomar no browser.
const privateApi = /^\/api\/(?:fiscal(?:\/|$)|backup(?:\/|$)|seed(?:[/?]|$)|seed-menu(?:[/?]|$)|agent-config(?:[/?]|$)|fix-tables(?:[/?]|$)|admin\/create-waiter(?:[/?]|$))/;
const origin = 'https://fixture.example.test';
function transportFor(input) {
  const url = new URL(input, origin);
  const privateRequest = url.origin === origin && privateApi.test(url.pathname);
  return {
    transport: privateRequest ? 'admin' : 'native',
    headers: privateRequest ? { Authorization: 'Bearer fixture-session-token' } : {},
  };
}

for (const url of [
  '/api/fiscal/config/tenant-a',
  '/api/fiscal/xml/chave?tenant=tenant-a',
  '/api/backup/list',
  '/api/seed',
  '/api/seed-menu',
  '/api/agent-config?tenant=tenant-a',
  '/api/fix-tables',
  '/api/admin/create-waiter',
]) {
  const result = transportFor(url);
  assert.equal(result.transport, 'admin', `${url} deve usar adminFetch`);
  assert.equal(result.headers.Authorization, 'Bearer fixture-session-token');
}

for (const url of ['/api/health', '/api/version', '/download/fechaconta-agente.exe', 'https://printer.example.test/print', 'https://foreign.example.test/api/fiscal/config/tenant-a']) {
  const result = transportFor(url);
  assert.equal(result.transport, 'native', `${url} deve permanecer no fetch nativo`);
  assert.deepEqual(result.headers, {}, `${url} não pode receber Bearer`);
}

assert.match(adminSource, /isPrivateAdminRequest/);
assert.match(adminSource, /url\.origin === window\.location\.origin/);
assert.match(adminSource, /headers\.set\('Authorization', `Bearer \$\{token\}`\)/);
assert.match(adminSource, /export function fetchWithAdminAuth/);
assert.match(adminSource, /export async function downloadAdminFile/);
assert.match(dashboardSource, /const fetch = fetchWithAdminAuth;/);
assert.match(dashboardSource, /downloadAdminFile\([^\n]*\/api\/agent-config/);
assert.match(dashboardSource, /downloadAdminFile\([^\n]*\/api\/fiscal\/xml\//);
assert.doesNotMatch(dashboardSource, /href=\{`\/api\/(?:fiscal|backup|agent-config)/);

console.log('test-admin-http-client: ok');
