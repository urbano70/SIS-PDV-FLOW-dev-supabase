#!/usr/bin/env node
'use strict';

/**
 * Chromium layout regression for the dashboard order-details surface.
 *
 * The fixture intentionally bundles only the real OrderDetails component
 * extracted from Dashboard.tsx plus a small React harness. It does not import
 * App, main.tsx, server.ts, Supabase, Firebase, environment files, or the
 * production socket. The shell keeps the production Dashboard class strings
 * and loads the compiled Tailwind CSS asset from dist/assets.
 *
 * Default run compares both geometry variants:
 *   - legacy: html/body zoom + h-screen/100vh (expected clipped baseline)
 *   - fixed: real applyDisplayScale() + --app-viewport-height (expected pass)
 *
 * Examples:
 *   PLAYWRIGHT_MODULE_PATH=/home/ubuntu/update-notification-browser/node_modules/playwright \
 *   CHROMIUM_PATH=/usr/bin/chromium \
 *   LAYOUT_VARIANT=both \
 *   PDV_LAYOUT_OUTPUT_DIR=/home/ubuntu/pdv-estabilidade/layout \
 *   node scripts/test-dashboard-layout-browser.cjs
 *
 * No application server is started and no production/network financial action
 * is clicked. The action buttons are inspected and focusable only.
 */

const assert = require('node:assert/strict');
const esbuild = require('../node_modules/esbuild');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_PATH = path.join(ROOT, 'src/components/Dashboard.tsx');
const DISPLAY_SCALE_PATH = path.join(ROOT, 'src/lib/displayScale.ts');
const OUTPUT_DIR = path.resolve(
  process.env.PDV_LAYOUT_OUTPUT_DIR || path.join(ROOT, '.test-artifacts', 'dashboard-layout'),
);
const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE_PATH
  || 'playwright';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH
  || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const LAYOUT_VARIANT = String(process.env.LAYOUT_VARIANT || 'both').toLowerCase();
const CSS_PATH = process.env.LAYOUT_CSS_PATH
  ? path.resolve(process.env.LAYOUT_CSS_PATH)
  : findCompiledCss();
const CSS_USES_VIEWPORT_VAR = fs.existsSync(CSS_PATH)
  && fs.readFileSync(CSS_PATH, 'utf8').includes('--app-viewport-height');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-dashboard-layout-'));
const BUNDLE_PATH = path.join(TEMP_DIR, 'dashboard-layout-fixture.js');
const RESULTS_PATH = path.join(OUTPUT_DIR, 'results.json');
const REPORT_PATH = path.join(OUTPUT_DIR, 'README.md');
const LOG_PATH = path.join(OUTPUT_DIR, 'stdout.log');

const { chromium } = require(PLAYWRIGHT_MODULE);

const logLines = [];
const cases = [];
let browser = null;
let fixtureServer = null;
let fatalError = null;

