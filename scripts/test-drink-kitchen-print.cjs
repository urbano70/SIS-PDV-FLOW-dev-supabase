#!/usr/bin/env node
'use strict';

/**
 * Focused regression test for drink production tickets. It bundles only the
 * real pure builders; no React app, browser, Socket.IO, database, or printer
 * hardware is started.
 */

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_PATH = path.join(ROOT, 'src/components/Dashboard.tsx');
const BLUETOOTH_PATH = path.join(ROOT, 'src/lib/bluetoothPrinter.ts');
const PIZZA_HELPER_PATH = path.join(ROOT, 'src/lib/pizzaKitchenDetails.ts');
const DRINK_HELPER_PATH = path.join(ROOT, 'src/lib/drinkPrintDetails.ts');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  let state = 'code';
  let quote = '';
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'line') { if (ch === '\n') state = 'code'; continue; }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; i += 1; }
      continue;
    }
    if (state === 'string') {
      if (ch === '\\') i += 1;
      else if (ch === quote) { state = 'code'; quote = ''; }
      continue;
    }
    if (state === 'template') {
      if (ch === '\\') i += 1;
      else if (ch === '`') state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') { state = 'line'; i += 1; continue; }
    if (ch === '/' && next === '*') { state = 'block'; i += 1; continue; }
    if (ch === '`') { state = 'template'; continue; }
    if (ch === '"' || ch === "'") { state = 'string'; quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return i;
  }
  throw new Error('Não foi possível fechar o builder extraído.');
}

function extractDashboardBuilder(source) {
  const start = source.indexOf('const TO_CP437');
  assert(start >= 0, 'Constantes ESC/POS do Dashboard ausentes.');
  const marker = 'function buildEscPosKitchenTicket';
  const functionStart = source.indexOf(marker, start);
  assert(functionStart >= 0, 'Builder ESC/POS do Dashboard ausente.');
  const open = source.indexOf('{', functionStart);
  const end = matchingBrace(source, open);
  return source.slice(start, end + 1);
}

function bundle(source, sourcefile, resolveDir = ROOT) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drink-kitchen-print-'));
  const outfile = path.join(tempDir, 'module.cjs');
  esbuild.buildSync({
    stdin: { contents: source, sourcefile, resolveDir, loader: sourcefile.endsWith('.tsx') ? 'tsx' : 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile,
    logLevel: 'silent',
  });
  delete require.cache[require.resolve(outfile)];
  return require(outfile);
}

function loadDashboard(source) {
  const wrapper = `
import { getPizzaKitchenDetails } from ${JSON.stringify(PIZZA_HELPER_PATH)};
import { getDrinkProductionDetails } from ${JSON.stringify(DRINK_HELPER_PATH)};
${extractDashboardBuilder(source)}
export { buildEscPosKitchenTicket };
`;
  return bundle(wrapper, path.join(ROOT, 'drink-dashboard-builder.ts'));
}

function loadBluetooth(source, label) {
  return bundle(source, path.join(ROOT, `src/lib/${label}.ts`), path.join(ROOT, 'src/lib'));
}

const CP437 = new Map([
  [0x80, 'Ç'], [0x81, 'ü'], [0x82, 'é'], [0x83, 'â'], [0x84, 'ä'], [0x85, 'à'], [0x86, 'å'], [0x87, 'ç'],
  [0x88, 'ê'], [0x89, 'ë'], [0x8a, 'è'], [0x8b, 'ï'], [0x8c, 'î'], [0x8d, 'ì'], [0x8e, 'Ä'], [0x8f, 'Å'],
  [0x90, 'É'], [0x91, 'æ'], [0x92, 'Æ'], [0x93, 'ô'], [0x94, 'ö'], [0x95, 'ò'], [0x96, 'û'], [0x97, 'ù'],
  [0x98, 'ÿ'], [0x99, 'Ö'], [0x9a, 'Ü'], [0xa0, 'á'], [0xa1, 'í'], [0xa2, 'ó'], [0xa3, 'ú'], [0xa4, 'ñ'],
  [0xa5, 'Ñ'], [0xf8, '°'],
]);
const CP850 = new Map([...CP437, [0xc6, 'ã'], [0xc7, 'Ã'], [0xe4, 'õ'], [0xe5, 'Õ']]);

