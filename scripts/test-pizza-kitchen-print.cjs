#!/usr/bin/env node
'use strict';

/**
 * Regression tests for pizza production printing.
 *
 * This file intentionally does not import Dashboard.tsx or WaiterTerminal.tsx as
 * React components. It extracts only Dashboard's real ESC/POS constants/helpers
 * and builder, and bundles the printer utility alone with esbuild. No app,
 * database, browser, socket, or environment configuration is loaded.
 */

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_PATH = path.join(ROOT, 'src/components/Dashboard.tsx');
const BLUETOOTH_PATH = path.join(ROOT, 'src/lib/bluetoothPrinter.ts');
const HELPER_PATH = path.join(ROOT, 'src/lib/pizzaKitchenDetails.ts');
const WAITER_PATH = path.join(ROOT, 'src/components/WaiterTerminal.tsx');
const BASELINE_REF = process.env.PIZZA_KITCHEN_BASELINE_REF || 'fd5c26c64aa6484c1da2ba3c0e2d45ed3017546d';
const FIXED_ISO = '2026-11-16T02:05:06.000Z';

let esbuild;
try {
  esbuild = require('esbuild');
} catch (error) {
  console.error('Este teste requer a dependência já instalada "esbuild".');
  throw error;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function gitHead(file) {
  return childProcess.execFileSync('git', ['show', `${BASELINE_REF}:${path.relative(ROOT, file)}`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/**
 * Find a JavaScript/TypeScript brace pair while ignoring comments, quoted
 * strings, and template-literal contents. Ignoring all braces inside a
 * template literal is sufficient here because only the outer function pair is
 * needed; it also avoids treating ${...} in ticket strings as declarations.
 */
function matchingBrace(source, openIndex) {
  let depth = 0;
  let state = 'code';
  let quote = '';

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'line-comment') {
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 1;
      }
      continue;
    }
    if (state === 'string') {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        state = 'code';
        quote = '';
      }
      continue;
    }
    if (state === 'template') {
      if (ch === '\\') {
        i += 1;
      } else if (ch === '`') {
        state = 'code';
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      state = 'line-comment';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block-comment';
      i += 1;
      continue;
    }
    if (ch === '`') {
      state = 'template';
      continue;
    }
    if (ch === '"' || ch === "'") {
      state = 'string';
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  throw new Error(`Não foi possível fechar o bloco iniciado em ${openIndex}.`);
}

function extractFunction(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert(start >= 0, `Função ${functionName} não encontrada na fonte.`);
  const open = source.indexOf('{', start);
  assert(open >= 0, `Corpo de ${functionName} não encontrado.`);
  return source.slice(start, matchingBrace(source, open) + 1);
}

function extractDashboardSnippet(source) {
  const startMarker = 'const TO_CP437';
  const start = source.indexOf(startMarker);
  assert(start >= 0, 'Constantes de codificação ESC/POS não encontradas no Dashboard.');
  const functionStart = source.indexOf('function buildEscPosKitchenTicket', start);
  assert(functionStart >= 0, 'buildEscPosKitchenTicket não encontrada no Dashboard.');
  const functionText = extractFunction(source, 'buildEscPosKitchenTicket');
  const end = functionStart + functionText.length;
  return source.slice(start, end);
}

function bundleToRequire(source, sourcefile, resolveDir = ROOT) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pizza-kitchen-print-'));
  const outfile = path.join(tempDir, 'module.cjs');
  try {
    esbuild.buildSync({
      stdin: {
        contents: source,
        sourcefile,
        resolveDir,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      outfile,
      logLevel: 'silent',
    });
    delete require.cache[require.resolve(outfile)];
    return { module: require(outfile), tempDir };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function loadDashboardBuilder(source, label) {
  const snippet = extractDashboardSnippet(source);
  const wrapper = `
import { getPizzaKitchenDetails } from ${JSON.stringify(HELPER_PATH)};
${snippet}
export { buildEscPosKitchenTicket };
`;
  return bundleToRequire(wrapper, `${label}-dashboard-extract.ts`).module;
}

function loadBluetooth(source, label) {
  const sourcefile = path.join(path.dirname(BLUETOOTH_PATH), `${label}-bluetoothPrinter.ts`);
  return bundleToRequire(source, sourcefile, path.dirname(BLUETOOTH_PATH)).module;
}

function withFixedDate(fn) {
  const RealDate = global.Date;
  const fixedTime = new RealDate(FIXED_ISO).getTime();
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [FIXED_ISO] : args));
    }
    static now() {
      return fixedTime;
    }
  }
  global.Date = FixedDate;
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

function asBytes(value) {
  return Array.from(value instanceof Uint8Array ? value : value);
}

function containsBytes(bytes, needle) {
  const haystack = asBytes(bytes);
  const wanted = asBytes(needle);
  outer: for (let i = 0; i <= haystack.length - wanted.length; i += 1) {
    for (let j = 0; j < wanted.length; j += 1) {
      if (haystack[i + j] !== wanted[j]) continue outer;
    }
    return true;
  }
  return false;
}

const CP437_REVERSE = new Map([
  [0x80, 'Ç'], [0x81, 'ü'], [0x82, 'é'], [0x83, 'â'], [0x84, 'ä'],
  [0x85, 'à'], [0x86, 'å'], [0x87, 'ç'], [0x88, 'ê'], [0x89, 'ë'],
  [0x8a, 'è'], [0x8b, 'ï'], [0x8c, 'î'], [0x8d, 'ì'], [0x8e, 'Ä'],
  [0x8f, 'Å'], [0x90, 'É'], [0x91, 'æ'], [0x92, 'Æ'], [0x93, 'ô'],
  [0x94, 'ö'], [0x95, 'ò'], [0x96, 'û'], [0x97, 'ù'], [0x98, 'ÿ'],
  [0x99, 'Ö'], [0x9a, 'Ü'], [0xa0, 'á'], [0xa1, 'í'], [0xa2, 'ó'],
  [0xa3, 'ú'], [0xa4, 'ñ'], [0xa5, 'Ñ'], [0xf8, '°'],
]);

function decodePrinterByte(byte) {
  return byte < 0x80 ? String.fromCharCode(byte) : (CP437_REVERSE.get(byte) || '?');
}

/** Parse only the ESC/POS controls relevant to ticket style assertions. */
function parseEscPos(value) {
  const bytes = asBytes(value);
  const lines = [];
  let text = '';
  let bold = false;
  let width = 1;
  let height = 1;
  let align = 0;

  const pushLine = () => {
    if (text.length > 0) lines.push({ text, bold, width, height, align });
    text = '';
  };

  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === 0x0a) {
      pushLine();
      continue;
    }
    if (byte === 0x1b) {
      const command = bytes[i + 1];
      if (command === 0x40) { // initialize
        bold = false; width = 1; height = 1; align = 0;
        i += 1;
      } else if (command === 0x45 || command === 0x61 || command === 0x74) {
        if (command === 0x45) bold = bytes[i + 2] === 0x01;
        if (command === 0x61) align = bytes[i + 2] || 0;
        i += 2;
      } else if (command === 0x21) {
        const n = bytes[i + 2] || 0;
        width = ((n >> 4) & 0x03) + 1;
        height = (n & 0x0f) + 1;
        i += 2;
      } else {
        i += 1;
      }
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
        // GS V m [n] cut; neither command nor its arguments are text.
        i += bytes[i + 2] === 0x42 ? 3 : 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (byte >= 0x20 || byte === 0x09) text += decodePrinterByte(byte);
  }
  pushLine();
  return lines;
}

function lineTexts(parsed) {
  return parsed.map(line => line.text);
}

function findLine(parsed, predicate, message) {
  const index = parsed.findIndex(line => predicate(line.text, line));
  assert(index >= 0, message);
  return index;
}

function findWrappedText(parsed, expectedText, message) {
  for (let start = 0; start < parsed.length; start += 1) {
    let joined = '';
    for (let end = start; end < Math.min(parsed.length, start + 8); end += 1) {
      joined = joined ? `${joined} ${parsed[end].text}` : parsed[end].text;
      if (joined === expectedText) return start;
      if (!expectedText.startsWith(joined)) break;
    }
  }
  assert.fail(message);
}

function assertStyle(parsed, texts, expectedText, expected, message) {
  const index = findLine(parsed, text => text === expectedText, `${message}: linha ${JSON.stringify(expectedText)} ausente`);
  const line = parsed[index];
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(line[key], value, `${message}: ${expectedText} deveria ter ${key}=${value}, recebeu ${line[key]}`);
  }
  return index;
}