function findCompiledCss() {
  const assetsDir = path.join(ROOT, 'dist/assets');
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`dist/assets ausente; execute npm run build antes do teste (${assetsDir})`);
  }
  const candidates = fs.readdirSync(assetsDir)
    .filter(name => name.endsWith('.css'))
    .map(name => ({
      name,
      mtimeMs: fs.statSync(path.join(assetsDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length === 0) {
    throw new Error(`nenhum CSS compilado em ${assetsDir}; execute npm run build antes do teste`);
  }
  return path.join(assetsDir, candidates[0].name);
}

function nowIso() {
  return new Date().toISOString();
}

function log(message) {
  const line = `[${nowIso()}] ${message}`;
  logLines.push(line);
  process.stdout.write(`${line}\n`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mustMatch(source, pattern, label, fallback) {
  const match = source.match(pattern);
  if (match && match[1]) return match[1];
  log(`[source] não foi possível extrair ${label}; usando fallback controlado`);
  return fallback;
}

function extractProductionPieces(source) {
  const orderStart = source.indexOf('const OrderDetails = (');
  const orderEnd = source.indexOf('\n\nexport default function Dashboard', orderStart);
  assert(orderStart >= 0 && orderEnd > orderStart, 'OrderDetails não encontrado em Dashboard.tsx');
  const orderDetailsSource = source.slice(orderStart, orderEnd);
  assert.match(orderDetailsSource, /className="bg-white rounded-2xl border-2 border-\[#141414\] shadow-xl flex flex-col h-full min-h-0 overflow-hidden"/);
  assert.match(orderDetailsSource, /className="flex-1 min-h-0 overflow-y-auto p-6 pt-0 scrollbar-hide"/);
  assert.match(orderDetailsSource, /Restante a Pagar/);

  const dashboardStart = source.indexOf('export default function Dashboard');
  const dashboardSource = source.slice(dashboardStart);
  const actionStart = source.indexOf('!showingRecentOrders && !!detailTargetId');
  const actionEnd = source.indexOf('{cashRegisterReportModal &&', actionStart);
  const actionSource = source.slice(actionStart, actionEnd > actionStart ? actionEnd : actionStart + 20000);

  const rootClass = mustMatch(
    dashboardSource,
    /<div className="([^"\n]*h-screen[^"\n]*overflow-hidden[^"\n]*)">/,
    'classe raiz do Dashboard',
    'flex h-screen overflow-hidden relative',
  );
  const mainClass = mustMatch(
    dashboardSource,
    /<main className="([^"\n]*h-screen[^"\n]*)">/,
    'classe main do Dashboard',
    'flex-1 h-screen overflow-hidden p-4 lg:p-6 pb-14 bg-[#F5F5F3] flex flex-col',
  );
  const overviewRowClass = mustMatch(
    dashboardSource,
    /<div className="(flex items-center justify-between pt-3 pb-0\.5 mb-1 shrink-0 gap-2)">/,
    'classe da linha de overview',
    'flex items-center justify-between pt-3 pb-0.5 mb-1 shrink-0 gap-2',
  );
  const actionGroupClass = mustMatch(
    actionSource,
    /<div className="(flex items-center space-x-2 shrink-0)">/,
    'classe do grupo de ações',
    'flex items-center space-x-2 shrink-0',
  );
  const detailsColumnClass = mustMatch(
    dashboardSource,
    /<div ref=\{detailsRef\} className="([^"\n]*md:col-span-3[^"\n]*)">/,
    'classe da coluna de detalhes',
    'md:col-span-3 md:col-start-3 md:row-start-1 h-full flex flex-col min-h-0 order-1 md:order-2',
  );

  // Keep this source check close to the fixture: if production action labels or
  // styling drift, the harness should make that visible instead of silently
  // becoming an unrelated hand-written button demo.
  for (const marker of ['Agrupar', 'Resumo', 'Transferir', 'Pagar']) {
    assert(actionSource.includes(marker) || dashboardSource.includes(marker), `ação ${marker} não encontrada na fonte de produção`);
  }
  assert.match(actionSource, /px-2 py-1 rounded-lg font-sans not-italic font-bold text-\[9px\] uppercase transition-colors/);
  assert.match(actionSource, /px-3 py-1 rounded-lg font-sans not-italic font-bold text-\[9px\] uppercase shadow-sm transition-colors flex items-center space-x-1/);

  return {
    orderDetailsSource,
    rootClass,
    mainClass,
    overviewRowClass,
    actionGroupClass,
    detailsColumnClass,
    sourceLines: source.split('\n').length,
  };
}

function buildFixtureBundle(pieces) {
  const entrySource = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle, History, PlusCircle, Trash2, UserPlus, Users, X } from 'lucide-react';
import { applyDisplayScale as applyDisplayScaleHelper } from ${JSON.stringify(DISPLAY_SCALE_PATH)};

const socket = {
  emit: (...args) => {
    if (typeof window !== 'undefined') {
      window.__layoutSocketEvents = window.__layoutSocketEvents || [];
      window.__layoutSocketEvents.push(args);
    }
  },
};
const toast = {
  error: () => {},
  warning: () => {},
  success: () => {},
};
function useFirebase() {
  return {
    clockOffset: 0,
    data: {
      pizzariaConfig: { enabled: false, kdsEnabled: false, redMinutes: 30 },
      shiftStartedAt: null,
    },
  };
}
function OrderTimer() { return null; }

const fixtureConfig = window.__layoutFixtureConfig || {};
if (fixtureConfig.variant === 'fixed') {
  applyDisplayScaleHelper(window);
}

${pieces.orderDetailsSource}

const productionRootClass = ${JSON.stringify(pieces.rootClass)};
const productionMainClass = ${JSON.stringify(pieces.mainClass)};
const productionOverviewRowClass = ${JSON.stringify(pieces.overviewRowClass)};
const productionActionGroupClass = ${JSON.stringify(pieces.actionGroupClass)};
const productionDetailsColumnClass = ${JSON.stringify(pieces.detailsColumnClass)};

function makeOrder(itemCount) {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    id: 'fixture-item-' + (index + 1),
    name: 'Item ' + (index + 1),
    price: 10,
    quantity: 1,
    type: 'bebidas',
    timestamp: null,
    waiterName: '',
  }));
  return {
    id: 'fixture-order-1',
    tableId: 1,
    waiterId: 'fixture-waiter-1',
    status: 'pending',
    timestamp: new Date().toISOString(),
    items,
    paymentLog: [],
    observations: '',
  };
}

