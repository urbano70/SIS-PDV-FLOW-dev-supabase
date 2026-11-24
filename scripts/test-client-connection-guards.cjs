#!/usr/bin/env node
'use strict';

// Isolated source-level and callback tests: no app server, auth or real database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const provider = read('src/components/FirebaseProvider.tsx');
const predicate = provider.match(/const canMutate\s*=\s*(\(\)\s*=>[^;]+);/);
assert.ok(predicate, 'production readiness predicate must exist');
for (const connected of [false, true]) {
  for (const current of [false, true]) {
    for (const onLine of [false, true]) {
      const check = vm.runInNewContext(`(${predicate[1]})`, {
        socket: { connected, id: 'connection-a' }, readyRef: { current }, navigator: { onLine },
        readySocketRef: { current: 'connection-a' }, effectTenantRef: { current: 'tenant-a' },
        normalizedTenantId: 'tenant-a',
      });
      assert.equal(check(), connected && current && onLine);
    }
  }
}

function parse(p) {
  const text = read(p);
  return ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function visit(node, callback) { callback(node); ts.forEachChild(node, child => visit(child, callback)); }
function checkFirstGuard(file, name, condition) {
  const source = parse(file);
  let found = false;
  visit(source, node => {
    if (!ts.isVariableDeclaration(node) || node.name.getText(source) !== name || !node.initializer || !ts.isArrowFunction(node.initializer)) return;
    const first = node.initializer.body.statements[0];
    assert.ok(ts.isIfStatement(first), `${name} must begin with a connection guard`);
    assert.equal(first.expression.getText(source), condition);
    assert.ok(first.thenStatement.getText(source).includes('return;'), `${name} must keep the form/cart and return without sending`);
    found = true;
  });
  assert.ok(found, `${name} not found`);
}
checkFirstGuard('src/components/Dashboard.tsx', 'handleAddItem', '!canMutate()');
checkFirstGuard('src/components/Dashboard.tsx', 'confirmQuantitySelection', '!canMutate()');
checkFirstGuard('src/components/WaiterTerminal.tsx', 'submitOrder', '!canSubmitOrder()');

const app = parse('src/App.tsx');
const effects = [];
visit(app, node => {
  if (ts.isCallExpression(node) && node.expression.getText(app) === 'useEffect' && node.arguments[0]?.getText(app).includes("socket.on('init_data'")) {
    effects.push(node.arguments[0].getText(app));
  }
  if (ts.isCallExpression(node) && node.expression.getText(app) === 'socket.off') {
    assert.ok(node.arguments.length >= 2, 'App cleanup must never remove every listener for a shared event');
  }
});
assert.equal(effects.length, 2, 'both App/Waiter init effects must be covered');
for (const effect of effects) {
  const socket = new EventEmitter();
  let providerEvents = 0;
  const providerListener = () => { providerEvents += 1; };
  socket.on('init_data', providerListener);
  const noop = () => {};
  const context = {
    socket, ownerUser: { id: 'tenant-a' }, tenantId: 'tenant-a',
    setPizzaFlavors: noop, setPizzaCrusts: noop, setPizzaSizes: noop,
    setIsApproved: noop, setDashboardTab: noop,
    toast: { error: noop, info: noop, success: noop },
  };
  const js = esbuild.transformSync(`const run = ${effect}; run();`, { loader: 'tsx' }).code;
  const cleanup = vm.runInNewContext(js, context);
  assert.equal(socket.listenerCount('init_data'), 2);
  cleanup();
  assert.equal(socket.listenerCount('init_data'), 1, 'screen cleanup removed the provider listener');
  socket.emit('init_data', { tenantId: 'tenant-a' });
  assert.equal(providerEvents, 1, 'provider must still receive the next authoritative snapshot');
}
console.log('client connection guards and shared listener cleanup tests passed');

// Exercise the production room helper; keep non-tenant rooms and the socket id.
const roomModule = { exports: {} };
const roomCode = esbuild.transformSync(read('src/server/socket-tenant.ts'), { loader: 'ts', format: 'cjs' }).code;
vm.runInNewContext(roomCode, { module: roomModule, exports: roomModule.exports });
const tenantSocket = {
  rooms: new Set(['socket-id', 'tenant:default', 'tenant:old', 'other-room']),
  tenantGeneration: 4,
  leave(room) { this.rooms.delete(room); },
  join(room) { this.rooms.add(room); },
};
roomModule.exports.switchSocketTenant(tenantSocket, 'tenant-new');
assert.equal(tenantSocket.tenantId, 'tenant-new');
assert.equal(tenantSocket.tenantGeneration, 5);
assert.deepEqual([...tenantSocket.rooms].sort(), ['other-room', 'socket-id', 'tenant:tenant-new']);
assert.throws(() => roomModule.exports.switchSocketTenant(tenantSocket, ''), /tenantId/);
console.log('tenant socket room isolation tests passed');