function pizzaItemPc() {
  return {
    name: 'Pizza Grande (Calabresa / Mussarela) + Borda Catupiry / Cheddar',
    type: 'pizzas',
    quantity: 1,
    price: 31.5,
    crust: 'Catupiry / Cheddar',
    flavors: ['Calabresa', 'Mussarela', 'Mussarela'],
    waiterName: 'Ana',
  };
}

function assertPcPizzaTicket(pc, paperWidth) {
  const plain = { name: 'Hamburguer', type: 'lanches', quantity: 1, price: 19.9 };
  const bytes = withFixedDate(() => pc.buildEscPosKitchenTicket(
    [pizzaItemPc(), plain], 'Mesa', '12', 'Pizzas', paperWidth,
  ));
  const parsed = parseEscPos(bytes);
  const texts = lineTexts(parsed);
  const description = findWrappedText(parsed, '1x Pizza Grande', `PC ${paperWidth}: descrição da pizza alterada`);
  const borderHeading = assertStyle(parsed, texts, 'Borda:', { bold: true, width: 1, height: 2 }, `PC ${paperWidth}: borda`);
  const crust1 = assertStyle(parsed, texts, 'CATUPIRY', { bold: true, width: 1, height: 2 }, `PC ${paperWidth}: borda`);
  const crust2 = assertStyle(parsed, texts, 'CHEDDAR', { bold: true, width: 1, height: 2 }, `PC ${paperWidth}: borda`);
  const price = findLine(parsed, text => text === 'R$31,50', `PC ${paperWidth}: preço ausente`);
  const flavorsHeading = findLine(parsed, text => text === 'Sabores:', `PC ${paperWidth}: título de sabores ausente`);
  const flavor1 = findLine(parsed, text => text === '- 1 X CALABRESA', `PC ${paperWidth}: sabor unitário ausente`);
  const flavor2 = findLine(parsed, text => text === '- 2 X MUSSARELA', `PC ${paperWidth}: repetição de sabor não agrupada`);
  assert(description < borderHeading && borderHeading < price && price < flavorsHeading, `PC ${paperWidth}: ordem descrição → borda → preço → sabores inválida`);
  assert(crust1 > borderHeading && crust2 > crust1 && crust2 < price, `PC ${paperWidth}: bordas não são linhas consecutivas antes do preço`);
  assert(flavor1 > flavorsHeading && flavor2 > flavor1, `PC ${paperWidth}: ordem de sabores inválida`);

  // The pizza style must be closed before the next item's pre-existing title.
  const plainIndex = findLine(parsed, text => text === '1x Hamburguer', `PC ${paperWidth}: item simples ausente`);
  assert.equal(parsed[plainIndex].bold, false, `PC ${paperWidth}: negrito da borda vazou para item simples`);
  assert.equal(parsed[plainIndex].width, 2, `PC ${paperWidth}: largura existente do título simples foi alterada`);
  assert.equal(parsed[plainIndex].height, 1, `PC ${paperWidth}: altura existente do título simples foi alterada`);
  assert.equal(texts.filter(text => text === 'Borda:').length, 1, `PC ${paperWidth}: borda inesperada em item simples`);
  assert.equal(texts.filter(text => text === 'Sabores:').length, 1, `PC ${paperWidth}: bloco de sabores inesperado em item simples`);
  const waiter = parsed[parsed.length - 1];
  assert.equal(waiter.text, 'Garcom: Ana', `PC ${paperWidth}: rodapé não encontrado`);
  assert.equal(waiter.bold, false, `PC ${paperWidth}: estilo de borda vazou para Garcom`);
  assert.equal(waiter.height, 1, `PC ${paperWidth}: altura de borda vazou para Garcom`);

  assert(containsBytes(bytes, [0x1d, 0x21, 0x01]), `PC ${paperWidth}: não emitiu GS ! 0x01 para bordas`);
  assert(containsBytes(bytes, [0x1b, 0x45, 0x01]), `PC ${paperWidth}: não emitiu ESC E 1 para bordas`);
  assert(containsBytes(bytes, [0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00]), `PC ${paperWidth}: não restaurou tamanho/negrito após bordas`);

  const expectedLineLength = paperWidth === '80mm' ? 42 : 28;
  assert(texts.includes('-'.repeat(expectedLineLength)), `PC ${paperWidth}: caminho de largura não emitiu separador de ${expectedLineLength} colunas`);
  return { bytes, parsed };
}