function ActionButton({ children, className, onAction, testId }) {
  return React.createElement(
    'button',
    {
      type: 'button',
      className,
      'data-fixture-action': testId,
      onClick: () => {
        window.__layoutActionEvents = window.__layoutActionEvents || [];
        window.__layoutActionEvents.push(testId);
        onAction(testId);
      },
    },
    children,
  );
}

function DashboardLayoutFixture() {
  const config = window.__layoutFixtureConfig || { itemCount: 100 };
  const itemCount = Number(config.itemCount || 100);
  const order = makeOrder(itemCount);
  const [lastAction, setLastAction] = useState(null);
  const noop = () => {};
  const setAction = action => setLastAction(action);
  const activeItem = { id: 1, status: 'occupied', currentOrder: order.id };
  const tables = [activeItem];
  const waiters = [{ id: 'fixture-waiter-1', name: 'Ana Silva' }];
  const callbackProps = {
    isComandaSelected: false,
    selectedComandaId: null,
    selectedTableId: 1,
    comandas: [],
    tables,
    orders: [order],
    waiters,
    isCashRegisterOpen: true,
    setIsAddItemModalOpen: noop,
    setIsHistoryModalOpen: noop,
    setIsLinkModalOpen: noop,
    setIsTransferModalOpen: noop,
    setIsPaymentModalOpen: noop,
    setIsBaixaModalOpen: noop,
    handleRemoveItem: noop,
    printerConfig: {},
    firstSeenRef: { current: new Map() },
    fiscalConfig: {},
    onOpenNfce: noop,
    tenantId: null,
    setFiscalNotes: noop,
    guestModeActive: false,
    onGuestModeActiveChange: noop,
  };
  const actionNeutral = 'px-2 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase transition-colors';
  const actionPay = 'px-3 py-1 rounded-lg font-sans not-italic font-bold text-[9px] uppercase shadow-sm transition-colors flex items-center space-x-1';
  return (
    <div id="dashboard-root" data-fixture-layout-root className={productionRootClass}>
      <main id="dashboard-main" data-fixture-dashboard-main className={productionMainClass}>
        <div className="flex items-center gap-2 mb-4 shrink-0 min-w-0">
          <header className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="font-serif italic text-2xl lg:text-3xl shrink-0">Painel</h2>
            <span className="text-[10px] uppercase font-bold opacity-50">Fixture de estabilidade visual</span>
          </header>
        </div>
        <div className={productionOverviewRowClass} data-fixture-overview-row>
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide shrink-0 pt-2">
            <span className="px-3 py-1.5 rounded-xl bg-green-600 text-white text-xs font-bold">Caixa aberto</span>
          </div>
          <div id="header-actions" data-fixture-header-actions className={productionActionGroupClass}>
            <ActionButton testId="guests" className={actionNeutral + ' bg-gray-100 text-[#141414]'} onAction={setAction}>Convidados</ActionButton>
            <ActionButton testId="group" className={actionNeutral + ' bg-gray-100 text-[#141414]'} onAction={setAction}>Agrupar</ActionButton>
            <ActionButton testId="summary" className={actionNeutral + ' bg-blue-50 text-blue-700'} onAction={setAction}>Resumo</ActionButton>
            <ActionButton testId="transfer" className={actionNeutral + ' bg-gray-100 text-[#141414]'} onAction={setAction}>Transferir</ActionButton>
            <ActionButton testId="pay" className={actionPay + ' bg-green-600 text-white'} onAction={setAction}>Pagar</ActionButton>
          </div>
        </div>
        <div id="overview-content" className="flex-1 min-h-0 pt-2 lg:pt-4 overflow-hidden">
          <section className="grid grid-cols-1 md:grid-cols-5 md:grid-rows-1 gap-4 h-full">
            <div className="hidden md:flex md:col-span-2 md:col-start-1 md:row-start-1 h-full flex-col min-h-0 space-y-3 order-2 md:order-1">
              <div className="bg-white rounded-2xl border border-[#141414]/10 shadow-sm p-4 flex-1 min-h-0">
                <p className="text-xs uppercase font-bold opacity-50">Mesas</p>
                <p className="text-3xl font-black">1</p>
              </div>
            </div>
            <div id="details-column" data-fixture-details-column className={productionDetailsColumnClass}>
              <div className="h-full flex flex-col min-h-0">
                <div id="order-details-host" data-testid="order-details-host" className="h-full flex flex-col min-h-0">
                  <OrderDetails {...callbackProps} />
                </div>
              </div>
            </div>
          </section>
        </div>
        <output id="fixture-last-action" hidden>{lastAction || ''}</output>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('root ausente no fixture');
createRoot(root).render(React.createElement(DashboardLayoutFixture));
`;

  const result = esbuild.buildSync({
    stdin: {
      contents: entrySource,
      resolveDir: ROOT,
      sourcefile: 'test-dashboard-layout-fixture.tsx',
      loader: 'tsx',
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    jsx: 'automatic',
    outfile: BUNDLE_PATH,
    metafile: true,
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert(inputs.some(file => /Dashboard\.tsx$/.test(file)) === false, 'bundle não deve importar Dashboard.tsx inteiro');
  assert(inputs.some(file => /displayScale\.ts$/.test(file)), 'bundle deve conter o helper displayScale.ts real');
  assert(inputs.some(file => /test-dashboard-layout-fixture\.tsx$/.test(file)), 'bundle de fixture ausente');
  fs.writeFileSync(path.join(TEMP_DIR, 'bundle-inputs.json'), `${JSON.stringify(inputs, null, 2)}\n`);
  log(`Bundle de layout criado com ${inputs.length} entrada(s); OrderDetails foi extraído sem App/Dashboard completo`);
  return { entrySource, inputs };
}

function fixtureHtml(config, cssFileName) {
  const serializedConfig = JSON.stringify(config).replace(/</g, '\\u003c');
  const fixedFallback = CSS_USES_VIEWPORT_VAR ? '' : `
    [data-layout-variant="fixed"] #dashboard-root,
    [data-layout-variant="fixed"] #dashboard-main { height: var(--app-viewport-height) !important; }`;
  return `<!doctype html>
<html lang="pt-BR" data-layout-variant="${config.variant}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard layout fixture</title>
  <link rel="stylesheet" href="/assets/${cssFileName}">
  <style>
    html, body { height: 100%; margin: 0; overflow: hidden; }
    body { min-height: 0; }
    #root { height: 100%; min-height: 0; }
    [data-layout-variant="legacy"] #dashboard-root,
    [data-layout-variant="legacy"] #dashboard-main { height: 100vh !important; }
    ${fixedFallback}
    #header-actions { max-width: 100%; min-width: 0; flex-shrink: 1; overflow-x: auto; overflow-y: hidden; }
    #header-actions button { flex: 0 0 auto; white-space: nowrap; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    window.__layoutFixtureConfig = ${serializedConfig};
    (function () {
      var config = window.__layoutFixtureConfig;
      document.documentElement.dataset.layoutVariant = config.variant;
      if (config.variant === 'legacy') {
        document.documentElement.style.zoom = String(Number(config.zoom || 1));
        document.documentElement.style.removeProperty('--app-viewport-height');
      } else {
        document.documentElement.style.zoom = '';
      }
      document.body.style.overflow = 'hidden';
    }());
  </script>
  <script src="/bundle.js"></script>
</body>
</html>`;
}

async function createFixtureServer() {
  const cssFileName = path.basename(CSS_PATH);
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const headers = {
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
    };
    if (requestUrl.pathname === '/') {
      const config = {
        variant: requestUrl.searchParams.get('variant') || 'fixed',
        zoom: Number(requestUrl.searchParams.get('zoom') || 1),
        itemCount: Number(requestUrl.searchParams.get('items') || 100),
      };
      response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
      response.end(fixtureHtml(config, cssFileName));
      return;
    }
    if (requestUrl.pathname === '/bundle.js') {
      response.writeHead(200, { ...headers, 'content-type': 'application/javascript; charset=utf-8' });
      fs.createReadStream(BUNDLE_PATH).pipe(response);
      return;
    }
    if (requestUrl.pathname === `/assets/${cssFileName}`) {
      response.writeHead(200, { ...headers, 'content-type': 'text/css; charset=utf-8' });
      fs.createReadStream(CSS_PATH).pipe(response);
      return;
    }
    if (requestUrl.pathname === '/favicon.ico') {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    response.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : null;
  assert(port, 'fixture não obteve porta loopback');
  const url = `http://127.0.0.1:${port}/`;
  log(`Fixture HTTP real em ${url}; CSS=${CSS_PATH}`);
  return { server, url };
}

function viewportCases() {
  return [
    { name: 'desktop-1366x768-dpr1', width: 1366, height: 768, dpr: 1, legacyZoom: 1, items: 100 },
    { name: 'desktop-1920x1080-dpr1.25', width: 1920, height: 1080, dpr: 1.25, legacyZoom: 1.1, items: 100 },
    { name: 'desktop-1280x600', width: 1280, height: 600, dpr: 1, legacyZoom: 1.1, items: 100 },
    { name: 'phone-390x844-dpr1', width: 390, height: 844, dpr: 1, legacyZoom: 1, items: 40 },
  ];
}

function variantsToRun() {
  if (LAYOUT_VARIANT === 'fixed' || LAYOUT_VARIANT === 'legacy') return [LAYOUT_VARIANT];
  if (LAYOUT_VARIANT === 'both' || LAYOUT_VARIANT === 'compare') return ['legacy', 'fixed'];
  throw new Error(`LAYOUT_VARIANT inválido: ${LAYOUT_VARIANT}; use legacy, fixed ou both`);
}

function pageLogger(page, label) {
  page.on('console', message => log(`[browser:${label}:console:${message.type()}] ${message.text()}`));
  page.on('pageerror', error => log(`[browser:${label}:pageerror] ${error.message}`));
  page.on('requestfailed', request => log(`[browser:${label}:requestfailed] ${request.url()} ${request.failure()?.errorText || ''}`));
}

async function waitForFixture(page) {
  await page.waitForSelector('[data-testid="order-details-host"] > div', { state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-testid="order-details-host"]');
    return Boolean(host && host.textContent && host.textContent.includes('Restante a Pagar'));
  }, null, { timeout: 10000 });
  await sleep(80);
}

async function readMetrics(page, expectedItemCount) {
  return page.evaluate((itemCount) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const root = document.getElementById('dashboard-root');
    const main = document.getElementById('dashboard-main');
    const row = document.querySelector('[data-fixture-overview-row]');
    const actionGroup = document.getElementById('header-actions');
    const pay = document.querySelector('[data-fixture-action="pay"]');
    const detailsColumn = document.getElementById('details-column');
    const host = document.querySelector('[data-testid="order-details-host"]');
    const card = host && host.firstElementChild;
    const scroller = card && Array.from(card.querySelectorAll('*')).find(node => {
      const style = getComputedStyle(node);
      return style.overflowY === 'auto' && node.scrollHeight > node.clientHeight;
    });
    const footer = card && card.lastElementChild;
    const rectOf = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const fullyVisible = rect => Boolean(
      rect && rect.width > 0 && rect.height > 0
      && rect.left >= -0.5 && rect.top >= -0.5
      && rect.right <= viewport.width + 0.5
      && rect.bottom <= viewport.height + 0.5,
    );
    const itemNames = Array.from(host ? host.querySelectorAll('span') : [])
      .map(node => (node.textContent || '').trim())
      .filter(text => /^Item \d+$/.test(text));
    return {
      viewport,
      dpr: window.devicePixelRatio,
      zoom: Number(getComputedStyle(document.documentElement).zoom || 1),
      appDisplayScale: getComputedStyle(document.documentElement).getPropertyValue('--app-display-scale').trim(),
      appViewportHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-viewport-height').trim(),
      root: rectOf(root),
      main: rectOf(main),
      overviewRow: rectOf(row),
      actionGroup: rectOf(actionGroup),
      pay: rectOf(pay),
      detailsColumn: rectOf(detailsColumn),
      detailsCard: rectOf(card),
      totalsFooter: rectOf(footer),
      rootVisible: fullyVisible(rectOf(root)),
      mainVisible: fullyVisible(rectOf(main)),
      overviewRowVisible: fullyVisible(rectOf(row)),
      actionGroupVisible: fullyVisible(rectOf(actionGroup)),
      payVisible: fullyVisible(rectOf(pay)),
      detailsCardVisible: fullyVisible(rectOf(card)),
      totalsVisible: fullyVisible(rectOf(footer)),
      itemRows: new Set(itemNames).size,
      expectedItemCount: itemCount,
      scroll: scroller ? {
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
      } : null,
      bodyScrollHeight: document.body.scrollHeight,
      htmlScrollHeight: document.documentElement.scrollHeight,
    };
  }, expectedItemCount);
}