function parseEscPos(value, encoding = CP437) {
  const bytes = Array.from(value instanceof Uint8Array ? value : value);
  const lines = [];
  let text = '';
  let bold = false;
  let width = 1;
  let height = 1;
  const pushLine = () => {
    if (text) lines.push({ text, bold, width, height });
    text = '';
  };
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === 0x0a) { pushLine(); continue; }
    if (byte === 0x1b) {
      const command = bytes[i + 1];
      if (command === 0x40) { bold = false; width = 1; height = 1; i += 1; }
      else if (command === 0x45) { bold = bytes[i + 2] === 1; i += 2; }
      else if (command === 0x74 || command === 0x61) i += 2;
      else i += 1;
      continue;
    }
    if (byte === 0x1d) {
      const command = bytes[i + 1];
      if (command === 0x21) {
        const n = bytes[i + 2] || 0;
        width = ((n >> 4) & 0x03) + 1;
        height = (n & 0x0f) + 1;
        i += 2;
      } else if (command === 0x56) {
        i += bytes[i + 2] === 0x42 ? 3 : 2;
      } else i += 1;
      continue;
    }
    if (byte >= 0x20 || byte === 0x09) text += byte < 0x80 ? String.fromCharCode(byte) : (encoding.get(byte) || '?');
  }
  pushLine();
  return lines;
}

function line(lines, expected, label) {
  const index = lines.findIndex(item => item.text === expected);
  assert(index >= 0, `${label}: linha ${JSON.stringify(expected)} ausente; linhas: ${JSON.stringify(lines.map(item => item.text))}`);
  return index;
}

function drinkObservation() {
  return '2 copos (Gelo+Limão) · 1 copo (Gelo) · 1 copo (Limão) · 1 copo · 0 copos (Gelo) · Junto com pedido · Sem açúcar';
}

function runDashboardAssertions(pc) {
  const drink = { name: 'Suco de Laranja', type: 'bebidas', quantity: 2, price: 20, observations: drinkObservation() };
  const next = { name: 'Depois', type: 'lanches', quantity: 1, price: 10 };
  const lines = parseEscPos(pc.buildEscPosKitchenTicket([drink, next], 'Mesa', 7, 'Bebidas', '80mm'));
  const both = line(lines, '2 COPOS (GELO+LIMaO)', 'Dashboard');
  const ice = line(lines, '1 COPO (GELO)', 'Dashboard');
  const lemon = line(lines, '1 COPO (LIMaO)', 'Dashboard');
  const plainServing = line(lines, '1 COPO', 'Dashboard');
  const withOrder = line(lines, 'JUNTO COM PEDIDO', 'Dashboard');
  const observation = line(lines, 'OBS: SEM AÇúCAR', 'Dashboard');
  const nextIndex = line(lines, '1x Depois', 'Dashboard');
  for (const index of [both, ice, lemon, plainServing, withOrder]) assert.equal(lines[index].bold, true, `Dashboard: linha ${lines[index].text} não ficou em negrito`);
  assert(both < ice && ice < lemon && lemon < plainServing && plainServing < withOrder && withOrder < observation, 'Dashboard: ordem de copos/Junto/observação inválida');
  assert.equal(lines[observation].bold, false, 'Dashboard: negrito vazou para observação');
  assert.equal(lines[nextIndex].bold, false, 'Dashboard: negrito vazou para o item seguinte');
  assert.equal(lines.filter(item => item.text.includes('0 COPOS')).length, 0, 'Dashboard: copo com quantidade zero foi impresso');

  const plainDrink = { name: 'Água', type: 'bebidas', quantity: 1, price: 5, observations: 'Sem açúcar' };
  const plainLines = parseEscPos(pc.buildEscPosKitchenTicket(plainDrink, 'Mesa', 7, 'Bebidas', '80mm'));
  const plainObservation = line(plainLines, 'OBS: SEM AÇúCAR', 'Dashboard sem extras');
  assert.equal(plainLines.filter(item => /\bCOPOS?\b/.test(item.text)).length, 0, 'Dashboard sem extras: linha de copos inesperada');
  assert.equal(plainLines[plainObservation].bold, false, 'Dashboard sem extras: observação ficou em negrito');
}