function assertPcLongFlavorWrap(pc) {
  const longName = 'PORTUGUESA COM MUITO QUEIJO E TOMATE';
  const item = {
    name: 'Pizza Longa (Portuguesa) + Borda Catupiry',
    type: 'pizzas',
    quantity: 1,
    price: 40,
    crust: 'Catupiry',
    flavors: [longName, longName],
  };
  const parsed = parseEscPos(withFixedDate(() => pc.buildEscPosKitchenTicket(item, 'Mesa', 3, 'Pizzas', '48mm')));
  const texts = lineTexts(parsed);
  const normalized = texts.join(' ').replace(/\s+/g, ' ');
  assert(normalized.includes(`- 2 X ${longName}`), 'PC 48mm: nome longo perdeu o count ou foi truncado no wrap');
  assert.equal(texts.filter(text => text.startsWith('- 2 X')).length, 1, 'PC 48mm: count do sabor repetido foi duplicado/perdido no wrap');
}

function assertPcLegacyNonPizzaUnchanged(pc, pcHead) {
  const item = {
    name: 'Lanche com molho',
    type: 'lanches',
    quantity: 1,
    price: 22,
    flavors: ['Molho', 'Molho'],
    crust: 'Cheddar',
    observations: 'Sem cebola',
    waiterName: 'Ana',
  };
  const currentBytes = withFixedDate(() => pc.buildEscPosKitchenTicket(item, 'Mesa', 9, 'Cozinha', '80mm'));
  const headBytes = withFixedDate(() => pcHead.buildEscPosKitchenTicket(item, 'Mesa', 9, 'Cozinha', '80mm'));
  assert.deepEqual(asBytes(currentBytes), asBytes(headBytes), 'PC: item explícito não-pizza com flavors mudou o formato legado');
  const texts = lineTexts(parseEscPos(currentBytes));
  assert(!texts.includes('Sabores:'), 'PC: item explícito não-pizza ganhou título Sabores:');
  assert(!texts.some(text => text.startsWith('- 1 X ')), 'PC: item explícito não-pizza ganhou novo formato de sabor');
}

