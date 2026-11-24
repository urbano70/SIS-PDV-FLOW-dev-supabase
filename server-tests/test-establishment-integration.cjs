#!/usr/bin/env node
'use strict';
// Production AST handlers, real persistence helper, fake Auth/Storage/HTTP only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const plain = value => JSON.parse(JSON.stringify(value));
function variable(name) {
 let value;
 const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node.initializer.getText(ast); ts.forEachChild(node, visit); };
 visit(ast); assert.ok(value, name); return `const ${name} = ${value};`;
}
function socketHandler(name) {
 let value;
 const visit = node => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'socket.on' && node.arguments[0]?.text === name) value = node.arguments[1].arguments[0].getText(ast);
  ts.forEachChild(node, visit);
 }; visit(ast); assert.ok(value, name); return value;
}
const compiled = esbuild.buildSync({ stdin: { contents: `
 import { createEstablishmentProfileService, EstablishmentProfileError, hasLegacyLogoMetadata, brandingFromUser, publicLogoReference } from './src/server/establishment-profile.ts';
 const { fetch, establishmentProfile, saveToSupabase, _tid, _st, io, socket, synchronizePlaygroundCatalog, normalizePlaygroundConfig, saveMenuToSupabaseAwait, getState } = globalThis.__deps;
 const authProxyBase = 'https://fixture.supabase.test'; const authProxyAnonKey = 'fixture-not-real';
 const clonePersistenceData = value => JSON.parse(JSON.stringify(value));
 ${['redactAuthError', 'issueAuthGrant', 'migrateGrantBeforeResponse', 'applyUserBrandingToState', 'publicEstablishmentProfile', 'publishEstablishmentProfile'].map(variable).join('\n')}
 const _room = () => 'tenant:' + _tid();
 const savePrinter = ${socketHandler('save_printer_config')};
 const savePizzeria = ${socketHandler('update_pizzaria_config')};
 module.exports = { issueAuthGrant, migrateGrantBeforeResponse, savePrinter, savePizzeria, applyUserBrandingToState, publishEstablishmentProfile, createEstablishmentProfileService };
 `, sourcefile: 'logo-integration-fixture.ts', resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', target: 'node20', write: false, logLevel: 'silent' }).outputFiles[0].text;
const jpeg = Buffer.from('ffd8ffc00011080010001003011100021100031100ffd9', 'hex');
const dataUrl = 'data:image/jpeg;base64,' + jpeg.toString('base64');
function harness(options = {}) {
 const tid = 'tenant-a';
 const metadata = { plan: 'premium', establishment_name: 'Loja A', address: 'Rua A', responsible_name: 'Privado', logo_url: options.legacy ? dataUrl : 'https://cdn.fixture.test/old.jpg' };
 const user = { id: tid, user_metadata: metadata, app_metadata: { guard: 'unchanged' } };
 const state = { pizzariaConfig: { enabled: false, logoUrl: metadata.logo_url }, printerConfig: { receipts: 'USB', logoUrl: metadata.logo_url }, menu: [], establishmentBranding: { logoUrl: metadata.logo_url } };
 const events = [], writes = [], calls = [], uploads = [];
 let failWrite = false, pauseWrite = null;
 const deps = {
  _tid: () => tid, _st: () => state, getState: id => { assert.equal(id, tid); return state; },
  io: { to: room => ({ emit: (event, payload) => events.push({ room, event, payload: plain(payload) }) }) }, socket: { emit() {} },
  normalizePlaygroundConfig: (_id, cfg) => ({ ...cfg }), synchronizePlaygroundCatalog: () => ({ changed: false }), saveMenuToSupabaseAwait: async () => {},
  saveToSupabase: async (table, data, id, tenant) => { writes.push({ table, data: plain(data), id, tenant }); if (pauseWrite) await pauseWrite; if (failWrite) throw new Error('fixture DB failure'); },
  fetch: async (url, init) => {
   calls.push({ url, init });
   assert.equal(init.headers.Authorization, undefined, 'Auth grant uses body, not legacy JWT header');
   const second = calls.length > 1;
   const returnedUser = options.wrongSecondUser && second ? { ...user, id: 'tenant-b' } : plain(user);
   return { ok: true, status: 200, json: async () => ({ access_token: (options.legacy && !second) || (options.largeSecond && second) ? 'X'.repeat(375928) : 'short-clean-token', refresh_token: `rotated-${calls.length}`, user: returnedUser }) };
  },
 };
 const context = { module: { exports: {} }, __deps: deps, Buffer, URL, require: name => { assert.ok(name.startsWith('node:')); return require(name); }, process: { env: { SUPABASE_URL: 'https://fixture.supabase.test' } }, console: { warn() {} } };
 vm.runInNewContext(compiled, context);
 const service = context.module.exports.createEstablishmentProfileService({
  supabaseUrl: 'https://fixture.supabase.test',
  authAdmin: { getUserById: async id => { assert.equal(id, tid); return { data: { user: plain(user) }, error: null }; }, updateUserById: async (id, attrs) => { assert.equal(id, tid); user.user_metadata = { ...user.user_metadata, ...plain(attrs.user_metadata) }; return { data: { user: plain(user) }, error: null }; } },
  storage: { getBucket: async () => ({ data: { id: 'pdv-establishment-logos' }, error: null }), createBucket: async () => ({ error: null }), from: () => ({ upload: async (objectPath, bytes) => { uploads.push({ objectPath, bytes: Buffer.from(bytes) }); return { error: null }; }, getPublicUrl: p => ({ data: { publicUrl: `https://fixture.supabase.test/storage/v1/object/public/pdv-establishment-logos/${p}` } }) }) },
 });
 deps.establishmentProfile = service;
 // Re-evaluate with the real injected service, still no live server imports.
 context.module = { exports: {} }; vm.runInNewContext(compiled, vm.createContext({ ...context }));
 const api = context.module.exports;
 return { ...api, user, state, events, writes, calls, uploads, setFail: value => { failWrite = value; }, pause: promise => { pauseWrite = promise; } };
}
(async () => {
 const migrated = harness({ legacy: true });
 const first = await migrated.issueAuthGrant('refresh_token', { refresh_token: 'fixture-old-refresh-token' });
 const clean = await migrated.migrateGrantBeforeResponse(first);
 assert.equal(clean.access_token, 'short-clean-token');
 assert.equal(migrated.calls.length, 2);
 assert.equal(migrated.uploads.length, 1);
 assert.deepEqual(migrated.uploads[0].bytes, jpeg);
 assert.ok(!JSON.stringify(clean).includes('data:image'));
 assert.equal(migrated.user.user_metadata.responsible_name, 'Privado');
 assert.equal(migrated.user.user_metadata.plan, 'premium');
 const wrong = harness({ legacy: true, wrongSecondUser: true });
 await assert.rejects(wrong.migrateGrantBeforeResponse(await wrong.issueAuthGrant('refresh_token', { refresh_token: 'old-token' })), error => error.code === 'AUTH_CLEAN_GRANT_NOT_CONFIRMED');
 const large = harness({ legacy: true, largeSecond: true });
 await assert.rejects(large.migrateGrantBeforeResponse(await large.issueAuthGrant('refresh_token', { refresh_token: 'old-token' })), error => error.code === 'AUTH_CLEAN_GRANT_NOT_CONFIRMED');
 const normal = harness();
 const payload = await normal.issueAuthGrant('password', { email: 'fixture@example.test', password: 'fictitious' });
 await normal.migrateGrantBeforeResponse(payload);
 assert.equal(normal.calls.length, 1, 'safe existing short reference does not require another grant');
 let resume;
 normal.pause(new Promise(resolve => { resume = resolve; }));
 const acks = [];
 const pending = normal.savePrinter({ receipts: 'LAN', logoUrl: 'data:image/jpeg;base64,stale', tenantId: 'tenant-a', requestId: 'fixture' }, ack => acks.push(plain(ack)));
 await Promise.resolve();
 assert.equal(acks.length, 0, 'no ACK before persistence');
 assert.equal(normal.events.length, 0, 'no broadcast before persistence');
 normal.state.establishmentBranding.logoUrl = '';
 resume(); await pending;
 assert.equal(acks[0].ok, true); assert.equal(acks[0].tenantId, 'tenant-a');
 assert.equal(acks[0].config.logoUrl, '', 'concurrent confirmed removal cannot be resurrected by stale printer save');
 assert.ok(!('requestId' in normal.writes[0].data));
 normal.pause(null); normal.setFail(true);
 const failed = await normal.savePizzeria({ enabled: true, logoUrl: 'https://stale.fixture.test/logo.jpg', tenantId: 'tenant-a' });
 assert.equal(failed.ok, false); assert.equal(failed.tenantId, 'tenant-a');
 assert.equal(normal.state.pizzariaConfig.logoUrl, '');
 normal.setFail(false);
 const saved = await normal.savePizzeria({ enabled: true, tenantId: 'tenant-a' });
 assert.equal(saved.ok, true); assert.equal(saved.tenantId, 'tenant-a'); assert.equal(saved.config.logoUrl, '');
 const rejected = await normal.savePrinter({ tenantId: 'tenant-b' });
 assert.equal(rejected.ok, false); assert.equal(rejected.tenantId, 'tenant-a');
 normal.applyUserBrandingToState('tenant-a', { id: 'tenant-a', user_metadata: { logo_url: dataUrl } });
 assert.equal(normal.state.printerConfig.logoUrl, '');
 const getBlock = source.slice(source.indexOf("app.get('/api/establishment/profile'"), source.indexOf("app.post('/api/establishment/profile'"));
 assert.ok(!getBlock.includes('publishEstablishmentProfile('), 'GET cannot create profile broadcast/refetch loop');
 console.log('establishment integration: real grant migration/clean JWT, mismatch/oversize rejection, delayed ACK, stale config/removal, failed write and public projection passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
