#!/usr/bin/env node
'use strict';
/**
 * Isolated waiter-auth harness. It extracts only the real Socket callbacks
 * from server.ts; it never imports/start the application or touches a DB.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const esbuild = require('esbuild');
const {
  ROOT,
  FakeSocket,
  FakeIO,
  clone,
  loadTsModule,
  waitTick,
} = require('./testsHelpers.cjs');

const SERVER = path.join(ROOT, 'server.ts');
const source = fs.readFileSync(SERVER, 'utf8');
const waiterAuth = loadTsModule('src/server/waiter-auth.ts', 'waiter-auth');
const tenantSwitch = loadTsModule('src/server/socket-tenant.ts', 'waiter-auth-tenant');

function extractHandler(eventName) {
  const file = ts.createSourceFile(SERVER, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let text;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'on' && node.arguments.length >= 2 &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === eventName &&
        ts.isArrowFunction(node.arguments[1])) {
      text = node.arguments[1].getText(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(text, `handler ${eventName} não encontrado`);
  return text;
}

function loadHandler(eventName, deps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pdv-waiter-${eventName}-`));
  const outfile = path.join(dir, 'handler.cjs');
  const handler = extractHandler(eventName);
  const wrapper = `
    const {
      socket, io, loadTenantIfNeeded, getState, saveToSupabase, db,
      buildWaiterAuthAck, findWaiterByCredentials, isApprovedWaiter,
      isWaiterActorForTenant, projectWaitersForActor, sanitizeWaiter,
      waiterCredentialsMatch, authActorSafe, publicWaiters, waiterForTenant,
      isAdminForTenant, _tid, __BUILD_ID__,
    } = globalThis.__pdvWaiterDeps;
    const { randomUUID } = require('node:crypto');
    const { switchSocketTenant } = globalThis.__pdvWaiterDeps;
    const handler = ${handler};
    module.exports = { handler };
  `;
  globalThis.__pdvWaiterDeps = { ...deps, ...waiterAuth, ...tenantSwitch };
  try {
    esbuild.buildSync({
      stdin: { contents: wrapper, sourcefile: `${eventName}-extract.ts`, loader: 'ts' },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      outfile,
      logLevel: 'silent',
    });
    delete require.cache[require.resolve(outfile)];
    return require(outfile).handler;
  } finally {
    delete globalThis.__pdvWaiterDeps;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeState(waiters) {
  return {
    waiters: waiters.map(clone),
    orders: [{ id: 'other-order' }],
    tables: [{ id: 1, status: 'occupied', currentOrder: 'other-order', linkedTo: null }],
    comandas: [],
    stock: [{ id: 'stock-1', quantity: 3 }],
    stockLog: [],
    menu: [],
    pizzaFlavors: [],
    pizzaCrusts: [],
    pizzaSizes: [],
    isCashRegisterOpen: true,
    shiftStartedAt: '2026-11-16T10:00:00.000Z',
    pizzariaConfig: {},
    printerAgentSocket: null,
  };
}

function makeHarness(waiters = []) {
  const io = new FakeIO();
  const socket = new FakeSocket('socket-waiter', io, 'tenant-a');
  socket.tenantId = 'tenant-a';
  socket.pendingTenantId = 'tenant-a';
  const states = new Map([['tenant-a', makeState(waiters)]]);
  const db = {
    calls: [],
    loaded: [],
    async load(tenantId) {
      this.loaded.push(tenantId);
      return states.get(tenantId);
    },
  };
  const deps = {
    socket,
    io,
    db,
    __BUILD_ID__: 'waiter-test-build',
    getState: tenantId => states.get(String(tenantId)),
    loadTenantIfNeeded: async tenantId => db.load(String(tenantId)),
    saveToSupabase: async (collection, data, docId, tenantId) => {
      db.calls.push({ collection, data: clone(data), docId, tenantId });
    },
    publicWaiters: waiterAuth.sanitizeWaiters,
    waiterForTenant: tenantId => {
      const actor = waiterAuth.authActorSafe(socket.authContext);
      const waiter = states.get(String(tenantId))?.waiters.find(candidate => String(candidate.id) === String(actor?.waiterId));
      return waiterAuth.isWaiterActorForTenant(actor, tenantId, waiter) ? waiter : null;
    },
    isAdminForTenant: tenantId => Boolean(socket.isAdmin && socket.authContext?.role === 'admin' && socket.authContext.tenantId === tenantId),
    _tid: () => String(socket.tenantId || 'default'),
  };
  return { socket, io, states, db, deps };
}

async function invoke(handler, socket, payload) {
  let callbackAck;
  const result = await handler(payload, ack => { callbackAck = clone(ack); });
  await waitTick();
  return { result, ack: callbackAck };
}

async function testRegisterWaitsForDurableAck() {
  const h = makeHarness();
  let release;
  const persistence = new Promise(resolve => { release = resolve; });
  h.deps.saveToSupabase = async (collection, data, docId, tenantId) => {
    h.db.calls.push({ collection, data: clone(data), docId, tenantId });
    await persistence;
  };
  const register = loadHandler('waiter_register', h.deps);
  const task = invoke(register, h.socket, {
    id: 'attacker-supplied-id', name: 'Ana', phone: '555', cpf: '111', password: 'secret', status: 'approved',
  });
  await waitTick();
  assert.equal(h.socket.events('waiter_login_ack').length, 0, 'ACK não pode sair antes do save');
  release();
  const { ack } = await task;
  assert.equal(ack.ok, true);
  assert.equal(ack.status, 'pending');
  assert.equal(ack.waiter.status, 'pending');
  assert.equal('password' in ack.waiter, false);
  assert.equal(h.states.get('tenant-a').waiters[0].id, '111');
  assert.equal(h.states.get('tenant-a').waiters[0].status, 'pending');
  assert.equal(h.db.calls[0].tenantId, 'tenant-a');
  assert.equal(h.db.calls[0].data.password, 'secret');
}

async function testDuplicateCannotResetApprovedCredentials() {
  const original = { id: 'w-approved', name: 'Bia', phone: '555', cpf: '222', password: 'original', status: 'approved' };
  const h = makeHarness([original]);
  const register = loadHandler('waiter_register', h.deps);
  const { ack } = await invoke(register, h.socket, {
    id: 'new-id', name: 'Bia', phone: '555', cpf: '222', password: 'replacement', status: 'pending',
  });
  const waiter = h.states.get('tenant-a').waiters[0];
  assert.equal(ack.ok, false);
  assert.equal(ack.status, undefined, 'duplicata sem senha válida não deve revelar status');
  assert.equal(waiter.password, 'original');
  assert.equal(waiter.status, 'approved');
  assert.equal(h.db.calls.length, 0, 'duplicata não deve sobrescrever credencial/status');
}

async function testApprovedLoginProjectsOnlyOwnWaiter() {
  const h = makeHarness([
    { id: 'w-own', name: 'Cris', phone: '1', password: 'pw', status: 'approved' },
    { id: 'w-other', name: 'Dora', phone: '2', password: 'other-pw', status: 'approved' },
  ]);
  const login = loadHandler('waiter_login', h.deps);
  const { ack } = await invoke(login, h.socket, { name: 'Cris', password: 'pw' });
  assert.equal(ack.ok, true);
  assert.equal(ack.status, 'approved');
  assert.equal('password' in ack.waiter, false);
  const init = h.socket.last('init_data');
  assert.equal(init.currentWaiter.id, 'w-own');
  assert.deepEqual(init.waiters.map(w => w.id), ['w-own']);
  assert.equal(JSON.stringify(init).includes('other-pw'), false);
  assert.equal(h.socket.authContext.role, 'waiter');
  assert.equal(h.socket.isAdmin, undefined);

  const requestInit = loadHandler('request_init_data', h.deps);
  const request = await invoke(requestInit, h.socket, { tenantId: 'tenant-a' });
  assert.equal(request.ack.ok, true);
  const requestedSnapshot = h.socket.last('init_data');
  assert.equal(requestedSnapshot.currentWaiter.id, 'w-own');
  assert.deepEqual(requestedSnapshot.waiters.map(w => w.id), ['w-own']);
  assert.equal(JSON.stringify(requestedSnapshot).includes('other-pw'), false);
}

async function testPendingLoginAckAndNoSnapshot() {
  const h = makeHarness([{ id: 'w-pending', name: 'Eva', password: 'pw', status: 'pending' }]);
  const login = loadHandler('waiter_login', h.deps);
  const { ack } = await invoke(login, h.socket, { name: 'Eva', password: 'pw' });
  assert.equal(ack.ok, true);
  assert.equal(ack.status, 'pending');
  assert.equal(h.socket.events('init_data').length, 0);
  assert.equal(h.socket.last('waiter_approved').status, 'pending');
}

async function testVerifiedOwnerCannotDowngradeOnWaiterLogin() {
  const original = { id: 'w-owner-target', name: 'Fabi', password: 'pw', status: 'approved' };
  const h = makeHarness([original]);
  h.socket.isAdmin = true;
  h.socket.authContext = { role: 'admin', tenantId: 'tenant-a', ready: true };
  const login = loadHandler('waiter_login', h.deps);
  const { ack } = await invoke(login, h.socket, { name: 'Fabi', password: 'pw' });
  assert.equal(ack.ok, false);
  assert.match(ack.message, /sessão administrativa/i);
  assert.equal(h.socket.authContext.role, 'admin');
  assert.equal(h.socket.isAdmin, true);
  assert.equal(h.db.calls.length, 0);
  assert.equal(h.socket.events('init_data').length, 0);
}

function testPureActorProjection() {
  const waiters = [
    { id: 'one', name: 'One', password: 'one-pw', status: 'approved' },
    { id: 'two', name: 'Two', password: 'two-pw', status: 'pending' },
  ];
  const admin = waiterAuth.projectWaitersForActor(waiters, { role: 'admin', tenantId: 'tenant-a' });
  const own = waiterAuth.projectWaitersForActor(waiters, { role: 'waiter', tenantId: 'tenant-a', waiterId: 'two', credentialsValidated: true });
  assert.deepEqual(admin.map(w => w.id), ['one', 'two']);
  assert.deepEqual(own.map(w => w.id), ['two']);
  assert.equal(JSON.stringify(admin).includes('one-pw'), false);
  assert.equal(JSON.stringify(own).includes('two-pw'), false);
  assert.deepEqual(waiterAuth.authActorSafe({ role: 'waiter', tenantId: 'tenant-a', waiterId: 'two', credentialsValidated: true }), {
    role: 'waiter', tenantId: 'tenant-a', waiterId: 'two', credentialsValidated: true,
  });
  assert.equal(waiterAuth.authActorSafe({ role: 'waiter', tenantId: 'tenant-a', waiterId: 'two' }), null);
}

(async () => {
  await testRegisterWaitsForDurableAck();
  await testDuplicateCannotResetApprovedCredentials();
  await testApprovedLoginProjectsOnlyOwnWaiter();
  await testPendingLoginAckAndNoSnapshot();
  await testVerifiedOwnerCannotDowngradeOnWaiterLogin();
  testPureActorProjection();
  console.log('test-waiter-auth: passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
