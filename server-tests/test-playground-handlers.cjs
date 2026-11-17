#!/usr/bin/env node
'use strict';

const {
  assert,
  clone,
  FakeIO,
  FakeSocket,
  loadTsModule,
} = require('./testsHelpers.cjs');

const dbPg = loadTsModule('src/db-pg.ts', 'db-pg-inert-playground');
assert.equal(dbPg.getPgPool(), undefined, 'db-pg isolado deve permanecer inerte antes do handler Parquinho');
const playground = loadTsModule('src/server/playground.ts', 'playground-handlers');
const core = loadTsModule('src/server/playground-core.ts', 'playground-core');

const passwordCache = new Map();
async function passwordHash(password = 'Passw0rd') {
  if (!passwordCache.has(password)) passwordCache.set(password, core.hashPlaygroundPassword(password));
  return passwordCache.get(password);
}

function makeState(tenant, patch = {}) {
  return {
    orders: [],
    tables: [{ id: 1, status: 'free', currentOrder: null, linkedTo: null }],
    menu: [],
    waiters: [],
    isCashRegisterOpen: true,
    shiftStartedAt: '2026-11-16T23:30:00.000Z',
    pizzariaConfig: {
      parquinhoEnabled: true,
      parquinhoChildNameRequired: false,
      parquinhoPrice: 12.5,
      ...patch.pizzariaConfig,
    },
    ...patch,
  };
}

async function operatorRow(id, name, status = 'approved', patch = {}) {
  return {
    id,
    tenant_id: patch.tenant_id || 'tenant-placeholder',
    name,
    status,
    phone: patch.phone || null,
    cpf: patch.cpf || null,
    birth_date: patch.birth_date || null,
    password_hash: patch.password_hash || await passwordHash(),
    role: 'playground_operator',
    ...patch,
  };
}

async function fixture(label, {
  tenant = `tenant-play-${label}`,
  statePatch = {},
  operators = [],
  entries = [],
} = {}) {
  const state = makeState(tenant, statePatch);
  const states = new Map([[tenant, state]]);
  const rows = [];
  for (const operator of operators) rows.push(await operatorRow(operator.id, operator.name, operator.status, { ...operator, tenant_id: tenant }));
  const db = require('./testsHelpers.cjs').makePlaygroundDb({ states, operators: rows, entries });
  const io = new FakeIO();
  const makeSocket = (id, { admin = false, socketTenant = tenant } = {}) => {
    const socket = new FakeSocket(id, io, socketTenant);
    playground.registerPlaygroundSocketHandlers({
      socket,
      io,
      db,
      usePostgres: false,
      buildId: `test-build-${label}`,
      getTenantId: () => tenant,
      getState: (tenantId) => states.get(tenantId),
      loadTenantIfNeeded: async (tenantId) => {
        if (!states.has(tenantId)) throw new Error('tenant desconhecido');
      },
      generateOrderId: () => `order-${label}-${state.orders.length + 1}`,
      withTenantCommand: (_tenantId, operation) => operation(),
      isAdmin: () => admin,
      isDedicatedConnection: () => true,
    });
    return socket;
  };
  return { tenant, state, states, db, io, makeSocket };
}

async function login(socket, name, password = 'Passw0rd') {
  return socket.invoke('parquinho_login', { name, password });
}

