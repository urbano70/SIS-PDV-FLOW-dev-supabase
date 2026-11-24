#!/usr/bin/env node
'use strict';
// Actual HTTP handler and grant helpers extracted by AST. All Auth/Storage calls
// use in-memory fixtures; no production server, network or database is loaded.
require('tsx/cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const esbuild = require('esbuild');
const serviceApi = require('../src/server/establishment-profile.ts');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server.ts'), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const names = ['redactAuthError', 'issueAuthGrant', 'migrateGrantBeforeResponse'];
const declarations = {};
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) declarations[node.name.getText(ast)] = node.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'app.post' && node.arguments[0]?.text === '/api/auth/refresh') callback = node.arguments.at(-1).getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback);
const code = esbuild.transformSync(`const {EstablishmentProfileError,hasLegacyLogoMetadata,establishmentProfile,fetch,publishEstablishmentProfile}=__deps;
const authProxyBase='https://fixture.supabase.test'; const authProxyAnonKey='fixture-anon';
${names.map(name => 'const ' + declarations[name] + ';').join('\n')}
module.exports=${callback};`, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
const clone = value => JSON.parse(JSON.stringify(value));
const image = 'data:image/jpeg;base64,' + Buffer.from('ffd8ffc00011080010001003011100021100031100ffd9', 'hex').toString('base64');
function fixture({ logo = image, rejectGrant = false, failWrite = false, silentWrite = false, badSecond = false } = {}) {
  let user = { id: 'tenant-a', app_metadata: { protected: true }, user_metadata: { logo_url: logo, plan: 'premium', establishment_name: 'Loja', responsible_name: 'Preservado' } };
  const calls = [], uploads = [], events = [];
  const service = serviceApi.createEstablishmentProfileService({
    supabaseUrl: 'https://fixture.supabase.test',
    authAdmin: {
      getUserById: async id => { assert.equal(id, user.id); return { data: { user: clone(user) } }; },
      updateUserById: async (id, attrs) => {
        assert.equal(id, user.id);
        if (failWrite) return { error: new Error('write failed') };
        if (!silentWrite) user.user_metadata = { ...user.user_metadata, ...clone(attrs.user_metadata) };
        return { data: { user: clone(user) } };
      },
    },
    storage: {
      getBucket: async () => ({ error: { status: 404, message: 'Bucket not found' } }),
      createBucket: async () => ({ error: null }),
      from: () => ({ upload: async (path, bytes) => { uploads.push({ path, bytes }); return { error: null }; },
        getPublicUrl: path => ({ data: { publicUrl: 'https://fixture.supabase.test/storage/v1/object/public/pdv-establishment-logos/' + path } }) }),
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, process: { env: { SUPABASE_URL: 'https://fixture.supabase.test' } },
    __deps: { ...serviceApi, establishmentProfile: service,
      publishEstablishmentProfile: (id, confirmedUser, profile) => events.push({ id, user: clone(confirmedUser), profile: clone(profile) }),
      fetch: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        assert.equal(init.headers.Authorization, undefined, 'grant never sends large JWT in a header');
        if (rejectGrant) return { ok: false, status: 401, json: async () => ({ error: 'Invalid refresh token' }) };
        return { ok: true, status: 200, json: async () => ({
          access_token: serviceApi.hasLegacyLogoMetadata(user) || (badSecond && calls.length > 1) ? 'X'.repeat(375928) : 'clean-token',
          refresh_token: 'fixture12abc', expires_in: 3600, user: clone(user),
        }) };
      },
    },
  });
  return { calls, uploads, events, getUser: () => clone(user), async run(body) {
    const result = { status: 200, payload: null };
    const res = { status(value) { result.status = value; return this; }, json(value) { result.payload = clone(value); return this; } };
    await module.exports({ body }, res);
    return result;
  } };
}
(async () => {
  const migrated = fixture();
  const valid = await migrated.run({ refresh_token: 'abcdefghijkl' });
  assert.equal(valid.status, 200);
  assert.equal(migrated.calls[0].body.refresh_token.length, 12);
  assert.equal(migrated.calls.length, 2, 'a second grant issues the clean JWT');
  assert.equal(valid.payload.access_token, 'clean-token');
  assert.equal(migrated.uploads.length, 1);
  assert.equal(valid.payload.user.user_metadata.plan, 'premium');
  assert.equal(valid.payload.user.user_metadata.responsible_name, 'Preservado');
  for (const token of ['', '   ', null, 123, 'a'.repeat(2049)]) {
    const f = fixture(); const result = await f.run({ refresh_token: token });
    assert.equal(result.status, 400); assert.equal(f.calls.length, 0);
  }
  const denied = fixture({ rejectGrant: true });
  assert.notEqual((await denied.run({ refresh_token: 'abcdefghijkl', removeLogo: true, fields: {} })).status, 200);
  assert.equal(denied.getUser().user_metadata.logo_url, image);
  assert.equal(denied.uploads.length, 0);
  const removed = fixture({ logo: 'data:image/svg+xml;base64,PHN2Zy8+' });
  const removal = await removed.run({ refresh_token: 'abcdefghijkl', removeLogo: true, fields: { address: 'Novo endereço' } });
  assert.equal(removal.status, 200); assert.equal(removal.payload.ok, true);
  assert.equal(removal.payload.profile.logo_url, '');
  assert.equal(removal.payload.user.user_metadata.logo_url, '');
  assert.equal(removal.payload.profile.address, 'Novo endereço');
  assert.equal(removal.payload.user.user_metadata.plan, 'premium');
  assert.deepEqual(removal.payload.user.app_metadata, { protected: true });
  assert.equal(removed.uploads.length, 0); assert.equal(removed.events.length, 1);
  const shortLogo = fixture({ logo: 'https://cdn.fixture.test/old.jpg' });
  const shortRemoval = await shortLogo.run({ refresh_token: 'abcdefghijkl', removeLogo: true, fields: {} });
  assert.equal(shortRemoval.status, 200);
  assert.equal(shortLogo.calls.length, 2, 'removing a short logo also issues a new session');
  assert.equal(shortRemoval.payload.user.user_metadata.logo_url, '');
  assert.equal(shortRemoval.payload.profile.logo_url, '');
  for (const options of [{ failWrite: true }, { silentWrite: true }, { badSecond: true }]) {
    const f = fixture(options); const result = await f.run({ refresh_token: 'abcdefghijkl', removeLogo: true, fields: {} });
    assert.equal(result.status, 503); assert.equal(result.payload.access_token, undefined);
    assert.equal(result.payload.recovery_pending, true); assert.equal(f.events.length, 0);
  }
  const prohibited = fixture();
  assert.equal((await prohibited.run({ refresh_token: 'abcdefghijkl', removeLogo: true, fields: { plan: 'free' } })).status, 400);
  assert.equal(prohibited.getUser().user_metadata.plan, 'premium');
  const wrongTenant = fixture();
  assert.equal((await wrongTenant.run({ refresh_token: 'abcdefghijkl', removeLogo: true, fields: {}, tenantId: 'tenant-b' })).status, 400);
  assert.equal(wrongTenant.getUser().user_metadata.logo_url, image);
  console.log('logo refresh handler: 12-character grants, invalid credentials, clean JWT, explicit legacy removal, persistence failures and tenant allowlist passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
