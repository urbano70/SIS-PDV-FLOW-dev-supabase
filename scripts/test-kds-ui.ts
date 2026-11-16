import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canAdvanceKitchenStage,
  getKitchenStage,
  isKitchenTracked,
  isPlaygroundItem,
  needsKitchenReadyForDelivery,
  resolveKitchenItemType,
} from '../src/lib/kitchenStatus.ts';
import type { MenuCategory, PizzaItem } from '../src/types.ts';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const baseItem = (patch: Partial<PizzaItem> = {}): PizzaItem => ({
  id: 'item-1',
  menuItemId: 'menu-1',
  name: 'Item',
  type: 'bebidas',
  flavors: [],
  size: 'G',
  extras: [],
  observations: '',
  price: 10,
  ...patch,
});

const menu: MenuCategory[] = [{
  name: 'Cardápio',
  type: 'outros',
  visible: true,
  subcategories: [{
    id: 'sub-lanches',
    name: 'Lanches especiais',
    position: 0,
    visible: true,
    items: [{ id: 'menu-1', name: 'Item', price: 10 }],
  }],
  items: [],
}];

const staleType = baseItem({ type: 'bebidas' });
assert.equal(resolveKitchenItemType(staleType, menu), 'outros', 'a categoria-pai deve ser resolvida mesmo em subcategoria');
assert.equal(isKitchenTracked(staleType, menu), false, 'categoria-pai Outros não entra no KDS');

const lancheMenu: MenuCategory[] = [{ ...menu[0], type: 'lanches' }];
assert.equal(resolveKitchenItemType(staleType, lancheMenu), 'lanches', 'resolveKitchenItemType deve corrigir type stale');
assert.equal(isKitchenTracked(staleType, lancheMenu), true, 'lanche resolvido deve entrar no KDS');
assert.equal(isKitchenTracked(baseItem({ menuItemId: 'porcao-1', type: 'porcoes' }), lancheMenu), false, 'porções não devem ser obrigadas ao KDS');
assert.equal(isKitchenTracked(baseItem({ menuItemId: 'lacarte-1', type: 'lacarte' }), lancheMenu), false, 'à la carte não deve ser obrigada ao KDS');
assert.equal(isKitchenTracked(baseItem({ menuItemId: 'bebida-1', type: 'bebidas' }), lancheMenu), false, 'bebidas não devem ser obrigadas ao KDS');
assert.equal(isKitchenTracked(baseItem({ source: 'parquinho', type: 'lanches' }), lancheMenu), false, 'Parquinho não entra no KDS');
assert.equal(isPlaygroundItem(baseItem({ source: 'parquinho' })), true);

const legacyPlaygroundItem = { ...baseItem({ type: 'lanches' }), isParquinho: true };
assert.equal(isPlaygroundItem(legacyPlaygroundItem), true);
assert.equal(isKitchenTracked(legacyPlaygroundItem, lancheMenu), false, 'marcador legado também exclui preparo');

const pizza = baseItem({ type: 'pizzas' });
assert.equal(getKitchenStage(pizza), 'waiting');
assert.equal(canAdvanceKitchenStage(pizza, 'preparing'), true);
assert.equal(canAdvanceKitchenStage(pizza, 'oven'), false, 'pizza não pode pular o preparo');
assert.equal(canAdvanceKitchenStage({ ...pizza, kitchenStatus: 'preparing' }, 'oven'), true);
assert.equal(canAdvanceKitchenStage({ ...pizza, kitchenStatus: 'preparing' }, 'ready'), false, 'pizza passa pelo forno');
assert.equal(canAdvanceKitchenStage({ ...pizza, kitchenStatus: 'oven' }, 'ready'), true);
assert.equal(canAdvanceKitchenStage({ ...pizza, kitchenStatus: 'ready' }, 'preparing'), false);

const lanche = baseItem({ type: 'lanches' });
assert.equal(canAdvanceKitchenStage({ ...lanche, kitchenStatus: 'preparing' }, 'ready', lancheMenu), true);
assert.equal(canAdvanceKitchenStage({ ...lanche, kitchenStatus: 'preparing' }, 'oven', lancheMenu), false, 'lanche não deve passar pelo forno');
assert.equal(needsKitchenReadyForDelivery(lanche, true, lancheMenu), true);
assert.equal(needsKitchenReadyForDelivery({ ...lanche, kitchenStatus: 'ready' }, true, lancheMenu), false);
assert.equal(needsKitchenReadyForDelivery(lanche, false, lancheMenu), false, 'KDS off não pode bloquear entrega');
assert.equal(needsKitchenReadyForDelivery({ ...lanche, deliveredAt: '2026-11-16T20:00:00.000Z' }, true, lancheMenu), false);

const waiter = read('src/components/WaiterTerminal.tsx');
const dashboard = read('src/components/Dashboard.tsx');
const kitchen = read('src/components/KitchenDisplay.tsx');
const provider = read('src/components/FirebaseProvider.tsx');
const onboarding = read('src/components/SelfOnboarding.tsx');
const app = read('src/App.tsx');

assert.match(waiter, /KitchenItemStatusBadge/);
assert.match(dashboard, /KitchenItemStatusBadge/);
assert.match(dashboard, /item\.price == null \? 'Preço não configurado'/);
assert.match(dashboard, /disabled=\{isManagedPlaygroundItem\(item\)\}/);
assert.doesNotMatch(dashboard, /kdsNeedsUpdate|kdsEnabled:\s*cfg\.kdsEnabled/, 'default de plano não sobrescreve KDS oficial');
assert.doesNotMatch(waiter, /✓ Pronto — Retirar/);
assert.doesNotMatch(dashboard, /✓ Pronto — Retirar/);
assert.match(waiter, /socket\.emit\('deliver_item',[\s\S]*settle/);
assert.match(kitchen, /type ItemActionAck|ItemActionAck/);
assert.match(kitchen, /socket\.emit\(event, \{ orderId, itemId \}, settle\)/);
assert.match(kitchen, /if \(item\.removed \|\| item\.deliveredAt\) continue/);
assert.doesNotMatch(kitchen, /item\.removed \|\| item\.deliveredAt \|\| item\.paid/);
assert.doesNotMatch(provider, /initialCache\.pizzariaConfig[^\n]*kdsEnabled:\s*false/);
assert.doesNotMatch(provider, /data\.pizzariaConfig[^\n]*kdsEnabled:\s*false/);
assert.match(provider, /isWaiterMode \? null : readTenantCache/);
assert.match(provider, /data\?\.currentWaiter \|\| data\?\.current_waiter \|\| data\?\.waiter/);
assert.doesNotMatch(onboarding, /waiters\.find/);
assert.match(onboarding, /waiter_login.*applyLoginAck/);
assert.match(app, /currentWaiter/);

console.log('test-kds-ui: ok');