async function testApprovedProjectionAndTwoOperatorsShareEntry() {
  const tenant = 'tenant-projection';
  const parquinhoItem = {
    id: 'legacy-parquinho-item',
    menuItemId: `parquinho:${tenant}`,
    productId: `parquinho:${tenant}`,
    source: 'parquinho',
    name: 'Parquinho',
    price: 12.5,
    quantity: 1,
    parquinhoEntryId: 'entry-existing',
    childName: 'Bia',
    operatorId: 'op-a',
    operatorName: 'Operador A',
  };
  const foodItem = { id: 'food-1', menuItemId: 'food-1', name: 'Pizza privada', type: 'pizzas', price: 99, quantity: 1 };
  const fx = await fixture('projection', {
    tenant,
    operators: [
      { id: 'op-a', name: 'Operador A' },
      { id: 'op-b', name: 'Operador B' },
    ],
    statePatch: {
      orders: [{ id: 'order-existing', tableId: 1, status: 'open', items: [parquinhoItem, foodItem] }],
      tables: [{ id: 1, status: 'occupied', currentOrder: 'order-existing', linkedTo: null }],
    },
    entries: [{
      id: 'entry-existing', tenant_id: tenant, order_id: 'order-existing', order_item_id: 'legacy-parquinho-item',
      table_id: 1, product_id: `parquinho:${tenant}`, product_name: 'Parquinho', child_name: 'Bia',
      operator_id: 'op-a', operator_name: 'Operador A', created_at: '2026-11-16T23:45:00.000Z',
      shift_started_at: '2026-11-16T23:30:00.000Z', quantity: 1, unit_price: 12.5, total_price: 12.5, status: 'active',
    }, {
      id: 'food-ledger', tenant_id: tenant, order_id: 'order-existing', order_item_id: 'food-1',
      table_id: 1, product_id: 'food-1', product_name: 'Pizza privada', child_name: null,
      operator_id: 'waiter', operator_name: 'Garçom', created_at: '2026-11-16T23:45:01.000Z',
      shift_started_at: '2026-11-16T23:30:00.000Z', quantity: 1, unit_price: 99, total_price: 99, status: 'active',
    }],
  });
  const opA = fx.makeSocket('projection-a');
  const opB = fx.makeSocket('projection-b');
  const loginA = await login(opA, 'Operador A');
  const loginB = await login(opB, 'Operador B');
  for (const response of [loginA, loginB]) {
    assert.equal(response.ok, true);
    assert.equal(response.data.tenantId, tenant);
    assert.equal(response.data.entries.length, 1, 'operador recebe apenas lançamentos Parquinho');
    assert.equal(response.data.entries[0].productId, `parquinho:${tenant}`);
    assert.equal('orders' in response.data, false, 'projeção não expõe pedido completo');
    assert.equal(JSON.stringify(response.data).includes('Pizza privada'), false, 'projeção não expõe alimentos');
    assert.equal(JSON.stringify(response).includes('password_hash'), false, 'credenciais não saem no ACK');
  }
  assert.equal((await opA.invoke('parquinho_request_data')).ok, true);
  assert.equal((await opB.invoke('parquinho_request_data')).ok, true);

  const addAck = await opA.invoke('parquinho_add_entry', { tableId: 1, childName: '  Cora  ', requestId: 'shared-entry-1' });
  assert.equal(addAck.ok, true);
  assert.equal(addAck.entry.childName, 'Cora');
  const bBroadcast = opB.events('parquinho_data').at(-1).payload;
  assert.ok(bBroadcast.entries.some((entry) => entry.id === 'entry-shared-entry-1'), 'segundo operador recebe a mesma entrada');
  assert.equal(JSON.stringify(bBroadcast).includes('Pizza privada'), false);
}

async function testRegistrationApprovalAndDuplicateTakeover() {
  const fx = await fixture('registration', { operators: [{ id: 'existing', name: 'Operador Existente', status: 'pending', cpf: '123' }] });
  const socket = fx.makeSocket('registration-socket');
  const pending = await socket.invoke('parquinho_register', { name: '  Novo   Operador  ', password: 'Passw0rd', phone: ' 555 ', cpf: '999' });
  assert.equal(pending.ok, true);
  assert.equal(pending.operator.name, 'Novo Operador');
  assert.equal(pending.operator.status, 'pending');
  assert.equal(pending.operator.role, undefined, 'publicOperator não expõe papel ou hash');
  const takeover = await socket.invoke('parquinho_register', { name: 'Outra pessoa', password: 'wrong-password', cpf: '123' });
  assert.equal(takeover.ok, false, 'cadastro duplicado não permite takeover com senha diferente');
  assert.match(takeover.message, /já existe|senha original/i);
}