async function scrollItemsToBottom(page) {
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="order-details-host"]');
    const card = host && host.firstElementChild;
    const scroller = card && Array.from(card.querySelectorAll('*')).find(node => {
      const style = getComputedStyle(node);
      return style.overflowY === 'auto' && node.scrollHeight > node.clientHeight;
    });
    if (!scroller) throw new Error('scroller de itens não encontrado');
    scroller.scrollTop = scroller.scrollHeight;
  });
  await sleep(60);
}

async function revealPayAction(page) {
  await page.evaluate(() => {
    const group = document.getElementById('header-actions');
    if (!group) throw new Error('grupo de ações não encontrado');
    group.scrollLeft = group.scrollWidth;
  });
  await sleep(40);
}

function assertFixedMetrics(metrics, testCase) {
  assert.equal(metrics.itemRows, testCase.items, `${testCase.name}: todos os itens devem estar no DOM`);
  assert(metrics.scroll, `${testCase.name}: OrderDetails deve manter um scroller interno`);
  assert(metrics.scroll.scrollHeight > metrics.scroll.clientHeight, `${testCase.name}: 40–100 itens devem produzir overflow interno`);
  assert(metrics.appViewportHeight, `${testCase.name}: helper real deve definir --app-viewport-height`);
  const viewportHeightFromVar = Number.parseFloat(metrics.appViewportHeight);
  assert(Number.isFinite(viewportHeightFromVar), `${testCase.name}: --app-viewport-height deve ser numérico`);
  assert(Math.abs(viewportHeightFromVar * metrics.zoom - metrics.viewport.height) < 1.5, `${testCase.name}: altura CSS variável deve compensar o zoom real`);
  assert(metrics.rootVisible, `${testCase.name}: raiz do dashboard deve caber no viewport`);
  assert(metrics.mainVisible, `${testCase.name}: main do dashboard deve caber no viewport`);
  assert(metrics.detailsCardVisible, `${testCase.name}: card OrderDetails deve caber no viewport`);
  assert(metrics.totalsVisible, `${testCase.name}: totais inferiores não podem ficar cortados`);
  assert(metrics.overviewRowVisible, `${testCase.name}: linha superior deve permanecer visível`);
  assert(metrics.actionGroupVisible, `${testCase.name}: grupo de ações deve permanecer visível`);
  assert(metrics.payVisible, `${testCase.name}: ação Pagar deve ser alcançável no viewport`);
}

