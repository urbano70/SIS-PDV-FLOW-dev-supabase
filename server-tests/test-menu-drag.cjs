#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { clone, loadTsModule, FakeIO, FakeSocket } = require('./testsHelpers.cjs');

const core = loadTsModule('src/server/menu-drag.ts', 'menu-drag-core');
const handlerModule = loadTsModule('src/server/menu-drag-handler.ts', 'menu-drag-handler');

const baseMenu = () => [
  {
    name: 'Lanches', type: 'lanches', visible: true,
    items: [{ id: 'hot-dog', name: 'Cachorro Quente', price: 15, ingredients: 'salsicha', trackStock: true, custom: { keep: true } }],
    subcategories: [],
  },
  {
    name: 'Bebidas', type: 'bebidas', visible: true,
    items: [],
    subcategories: [{ id: 'ovos', name: 'Ovos', position: 0, visible: true, items: [] }],
  },
  {
    name: 'Adicionais', type: 'lanches', visible: true,
    items: [],
    subcategories: [{ id: 'extras', name: 'Adicionais', position: 0, visible: true, items: [] }],
  },
];

function find(menu, id) {
  for (const category of menu) {
    const root = (category.items || []).find((item) => item.id === id);
    if (root) return { category, subcategory: null, item: root };
    for (const subcategory of category.subcategories || []) {
      const item = (subcategory.items || []).find((candidate) => candidate.id === id);
      if (item) return { category, subcategory, item };
    }
  }
  return null;
}

function testMoveRootToSubcategoryPreservesIdentity() {
  const menu = baseMenu();
  const originalItem = menu[0].items[0];
  const original = clone(menu);
  const result = core.moveMenuItem(menu, {
    itemId: 'hot-dog', targetCategoryName: 'Bebidas', targetSubcategoryId: 'ovos',
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(menu, original, 'o helper não deve mutar o snapshot anterior');
  assert.equal(find(result.menu, 'hot-dog').category.name, 'Bebidas');
  assert.equal(find(result.menu, 'hot-dog').subcategory.id, 'ovos');
  assert.deepEqual(find(result.menu, 'hot-dog').item, original[0].items[0], 'preço, estoque e campos desconhecidos permanecem');
  assert.equal(find(result.menu, 'hot-dog').item, originalItem, 'o item é o mesmo objeto lógico, sem novo ID');
}

function testMoveSubcategoryToRoot() {
  const menu = baseMenu();
  menu[2].subcategories[0].items.push({ id: 'cheese', name: 'Queijo', price: 3, ingredients: 'queijo' });
  const result = core.moveMenuItem(menu, { itemId: 'cheese', targetCategoryName: 'Lanches' });
  assert.equal(result.ok, true);
  assert.equal(result.target.subcategoryId, null);
  assert.equal(find(result.menu, 'cheese').category.name, 'Lanches');
  assert.equal(find(result.menu, 'cheese').subcategory, null);
  assert.equal(find(result.menu, 'cheese').item.price, 3);
}

function testRejectsPizzaBoundaryAndInvalidDestination() {
  const menu = baseMenu();
  menu.push({ name: 'Pizzas', type: 'pizzas', items: [{ id: 'pizza-size', name: 'Média com Borda', price: 80, flavors: ['x'], size: 'M' }], subcategories: [] });
  const incompatible = core.moveMenuItem(menu, { itemId: 'pizza-size', targetCategoryName: 'Lanches' });
  assert.equal(incompatible.ok, false);
  assert.equal(incompatible.code, 'INCOMPATIBLE_DESTINATION');
  const missing = core.moveMenuItem(menu, { itemId: 'hot-dog', targetCategoryName: 'Bebidas', targetSubcategoryId: 'missing' });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'SUBCATEGORY_NOT_FOUND');
}

async function testHandlerAckPersistenceBroadcastAndIsolation() {
  const io = new FakeIO();
  const socket = new FakeSocket('admin-a', io, 'tenant-a');
  const state = { menu: baseMenu() };
  const persisted = [];
  handlerModule.registerMenuDragHandler({
    socket, io, getTenantId: () => 'tenant-a', getState: () => state,
    isAdminForTenant: (tenantId) => tenantId === 'tenant-a',
    withTenantCommand: async (_tenantId, operation) => operation(),
    persistMenu: async (menu, tenantId) => { persisted.push({ menu: clone(menu), tenantId }); },
  });
  const ack = await socket.invoke('move_menu_item', {
    itemId: 'hot-dog', targetCategoryName: 'Bebidas', targetSubcategoryId: 'ovos',
  });
  assert.equal(ack.ok, true);
  assert.equal(persisted.length, 1, 'persistência oficial deve ocorrer uma vez');
  assert.equal(persisted[0].tenantId, 'tenant-a');
  assert.equal(find(state.menu, 'hot-dog').category.name, 'Bebidas');
  assert.equal(io.roomEvents('tenant:tenant-a', 'update_menu').length, 1, 'WaiterTerminal receberia o broadcast de catálogo');

  const denied = await socket.invoke('move_menu_item', { itemId: 'hot-dog', targetCategoryName: 'Adicionais' });
  assert.equal(denied.ok, true, 'o mesmo admin continua autorizado');
  const otherSocket = new FakeSocket('admin-b', io, 'tenant-b');
  handlerModule.registerMenuDragHandler({
    socket: otherSocket, io, getTenantId: () => 'tenant-b', getState: () => ({ menu: baseMenu() }),
    isAdminForTenant: () => false,
    withTenantCommand: async (_tenantId, operation) => operation(),
    persistMenu: async () => { throw new Error('não deveria persistir tenant inválido'); },
  });
  const crossTenant = await otherSocket.invoke('move_menu_item', { itemId: 'hot-dog', targetCategoryName: 'Bebidas' });
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.code, 'UNAUTHORIZED');
}