async function testNamesPriceOwnerAndCanonicalProduct() {
  const fx = await fixture('validation', {
    operators: [{ id: 'approved-op', name: 'Operador Seguro' }],
    statePatch: { pizzariaConfig: { parquinhoEnabled: true, parquinhoChildNameRequired: true, parquinhoPrice: 0 } },
  });
  const socket = fx.makeSocket('validation-socket');
  assert.equal((await login(socket, 'Operador Seguro')).ok, true);
  const blank = await socket.invoke('parquinho_add_entry', { tableId: 1, childName: '   ', requestId: 'blank-required' });
  assert.equal(blank.ok, false, 'nome só com espaços é rejeitado quando obrigatório');

  fx.state.pizzariaConfig.parquinhoChildNameRequired = false;
  const acceptedEmpty = await socket.invoke('parquinho_add_entry', {
    tableId: 1,
    childName: '   ',
    requestId: 'empty-optional',
    price: 999,
    productId: 'attacker-product',
    operatorId: 'attacker-operator',
    quantity: 99,
  });
  assert.equal(acceptedEmpty.ok, true);
  assert.equal(acceptedEmpty.entry.childName, null);
  assert.equal(acceptedEmpty.entry.quantity, 1);
  assert.equal(acceptedEmpty.entry.totalPrice, 0, 'preço vem do dono e aceita zero válido');
  assert.equal(acceptedEmpty.entry.unitPrice, 0);
  assert.equal(acceptedEmpty.entry.productId, `parquinho:${fx.tenant}`, 'produto é o ID canônico Outros');
  assert.equal(acceptedEmpty.entry.operatorId, 'approved-op');
  assert.equal(acceptedEmpty.entry.operatorName, 'Operador Seguro');
  assert.equal(fx.db.rpcCalls.at(-1).params.p_operator_id, 'approved-op');
  assert.equal('p_price' in fx.db.rpcCalls.at(-1).params, false, 'RPC não recebe preço confiável do cliente');

  fx.state.pizzariaConfig.parquinhoPrice = null;
  const noPrice = await socket.invoke('parquinho_add_entry', { tableId: 1, childName: 'Duda', requestId: 'null-price' });
  assert.equal(noPrice.ok, false, 'preço null bloqueia o lançamento');
  assert.equal(fx.db.entries.length, 1);
}

