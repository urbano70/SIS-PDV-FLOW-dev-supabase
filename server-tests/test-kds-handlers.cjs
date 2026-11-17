#!/usr/bin/env node
'use strict';

const {
  assert,
  clone,
  FakeIO,
  FakeSocket,
  loadTsModule,
  waitTick,
} = require('./testsHelpers.cjs');

const kitchen = loadTsModule('src/server/kitchen-core.ts', 'kitchen-handlers');
const status = loadTsModule('src/lib/kitchenStatus.ts', 'kitchen-status');

function item(id, patch = {}) {
  return {
    id,
    menuItemId: `${id}-menu`,
    name: id,
    type: 'pizzas',
    flavors: [],
    size: 'G',
    extras: [],
    observations: '',
    price: 31.5,
    quantity: 1,
    timestamp: '2026-11-16T18:00:00.000Z',
    ...patch,
  };
}

function baseState({ kdsEnabled = true, orders = [], waiters = [] } = {}) {
  return {
    pizzariaConfig: { kdsEnabled },
    orders,
    tables: [{ id: 7, status: 'occupied', currentOrder: 'order-1', linkedTo: null }],
    waiters,
    menu: [
      { name: 'Pizzas', type: 'pizzas', items: [], subcategories: [] },
      { name: 'Lanches', type: 'lanches', items: [{ id: 'burger-menu', name: 'Burger' }], subcategories: [] },
      { name: 'Bebidas', type: 'bebidas', items: [{ id: 'drink-menu', name: 'Drink' }], subcategories: [] },
    ],
  };
}

function makeDeps(state, { id, tenant = 'tenant-kds', admin = false, waiterId = null, waiterName = null, io, saveOrder } = {}) {
  const socket = new FakeSocket(id || `socket-${Math.random()}`, io, tenant);
  if (waiterId !== null) socket.waiterId = waiterId;
  if (waiterName !== null) socket.waiterName = waiterName;
  const saved = [];
  const actualSave = saveOrder || (async (order, orderId, tenantId) => {
    saved.push({ order: clone(order), orderId: String(orderId), tenantId });
  });
  kitchen.registerKitchenSocketHandlers({
    socket,
    io,
    getTenantId: () => tenant,
    getState: () => state,
    withTenantCommand: (_tenantId, operation) => operation(),
    saveOrder: actualSave,
    isAdmin: () => admin,
  });
  return { socket, saved };
}

function openOrder(items, patch = {}) {
  return {
    id: 'order-1',
    tableId: 7,
    waiterId: 'waiter-1',
    waiterName: 'Garçom da conta',
    status: 'open',
    isComanda: false,
    timestamp: '2026-11-16T18:00:00.000Z',
    paymentLog: [{ type: 'partial', amount: 10, id: 'payment-keep' }],
    deliveryLog: [],
    items,
    ...patch,
  };
}