function assertLegacyBaseline(metrics, testCase) {
  assert.equal(metrics.itemRows, testCase.items, `${testCase.name}: baseline ainda deve renderizar todos os itens no DOM`);
  assert(metrics.scroll, `${testCase.name}: baseline deve ter overflow interno`);
  if (testCase.legacyZoom <= 1) {
    assert(metrics.totalsVisible, `${testCase.name}: sem zoom, o baseline não deveria cortar totais`);
    assert(metrics.payVisible, `${testCase.name}: sem zoom, o baseline não deveria cortar Pagar`);
    return { clipped: false, reason: 'sem zoom aplicado neste viewport' };
  }
  const clipped = !metrics.rootVisible || !metrics.mainVisible || !metrics.totalsVisible || !metrics.payVisible;
  assert(clipped, `${testCase.name}: baseline 100vh + zoom deveria demonstrar clipping de raiz/totais/Pagar`);
  return { clipped: true, reason: '100vh/h-screen escalado por html zoom excede a altura disponível' };
}

async function runCase(variant, testCase) {
  const name = `${variant}-${testCase.name}`;
  const started = Date.now();
  let context = null;
  let page = null;
  const screenshotPath = path.join(OUTPUT_DIR, `${name}.png`);
  log(`[case ${name}] INÍCIO`);
  try {
    context = await browser.newContext({
      viewport: { width: testCase.width, height: testCase.height },
      screen: { width: testCase.width, height: testCase.height },
      deviceScaleFactor: testCase.dpr,
      locale: 'pt-BR',
      serviceWorkers: 'block',
    });
    page = await context.newPage();
    pageLogger(page, name);
    const url = `${fixtureServer.url}?variant=${encodeURIComponent(variant)}&zoom=${encodeURIComponent(testCase.legacyZoom)}&items=${testCase.items}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForFixture(page);
    const beforeScroll = await readMetrics(page, testCase.items);
    await scrollItemsToBottom(page);
    await revealPayAction(page);
    const afterScroll = await readMetrics(page, testCase.items);
    const actionState = await page.evaluate(() => {
      const pay = document.querySelector('[data-fixture-action="pay"]');
      pay?.focus({ preventScroll: true });
      return {
        active: document.activeElement?.getAttribute('data-fixture-action') || null,
        payTabIndex: pay ? pay.tabIndex : null,
      };
    });
    assert.equal(actionState.active, 'pay', `${name}: Pagar deve aceitar foco sem clique financeiro`);
    assert.equal(actionState.payTabIndex, 0, `${name}: Pagar deve ser foco navegável`);

    let baseline = null;
    if (variant === 'fixed') {
      assertFixedMetrics(afterScroll, testCase);
    } else {
      baseline = assertLegacyBaseline(afterScroll, testCase);
    }
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const durationMs = Date.now() - started;
    const status = variant === 'legacy' && baseline && baseline.clipped ? 'expected-fail' : 'pass';
    const details = {
      viewport: testCase,
      beforeScroll,
      afterScroll,
      actionState,
      baseline,
      screenshot: screenshotPath,
      limitation: 'O clique em Pagar não é executado; a checagem é geométrica e de foco para não iniciar fluxo financeiro.',
    };
    cases.push({ name, status, durationMs, details });
    log(`[case ${name}] ${status.toUpperCase()} (${durationMs}ms); totals=${afterScroll.totalsVisible}; pay=${afterScroll.payVisible}; scroll=${afterScroll.scroll ? `${afterScroll.scroll.scrollTop}/${afterScroll.scroll.scrollHeight}` : 'ausente'}`);
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error && error.stack ? error.stack : String(error);
    cases.push({ name, status: 'fail', durationMs, error: message });
    log(`[case ${name}] FALHA (${durationMs}ms): ${error && error.message ? error.message : error}`);
    if (!fatalError) fatalError = error;
  } finally {
    if (page) await page.close().catch(error => log(`[case ${name}] falha fechando page: ${error.message}`));
    if (context) await context.close().catch(error => log(`[case ${name}] falha fechando context: ${error.message}`));
  }
}

function writeEvidence({ pieces, bundle }) {
  const failed = cases.filter(item => item.status === 'fail');
  const fixedCases = cases.filter(item => item.name.startsWith('fixed-'));
  const legacyCases = cases.filter(item => item.name.startsWith('legacy-'));
  const fixedPass = fixedCases.length === 0 || fixedCases.every(item => item.status === 'pass');
  const legacyBaselineObserved = legacyCases.length === 0 || legacyCases.every(item => item.status === 'expected-fail' || item.status === 'pass');
  const status = failed.length === 0 && fixedPass && legacyBaselineObserved ? 'pass' : 'fail';
  const result = {
    status,
    generatedAt: nowIso(),
    project: ROOT,
    source: {
      dashboard: DASHBOARD_PATH,
      displayScale: DISPLAY_SCALE_PATH,
      extractedComponent: 'OrderDetails (source slice before export default Dashboard)',
      sourceLines: pieces.sourceLines,
      rootClass: pieces.rootClass,
      mainClass: pieces.mainClass,
      overviewRowClass: pieces.overviewRowClass,
      actionGroupClass: pieces.actionGroupClass,
      detailsColumnClass: pieces.detailsColumnClass,
    },
    browser: {
      engine: 'Chromium headless via external Playwright module',
      executablePath: CHROMIUM_PATH,
      playwrightModule: PLAYWRIGHT_MODULE,
      version: browser ? browser.version() : null,
      cssAsset: CSS_PATH,
      cssUsesAppViewportHeight: CSS_USES_VIEWPORT_VAR,
      fixtureBundleInputs: bundle.inputs,
    },
    comparison: {
      requestedVariant: LAYOUT_VARIANT,
      legacy: 'html/body zoom + production h-screen/100vh; clipping is expected only as baseline evidence for zoomed viewports',
      fixed: 'real applyDisplayScale() sets --app-viewport-height = innerHeight / scale; compiled h-screen consumes the variable and totals/Pagar must remain visible',
    },
    cases,
    limitations: [
      'A fixture usa o OrderDetails real extraído do Dashboard.tsx e os tokens/classes do shell de produção, mas não importa o Dashboard completo para evitar env, banco, providers e socket de produção.',
      'A linha de ações é uma reconstrução controlada dos botões de header (Convidados, Agrupar, Resumo, Transferir, Pagar), com classes/labels verificados na fonte; os handlers reais não são executados.',
      'O CSS é o artefato compilado indicado em browser.cssAsset; cssUsesAppViewportHeight deve ser true após npm run build/Vite build do parent.',
      'A evidência mede bounds reais do Chromium, overflow interno e foco; não infere estabilidade do servidor nem executa pagamentos, impressão, transferências ou chamadas financeiras.',
    ],
  };
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(result, null, 2)}\n`);

  const lines = [
    '# Evidência — layout do Dashboard em Chromium real',
    '',
    `Status: **${status.toUpperCase()}**`,
    '',
    `Gerado em **${result.generatedAt}** com \`${CHROMIUM_PATH}\` e Playwright externo \`${PLAYWRIGHT_MODULE}\`.`,
    '',
    '## Escopo exercitado',
    '',
    `- Fonte: \`${DASHBOARD_PATH}\`; componente real extraído: ` + '`OrderDetails`.',
    `- CSS compilado: \`${CSS_PATH}\`.`,
    '- Shell: classes de raiz/main/overview/coluna de detalhes extraídas da fonte de produção.',
    '- Dados: pedidos fake somente em memória, com 40 ou 100 itens para exercitar scroll interno.',
    '- Segurança: nenhum App/server/provider/env real importado; nenhuma ação financeira foi clicada.',
    '',
    '## Comparação',
    '',
    '- **legacy** — reproduz `html/body zoom` com `h-screen`/`100vh`; nos viewports zoomados o clipping é marcado como `expected-fail` para preservar a evidência do defeito.',
    '- **fixed** — executa o `applyDisplayScale()` real, exige `--app-viewport-height = innerHeight / scale` consumido pelo `h-screen`, e exige raiz, main, card, totais, linha superior e botão `Pagar` dentro do viewport.',
    '',
    '## Casos',
    '',
  ];
  for (const item of cases) {
    lines.push(`- **${item.name}** — ${item.status.toUpperCase()} (${item.durationMs} ms)`);
    if (item.error) lines.push(`  - erro: \`${item.error.split('\n')[0]}\``);
    if (item.details) {
      const d = item.details;
      lines.push(`  - viewport: ${d.viewport.width}x${d.viewport.height}, dpr ${d.viewport.dpr}, fixed zoom ${d.afterScroll.zoom}, legacy comparator zoom ${d.viewport.legacyZoom}, itens ${d.viewport.items}`);
      lines.push(`  - bounds: totals=${d.afterScroll.totalsVisible}, Pagar=${d.afterScroll.payVisible}, scroll=${d.afterScroll.scroll ? `${d.afterScroll.scroll.scrollTop}/${d.afterScroll.scroll.scrollHeight}` : 'ausente'}`);
      lines.push(`  - screenshot: \`${d.screenshot}\``);
    }
  }
  lines.push('', '## Screenshots', '');
  for (const item of cases) {
    if (item.details && item.details.screenshot) lines.push(`![${item.name}](${item.details.screenshot})`);
  }
  lines.push('', '## Limitações', '');
  for (const limitation of result.limitations) lines.push(`- ${limitation}`);
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`);
  log(`Evidências salvas em ${OUTPUT_DIR}: ${path.basename(RESULTS_PATH)}, ${path.basename(REPORT_PATH)}`);
  return result;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  assert(fs.existsSync(CSS_PATH), `CSS compilado ausente: ${CSS_PATH}`);
  assert(CHROMIUM_PATH && fs.existsSync(CHROMIUM_PATH), `Chromium ausente: ${CHROMIUM_PATH}`);
  log(`Harness iniciado; ROOT=${ROOT}`);
  log(`LAYOUT_VARIANT=${LAYOUT_VARIANT}; OUTPUT_DIR=${OUTPUT_DIR}`);
  log(`Chromium=${CHROMIUM_PATH}; Playwright=${PLAYWRIGHT_MODULE}`);

  const dashboardSource = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const pieces = extractProductionPieces(dashboardSource);
  const bundle = buildFixtureBundle(pieces);
  fixtureServer = await createFixtureServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  log(`Chromium iniciado: ${await browser.version()}`);

  for (const variant of variantsToRun()) {
    for (const testCase of viewportCases()) {
      await runCase(variant, testCase);
    }
  }
  const result = writeEvidence({ pieces, bundle });
  if (result.status !== 'pass') throw fatalError || new Error('um ou mais casos de layout falharam');
}

(async () => {
  try {
    await main();
  } catch (error) {
    fatalError = fatalError || error;
    log(`FALHA FINAL: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(error => log(`falha fechando Chromium: ${error.message}`));
    if (fixtureServer) await new Promise(resolve => fixtureServer.server.close(() => resolve())).catch(error => log(`falha fechando fixture: ${error.message}`));
    try {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(LOG_PATH, `${logLines.join('\n')}\n`);
    } catch (error) {
      process.stderr.write(`Não foi possível gravar stdout.log: ${error.message}\n`);
      process.exitCode = 1;
    }
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
})();