function assertHtmlFallbackSource(dashboard) {
  const start = dashboard.indexOf('const itemsHtml = items.map(item => {');
  assert(start >= 0, 'Fallback HTML de cozinha não contém items.map real.');
  const endMarker = '}).join(`<div class="sep"></div>`)';
  const end = dashboard.indexOf(endMarker, start);
  assert(end > start, 'Não foi possível delimitar o items.map do fallback HTML.');
  const block = dashboard.slice(start, end + endMarker.length);

  assert.match(block, /getPizzaKitchenDetails\(item\)/, 'HTML: fallback não usa o helper compartilhado');
  assert.match(block, /pizzaDetails\.crusts\.length > 0/, 'HTML: fallback não lê crusts agrupadas');
  assert.match(block, /pizzaDetails\.flavors\.length > 0/, 'HTML: fallback não lê flavors agrupados');
  assert.match(block, /font-size:calc\(\$\{_obsFs\} \+ 2px\);font-weight:bold/, 'HTML: borda não usa fonte maior e negrito');
  assert.match(block, /Borda:/, 'HTML: título Borda: ausente');
  assert.match(block, /name\.toUpperCase\(\)/, 'HTML: nomes de borda não preservam o formato uppercase PC');
  assert.match(block, /- \$\{count\} X \$\{name\.toUpperCase\(\)\}/, 'HTML: sabores não usam count agrupado no formato exigido');
  assert.match(block, /formatPizzaDetails\s*=\s*item\.type === 'pizzas' \|\| \(!item\.type && isPiz\)/, 'HTML: lanches/bebidas explícitos com flavors não foram excluídos do novo formato');
  assert.match(block, /formatPizzaDetails \? crustHtml \+ flavorsHtml : flavorsHtml \+ crustHtml/, 'HTML: borda não está antes dos sabores para pizza');
  assert.match(block, /else if \(isPiz && item\.flavors && item\.flavors\.length > 0\)/, 'HTML: fallback legado de flavors não-pizza foi removido');
}