async function testPreparedFlowAndAuthorization() {
  const pizza = item('pizza-1', { type: 'pizzas' });
  const sandwich = item('sandwich-1', { type: 'lanches', menuItemId: 'burger-menu', name: 'Burger' });
  const state = baseState({
    waiters: [{ id: 'waiter-1', name: 'Garçom Aprovado', status: 'approved' }],
    orders: [openOrder([pizza, sandwich])],
  });
  const io = new FakeIO();
  const admin = makeDeps(state, { id: 'kds-admin-flow', admin: true, io });
  const waiter = makeDeps(state, { id: 'waiter-flow', waiterId: 'waiter-1', waiterName: 'Cliente não confiável', io });
  const anonymous = makeDeps(state, { id: 'anonymous-flow', io });

  assert.equal((await waiter.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'pizza-1' })).ok, false,
    'garçom aprovado não pode alterar preparo');
  assert.equal((await anonymous.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'pizza-1' })).ok, false,
    'anônimo não pode entregar');
  assert.equal((await waiter.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'pizza-1' })).ok, false,
    'garçom pode entregar, mas não antes de pronto');

  assert.equal((await admin.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'pizza-1' })).ok, true);
  assert.equal(state.orders[0].items[0].kitchenStatus, 'preparing');
  assert.equal((await admin.socket.invoke('kitchen_oven_item', { orderId: 'order-1', itemId: 'pizza-1' })).ok, true);
  assert.equal(state.orders[0].items[0].kitchenStatus, 'oven');
  const ready = await admin.socket.invoke('kitchen_finish_item', { orderId: 'order-1', itemId: 'pizza-1' });
  assert.equal(ready.ok, true);
  assert.equal(state.orders[0].items[0].kitchenStatus, 'ready');
  assert.equal(state.orders[0].items[0].deliveredAt, undefined, 'ready não é entregue');
  assert.equal((await waiter.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'pizza-1' })).ok, true);
  assert.ok(state.orders[0].items[0].deliveredAt, 'entrega deve ter timestamp');
  assert.equal(state.orders[0].items[0].deliveredBy, 'Garçom Aprovado', 'ator vem do waiter aprovado, não do payload');

  const sandwichStart = await admin.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'sandwich-1' });
  assert.equal(sandwichStart.ok, true);
  assert.equal(state.orders[0].items[1].kitchenStatus, 'preparing');
  const sandwichOven = await admin.socket.invoke('kitchen_oven_item', { orderId: 'order-1', itemId: 'sandwich-1' });
  assert.equal(sandwichOven.ok, false, 'lanche não passa pelo forno');
  assert.equal((await admin.socket.invoke('kitchen_finish_item', { orderId: 'order-1', itemId: 'sandwich-1' })).ok, true,
    'lanche vai de preparo diretamente a pronto');
  assert.equal(state.orders[0].items[1].kitchenStatus, 'ready');

  assert.equal((await admin.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'pizza-1' })).ok, false,
    'item entregue não pode voltar ao preparo');
  assert.equal((await admin.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'sandwich-1' })).ok, false,
    'transição backward ready -> preparing deve ser rejeitada');
}

async function testTwoItemsCanHaveDifferentStages() {
  const state = baseState({ orders: [openOrder([
    item('pizza-a'),
    item('pizza-b'),
  ])] });
  const io = new FakeIO();
  const admin = makeDeps(state, { id: 'kds-admin-two-stages', admin: true, io });
  assert.equal((await admin.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'pizza-a' })).ok, true);
  assert.equal((await admin.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'pizza-b' })).ok, true);
  assert.equal((await admin.socket.invoke('kitchen_oven_item', { orderId: 'order-1', itemId: 'pizza-a' })).ok, true);
  assert.equal(state.orders[0].items.find((i) => i.id === 'pizza-a').kitchenStatus, 'oven');
  assert.equal(state.orders[0].items.find((i) => i.id === 'pizza-b').kitchenStatus, 'preparing');
}

async function testPaidItemStillNeedsPhysicalDelivery() {
  const state = baseState({
    waiters: [{ id: 'waiter-1', name: 'Garçom Aprovado', status: 'approved' }],
    orders: [openOrder([item('paid-item', { type: 'lanches', menuItemId: 'burger-menu', name: 'Burger', paid: true, kitchenStatus: 'ready' })])],
  });
  const io = new FakeIO();
  const waiter = makeDeps(state, { id: 'waiter-paid', waiterId: 'waiter-1', io });
  const before = clone(state.orders[0]);
  const ack = await waiter.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'paid-item' });
  assert.equal(ack.ok, true, 'pagamento não comprova entrega física de um item pronto');
  assert.ok(state.orders[0].items[0].deliveredAt);
  assert.equal(state.orders[0].items[0].paid, true, 'a confirmação não pode desfazer o pagamento');
  assert.equal(state.orders[0].items[0].price, before.items[0].price);
  assert.deepEqual(state.orders[0].paymentLog, before.paymentLog);
  assert.equal(state.orders[0].status, before.status, 'entregar não finaliza a mesa');
}

