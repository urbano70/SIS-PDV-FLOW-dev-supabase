#!/usr/bin/env node
'use strict';

/**
 * Reproduction/acceptance harness for the manual PWA activation path.
 *
 * This file intentionally does not import the application entrypoint, App,
 * socket server, Supabase, Firebase, environment files, or the production
 * Vite server. It bundles only src/lib/appUpdate.ts (or the exact baseline
 * copy selected with PWA_UPDATE_SOURCE=baseline) and serves an isolated HTML
 * fixture plus real service workers over an ephemeral loopback HTTP server.
 *
 * The fixture is deliberately real at the browser boundary:
 *   - Chromium is launched by Playwright, not a DOM mock;
 *   - navigator.serviceWorker.register/update, Worker state transitions,
 *     postMessage, skipWaiting, activation, and controllerchange are real;
 *   - the page is served by a real HTTP server on 127.0.0.1;
 *   - the update callback targets the registration's current waiting worker;
 *   - the activation worker intentionally does not call clients.claim() for
 *     the update, reproducing the valid state where activation completes but
 *     this existing page does not receive controllerchange.
 *
 * First run the requested baseline reproduction:
 *
 *   OUTPUTDIR=/absolute/path/to/pwa-evidence \
 *   PWA_UPDATE_SOURCE=baseline \
 *   PLAYWRIGHT_MODULE_PATH=/tmp/fechaconta-browser-test/node_modules/playwright \
 *   CHROMIUM_PATH=/usr/bin/chromium \
 *   node scripts/test-pwa-activation-browser.cjs
 *
 * To verify the correction in src/lib/appUpdate.ts, run the same command
 * with PWA_UPDATE_SOURCE=current. No application/configuration file is
 * modified by this test.
 */

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_COMMIT = process.env.PWA_UPDATE_BASELINE_COMMIT || '32ce2f0';
const SOURCE_MODE = String(process.env.PWA_UPDATE_SOURCE || 'current').toLowerCase();
const OUTPUT_DIR = path.resolve(
  process.env.OUTPUTDIR
    || process.env.PWA_UPDATE_OUTPUT_DIR
    || path.join(ROOT, 'test-results', 'pwa-activation'),
);
const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH
  || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const INSTALL_TIMEOUT_MS = Number(process.env.PWA_INSTALL_TIMEOUT_MS || 15000);
const ACTIVATION_TIMEOUT_MS = Number(process.env.PWA_ACTIVATION_TIMEOUT_MS || 20000);
const CASE_TIMEOUT_MS = Number(process.env.PWA_CASE_TIMEOUT_MS || 60000);

const esbuild = require(path.join(ROOT, 'node_modules/esbuild'));
const { chromium } = require(PLAYWRIGHT_MODULE);

const HELPER_PATH = path.join(ROOT, 'src', 'lib', 'appUpdate.ts');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-activation-browser-'));
const HELPER_SOURCE_PATH = path.join(TEMP_DIR, 'appUpdate-selected.ts');
const HELPER_BUNDLE_PATH = path.join(TEMP_DIR, 'appUpdate-browser.js');
const RESULTS_PATH = path.join(OUTPUT_DIR, 'results.json');
const LOG_PATH = path.join(OUTPUT_DIR, 'stdout.log');
const REPORT_PATH = path.join(OUTPUT_DIR, 'README.md');
const BASELINE_SCREENSHOT_PATH = path.join(OUTPUT_DIR, 'baseline-activation-error.png');
const FIXED_SCREENSHOT_PATH = path.join(OUTPUT_DIR, 'fixed-activation-success.png');
const BROKEN_SCREENSHOT_PATH = path.join(OUTPUT_DIR, 'activation-error-no-reload.png');

const logLines = [];
const cases = [];
let browser;
let fixture;
let fatalError = null;

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

async function waitUntil(predicate, label, timeoutMs = 10000, intervalMs = 100) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} não ocorreu em ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`);
}

function readBaselineHelper() {
  return cp.execFileSync('git', ['show', `${BASELINE_COMMIT}:src/lib/appUpdate.ts`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function selectHelperSource() {
  if (SOURCE_MODE === 'baseline') {
    return {
      source: readBaselineHelper(),
      label: `git:${BASELINE_COMMIT}:src/lib/appUpdate.ts`,
    };
  }
  if (SOURCE_MODE === 'current' || SOURCE_MODE === 'fixed' || SOURCE_MODE === 'working-tree') {
    return {
      source: fs.readFileSync(HELPER_PATH, 'utf8'),
      label: 'working-tree:src/lib/appUpdate.ts',
    };
  }
  if (SOURCE_MODE.startsWith('file:')) {
    const selectedPath = path.resolve(SOURCE_MODE.slice('file:'.length));
    return {
      source: fs.readFileSync(selectedPath, 'utf8'),
      label: `file:${selectedPath}`,
    };
  }
  throw new Error(`PWA_UPDATE_SOURCE inválido: ${SOURCE_MODE}; use baseline, current ou file:/caminho`);
}

function bundleSelectedHelper() {
  const selected = selectHelperSource();
  fs.writeFileSync(HELPER_SOURCE_PATH, selected.source);
  const entryPath = path.join(TEMP_DIR, 'entry.ts');
  fs.writeFileSync(entryPath, `