function assertWaiterCartMapping(waiterSource) {
  const start = waiterSource.indexOf('items: cart.map(i => ({');
  assert(start >= 0, 'WaiterTerminal: mapping automático do carrinho não encontrado.');
  const end = waiterSource.indexOf('})),', start);
  assert(end > start, 'WaiterTerminal: mapping automático não pôde ser delimitado.');
  const block = waiterSource.slice(start, end);
  for (const field of ['name', 'price', 'quantity', 'obs', 'flavors', 'crust', 'type']) {
    assert.match(block, new RegExp(`\\b${field}\\s*:`), `WaiterTerminal: campo ${field} não é repassado ao ticket BT`);
  }
  assert.match(block, /obs:\s*\(i as any\)\.obs\s*\?\?\s*\(i as any\)\.observations/, 'WaiterTerminal: observações legadas não têm fallback');
}

function btPizzaOrder() {
  return {
    id: 'BT-1234',
    tableId: 12,
    isComanda: false,
    waiterName: 'Ana',
    observations: 'Sem cebola',
    items: [{
      name: 'Pizza BT (Calabresa / Mussarela) + Borda Catupiry / Cheddar',
      type: 'pizzas',
      price: 31.5,
      quantity: 1,
      flavors: ['Calabresa', 'Calabresa', 'Mussarela'],
      crust: 'Catupiry / Cheddar',
      obs: 'Bem assada',
    }],
  };
}

function assertBluetoothPizza(bt) {
  const bytes = withFixedDate(() => bt.buildOrderTicket(btPizzaOrder(), 'Minha Loja'));
  const parsed = parseEscPos(bytes);
  const texts = lineTexts(parsed);
  const description = findLine(parsed, text => text === '1x Pizza BT', 'BT: descrição da pizza alterada');
  const borderHeading = assertStyle(parsed, texts, 'Borda:', { bold: true, width: 1, height: 2 }, 'BT: borda');
  const crust1 = assertStyle(parsed, texts, 'Catupiry', { bold: true, width: 1, height: 2 }, 'BT: borda');
  const crust2 = assertStyle(parsed, texts, 'Cheddar', { bold: true, width: 1, height: 2 }, 'BT: borda');
  const flavorHeading = findLine(parsed, text => text === 'Sabores:', 'BT: título de sabores ausente');
  const flavor1 = findLine(parsed, text => text === '- 2 X Calabresa', 'BT: count/case do sabor repetido incorreto');
  const flavor2 = findLine(parsed, text => text === '- 1 X Mussarela', 'BT: sabor unitário ausente');
  assert(description < borderHeading && borderHeading < flavorHeading, 'BT: borda não vem imediatamente antes dos sabores');
  assert(crust1 > borderHeading && crust2 > crust1 && crust2 < flavorHeading, 'BT: duas bordas não foram linhas separadas antes dos sabores');
  assert(flavor1 > flavorHeading && flavor2 > flavor1, 'BT: ordem de sabores inválida');
  assert(!texts.includes('CATUPIRY') && !texts.includes('- 2 X CALABRESA'), 'BT: nomes existentes foram convertidos para uppercase');
  assert(containsBytes(bytes, [0x1b, 0x45, 0x01, 0x1d, 0x21, 0x01]), 'BT: não emitiu ESC E 1 + GS ! 0x01 nas bordas');
  assert(containsBytes(bytes, [0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00]), 'BT: não restaurou estilo após bordas');
  const obs = findLine(parsed, text => text === '   Obs: Bem assada', 'BT: observação ausente');
  assert.equal(parsed[obs].bold, false, 'BT: negrito da borda vazou para observação');
}