async function testConcurrentDeliveryAndActorImmutability() {
  const original = item('concurrent', {
    type: 'lanches', menuItemId: 'burger-menu', name: 'Burger',
    price: 42, paid: false, kitchenStatus: 'ready',
  });
  const state = baseState({
    waiters: [
      { id: 'waiter-1', name: 'Waiter A', status: 'approved' },
      { id: 'waiter-2', name: 'Waiter B', status: 'approved' },
    ],
    orders: [openOrder([original], { paymentLog: [{ type: 'full', amount: 42, id: 'payment-stable' }] })],
  });
  const io = new FakeIO();
  const first = makeDeps(state, { id: 'waiter-concurrent-a', waiterId: 'waiter-1', io });
  const second = makeDeps(state, { id: 'waiter-concurrent-b', waiterId: 'waiter-2', io });
  const [ackA, ackB] = await Promise.all([
    first.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'concurrent', waiterName: 'attacker A' }),
    second.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'concurrent', waiterName: 'attacker B' }),
  ]);
  assert.equal(ackA.ok, true);
  assert.equal(ackB.ok, true);
  assert.equal(state.orders[0].deliveryLog.length, 1, 'duas entregas simultâneas geram exatamente um log');
  assert.equal(state.orders[0].items[0].price, 42);
  assert.equal(state.orders[0].items[0].paid, false);
  assert.equal(state.orders[0].tableId, 7);
  assert.deepEqual(state.orders[0].paymentLog, [{ type: 'full', amount: 42, id: 'payment-stable' }]);
  assert.ok(['Waiter A', 'Waiter B'].includes(state.orders[0].items[0].deliveredBy));
  assert.equal(state.orders[0].deliveryLog[0].waiterName, state.orders[0].items[0].deliveredBy);
  assert.equal(io.roomEvents('tenant:tenant-kds', 'update_orders').length, 1,
    'a entrega idempotente não deve fazer dois broadcasts');
}

async function testStoreFailureRollsBackWithoutBroadcast() {
  const state = baseState({ orders: [openOrder([item('will-fail')])] });
  const io = new FakeIO();
  const before = clone(state);
  const failing = makeDeps(state, {
    id: 'kds-failure',
    admin: true,
    io,
    saveOrder: async () => { throw new Error('storage unavailable'); },
  });
  const ack = await failing.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'will-fail' });
  assert.equal(ack.ok, false);
  assert.deepEqual(state, before, 'falha de storage deve restaurar snapshot do pedido');
  assert.equal(io.roomEvents('tenant:tenant-kds', 'update_orders').length, 0, 'falha não pode transmitir estado não persistido');
  assert.equal(failing.socket.events('kitchen_start_item_ack').at(-1).payload.ok, false);
}

async function testKdsOffDeliveryPreservesFinanceAndTable() {
  const itemBefore = item('off-item', { kitchenStatus: undefined, price: 19.9, paid: false });
  const state = baseState({ kdsEnabled: false, waiters: [{ id: 'waiter-1', name: 'Waiter Off', status: 'approved' }], orders: [openOrder([itemBefore], {
    tableId: 99,
    paymentLog: [{ type: 'partial', amount: 5, id: 'payment-off' }],
  })] });
  const io = new FakeIO();
  const waiter = makeDeps(state, { id: 'waiter-kds-off', waiterId: 'waiter-1', io });
  const ack = await waiter.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'off-item' });
  assert.equal(ack.ok, true, 'KDS off não exige preparo');
  const delivered = state.orders[0].items[0];
  assert.equal(delivered.price, 19.9);
  assert.equal(delivered.paid, false);
  assert.equal(state.orders[0].tableId, 99);
  assert.deepEqual(state.orders[0].paymentLog, [{ type: 'partial', amount: 5, id: 'payment-off' }]);
  assert.equal(delivered.kitchenStatus, undefined, 'entrega com KDS off não inventa etapa');
}

