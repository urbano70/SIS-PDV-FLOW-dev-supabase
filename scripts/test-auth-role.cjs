#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('src/App.tsx', 'utf8');
const provider = fs.readFileSync('src/components/FirebaseProvider.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

const appContent = app.slice(app.indexOf('function AppContent'), app.indexOf('// Rota do garçom'));
assert.doesNotMatch(appContent, /waiter_login/, 'AppContent must never auto-login saved waiter credentials');
assert.match(appContent, /socket\.off\('connect', sendAdminConnect\)/, 'admin listener cleanup must be scoped');

const waiterRoute = app.slice(app.indexOf('function WaiterRoute'), app.indexOf('function WaiterRouteInner'));
assert.match(waiterRoute, /getSocketAuthRole\(\).*=== 'admin'/, 'waiter route must detect an active admin role');
assert.match(waiterRoute, /socket\.disconnect\(\);\s*socket\.connect\(\);/s, 'owner-to-staff transition must reconnect once');
assert.match(waiterRoute, /socket\.off\('connect', onConnect\)/, 'role transition listener cleanup must be scoped');

const waiterInner = app.slice(app.indexOf('function WaiterRouteInner'), app.indexOf('// Parquinho'));
assert.match(waiterInner, /waiterLoginKeyRef/, 'waiter login must be deduplicated per connection/tenant');
assert.match(waiterInner, /waiter_identify_tenant/ , 'waiter route must identify tenant before login');
assert.match(waiterInner, /socket\.off\('connect', loginOwnStaff\)/, 'waiter auto-login cleanup must be scoped');

assert.match(provider, /socket\.on\('waiter_status_changed', handleWaiterStatusChanged\)/);
assert.match(provider, /socket\.off\('waiter_status_changed', handleWaiterStatusChanged\)/);
assert.match(provider, /safeSnapshotWaiter\.status !== 'approved'/, 'pending snapshots cannot become ready');
assert.match(provider, /readyRef\.current = false;/, 'status changes must revoke mutation readiness');

const waiterLogin = server.slice(server.indexOf('socket.on("waiter_login"'), server.indexOf('onTenantCommand("toggle_cash_register"'));
assert.match(waiterLogin, /ownerActor\?\.role === 'admin'/);
assert.match(waiterLogin, /isAdminForTenant\(ownerActor\.tenantId\)/);
assert.match(waiterLogin, /invalid\('A sessão administrativa não pode entrar como garçom nesta conexão\.'/);

console.log('test-auth-role: passed');