function assertBluetoothLegacyNonPizza(bt, btHead) {
  const order = {
    id: 'BT-LEGACY',
    tableId: 4,
    waiterName: 'Bia',
    items: [{
      name: 'Lanche molho',
      type: 'lanches',
      price: 22,
      quantity: 1,
      flavors: ['Molho', 'Molho'],
      crust: 'Cheddar',
    }],
  };
  const currentBytes = withFixedDate(() => bt.buildOrderTicket(order, 'Minha Loja'));
  const headBytes = withFixedDate(() => btHead.buildOrderTicket(order, 'Minha Loja'));
  assert.deepEqual(asBytes(currentBytes), asBytes(headBytes), 'BT: item explícito não-pizza com flavors deixou de usar o formato legado');
  const texts = lineTexts(parseEscPos(currentBytes));
  assert(!texts.includes('Sabores:'), 'BT: item explícito não-pizza ganhou título Sabores:');
  assert(!texts.some(text => text.startsWith('- 1 X ')), 'BT: item explícito não-pizza ganhou novo formato de sabor');
}

function assertReceiptUnchanged(bt, btHead) {
  const order = {
    id: 'RCPT-1234',
    tableId: 12,
    isComanda: false,
    waiterName: 'Ana',
    observations: 'Sem cebola',
    items: [
      {
        name: 'Pizza BT (Calabresa / Mussarela) + Borda Catupiry / Cheddar',
        type: 'pizzas',
        price: 31.5,
        quantity: 2,
        flavors: ['Calabresa', 'Calabresa', 'Mussarela'],
        crust: 'Catupiry / Cheddar',
        obs: 'Bem assada',
      },
      {
        name: 'Lanche molho',
        type: 'lanches',
        price: 22,
        quantity: 1,
        flavors: ['Molho', 'Molho'],
        crust: 'Cheddar',
      },
      { name: 'Item removido', type: 'lanches', price: 999, removed: true },
    ],
  };
  const config = {
    establishmentName: 'Minha Loja',
    receiptHeader: 'Obrigado',
    address: 'Rua 1',
    receiptTitle: 'COMPROVANTE',
    receiptFooter: 'Volte sempre',
  };
  const service = { servicoGarcomAtivo: true, taxaServico: 10 };
  const currentBytes = withFixedDate(() => bt.buildReceiptTicket(order, config, service));
  const headBytes = withFixedDate(() => btHead.buildReceiptTicket(order, config, service));
  assert.deepEqual(asBytes(currentBytes), asBytes(headBytes), 'BT: buildReceiptTicket mudou bytes do recibo do cliente');
}

function main() {
  const dashboardSource = read(DASHBOARD_PATH);
  const bluetoothSource = read(BLUETOOTH_PATH);
  const waiterSource = read(WAITER_PATH);
  const dashboardHead = gitHead(DASHBOARD_PATH);
  const bluetoothHead = gitHead(BLUETOOTH_PATH);

  assertHtmlFallbackSource(dashboardSource);
  assertWaiterCartMapping(waiterSource);

  const pc = loadDashboardBuilder(dashboardSource, 'working-tree');
  const pcHead = loadDashboardBuilder(dashboardHead, 'git-head');
  for (const width of ['80mm', '48mm', '50mm']) assertPcPizzaTicket(pc, width);
  assertPcLongFlavorWrap(pc);
  assertPcLegacyNonPizzaUnchanged(pc, pcHead);

  const bt = loadBluetooth(bluetoothSource, 'working-tree');
  const btHead = loadBluetooth(bluetoothHead, 'git-head');
  assertBluetoothPizza(bt);
  assertBluetoothLegacyNonPizza(bt, btHead);
  assertReceiptUnchanged(bt, btHead);

  console.log('OK: testes de impressão de cozinha pizza PC/BT, fallback HTML, mapeamento do garçom e recibo baseline passaram.');
  console.log('Cobertura: ESC/POS 80/48/50mm; duas bordas Catupiry/Cheddar; sabores agrupados e case; wrap/count; reset de estilo; itens não-pizza; recibos byte-a-byte contra HEAD.');
}

try {
  main();
} catch (error) {
  console.error(`FALHOU: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
}