function runBluetoothAssertions(bt) {
  const order = {
    id: 'BT-DRINK', tableId: 4, waiterName: 'Bia',
    items: [
      { name: 'Suco de Laranja', type: 'bebidas', price: 20, quantity: 2, obs: drinkObservation() },
      { name: 'Depois', type: 'lanches', price: 10, quantity: 1 },
    ],
  };
  const lines = parseEscPos(bt.buildOrderTicket(order, 'Minha Loja'), CP850);
  const both = line(lines, '2 copos (Gelo+Limão)', 'Bluetooth');
  const ice = line(lines, '1 copo (Gelo)', 'Bluetooth');
  const lemon = line(lines, '1 copo (Limão)', 'Bluetooth');
  const plainServing = line(lines, '1 copo', 'Bluetooth');
  const withOrder = line(lines, 'Junto com pedido', 'Bluetooth');
  const observation = line(lines, '   Obs: Sem açúcar', 'Bluetooth');
  for (const index of [both, ice, lemon, plainServing, withOrder]) assert.equal(lines[index].bold, true, `Bluetooth: linha ${lines[index].text} não ficou em negrito`);
  assert(both < ice && ice < lemon && lemon < plainServing && plainServing < withOrder && withOrder < observation, 'Bluetooth: ordem de copos/Junto/observação inválida');
  assert.equal(lines[observation].bold, false, 'Bluetooth: negrito vazou para observação');
  assert.equal(lines.filter(item => item.text.includes('0 copos')).length, 0, 'Bluetooth: copo com quantidade zero foi impresso');

  const plainDrink = { id: 'BT-PLAIN', tableId: 4, items: [{ name: 'Água', type: 'bebidas', price: 5, quantity: 1, obs: 'Sem açúcar' }] };
  const plainLines = parseEscPos(bt.buildOrderTicket(plainDrink, 'Minha Loja'), CP850);
  const plainObservation = line(plainLines, '   Obs: Sem açúcar', 'Bluetooth sem extras');
  assert.equal(plainLines.filter(item => /\bcopos?\b/i.test(item.text)).length, 0, 'Bluetooth sem extras: linha de copos inesperada');
  assert.equal(plainLines[plainObservation].bold, false, 'Bluetooth sem extras: observação ficou em negrito');
}

function runHtmlAssertions(source) {
  assert.match(source, /getDrinkProductionDetails\(item\)/, 'HTML: helper de bebidas ausente');
  assert.match(source, /drinkDetails\.lines\.map\(detail => `<div style="font-size:\$\{_obsFs\};font-weight:bold">/, 'HTML: linhas de bebidas não estão em negrito');
  assert.match(source, /drinkDetails\?\.remainingObservation \?\? item\.observations/, 'HTML: observação de bebida não é desduplicada');
}

function main() {
  const dashboardSource = read(DASHBOARD_PATH);
  const bluetoothSource = read(BLUETOOTH_PATH);
  const dashboard = loadDashboard(dashboardSource);
  const bluetooth = loadBluetooth(bluetoothSource, 'drink-working-tree-bluetoothPrinter');
  runDashboardAssertions(dashboard);
  runBluetoothAssertions(bluetooth);
  runHtmlAssertions(dashboardSource);

  // Customer receipt bytes are a separate path and must remain byte-identical.
  const receiptOrder = { id: 'RCPT-DRINK', tableId: 4, items: [{ name: 'Suco', type: 'bebidas', price: 10, quantity: 1, obs: drinkObservation() }] };
  const config = { establishmentName: 'Minha Loja', receiptHeader: '', address: '', receiptTitle: 'COMPROVANTE', receiptFooter: '' };
  const currentBytes = Array.from(bluetooth.buildReceiptTicket(receiptOrder, config));
  const headBluetooth = loadBluetooth(childProcess.execFileSync('git', ['show', `HEAD:${path.relative(ROOT, BLUETOOTH_PATH)}`], { cwd: ROOT, encoding: 'utf8' }), 'head-bluetoothPrinter');
  const headBytes = Array.from(headBluetooth.buildReceiptTicket(receiptOrder, config));
  assert.deepEqual(currentBytes, headBytes, 'Comprovante do cliente mudou byte-a-byte');

  console.log('OK: produção de bebidas PC ESC/POS, agente/TCP raw, Bluetooth, fallback HTML e recibo do cliente passaram.');
  console.log('Cobertura: combinações Gelo/Limão, copos sem extras, Junto com pedido, quantity zero, desduplicação, reset de bold e observação comum.');
}

try {
  main();
} catch (error) {
  console.error(`FALHOU: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
}