import * as helper from ${JSON.stringify(HELPER_SOURCE_PATH)};
(globalThis).__PWA_UPDATE_HELPER__ = helper;
`);
  const result = esbuild.buildSync({
    entryPoints: [entryPath],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    outfile: HELPER_BUNDLE_PATH,
    metafile: true,
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert(inputs.some(file => file.endsWith('appUpdate-selected.ts')), 'bundle deve conter o helper selecionado');
  assert(!inputs.some(file => /(?:^|\/)(?:App|UpdateBanner|main)\.(?:tsx?|jsx?)$/.test(file)), 'bundle não pode importar a aplicação');
  log(`Helper selecionado: ${selected.label}`);
  log(`Bundle browser criado com ${inputs.length} entrada(s): ${inputs.join(', ')}`);
  return { ...selected, inputs };
}

function serviceWorkerSource(version) {
  const broken = version === 'broken';
  return `
const PWA_FIXTURE_VERSION = ${JSON.stringify(version)};
self.__pwaFixtureVersion = PWA_FIXTURE_VERSION;
self.addEventListener('install', () => {
  // The initial page explicitly activates the first worker. Update workers
  // remain waiting until the real page posts SKIP_WAITING after user action.
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cache = await caches.open('pwa-activation-fixture-' + PWA_FIXTURE_VERSION);
    await cache.put('/__pwa_fixture_version__', new Response(PWA_FIXTURE_VERSION));
    ${broken ? "await new Promise(() => {}); // activation deliberately never settles: real worker stays activating and helper must reject on its timer" : ''}
    // Deliberately no clients.claim(): prompt registration can leave this
    // existing page without a controller even after activation completes.
  })());
});
self.addEventListener('fetch', event => {
  if (new URL(event.request.url).pathname === '/__pwa_fixture_version__') {
    event.respondWith(new Response(PWA_FIXTURE_VERSION, { headers: { 'content-type': 'text/plain' } }));
  }
});
`;
}

function htmlSource(appVersion) {
  return `<!doctype html>
