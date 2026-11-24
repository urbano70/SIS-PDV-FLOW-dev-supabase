#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const helperPath = path.join(root, 'src/lib/establishment-profile.ts');
const panelPath = path.join(root, 'src/pages/UserPanel.tsx');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const panelSource = fs.readFileSync(panelPath, 'utf8');

// Static UI contract: this suite never starts Vite/PDV, opens a browser, or touches Supabase.
assert.match(panelSource, /getEstablishmentProfile\(\)/);
assert.match(panelSource, /saveEstablishmentProfile\(/);
assert.match(panelSource, /currentTenantRef/);
assert.match(panelSource, /profileRequestVersionRef/);
assert.match(panelSource, /requestTenantId/);
assert.match(panelSource, /!editOpenRef\.current/);
assert.match(panelSource, /establishment-profile-updated/);
assert.match(panelSource, /FileReader/);
assert.match(panelSource, /createElement\('canvas'\)/);
assert.match(panelSource, /MAX_LOGO_RAW_BYTES = 600_000/);
assert.match(panelSource, /MAX_LOGO_ENCODED_BYTES = 600_000/);
assert.match(panelSource, /accept="image\/png,image\/jpeg,image\/svg\+xml/);
assert.match(panelSource, /e\.target\.value = ''/);
assert.doesNotMatch(panelSource, /function saveLogo/);
assert.doesNotMatch(panelSource, /localStorage\.getItem\('printerConfig'\)/);
assert.doesNotMatch(panelSource, /logo_url:\s*formData\.logo/);

// Ask esbuild to parse the changed TSX without importing the application, Auth, or providers.
esbuild.transformSync(panelSource, { loader: 'tsx', format: 'esm', target: 'es2022' });

// Transform only the helper and provide a deterministic adminFetch seam for this client-only test.
const helperFixtureSource = helperSource.replace(
  "import { adminFetch } from './admin-http';",
  "const adminFetch = (...args) => globalThis.__establishmentProfileAdminFetch(...args);",
);
const transformedHelper = esbuild.transformSync(helperFixtureSource, {
  loader: 'ts',
  format: 'cjs',
  target: 'node18',
});
const compiledModule = { exports: {} };
new Function('module', 'exports', transformedHelper.code)(compiledModule, compiledModule.exports);
const api = compiledModule.exports;

const fields = {
  establishment_name: 'Loja A',
  establishment_type: 'Bar',
  establishment_type_other: '',
  cnpj: '00.000.000/0001-00',
  responsible_name: 'Ana',
  address: 'Rua A',
  phone_whatsapp: '5511999999999',
  responsible_whatsapp: '5511888888888',
  establishment_email: 'a@example.test',
};
const profile = {
  ...fields,
  logo_url: 'https://cdn.example.test/logo-a.png',
};
const responseFor = (name, status = 200) => new Response(JSON.stringify({
  ok: true,
  user: { id: name, user_metadata: { establishment_name: name } },
  profile: { ...profile, establishment_name: name },
}), { status, headers: { 'Content-Type': 'application/json' } });

(async () => {
  const calls = [];
  globalThis.__establishmentProfileAdminFetch = async (input, init = {}) => {
    calls.push({ input, init });
    return responseFor('Loja A');
  };

  const loaded = await api.getEstablishmentProfile();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.profile.logo_url, profile.logo_url);
  assert.equal(calls[0].input, '/api/establishment/profile');
  assert.equal(calls[0].init.method, 'GET');

  calls.length = 0;
  await api.saveEstablishmentProfile({ fields });
  assert.equal(calls.length, 1);
  const savedBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(savedBody, { fields }, 'sem upload/remocao ambos devem ser omitidos');
  assert.equal(calls[0].init.method, 'POST');

  calls.length = 0;
  await api.saveEstablishmentProfile({ fields, removeLogo: true });
  assert.deepEqual(JSON.parse(calls[0].init.body), { fields, removeLogo: true });
  await assert.rejects(
    () => api.saveEstablishmentProfile({ fields, logoDataUrl: 'data:image/png;base64,AA==', removeLogo: true }),
    /não podem ser enviados juntos/,
  );
  assert.equal(calls.length, 1, 'upload e remocao conflitantes nao podem chegar ao endpoint');

  globalThis.__establishmentProfileAdminFetch = async () => new Response(
    JSON.stringify({ error: 'Sessão expirada', code: 'AUTH_REQUIRED' }),
    { status: 401, statusText: 'Unauthorized' },
  );
  await assert.rejects(api.getEstablishmentProfile(), error => {
    assert.equal(error.name, 'EstablishmentProfileHttpError');
    assert.equal(error.status, 401);
    assert.equal(error.code, 'AUTH_REQUIRED');
    assert.equal(error.message, 'Sessão expirada');
    return true;
  }, 'erro HTTP deve rejeitar com status e mensagem, sem falso sucesso');

  globalThis.__establishmentProfileAdminFetch = async () => new Response(
    JSON.stringify({ ok: false, error: 'Falha persistente' }),
    { status: 200 },
  );
  await assert.rejects(api.getEstablishmentProfile(), /Falha persistente/);

  // Two delayed tenants remain independent; the UI's tenant/version guards decide
  // which completion may be applied, while the helper never mixes payloads.
  const pending = [];
  globalThis.__establishmentProfileAdminFetch = async () => new Promise(resolve => pending.push(resolve));
  const tenantA = api.getEstablishmentProfile();
  const tenantB = api.getEstablishmentProfile();
  pending[1](responseFor('tenant-b'));
  pending[0](responseFor('tenant-a'));
  assert.equal((await tenantB).profile.establishment_name, 'tenant-b');
  assert.equal((await tenantA).profile.establishment_name, 'tenant-a');

  const branding = api.brandingFromMetadata({
    establishment_name: 'A',
    cnpj: '',
    phone_whatsapp: '',
    establishment_email: 'a@example.test',
    logo_url: '',
  });
  assert.deepEqual(branding, {
    establishmentName: 'A',
    cnpj: '',
    phone: '',
    email: 'a@example.test',
    logoUrl: '',
  }, 'logo_url vazio e outros campos explicitos sao autoritativos');
  assert.deepEqual(api.brandingFromMetadata({ address: 'Rua A' }), { address: 'Rua A' });
  assert.deepEqual(api.brandingFromMetadata({}), {}, 'propriedade ausente nao deve inventar patch');

  console.log('test-establishment-profile-client: helper HTTP, corrida two-tenant, remocao vazia, branding e contrato UI passaram');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
