import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getPlaygroundLaunchError,
  isPlaygroundItem,
  isValidPlaygroundPrice,
  makePlaygroundLaunch,
  parsePlaygroundPriceInput,
  trimChildName,
} from '../src/lib/playgroundClient.ts';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

assert.equal(isValidPlaygroundPrice(0), true, 'zero is an explicit valid price');
assert.equal(isValidPlaygroundPrice(25.5), true);
assert.equal(isValidPlaygroundPrice(null), false);
assert.equal(isValidPlaygroundPrice(-0.01), false);
assert.equal(parsePlaygroundPriceInput('25,50'), 25.5);
assert.equal(parsePlaygroundPriceInput('0'), 0);
assert.equal(parsePlaygroundPriceInput(''), null);
assert.equal(parsePlaygroundPriceInput('abc'), null);
assert.equal(trimChildName('  Ana  '), 'Ana');
assert.equal(trimChildName('   '), '');

const readyData = {
  ready: true,
  isCashRegisterOpen: true,
  config: {
    parquinhoEnabled: true,
    parquinhoChildNameRequired: true,
    parquinhoPrice: 0,
    parquinhoProductId: 'parquinho:tenant-a',
  },
};
assert.equal(getPlaygroundLaunchError(readyData, '  Bia '), null);
assert.match(getPlaygroundLaunchError(readyData, '   ') || '', /nome/i);
assert.match(getPlaygroundLaunchError({ ...readyData, config: { ...readyData.config, parquinhoPrice: null } }, 'Bia') || '', /preço/i);
assert.match(getPlaygroundLaunchError({ ...readyData, isCashRegisterOpen: false }, 'Bia') || '', /caixa/i);
assert.equal(getPlaygroundLaunchError({ ...readyData, config: { ...readyData.config, parquinhoChildNameRequired: false } }, '   '), null);

const launch = makePlaygroundLaunch(3, '  Bia  ', 'request-1', 'build-1');
assert.deepEqual(launch, { requestId: 'request-1', tableId: 3, childName: 'Bia', buildId: 'build-1' });
assert.equal(isPlaygroundItem({ source: 'parquinho' }), true);
assert.equal(isPlaygroundItem({ menuItemId: 'parquinho:tenant-a' }, 'tenant-a'), true);
assert.equal(isPlaygroundItem({ menuItemId: 'parquinho:tenant-b' }, 'tenant-a'), false);
const ordinaryOtherProduct = { id: 'other-product', type: 'outros' };
assert.equal(isPlaygroundItem(ordinaryOtherProduct), false);

const terminal = read('src/components/PlaygroundTerminal.tsx');
const app = read('src/App.tsx');
const client = read('src/lib/playgroundClient.ts');
assert.equal(terminal.includes("from '../lib/socket'"), false, 'operator terminal must not import shared socket');
assert.equal(/import\s+.*FirebaseProvider|<FirebaseProvider/.test(terminal), false, 'operator terminal must not mount the full provider');
assert.match(client, /sessionStorage/);
assert.equal(client.includes('localStorage'), false, 'playground session must not persist credentials in localStorage');
assert.match(terminal, /parquinho_add_entry/);
assert.match(terminal, /makePlaygroundLaunch/);
assert.match(terminal, /!hasPendingLaunch/);
assert.match(app, /path="\/parquinho"/);
assert.match(app, /PlaygroundTerminal/);
assert.match(read('src/components/Dashboard.tsx'), /PlaygroundReport/);
assert.match(read('src/components/WaiterTerminal.tsx'), /Criança:/);

const adminCard = read('src/components/PlaygroundAdminCard.tsx');
assert.match(adminCard, /await emitPlaygroundAck\(socket, 'update_pizzaria_config', patch\)/);
assert.doesNotMatch(adminCard, /\.\.\.pizzariaConfig,/, 'o card não deve sobrescrever configurações de outro PC');
assert.match(adminCard, /if \(!ack\.ok\)/, 'não avisar sucesso sem confirmação');
assert.match(adminCard, /parquinhoChildNameRequired === true/, 'padrão de obrigatoriedade deve coincidir com o servidor');
assert.match(read('src/components/Dashboard.tsx'), /isManagedPlaygroundItem\(item\).*aplicativo Operador de Parquinho/);
assert.match(read('src/components/Dashboard.tsx'), /isManagedPlaygroundItem\(selectedQuantityItem\)/);

console.log('test-playground-ui: ok');