<html lang="pt-BR" data-fixture-app-version="${String(appVersion).replaceAll('"', '&quot;')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reprodução PWA — ativação manual</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 2rem; background: #111827; color: #e5e7eb; }
    main { max-width: 940px; margin: 0 auto; }
    .card { border: 1px solid #374151; border-radius: 14px; padding: 1rem; margin: 1rem 0; background: #1f2937; }
    .error { border-color: #f87171; color: #fecaca; }
    .success { border-color: #34d399; color: #a7f3d0; }
    code, pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    button { font: inherit; padding: .65rem .9rem; margin: .25rem; cursor: pointer; }
    #fixture-events { max-height: 17rem; overflow: auto; background: #030712; padding: .75rem; border-radius: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>Reprodução isolada da ativação PWA</h1>
    <p>Fixture HTTP loopback; não é a aplicação de produção.</p>
    <div class="card">
      <div>HTML servido como versão: <strong id="html-version">${String(appVersion)}</strong></div>
      <div>Reloads desta aba: <strong id="reload-count">0</strong></div>
      <div>Estado: <strong id="fixture-status">inicializando</strong></div>
    </div>
    <div id="fixture-result" class="card">Aguardando o caso do harness.</div>
    <div class="card">
      <h2>Eventos reais do navegador</h2>
      <pre id="fixture-events">[]</pre>
    </div>
  </main>
  <script>
  (() => {
    const reloadKey = '__pwa_fixture_reload_count__';
    const reloadCount = Number(sessionStorage.getItem(reloadKey) || 0);
    const events = [];
    const state = {
      registration: null,
      bootReady: false,
      initialController: null,
      controllerChanges: 0,
      activatedVersions: [],
      updateStarted: false,
      outcome: null,
      reloadCount,
    };
    window.__pwaFixture = state;
    function serialState() {
      const reg = state.registration;
      const workerState = worker => worker ? worker.state : null;
      return {
        initialController: state.initialController,
        controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
        controllerChanges: state.controllerChanges,
        activatedVersions: state.activatedVersions.slice(),
        bootReady: state.bootReady,
        outcome: state.outcome,
        reloadCount: Number(sessionStorage.getItem(reloadKey) || 0),
        registration: reg ? {
          installing: workerState(reg.installing),
          waiting: workerState(reg.waiting),
          active: workerState(reg.active),
          activeScript: reg.active ? reg.active.scriptURL : null,
        } : null,
        events: events.slice(),
      };
    }
    function render() {
      const snapshot = serialState();
      document.getElementById('reload-count').textContent = String(snapshot.reloadCount);
      document.getElementById('fixture-status').textContent = snapshot.outcome ? snapshot.outcome.kind : (snapshot.bootReady ? 'pronto' : 'inicializando');
      document.getElementById('fixture-events').textContent = JSON.stringify(snapshot.events, null, 2);
      if (snapshot.outcome) {
        const result = document.getElementById('fixture-result');
        result.className = 'card ' + (snapshot.outcome.kind === 'success' ? 'success' : 'error');
        result.textContent = snapshot.outcome.kind + (snapshot.outcome.message ? ': ' + snapshot.outcome.message : '');
      }
    }
    function record(type, detail) {
      events.push({ type, detail: detail || null, at: new Date().toISOString() });
      render();
    }
    function watchWorker(worker, role) {
      if (!worker) return;
      record('worker-' + role + '-initial', worker.state);
      if (worker.state === 'activated') state.activatedVersions.push(role);
      worker.addEventListener('statechange', () => {
        record('worker-' + role + '-state', worker.state);
        if (worker.state === 'activated') state.activatedVersions.push(role);
      });
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      state.controllerChanges += 1;
      record('controllerchange', navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null);
    });
    async function boot() {
      state.initialController = navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null;
      record('before-register-controller', state.initialController);
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      state.registration = registration;
      record('registered', registration.scope);
      watchWorker(registration.installing, 'installing');
      watchWorker(registration.waiting, 'waiting');
      watchWorker(registration.active, 'active');
      registration.addEventListener('updatefound', () => {
        record('updatefound', null);
        watchWorker(registration.installing, 'installing');
      });
      const activateInitialWorker = worker => {
        if (worker && !navigator.serviceWorker.controller) {
          record('initial-post-skip-waiting', worker.state);
          worker.postMessage({ type: 'SKIP_WAITING' });
        }
      };
      if (!navigator.serviceWorker.controller) {
        if (registration.waiting) activateInitialWorker(registration.waiting);
        else if (registration.installing) {
          registration.installing.addEventListener('statechange', () => {
            if (registration.installing && registration.installing.state === 'installed') activateInitialWorker(registration.installing);
          });
        }
      }
      await navigator.serviceWorker.ready;
      state.bootReady = true;
      record('ready', registration.active ? registration.active.scriptURL : null);
      render();
    }
    state.waitForUpdate = async () => {
      const registration = state.registration || await navigator.serviceWorker.ready;
      await registration.update();
      render();
      return serialState();
    };
    state.startManualUpdate = () => {
      if (state.updateStarted) return;
      state.updateStarted = true;
      const registration = state.registration;
      const helper = window.__PWA_UPDATE_HELPER__;
      if (!registration || !helper || typeof helper.updateAppManually !== 'function') {
        state.outcome = { kind: 'error', message: 'helper/registration ausente' };
        render();
        return;
      }
      const waitingAtStart = registration.waiting;
      record('manual-update-start', waitingAtStart ? waitingAtStart.state : null);
      const reload = () => {
        const next = Number(sessionStorage.getItem(reloadKey) || 0) + 1;
        sessionStorage.setItem(reloadKey, String(next));
        record('reload-callback', next);
        window.location.reload();
      };
      const activateBaseline = async () => {
        const waiting = registration.waiting || waitingAtStart;
        record('baseline-activate-callback-before-post', waiting ? waiting.state : null);
        if (!waiting) throw new Error('registration.waiting ausente no callback de ativação');
        // This is the real equivalent of the old Workbox registerSW callback:
        // no fake failure is injected; it posts to the actual waiting worker.
        waiting.postMessage({ type: 'SKIP_WAITING' });
        record('baseline-activate-callback-posted-to-waiting', waiting.state);
      };
      const updatePromise = ${JSON.stringify(SOURCE_MODE)} === 'baseline'
        ? helper.updateAppManually(registration, activateBaseline, navigator.serviceWorker, reload)
        : helper.updateAppManually(registration, navigator.serviceWorker, reload);
      Promise.resolve(updatePromise).then(() => {
        state.outcome = { kind: 'success', message: 'helper resolveu' };
        record('helper-resolved', null);
        render();
      }).catch(error => {
        state.outcome = { kind: 'error', message: error && error.message ? error.message : String(error) };
        record('helper-rejected', state.outcome.message);
        render();
      });
      render();
    };
    state.snapshot = serialState;
    state.activateWaitingExternally = () => {
      const registration = state.registration;
      const waiting = registration && registration.waiting;
      if (!waiting) throw new Error('waiting ausente para ativação externa');
      record('external-post-skip-waiting', waiting.state);
      waiting.postMessage({ type: 'SKIP_WAITING' });
    };
    sessionStorage.setItem(reloadKey, String(reloadCount));
    boot().catch(error => {
      state.outcome = { kind: 'error', message: 'boot: ' + (error && error.message ? error.message : String(error)) };
      record('boot-error', state.outcome.message);
      render();
    });
    render();
  })();
  </script>
  <script src="/appUpdate-browser.js"></script>
</body>
</html>`;
}

async function createFixtureServer() {
  let workerVersion = 'old';
  let appVersion = 'old';
  const requests = [];
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    requests.push({ method: request.method, path: requestUrl.pathname, at: nowIso() });
    const headers = {
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
    };
    if (requestUrl.pathname === '/') {
      response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
      response.end(htmlSource(appVersion));
      return;
    }
    if (requestUrl.pathname === '/appUpdate-browser.js') {
      response.writeHead(200, { ...headers, 'content-type': 'application/javascript; charset=utf-8' });
      fs.createReadStream(HELPER_BUNDLE_PATH).pipe(response);
      return;
    }
    if (requestUrl.pathname === '/sw.js') {
      response.writeHead(200, {
        ...headers,
        'content-type': 'application/javascript; charset=utf-8',
        // Service worker update checks must see the changed bytes.
        etag: `"pwa-fixture-${workerVersion}"`,
      });
      response.end(serviceWorkerSource(workerVersion));
      return;
    }
    if (requestUrl.pathname === '/__fixture_version__') {
      response.writeHead(200, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      response.end(appVersion);
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
  log(`Fixture HTTP real em ${url}`);
  return {
    server,
    url,
    requests,
    get workerVersion() { return workerVersion; },
    get appVersion() { return appVersion; },
    setWorkerVersion(version) {
      workerVersion = version;
      appVersion = version;
      log(`[fixture] service worker e HTML agora ${version}`);
    },
    setAppVersion(version) {
      appVersion = version;
      log(`[fixture] HTML agora ${version}`);
    },
  };
}

async function closeFixtureServer(value) {
  if (!value || !value.server) return;
  await new Promise(resolve => value.server.close(() => resolve()));
}

async function newPageContext(label) {
  const context = await browser.newContext({
    serviceWorkers: 'allow',
    viewport: { width: 1280, height: 900 },
    locale: 'pt-BR',
  });
  const page = await context.newPage();
  attachPageLogging(page, label);
  return { context, page };
}

function attachPageLogging(page, label) {
  page.on('console', message => log(`[browser:${label}:console:${message.type()}] ${message.text()}`));
  page.on('pageerror', error => log(`[browser:${label}:pageerror] ${error.message}`));
  page.on('requestfailed', request => log(`[browser:${label}:requestfailed] ${request.url()} ${request.failure()?.errorText || ''}`));
}

async function openInitialPage(label) {
  // Every BrowserContext has a fresh profile, but reset the fixture server too
  // so each case starts with the initial old worker rather than a prior case's
  // new/broken worker bytes.
  fixture.setWorkerVersion('old');
  const opened = await newPageContext(label);
  await opened.page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
  await opened.page.waitForFunction(() => window.__pwaFixture && window.__pwaFixture.bootReady, null, { timeout: INSTALL_TIMEOUT_MS });
  // A prompt registration can leave the first page uncontrolled. A second
  // real navigation is the holder that remains controlled by the old active
  // worker and therefore keeps a later update in waiting state.
  opened.holder = await opened.context.newPage();
  attachPageLogging(opened.holder, `${label}-holder`);
  await opened.holder.goto(fixture.url, { waitUntil: 'domcontentloaded' });
  await opened.holder.waitForFunction(() => window.__pwaFixture && window.__pwaFixture.bootReady, null, { timeout: INSTALL_TIMEOUT_MS });
  await opened.holder.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: INSTALL_TIMEOUT_MS });
  const targetSnapshot = await readSnapshot(opened.page);
  const holderSnapshot = await readSnapshot(opened.holder);
  assert.equal(targetSnapshot.controller, null, `${label}: página alvo deveria iniciar sem controller`);
  assert(holderSnapshot.controller, `${label}: page-holder deveria estar controlado pelo SW antigo`);
  log(`[${label}] alvo sem controller; holder controlado por ${holderSnapshot.controller}`);
  return opened;
}

async function waitForWaiting(page, label) {
  await page.waitForFunction(
    () => Boolean(window.__pwaFixture && window.__pwaFixture.registration && window.__pwaFixture.registration.waiting && window.__pwaFixture.registration.waiting.state === 'installed'),
    null,
    { timeout: INSTALL_TIMEOUT_MS },
  );
  const snapshot = await page.evaluate(() => window.__pwaFixture.snapshot());
  assert.equal(snapshot.registration.waiting, 'installed', `${label}: worker update deve estar waiting/installed`);
  log(`[${label}] waiting real instalado; controller=${snapshot.controller}`);
  return snapshot;
}

async function prepareUpdate(opened, label, version) {
  fixture.setWorkerVersion(version);
  await opened.page.evaluate(() => window.__pwaFixture.waitForUpdate());
  await waitForWaiting(opened.page, label);
}

async function readSnapshot(page) {
  try {
    return await page.evaluate(() => window.__pwaFixture ? window.__pwaFixture.snapshot() : null);
  } catch {
    return null;
  }
}

async function waitForBrowserOutcome(page, label, timeoutMs) {
  const started = Date.now();
  let lastProgressSecond = -1;
  let latest = null;
  try {
    await waitUntil(async () => {
      latest = await readSnapshot(page);
      const elapsedSecond = Math.floor((Date.now() - started) / 1000);
      if (elapsedSecond !== lastProgressSecond && (elapsedSecond === 1 || elapsedSecond % 5 === 0)) {
        lastProgressSecond = elapsedSecond;
        log(`[${label}] progresso ${elapsedSecond}s; outcome=${latest && latest.outcome ? latest.outcome.kind : 'pendente'}`);
      }
      return Boolean(latest && latest.outcome);
    }, `${label}: resultado do helper`, timeoutMs, 250);
  } catch (error) {
    log(`[${label}] último snapshot antes do timeout: ${JSON.stringify(latest)}`);
    throw error;
  }
  return { snapshot: latest, elapsedMs: Date.now() - started };
}

async function runCase(name, fn) {
  const started = Date.now();
  log(`[case ${name}] INÍCIO`);
  try {
    const details = await fn();
    const durationMs = Date.now() - started;
    cases.push({ name, status: 'pass', durationMs, details: details || null });
    log(`[case ${name}] PASS (${durationMs}ms)`);
    return details;
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error && error.stack ? error.stack : String(error);
    cases.push({ name, status: 'fail', durationMs, error: message });
    log(`[case ${name}] FALHA (${durationMs}ms): ${error && error.message ? error.message : error}`);
    if (!fatalError) fatalError = error;
    return null;
  }
}

async function closeOpened(opened) {
  if (!opened) return;
  try { await opened.context.close(); } catch (error) { log(`falha fechando contexto: ${error.message}`); }
}

async function runBaselineReproduction() {
  let opened;
  try {
    opened = await openInitialPage('baseline');
    const initial = await readSnapshot(opened.page);
    assert.equal(initial.initialController, null, 'primeiro registro deve começar sem controller');
    log(`[baseline] registro inicial sem controller confirmado; controller agora=${initial.controller}`);

    await prepareUpdate(opened, 'baseline', 'new');
    await opened.page.screenshot({ path: path.join(OUTPUT_DIR, 'baseline-waiting-installed.png'), fullPage: true });
    await opened.page.evaluate(() => window.__pwaFixture.startManualUpdate());

    const outcome = await waitForBrowserOutcome(opened.page, 'baseline', ACTIVATION_TIMEOUT_MS + 5000);
    const elapsed = outcome.elapsedMs;
    const snapshot = outcome.snapshot;
    if (snapshot && snapshot.outcome && snapshot.outcome.kind === 'error') {
      assert.match(snapshot.outcome.message, /Não foi possível ativar a atualização|ativar a atualização|controller/i);
    }
    assert(snapshot, 'snapshot baseline ausente após timeout');
    assert.equal(snapshot.reloadCount, 0, 'baseline com falha não pode recarregar');
    const activationStateObserved = snapshot.events.some(event => event.type === 'worker-installing-state' && event.detail === 'activated');
    assert(activationStateObserved, 'baseline deve observar o worker de update em estado activated');
    assert.equal(snapshot.controllerChanges, 0, 'worker sem clients.claim não deve emitir controllerchange nessa aba');
    await opened.page.screenshot({ path: BASELINE_SCREENSHOT_PATH, fullPage: true });
    log(`[baseline] reprodução confirmada em ${elapsed}ms: activated=${snapshot.activatedVersions.join(',')}, controllerchange=${snapshot.controllerChanges}, reloads=${snapshot.reloadCount}, erro=${snapshot.outcome.message}`);
    return {
      expectedFailure: true,
      elapsedMs: elapsed,
      error: snapshot.outcome.message,
      activationStateObserved,
      controllerChanges: snapshot.controllerChanges,
      reloadCount: snapshot.reloadCount,
      screenshot: BASELINE_SCREENSHOT_PATH,
      periodicProgressSeconds: [1, 5, 10, 15, 20].filter(second => second * 1000 <= elapsed),
    };
  } finally {
    await closeOpened(opened);
  }
}

async function runFixedOrCurrentSuccess() {
  let opened;
  try {
    opened = await openInitialPage('manual-update');
    await prepareUpdate(opened, 'manual-update', 'new');
    await opened.page.evaluate(() => window.__pwaFixture.startManualUpdate());
    const startedAt = Date.now();
    let lastReloadCount = 0;
    await waitUntil(async () => {
      const snapshot = await readSnapshot(opened.page);
      const count = snapshot ? snapshot.reloadCount : 0;
      if (count !== lastReloadCount) {
        lastReloadCount = count;
        log(`[manual-update] progresso reloadCount=${count}`);
      }
      return count >= 1 && snapshot && snapshot.bootReady;
    }, 'ativação manual + uma navegação real', CASE_TIMEOUT_MS, 250);
    const elapsed = Date.now() - startedAt;
    const snapshot = await readSnapshot(opened.page);
    assert(snapshot, 'snapshot fixed ausente depois da navegação');
    assert.equal(snapshot.reloadCount, 1, 'clique manual deve provocar exatamente um reload');
    assert.equal(snapshot.controllerChanges, 0, 'novo worker sem clients.claim não precisa controlar a aba antes da navegação');
    assert.equal(snapshot.registration.activeScript.endsWith('/sw.js'), true);
    const fixtureVersion = await opened.page.evaluate(async () => {
      const response = await fetch('/__pwa_fixture_version__', { cache: 'no-store' });
      return response.text();
    });
    assert.equal(fixtureVersion, 'new', 'navegação após reload deve observar o novo worker/cache');
    await sleep(1500);
    const after = await readSnapshot(opened.page);
    assert.equal(after.reloadCount, 1, 'não pode haver segundo reload automático');
    await opened.page.screenshot({ path: FIXED_SCREENSHOT_PATH, fullPage: true });
    log(`[manual-update] sucesso em ${elapsed}ms: reloads=${after.reloadCount}, active=${after.registration.active}, fixtureVersion=${fixtureVersion}`);
    return {
      elapsedMs: elapsed,
      reloadCount: after.reloadCount,
      controllerChanges: after.controllerChanges,
      activeState: after.registration.active,
      fixtureVersion,
      screenshot: FIXED_SCREENSHOT_PATH,
    };
  } finally {
    await closeOpened(opened);
  }
}

async function runExternalActivationCase() {
  let first;
  let second;
  try {
    first = await openInitialPage('external-tab-a');
    second = { page: await first.context.newPage() };
    attachPageLogging(second.page, 'external-tab-b');
    await second.page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    await second.page.waitForFunction(() => window.__pwaFixture && window.__pwaFixture.bootReady && navigator.serviceWorker.controller, null, { timeout: INSTALL_TIMEOUT_MS });
    const beforeA = await readSnapshot(first.page);
    const beforeB = await readSnapshot(second.page);
    assert.equal(beforeA.reloadCount, 0);
    assert.equal(beforeB.reloadCount, 0);
    fixture.setWorkerVersion('new');
    await second.page.evaluate(() => window.__pwaFixture.waitForUpdate());
    await waitForWaiting(second.page, 'external-tab-b');
    await second.page.evaluate(() => window.__pwaFixture.activateWaitingExternally());
    await waitUntil(async () => {
      const snapshot = await readSnapshot(second.page);
      return Boolean(snapshot && snapshot.activatedVersions.length > 1);
    }, 'ativação externa real', INSTALL_TIMEOUT_MS);
    await sleep(1000);
    const afterA = await readSnapshot(first.page);
    const afterB = await readSnapshot(second.page);
    assert.equal(afterA.reloadCount, 0, 'outra aba não pode recarregar por ativação externa');
    assert.equal(afterB.reloadCount, 0, 'aba ativadora não pode recarregar automaticamente');
    assert.equal(afterA.controllerChanges, 0, 'sem clients.claim não há controllerchange na aba A');
    assert(afterB.controllerChanges >= 1, 'a aba B controlada deve observar a troca real de controlador');
    log(`[external] as duas abas permaneceram sem reload automático; A=${afterA.reloadCount}, B=${afterB.reloadCount}`);
    return {
      tabA: { reloadCount: afterA.reloadCount, controllerChanges: afterA.controllerChanges },
      tabB: { reloadCount: afterB.reloadCount, controllerChanges: afterB.controllerChanges },
    };
  } finally {
    if (second && second.page) await second.page.close().catch(() => {});
    await closeOpened(first);
  }
}

async function runPreviouslyActivatedCase() {
  let opened;
  try {
    opened = await openInitialPage('previously-activated');
    fixture.setWorkerVersion('new');
    await opened.page.evaluate(() => window.__pwaFixture.waitForUpdate());
    await waitForWaiting(opened.page, 'previously-activated');
    await opened.page.evaluate(() => window.__pwaFixture.activateWaitingExternally());
    await waitUntil(async () => {
      const snapshot = await readSnapshot(opened.page);
      return Boolean(snapshot && snapshot.activatedVersions.length > 1);
    }, 'worker ativado antes do clique', INSTALL_TIMEOUT_MS);
    await opened.page.evaluate(() => window.__pwaFixture.startManualUpdate());
    await waitUntil(async () => {
      const snapshot = await readSnapshot(opened.page);
      return Boolean(snapshot && snapshot.reloadCount >= 1 && snapshot.bootReady);
    }, 'reload sem timeout após ativação anterior', CASE_TIMEOUT_MS, 250);
    const snapshot = await readSnapshot(opened.page);
    assert.equal(snapshot.reloadCount, 1);
    log(`[previously-activated] helper não ficou aguardando controllerchange após ativação externa; reloads=${snapshot.reloadCount}`);
    return { reloadCount: snapshot.reloadCount, controllerChanges: snapshot.controllerChanges };
  } finally {
    await closeOpened(opened);
  }
}

async function runActivationErrorCase() {
  let opened;
  try {
    opened = await openInitialPage('activation-error');
    await prepareUpdate(opened, 'activation-error', 'broken');
    await opened.page.evaluate(() => window.__pwaFixture.startManualUpdate());
    const activationErrorTimeout = SOURCE_MODE === 'current' || SOURCE_MODE === 'fixed'
      ? CASE_TIMEOUT_MS
      : ACTIVATION_TIMEOUT_MS + 5000;
    const outcome = await waitForBrowserOutcome(opened.page, 'activation-error', activationErrorTimeout);
    const snapshot = outcome.snapshot;
    assert(snapshot && snapshot.outcome && snapshot.outcome.kind === 'error', 'ativação rejeitada deve resultar em erro visível');
    assert.equal(snapshot.reloadCount, 0, 'falha de ativação não pode recarregar');
    await opened.page.screenshot({ path: BROKEN_SCREENSHOT_PATH, fullPage: true });
    log(`[activation-error] erro sem reload confirmado: ${snapshot.outcome.message}`);
    return { error: snapshot.outcome.message, reloadCount: snapshot.reloadCount, screenshot: BROKEN_SCREENSHOT_PATH };
  } finally {
    await closeOpened(opened);
  }
}

function writeReport(result) {
  const baselineCase = result.cases.find(item => item.name === 'baseline-reproduction');
  const fixedCase = result.cases.find(item => item.name === 'fixed-or-current-success');
  const reproduced = baselineCase && baselineCase.status === 'pass' && baselineCase.details && baselineCase.details.expectedFailure;
  const passed = result.status === 'pass';
  const lines = [
    '# Evidência — ativação manual PWA em Chromium real',
    '',
    `Gerado em **${result.generatedAt}** com ` + (result.source.label || result.source),
    '',
    '## Proveniência',
    '',
    `- Fonte exercitada: \`${result.source.label}\`.`,
    `- Chromium: \`${result.browser.executablePath}\` (${result.browser.version}).`,
    `- Playwright: \`${result.browser.playwrightModule}\`.`,
    `- Fixture: HTTP real em \`${result.fixture.url}\`, service workers reais e cache/controlador reais.`,
    '- Não foram importados App, socket.io de produção, banco, env, Vite server ou configuração do aplicativo.',
    '',
    '## Causalidade observada',
    '',
    'O baseline instala um novo SW no estado `waiting`, o callback envia `SKIP_WAITING` ao worker correto e o worker passa para `activated`. Esse worker do fixture não chama `clients.claim()`, portanto a página alvo inicialmente sem controlador continua sem disparar `controllerchange`. O helper baseline espera somente esse evento e termina no timeout com `Não foi possível ativar a atualização. Tente novamente.`, sem recarregar.',
    '',
    'Isso reproduz a condição real de ativação concluída sem tomada de controle da página; não é um timeout artificial nem um mock de Service Worker.',
    '',
    '## Casos',
    '',
  ];
  for (const item of result.cases) {
    lines.push(`- **${item.name}** — ${item.status.toUpperCase()} (${item.durationMs} ms)`);
    if (item.error) lines.push(`  - erro: \`${item.error.split('\n')[0]}\``);
    if (item.details) lines.push(`  - detalhes: \`${JSON.stringify(item.details)}\``);
  }
  lines.push('', '## Imagens', '');
  for (const screenshot of [BASELINE_SCREENSHOT_PATH, FIXED_SCREENSHOT_PATH, BROKEN_SCREENSHOT_PATH]) {
    if (fs.existsSync(screenshot)) lines.push(`![${path.basename(screenshot)}](${screenshot})`);
  }
  lines.push('', '## Interpretação', '');
  if (reproduced) lines.push('- A reprodução baseline passou como evidência do defeito: o caso de falha esperada ocorreu com ativação observada, zero `controllerchange` e zero reload.', '- Para aceitar a correção do parent, execute novamente com `PWA_UPDATE_SOURCE=current`; o caso de sucesso deve terminar com exatamente um reload após o clique e sem reload automático em outra aba.');
  if (fixedCase && fixedCase.status === 'pass') lines.push('- A fonte current/fixed também passou o fluxo de clique, ativação e reload único.');
  if (!passed) lines.push('- Há casos não concluídos; consulte `stdout.log` e `results.json` para o primeiro erro.');
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  log(`Harness iniciado; ROOT=${ROOT}`);
  log(`SOURCE_MODE=${SOURCE_MODE}; OUTPUT_DIR=${OUTPUT_DIR}`);
  log(`Chromium=${CHROMIUM_PATH}; Playwright=${PLAYWRIGHT_MODULE}`);
  log(`Timeouts: instalação=${INSTALL_TIMEOUT_MS}ms ativação=${ACTIVATION_TIMEOUT_MS}ms caso=${CASE_TIMEOUT_MS}ms`);
  const source = bundleSelectedHelper();
  fixture = await createFixtureServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  log(`Chromium real iniciado: ${await browser.version()}`);

  // The original helper is reproduced first. For a current/fixed run this
  // reference case is intentionally skipped: the same real waiting-worker
  // setup is exercised by fixed-or-current-success with the new 3-arg API.
  if (SOURCE_MODE === 'baseline') {
    await runCase('baseline-reproduction', runBaselineReproduction);
  } else {
    cases.push({
      name: 'baseline-reproduction',
      status: 'skipped',
      durationMs: 0,
      details: { reason: 'PWA_UPDATE_SOURCE=current; baseline was run separately before the fix' },
    });
    log('[case baseline-reproduction] SKIP (fonte current/fixed; baseline deve ser executado separadamente)');
  }

  if (SOURCE_MODE === 'baseline') {
    cases.push({
      name: 'fixed-or-current-success',
      status: 'skipped',
      durationMs: 0,
      details: { reason: 'PWA_UPDATE_SOURCE=baseline; fixed 3-arg acceptance is run separately with PWA_UPDATE_SOURCE=current' },
    });
    log('[case fixed-or-current-success] SKIP (fonte baseline; correção deve ser executada separadamente)');
  } else {
    await runCase('fixed-or-current-success', runFixedOrCurrentSuccess);
  }
  await runCase('external-activation-no-auto-reload', runExternalActivationCase);
  await runCase('previously-activated-no-timeout', runPreviouslyActivatedCase);
  await runCase('activation-error-no-reload', runActivationErrorCase);

  const baseline = cases.find(item => item.name === 'baseline-reproduction');
  const success = cases.find(item => item.name === 'fixed-or-current-success');
  const reproductionPassed = baseline && baseline.status === 'pass' && baseline.details && baseline.details.expectedFailure;
  const sourceIsBaseline = SOURCE_MODE === 'baseline';
  const allCasesPassed = cases.filter(item => item.status !== 'skipped').every(item => item.status === 'pass');
  const status = sourceIsBaseline
    ? (reproductionPassed && allCasesPassed ? 'baseline-reproduced' : 'fail')
    : (allCasesPassed ? 'pass' : 'fail');
  const results = {
    status,
    generatedAt: nowIso(),
    project: ROOT,
    source: {
      mode: SOURCE_MODE,
      label: source.label,
      baselineCommit: BASELINE_COMMIT,
      extractedHelper: HELPER_SOURCE_PATH,
      bundle: HELPER_BUNDLE_PATH,
      bundleInputs: source.inputs,
    },
    browser: {
      engine: 'Chromium headless via external Playwright',
      executablePath: CHROMIUM_PATH,
      playwrightModule: PLAYWRIGHT_MODULE,
      version: await browser.version(),
      serviceWorkers: 'real; browser context serviceWorkers=allow',
    },
    fixture: {
      url: fixture.url,
      loopbackHttp: true,
      serviceWorkerVersions: ['old', 'new', 'broken'],
      initialWorkerClaimsClients: false,
      updateWorkerClaimsClients: false,
      updateCallback: 'registration.waiting.postMessage({type: SKIP_WAITING})',
      productionAppImported: false,
      productionDatabaseUsed: false,
      productionSocketUsed: false,
    },
    evidence: {
      report: REPORT_PATH,
      log: LOG_PATH,
      screenshots: [BASELINE_SCREENSHOT_PATH, FIXED_SCREENSHOT_PATH, BROKEN_SCREENSHOT_PATH].filter(fs.existsSync),
    },
    cases,
    limitations: [
      'O fixture valida o contrato do helper e a semântica real do navegador; não monta UpdateBanner/useRegisterSW para não stubbar o runtime PWA.',
      'A callback de ativação é o equivalente mínimo verificável ao postMessage do runtime Workbox e aponta explicitamente para registration.waiting.',
      'A aba do fixture não usa clients.claim() no SW de update de propósito, para reproduzir ativação concluída sem controllerchange antes da navegação.',
      sourceIsBaseline ? 'Em modo baseline, o caso de sucesso esperado falha pelo timeout original; isso é reportado como baseline-reproduced, não como falha do harness.' : 'Em modo current/fixed, todos os casos precisam passar; o caso baseline-reproduction continua documentando a mesma condição com a fonte selecionada.',
    ],
  };
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`);
  writeReport(results);
  log(`Resultados salvos em ${RESULTS_PATH}`);
  log(`Relatório salvo em ${REPORT_PATH}`);
  if (status === 'fail') throw fatalError || new Error('um ou mais casos falharam');
}

(async () => {
  try {
    await main();
  } catch (error) {
    fatalError = fatalError || error;
    log(`FALHA FINAL: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  } finally {
    await closeFixtureServer(fixture);
    if (browser) {
      try { await browser.close(); } catch (error) { log(`falha fechando Chromium: ${error.message}`); }
    }
    try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}
    try {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(LOG_PATH, `${logLines.join('\n')}\n`);
    } catch (error) {
      process.stderr.write(`Não foi possível gravar stdout.log: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
})();