async function testPersistenceFailureDoesNotBroadcastOrMutate() {
  const io = new FakeIO();
  const socket = new FakeSocket('admin-fail', io, 'tenant-fail');
  const state = { menu: baseMenu() };
  const before = clone(state.menu);
  handlerModule.registerMenuDragHandler({
    socket, io, getTenantId: () => 'tenant-fail', getState: () => state,
    isAdminForTenant: () => true,
    withTenantCommand: async (_tenantId, operation) => operation(),
    persistMenu: async () => { throw new Error('fake persistence failure'); },
  });
  const ack = await socket.invoke('move_menu_item', { itemId: 'hot-dog', targetCategoryName: 'Bebidas' });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'PERSISTENCE_FAILED');
  assert.deepEqual(state.menu, before, 'falha não aplica estado otimista');
  assert.equal(io.roomEvents('tenant:tenant-fail', 'update_menu').length, 0);
}

async function testReservedItemIsRejected() {
  const io = new FakeIO();
  const socket = new FakeSocket('admin-reserved', io, 'tenant-reserved');
  const state = { menu: baseMenu() };
  state.menu[0].items[0].source = 'parquinho';
  handlerModule.registerMenuDragHandler({
    socket, io, getTenantId: () => 'tenant-reserved', getState: () => state,
    isAdminForTenant: () => true,
    withTenantCommand: async (_tenantId, operation) => operation(),
    persistMenu: async () => { throw new Error('reserved item should stop before persistence'); },
    isReservedItem: (item) => item?.source === 'parquinho',
  });
  const ack = await socket.invoke('move_menu_item', { itemId: 'hot-dog', targetCategoryName: 'Bebidas' });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'RESERVED_ITEM');
}

function testWaiterConsumerWiring() {
  const provider = fs.readFileSync('src/components/FirebaseProvider.tsx', 'utf8');
  const waiter = fs.readFileSync('src/components/WaiterTerminal.tsx', 'utf8');
  assert.match(provider, /socket\.on\('update_menu', handleUpdateMenu\)/);
  assert.match(provider, /const handleUpdateMenu = \(data: MenuCategory\[\]\)/);
  assert.match(waiter, /menu: MenuCategory\[\]/);
}

(async () => {
  testMoveRootToSubcategoryPreservesIdentity();
  testMoveSubcategoryToRoot();
  testRejectsPizzaBoundaryAndInvalidDestination();
  await testHandlerAckPersistenceBroadcastAndIsolation();
  await testPersistenceFailureDoesNotBroadcastOrMutate();
  await testReservedItemIsRejected();
  testWaiterConsumerWiring();
  console.log('test-menu-drag: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
