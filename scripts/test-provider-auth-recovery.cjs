#!/usr/bin/env node
'use strict';
// Runs the production provider with fake React hooks, socket and auth. No network or DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const transpile = file => esbuild.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {
  loader: file.endsWith('tsx') ? 'tsx' : 'ts', format: 'cjs', target: 'node18', jsx: 'transform',
}).code;
const syncModule = { exports: {} };
vm.runInNewContext(transpile('src/lib/firebaseSync.ts'), { module: syncModule, exports: syncModule.exports });
const commandModule = { exports: {} };
vm.runInNewContext(transpile('src/lib/order-command.ts'), {
  module: commandModule, exports: commandModule.exports, setTimeout, clearTimeout,
});
const providerCode = transpile('src/components/FirebaseProvider.tsx');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
function harness(proxy = async () => ({ access_token: 'fresh-token' }), options = {}) {
  const hooks = [];
  let cursor = 0;
  const scheduled = [];
  const stateWrites = [];
  const notices = [];
  const sent = [];
  const listeners = new Map();
  const timers = new Set();
  const storage = new Map();
  const browserStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) {
      storage.set(key, String(value));
      Object.defineProperty(browserStorage, key, { configurable: true, enumerable: true, value: String(value), writable: true });
    },
    removeItem(key) { storage.delete(key); delete browserStorage[key]; },
  };
  if (options.storedSession) browserStorage.setItem('sb-test-auth-token', JSON.stringify(options.storedSession));
  const socket = {
    connected: true, id: 'connection-a',
    on(event, handler) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(handler); },
    off(event, handler) { listeners.get(event)?.delete(handler); },
    emit(event, ...args) { sent.push({ event, args }); },
    fire(event, ...args) { for (const handler of [...(listeners.get(event) || [])]) handler(...args); },
  };
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    createElement: (type, props, ...children) => ({ type, props, children }),
    useContext: () => undefined,
    useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index]; },
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, value => {
        hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value;
        stateWrites.push({ index, value: hooks[index].value });
      }];
    },
    useEffect(callback, deps) {
      const index = cursor++;
      const old = hooks[index];
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) {
        scheduled.push(() => { old?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
      }
    },
  };
  const module = { exports: {} };
  const auth = {
    refreshViaProxy: proxy,
    getProxyRefreshError: options.getProxyRefreshError || (() => null),
    forceRefreshSession: options.forceRefreshSession || (async () => ({ access_token: 'sdk-token' })),
    getSession: options.getSession || (async () => ({ access_token: 'cached-token' })),
    forceLocalSignOut: async () => { notices.push('sign-out'); },
  };
  vm.runInNewContext(providerCode, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return react;
      if (name === '../lib/socket') return {
        default: socket, __esModule: true,
        clearAdminConnectDedup() {}, isAutoAuthSuspended: () => false, setSocketAuthRole() {},
      };
      if (name === '../lib/auth') return auth;
      if (name === '../lib/firebaseSync') return syncModule.exports;
      if (name === '../lib/order-command') return commandModule.exports;
      if (name === 'sonner') return { toast: {
        error: text => notices.push(text), info: text => notices.push(text), success: text => notices.push(text),
      } };
      throw new Error(`Unexpected production import: ${name}`);
    },
    navigator: { onLine: true },
    window: { localStorage: browserStorage },
    localStorage: browserStorage,
    setTimeout(fn, delay = 0) { const timer = { fn, delay }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    console,
  });
  function render(tenantId = 'tenant-a', isWaiterMode = false) {
    cursor = 0;
    const tree = module.exports.FirebaseProvider({ tenantId, isWaiterMode, children: null });
    for (const run of scheduled.splice(0)) run();
    return tree.props.value;
  }
  function init(tenantId = 'tenant-a', extra = {}) {
    socket.fire('init_data', {
      tenantId, ready: true,
      orders: [{ id: 'order-8', status: 'pending', tableId: '8', items: [] }],
      tables: [{ id: 8, status: 'occupied', currentOrder: 'order-8' }], comandas: [], menu: [], ...extra,
    });
  }
  function close() { for (const hook of hooks) hook?.cleanup?.(); }
  async function runTimer(timer) {
    assert.ok(timers.has(timer), 'timer must still be active');
    timers.delete(timer);
    timer.fn();
    await flush();
  }
  return { socket, sent, notices, stateWrites, timers, render, init, close, runTimer };
}
(async () => {
  const h = harness();
  const context = h.render();
  assert.equal(context.canMutate(), false, 'cache is not an authorization handshake');
  await flush();
  assert.equal(h.sent.filter(e => e.event === 'admin_connect').length, 1);
  h.init();
  assert.equal(context.canMutate(), true);
  const writeCount = h.stateWrites.length;
  h.socket.fire('auth_error', { tenantId: 'tenant-a', message: 'Session changed' });
  assert.equal(context.canMutate(), false, 'auth_error must revoke an already-ready connection immediately');
  assert.ok(!h.stateWrites.slice(writeCount).some(w => Array.isArray(w.value) && w.value.length === 0), 'auth error must preserve the visible order');
  await flush();
  assert.equal(h.sent.filter(e => e.event === 'admin_connect').length, 2, 'refresh must reach the server without replaying payment');
  h.init('tenant-b');
  assert.equal(context.canMutate(), false, 'foreign init must not unlock the current tenant');
  h.init();
  assert.equal(context.canMutate(), true);
  context.refreshSnapshot();
  assert.equal(context.canMutate(), false);
  const request = h.sent.filter(e => e.event === 'request_init_data').at(-1);
  assert.equal(request.args[0].tenantId, 'tenant-a');
  h.init('tenant-a', { initEpoch: 'old-epoch' });
  assert.equal(context.canMutate(), false, 'stale snapshot must not unblock resync');
  request.args[1]({ tenantId: 'tenant-a', ready: true, initEpoch: request.args[0].initEpoch, orders: [] });
  assert.equal(context.canMutate(), true, 'fresh acknowledged snapshot must restore readiness');
  h.socket.connected = false;
  h.socket.fire('disconnect');
  assert.equal(context.canMutate(), false);
  h.socket.id = 'connection-b';
  h.socket.connected = true;
  assert.equal(context.canMutate(), false, 'new socket id is not an authorization handshake');
  h.socket.fire('connect');
  await flush();
  h.init();
  assert.equal(context.canMutate(), true);
  assert.ok(!h.sent.some(e => ['pay_items', 'add_item_to_order', 'new_order', 'force_release_table'].includes(e.event)), 'recovery must never replay a mutation');
  h.close();
  assert.ok([...h.timers].length === 0);

  const initialAuth = deferred();
  let initialAuthCalls = 0;
  const firstEmission = harness(() => {
    initialAuthCalls += 1;
    return initialAuthCalls === 1
      ? initialAuth.promise
      : Promise.resolve({ access_token: 'recovered-initial-token' });
  });
  const firstEmissionContext = firstEmission.render();
  await flush();
  firstEmission.socket.fire('auth_error', { tenantId: 'tenant-a', message: 'Initial grant rejected' });
  await flush();
  assert.equal(firstEmission.sent.filter(e => e.event === 'admin_connect').length, 1, 'auth_error during the first token promise must restart the handshake');
  assert.equal(firstEmission.sent.filter(e => e.event === 'admin_connect')[0].args[0], 'recovered-initial-token');
  initialAuth.resolve({ access_token: 'stale-initial-token' });
  await flush();
  firstEmission.init();
  assert.equal(firstEmissionContext.canMutate(), true, 'the restarted first handshake must accept its fresh init');
  firstEmission.close();

  const oversizedToken = 'J'.repeat(48_001);
  let sdkRefreshCalls = 0;
  let cachedSessionCalls = 0;
  const oversizedFallback = harness(async () => null, {
    forceRefreshSession: async () => {
      sdkRefreshCalls += 1;
      return { access_token: oversizedToken };
    },
    getSession: async () => {
      cachedSessionCalls += 1;
      return { access_token: oversizedToken };
    },
  });
  const oversizedContext = oversizedFallback.render();
  await flush();
  const oversizedState = oversizedFallback.render();
  assert.equal(sdkRefreshCalls, 1);
  assert.equal(cachedSessionCalls, 0, 'an oversized SDK token must block cache/localStorage fallbacks');
  assert.equal(oversizedFallback.sent.filter(e => e.event === 'admin_connect').length, 0, 'oversized fallback tokens must never be emitted as JWT');
  assert.equal(oversizedContext.canMutate(), false);
  assert.match(oversizedState.syncError, /JWT grande|logo inline|proxy/i);
  oversizedFallback.close();

  const timedOut = harness();
  const timedOutContext = timedOut.render();
  await flush();
  const handshakeTimeout = [...timedOut.timers].find(timer => timer.delay === 18_000);
  assert.ok(handshakeTimeout, 'handshake must have a finite timeout');
  await timedOut.runTimer(handshakeTimeout);
  const timedOutState = timedOut.render();
  assert.match(timedOutState.syncError, /Tempo limite/);
  assert.equal(timedOutContext.canMutate(), false);
  const beforeRetry = timedOut.sent.filter(e => e.event === 'admin_connect').length;
  timedOutState.refreshSnapshot();
  await flush();
  assert.equal(timedOut.sent.filter(e => e.event === 'admin_connect').length, beforeRetry + 1, 'retry after timeout must reauthenticate');
  timedOut.init();
  assert.equal(timedOutContext.canMutate(), true);
  timedOut.close();

  const oldAuth = deferred();
  let calls = 0;
  const reconnect = harness(() => ++calls === 1 ? oldAuth.promise : Promise.resolve({ access_token: 'new-connection-token' }));
  const reconnectContext = reconnect.render();
  reconnect.socket.connected = false;
  reconnect.socket.fire('disconnect');
  reconnect.socket.id = 'connection-new';
  reconnect.socket.connected = true;
  reconnect.socket.fire('connect');
  await flush();
  oldAuth.resolve({ access_token: 'stale-connection-token' });
  await flush();
  assert.deepEqual(reconnect.sent.filter(e => e.event === 'admin_connect').map(e => e.args[0]), ['new-connection-token'], 'delayed token from an old connection cannot overwrite the new handshake');
  reconnect.init();
  assert.equal(reconnectContext.canMutate(), true);
  reconnect.close();

  const tenantAuth = deferred();
  let tenantCalls = 0;
  const switcher = harness(() => ++tenantCalls === 1 ? tenantAuth.promise : Promise.resolve({ access_token: 'tenant-b-token' }));
  const a = switcher.render('tenant-a');
  const b = switcher.render('tenant-b');
  await flush();
  tenantAuth.resolve({ access_token: 'tenant-a-stale-token' });
  await flush();
  switcher.init('tenant-a');
  assert.equal(b.canMutate(), false);
  switcher.init('tenant-b');
  assert.equal(b.canMutate(), true);
  assert.equal(a.canMutate(), false, 'old tenant callback cannot mutate the newly authorized tenant');
  switcher.socket.fire('auth_error', { tenantId: 'tenant-a', message: 'Old tenant error' });
  assert.equal(b.canMutate(), true, 'old-tenant error must not invalidate the new tenant');
  assert.deepEqual(switcher.sent.filter(e => e.event === 'admin_connect').map(e => e.args[0]), ['tenant-b-token']);
  switcher.close();

  const waiter = harness();
  const w = waiter.render('tenant-a', true);
  await flush();
  waiter.socket.fire('waiter_approved', { tenantId: 'tenant-a', status: 'approved', waiter: { id: 'waiter-a', status: 'approved' } });
  waiter.init('tenant-a', { currentWaiter: { id: 'waiter-a', status: 'approved' } });
  assert.equal(w.canMutate(), true);
  waiter.socket.fire('auth_error', { tenantId: 'tenant-a', message: 'Waiter must log in' });
  assert.equal(w.canMutate(), false);
  await flush();
  assert.ok(!waiter.sent.some(e => e.event === 'admin_connect'), 'waiter auth errors must not start an admin handshake');
  waiter.close();
  console.log('provider auth recovery: readiness loss, resync, reconnect, tenant boundaries and waiter role passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
