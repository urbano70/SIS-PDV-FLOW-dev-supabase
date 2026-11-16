#!/usr/bin/env node
'use strict';

const { assert, clone, loadTsModule } = require('./testsHelpers.cjs');

const core = loadTsModule('src/server/playground-core.ts', 'playground-catalog');
const tenant = 'tenant-catalog-guards';
const productId = `parquinho:${tenant}`;

const menu = [
  {
    name: 'Outros',
    type: 'outros',
    visible: true,
    items: [
      { id: 'play-kids', name: 'PLAY KIDS', type: 'outros', price: 70 },
      { id: 'copy-one', name: 'Cópia reservada', source: 'parquinho', price: 999 },
    ],
    subcategories: [
      { id: 'legacy-sub', name: 'Legados', items: [
        { id: 'legacy-food', name: 'Bolo', price: 8 },
        { id: productId, name: 'Parquinho duplicado', source: 'parquinho', price: 1 },
      ] },
    ],
  },
  {
    name: 'Lanches',
    type: 'lanches',
    items: [{ id: 'l1', name: 'X Delli', price: 32 }],
    subcategories: [],
  },
];

assert.equal(core.isPlaygroundReservedItem({ source: 'parquinho', id: 'arbitrary-copy' }, tenant), true);
assert.equal(core.isPlaygroundReservedItem({ isParquinho: true, id: 'arbitrary-copy' }, tenant), true);
assert.equal(core.isPlaygroundReservedItem({ id: productId }, tenant), true);
assert.equal(core.isPlaygroundReservedItem({ id: 'normal-food' }, tenant), false);

const first = core.ensurePlaygroundProduct(menu, tenant, 25);
assert.equal(first.changed, true);
const others = first.menu.find((category) => category.type === 'outros');
assert.ok(others, 'categoria Outros deve existir');
assert.equal(others.items.filter((item) => core.isPlaygroundReservedItem(item, tenant)).length, 1);
assert.deepEqual(others.items.find((item) => item.id === 'play-kids'), menu[0].items[0], 'PLAY KIDS permanece independente');
assert.equal(others.items.find((item) => item.id === productId).price, 25);
assert.equal(others.items.find((item) => item.id === productId).unidade, 'criança');
assert.equal(others.items.find((item) => item.id === productId).unit, 'criança');
assert.equal(others.subcategories[0].items.some((item) => core.isPlaygroundReservedItem(item, tenant)), false, 'submenu não duplica item reservado');
assert.equal(others.subcategories[0].items.some((item) => item.id === 'legacy-food'), true, 'item legado do submenu permanece');

const second = core.ensurePlaygroundProduct(first.menu, tenant, 25);
assert.equal(second.changed, false, 'sincronização repetida é idempotente');
assert.equal(second.menu.find((category) => category.type === 'outros').items.filter((item) => item.id === productId).length, 1);

const repriced = core.synchronizePlaygroundCatalog(first.menu, tenant, {
  parquinhoEnabled: true,
  parquinhoPrice: 30,
});
assert.equal(repriced.menu.find((category) => category.type === 'outros').items.find((item) => item.id === productId).price, 30);
const oldCharge = { menuItemId: productId, source: 'parquinho', price: 25, quantity: 1 };
assert.equal(oldCharge.price, 25, 'reprecificação do catálogo não altera lançamento histórico');

const noPrice = core.synchronizePlaygroundCatalog(first.menu, tenant, {
  parquinhoEnabled: true,
  parquinhoPrice: null,
});
assert.equal(noPrice.menu.find((category) => category.type === 'outros').items.find((item) => item.id === productId).price, null);

const disabled = core.synchronizePlaygroundCatalog(first.menu, tenant, {
  parquinhoEnabled: false,
  parquinhoPrice: 30,
});
assert.deepEqual(disabled.menu, first.menu, 'desativação preserva o catálogo em memória');

console.log('test-playground-catalog: ok');
