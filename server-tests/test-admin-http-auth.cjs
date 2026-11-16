#!/usr/bin/env node
'use strict';

require('tsx/cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  authorizeAdminRequest,
  extractAdminAccessToken,
} = require('../src/server/admin-auth.ts');

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function fakeGetUser(token) {
  if (token === 'valid-owner-access-token') {
    return Promise.resolve({ data: { user: { id: OWNER_ID, role: 'owner' } }, error: null });
  }
  return Promise.resolve({ data: { user: null }, error: new Error('invalid token') });
}

async function expectStatus(request, options, status) {
  const result = await authorizeAdminRequest(request, options);
  assert.equal(result.ok, false);
  assert.equal(result.status, status);
  return result;
}

(async () => {
  const common = { getUser: fakeGetUser, tenantIds: [OWNER_ID] };

  const valid = await authorizeAdminRequest({
    headers: { authorization: 'Bearer valid-owner-access-token' },
  }, common);
  assert.equal(valid.ok, true, 'um token confirmado por getUser deve autorizar');
  assert.equal(valid.userId, OWNER_ID);
  assert.equal(extractAdminAccessToken({ body: { token: 'legacy-body-token' } }), 'legacy-body-token');
  assert.equal(extractAdminAccessToken({ query: { token: 'legacy-query-token' } }), 'legacy-query-token');

  await expectStatus({
    headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZWQi.forged' },
  }, common, 401);
  await expectStatus({}, common, 401);
  await expectStatus({
    query: { token: 'opaque-playground-operator-token' },
  }, common, 401);
  await expectStatus({
    headers: { authorization: 'Bearer valid-owner-access-token' },
  }, { ...common, tenantIds: [OTHER_ID] }, 403);
  await expectStatus({
    headers: { authorization: 'Bearer valid-owner-access-token' },
  }, { getUser: undefined, tenantIds: [OWNER_ID] }, 503);

  const bodyToken = await authorizeAdminRequest({ body: { token: 'valid-owner-access-token' } }, common);
  assert.equal(bodyToken.ok, true, 'transport legado no body continua usando getUser real');
  const queryToken = await authorizeAdminRequest({ query: { token: 'valid-owner-access-token' } }, common);
  assert.equal(queryToken.ok, true, 'transport legado na query continua usando getUser real');

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
  const apiBlock = serverSource.slice(serverSource.indexOf('  // API Routes'));
  for (const route of [
    '/api/fiscal/config/:tenantId',
    '/api/fiscal/nfce/:orderId',
    '/api/fiscal/xml/:chaveAcesso',
    '/api/backup/list',
    '/api/backup/download/:nome',
    '/api/backup/now',
    '/api/seed',
    '/api/seed-menu',
    '/api/agent-config',
    '/api/fix-tables',
  ]) {
    assert.ok(apiBlock.includes(route), `rota privada ausente: ${route}`);
  }
  assert.ok(apiBlock.includes('const requireAdminHttp'), 'adaptador de autenticação HTTP ausente');
  assert.ok(apiBlock.includes('getUser.bind'), 'rotas HTTP não estão ligadas ao Supabase Auth getUser');
  assert.ok(apiBlock.includes('/api/health'), 'health deve continuar público');
  assert.ok(apiBlock.includes('/api/version'), 'version deve continuar público');
  assert.ok(apiBlock.includes('/download/fechaconta-agente.exe'), 'download do instalador deve continuar público');

  console.log('test-admin-http-auth: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