async function testUnsupportedTypeAndPlaygroundAreOutsideKds() {
  const state = baseState({ orders: [openOrder([
    item('drink', { type: 'bebidas', menuItemId: 'drink-menu', name: 'Drink' }),
    item('play', { source: 'parquinho', type: 'outros', menuItemId: 'parquinho:tenant-kds' }),
    item('legacy-play', { isParquinho: true, type: 'lanches', menuItemId: 'legacy-child-service' }),
  ])] });
  const io = new FakeIO();
  const admin = makeDeps(state, { id: 'kds-unsupported', admin: true, io });
  assert.equal((await admin.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'drink' })).ok, false);
  assert.equal((await admin.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'play' })).ok, false);
  assert.equal((await admin.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'drink' })).ok, true,
    'item sem fila pode ser entregue sem exigência KDS');
  assert.equal((await admin.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'play' })).ok, false,
    'cobrança do Parquinho não é uma entrega de cozinha');
  assert.equal((await admin.socket.invoke('kitchen_start_item', { orderId: 'order-1', itemId: 'legacy-play' })).ok, false);
  assert.equal((await admin.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'legacy-play' })).ok, false);
  assert.equal(status.isKitchenTracked(state.orders[0].items[0], state.menu), false);
  assert.equal(status.isPlaygroundItem(state.orders[0].items[1]), true);
}

async function testCapturedActorAndClosedOrderGuards() {
  const state = baseState({ waiters: [{ id: 'waiter-1', name: 'Waiter Guard', status: 'approved' }], orders: [openOrder([item('closed-item', { kitchenStatus: 'ready' })], { status: 'finalizada' })] });
  const io = new FakeIO();
  const waiter = makeDeps(state, { id: 'waiter-closed', waiterId: 'waiter-1', waiterName: 'forged', io });
  const ack = await waiter.socket.invoke('deliver_item', { orderId: 'order-1', itemId: 'closed-item', waiterName: 'forged payload' });
  assert.equal(ack.ok, false, 'pedido encerrado não aceita entrega');
  assert.equal(state.orders[0].items[0].deliveredBy, undefined);
}

async function run() {
  // Importing db-pg through the isolated bundle must not initialize a pool.
  const dbPg = loadTsModule('src/db-pg.ts', 'db-pg-inert');
  assert.equal(dbPg.getPgPool(), undefined, 'db-pg isolado deve permanecer inerte antes de initPg');

  const tests = [
    ['prepared-flow-and-authorization', testPreparedFlowAndAuthorization],
    ['two-items-different-stages', testTwoItemsCanHaveDifferentStages],
    ['paid-item-still-needs-physical-delivery', testPaidItemStillNeedsPhysicalDelivery],
    ['concurrent-delivery-and-actor-immutability', testConcurrentDeliveryAndActorImmutability],
    ['store-failure-rollback', testStoreFailureRollsBackWithoutBroadcast],
    ['kds-off-delivery', testKdsOffDeliveryPreservesFinanceAndTable],
    ['unsupported-types-and-playground', testUnsupportedTypeAndPlaygroundAreOutsideKds],
    ['captured-actor-and-closed-order', testCapturedActorAndClosedOrderGuards],
  ];
  const failures = [];
  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`  FAIL ${name}: ${error.message || error}`);
    }
  }
  await waitTick();
  if (failures.length) {
    const details = failures.map(({ name, error }) => `${name}: ${error.stack || error}`).join('\n');
    throw new Error(`KDS failures (${failures.length})\n${details}`);
  }
  console.log('test-kds-handlers: ok');
}

run().catch((error) => {
  console.error(`test-kds-handlers: FAIL\n${error.stack || error}`);
  process.exitCode = 1;
});