async function testIdempotencySdkFailureAndNoFalseSuccess() {
  const fx = await fixture('idempotency', { operators: [{ id: 'approved-op', name: 'Operador Idempotente' }] });
  const socket = fx.makeSocket('idempotency-socket');
  assert.equal((await login(socket, 'Operador Idempotente')).ok, true);
  const first = await socket.invoke('parquinho_add_entry', { tableId: 1, childName: 'Uma', requestId: 'retry-token' });
  const second = await socket.invoke('parquinho_add_entry', { tableId: 1, childName: 'Uma', requestId: 'retry-token' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(fx.db.entries.length, 1, 'retry com mesmo requestId não reinsere no fake RPC');
  assert.equal(fx.state.orders[0].items.length, 1);
  assert.equal(fx.db.rpcCalls.length, 2);

  const failing = await fixture('sdk-failure', { operators: [{ id: 'approved-op', name: 'Operador Falha' }] });
  const failingSocket = failing.makeSocket('sdk-failure-socket');
  assert.equal((await login(failingSocket, 'Operador Falha')).ok, true);
  failing.db.failRpc = true;
  const beforeState = clone(failing.state);
  const beforeBroadcasts = failing.io.roomEvents(`playground:${failing.tenant}`, 'parquinho_data').length;
  const failureAck = await failingSocket.invoke('parquinho_add_entry', { tableId: 1, childName: 'Falha', requestId: 'sdk-failure' });
  assert.equal(failureAck.ok, false, 'falha SDK não pode virar sucesso falso');
  assert.deepEqual(failing.state, beforeState, 'falha não pode mutar estado local');
  assert.equal(failing.db.entries.length, 0);
  assert.equal(failing.io.roomEvents(`playground:${failing.tenant}`, 'parquinho_data').length, beforeBroadcasts);
}

async function testCurrentTableProjectionAndPaymentStates() {
  const tenant = 'tenant-occupancy';
  const makeParq = (id, orderId, patch = {}) => ({
    id, menuItemId: `parquinho:${tenant}`, source: 'parquinho', name: 'Parquinho', price: 10,
    quantity: 1, parquinhoEntryId: id, ...patch,
  });
  const state = makeState(tenant, {
    tables: [
      { id: 1, status: 'occupied', currentOrder: 'active', linkedTo: null },
      { id: 2, status: 'occupied', currentOrder: 'food-only', linkedTo: null },
      { id: 3, status: 'occupied', currentOrder: 'history', linkedTo: null },
      { id: 4, status: 'occupied', currentOrder: 'removed', linkedTo: null },
      { id: 5, status: 'occupied', currentOrder: 'cancelled', linkedTo: null },
      { id: 6, status: 'occupied', currentOrder: 'partial', linkedTo: null },
      { id: 7, status: 'occupied', currentOrder: 'finalized', linkedTo: null },
    ],
    orders: [
      { id: 'active', tableId: 1, status: 'open', items: [makeParq('entry-active', 'active')] },
      { id: 'food-only', tableId: 2, status: 'open', items: [{ id: 'food', menuItemId: 'food', name: 'Food', type: 'pizzas', price: 20 }] },
      { id: 'history', tableId: 3, status: 'finalizada', items: [makeParq('entry-history', 'history')] },
      { id: 'removed', tableId: 4, status: 'open', items: [makeParq('entry-removed', 'removed', { removed: true, removedBy: 'ADM' })] },
      { id: 'cancelled', tableId: 5, status: 'cancelled', items: [makeParq('entry-cancelled', 'cancelled')] },
      { id: 'partial', tableId: 6, status: 'aguardando_baixa', items: [makeParq('entry-partial', 'partial', { paid: true })] },
      { id: 'finalized', tableId: 7, status: 'paid', items: [makeParq('entry-finalized', 'finalized')] },
    ],
  });
  const projection = core.projectPlaygroundData({ tenantId: tenant, state, buildId: 'occupancy' });
  const byTable = new Map(projection.tables.map((table) => [table.id, table]));
  assert.equal(byTable.get(1).occupied, true);
  assert.equal(byTable.get(1).currentOrderId, 'active');
  assert.equal(byTable.get(2).occupied, false, 'comida sem Parquinho não ocupa na visão do operador');
  assert.equal(byTable.get(3).occupied, false, 'histórico não ocupa');
  assert.equal(byTable.get(3).currentOrderId, null);
  assert.equal(byTable.get(4).occupied, false, 'item removido não ocupa');
  assert.equal(byTable.get(5).occupied, false, 'pedido cancelado não ocupa');
  assert.equal(byTable.get(6).occupied, true, 'aguardando baixa/pagamento parcial não libera a mesa');
  assert.equal(byTable.get(7).occupied, false, 'finalização definitiva libera');
  assert.equal(projection.entries.find((entry) => entry.id === 'entry-history').status, 'finalized');
  assert.equal(projection.entries.find((entry) => entry.id === 'entry-removed').status, 'removed');
  assert.equal(projection.entries.find((entry) => entry.id === 'entry-cancelled').status, 'cancelled');
}

async function testDisconnectResumeTenantAndInactiveAuth() {
  const fx = await fixture('sessions', { operators: [{ id: 'session-op', name: 'Sessão Segura' }] });
  const first = fx.makeSocket('session-first');
  const logged = await login(first, 'Sessão Segura');
  assert.equal(logged.ok, true);
  const token = logged.token;
  const countBefore = fx.db.entries.length;
  first.disconnect();
  assert.equal(first.rooms.has(`playground:${fx.tenant}`), false, 'disconnect limpa sala');

  const resumed = fx.makeSocket('session-resumed');
  const resumeAck = await resumed.invoke('parquinho_resume', { token });
  assert.equal(resumeAck.ok, true, 'mesmo token retoma sessão');
  assert.equal(fx.db.entries.length, countBefore, 'resume não duplica lançamento');

  const other = fx.makeSocket('session-cross-tenant', { socketTenant: 'tenant-other' });
  const cross = await other.invoke('parquinho_resume', { token });
  assert.equal(cross.ok, false, 'token de uma conta não atravessa tenant');

  fx.db.operators.find((row) => row.id === 'session-op').status = 'inactive';
  const denied = await resumed.invoke('parquinho_request_data');
  assert.equal(denied.ok, false);
  assert.equal(resumed.rooms.has(`playground:${fx.tenant}`), false, 'operador inativo perde a sala');
  assert.equal(resumed.playgroundConnection, false, 'operador inativo perde a conexão autorizada');
  assert.equal(resumed.last('parquinho_operator_status').status, 'inactive');
}

async function testAdminReportExactShiftAndOperatorWhitelist() {
  const tenant = 'tenant-report';
  const shift = '2026-11-16T23:30:00.000Z';
  const fx = await fixture('report', {
    tenant,
    operators: [{ id: 'report-op', name: 'Operador Relatório' }],
    entries: [
      { id: 'before-midnight', tenant_id: tenant, order_id: 'o1', order_item_id: 'i1', table_id: 1, product_id: `parquinho:${tenant}`, product_name: 'Parquinho', child_name: 'Antes', operator_id: 'report-op', operator_name: 'Operador Relatório', created_at: '2026-11-16T23:59:00.000Z', shift_started_at: shift, quantity: 1, unit_price: 10, total_price: 10, status: 'active' },
      { id: 'after-midnight', tenant_id: tenant, order_id: 'o2', order_item_id: 'i2', table_id: 2, product_id: `parquinho:${tenant}`, product_name: 'Parquinho', child_name: null, operator_id: 'report-op', operator_name: 'Operador Relatório', created_at: '2026-11-17T00:10:00.000Z', shift_started_at: shift, quantity: 1, unit_price: 10, total_price: 10, status: 'paid' },
      { id: 'other-shift', tenant_id: tenant, order_id: 'o3', order_item_id: 'i3', table_id: 3, product_id: `parquinho:${tenant}`, product_name: 'Parquinho', child_name: 'Outro turno', operator_id: 'report-op', operator_name: 'Operador Relatório', created_at: '2026-11-17T01:00:00.000Z', shift_started_at: '2026-11-17T00:30:00.000Z', quantity: 1, unit_price: 10, total_price: 10, status: 'active' },
    ],
  });
  const operator = fx.makeSocket('report-operator');
  assert.equal((await login(operator, 'Operador Relatório')).ok, true);
  assert.equal((await operator.invoke('parquinho_get_report', { shiftStartedAt: shift })).ok, false,
    'relatório é exclusivo ADM');

  const admin = fx.makeSocket('report-admin', { admin: true });
  const report = await admin.invoke('parquinho_get_report', { shiftStartedAt: '2026-11-16T23:30:00-00:00' });
  assert.equal(report.ok, true);
  assert.equal(report.entries.length, 2, 'turno atravessando meia-noite permanece um turno');
  assert.deepEqual(report.entries.map((entry) => entry.id), ['before-midnight', 'after-midnight']);
  assert.equal(report.entries.some((entry) => entry.childName === 'Outro turno'), false);
  assert.equal(report.shiftStartedAt, shift);
  assert.ok(report.shifts.includes(shift));

  for (const event of ['parquinho_register', 'parquinho_login', 'parquinho_resume', 'parquinho_logout', 'parquinho_request_data', 'parquinho_add_entry']) {
    assert.equal(playground.isPlaygroundOperatorSocketEventAllowed(event), true, `${event} deve estar na allowlist`);
  }
  for (const event of ['new_order', 'add_item_to_order', 'pay_order', 'cancel_item', 'kitchen_start_item', 'deliver_item', 'parquinho_get_report', 'parquinho_set_operator_status', 'request_init_data']) {
    assert.equal(playground.isPlaygroundOperatorSocketEventAllowed(event), false, `${event} não deve ser acessível ao operador`);
  }
}

async function testSignupDoesNotRewriteLegacyMenuAndManagedProductIsCanonical() {
  const tenant = 'tenant-catalog';
  const legacy = {
    name: 'Outros', type: 'outros', visible: true,
    items: [{ id: 'play-kids', name: 'PLAY KIDS', type: 'outros', price: 70 }],
    subcategories: [{ name: 'Antigos', items: [{ id: 'legacy-food', name: 'Bolo', price: 8 }] }],
  };
  const state = makeState(tenant, { menu: [legacy] });
  const beforeMenu = clone(state.menu);
  const fx = await fixture('catalog', { tenant, statePatch: state, operators: [{ id: 'catalog-op', name: 'Cadastro Catálogo', status: 'pending' }] });
  const signup = fx.makeSocket('catalog-signup');
  assert.equal((await signup.invoke('parquinho_register', { name: 'Novo Cadastro', password: 'Passw0rd' })).ok, true);
  assert.deepEqual(fx.state.menu, beforeMenu, 'signup não deve reescrever alimentos legados');

  const first = core.ensurePlaygroundProduct(beforeMenu, tenant, 0);
  const second = core.ensurePlaygroundProduct(first.menu, tenant, 0);
  const category = first.menu.find((candidate) => candidate.type === 'outros');
  assert.equal(category.items.filter((candidate) => candidate.id === `parquinho:${tenant}`).length, 1);
  assert.equal(category.items.find((candidate) => candidate.id === 'play-kids').price, 70);
  assert.equal(category.subcategories[0].items[0].id, 'legacy-food');
  assert.equal(second.menu.find((candidate) => candidate.type === 'outros').items.filter((candidate) => candidate.id === `parquinho:${tenant}`).length, 1,
    'produto gerenciado não duplica em sincronização repetida');
  assert.equal(category.items.find((candidate) => candidate.id === `parquinho:${tenant}`).source, 'parquinho');
}

async function run() {
  await testApprovedProjectionAndTwoOperatorsShareEntry();
  await testRegistrationApprovalAndDuplicateTakeover();
  await testNamesPriceOwnerAndCanonicalProduct();
  await testIdempotencySdkFailureAndNoFalseSuccess();
  await testCurrentTableProjectionAndPaymentStates();
  await testDisconnectResumeTenantAndInactiveAuth();
  await testAdminReportExactShiftAndOperatorWhitelist();
  await testSignupDoesNotRewriteLegacyMenuAndManagedProductIsCanonical();
  console.log('test-playground-handlers: ok');
}

run().catch((error) => {
  console.error(`test-playground-handlers: FAIL\n${error.stack || error}`);
  process.exitCode = 1;
});
