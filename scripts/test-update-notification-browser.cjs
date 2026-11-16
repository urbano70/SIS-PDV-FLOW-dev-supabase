#!/usr/bin/env node
'use strict';

/**
 * Real Chromium/React/DOM regression test for UpdateBanner.
 *
 * This harness deliberately does not import the application entrypoint, App,
 * environment configuration, database code, or the production server. It
 * bundles only UpdateBanner.tsx and its direct imports with esbuild, uses the
 * repository's compiled CSS asset, and serves a small real Socket.IO server
 * on an ephemeral loopback port.
 *
 * Playwright may be installed separately and selected with PLAYWRIGHT_MODULE_PATH.
 * CHROMIUM_PATH and UPDATE_TEST_OUTPUT_DIR optionally customize the browser and
 * evidence directory. This test never changes the application's dependencies.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = process.env.UPDATE_TEST_OUTPUT_DIR || path.join(ROOT, 'test-results', 'update-notification');
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, 'aviso-atualizacao.png');
const RESULTS_PATH = path.join(OUTPUT_DIR, 'resultados.json');
const LOG_PATH = path.join(OUTPUT_DIR, 'stdout.log');
const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

const esbuild = require(path.join(ROOT, 'node_modules/esbuild'));
const { Server: SocketIOServer } = require(path.join(ROOT, 'node_modules/socket.io'));
const { chromium } = require(PLAYWRIGHT_MODULE);

const UI_PATH = path.join(ROOT, 'src/components/UpdateBanner.tsx');
const CSS_PATH = path.join(
  ROOT,
  'dist/assets',
  fs.readdirSync(path.join(ROOT, 'dist/assets')).find((name) => name.endsWith('.css')),
);
const BUILD_INFO_PATH = path.join(ROOT, '.build-info.json');
const LOCAL_BUILD_ID = JSON.parse(fs.readFileSync(BUILD_INFO_PATH, 'utf8')).buildId;
const legacyMatch = fs.readFileSync(path.join(ROOT, 'src/version.ts'), 'utf8').match(/LATEST_PR\s*=\s*(\d+)/);
if (!legacyMatch) throw new Error('LATEST_PR não encontrado em src/version.ts');
const LEGACY_VERSION = Number(legacyMatch[1]);
const REMOTE_BUILD_1 = 'browser-test-opaque-remote-1';
const REMOTE_BUILD_2 = 'browser-test-opaque-remote-2';
const REMOTE_BUILD_3 = 'browser-test-opaque-remote-3';

const logLines = [];
const cases = [];
let browser;
let context;
let page;
let isolated;
let tempDir;
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
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function browserBootCount() {
  return page.evaluate(() => Number(sessionStorage.getItem('__update_browser_boot_count__') || 0));
}

async function hasBanner() {
  return (await page.locator('[role="status"]').count()) > 0;
}

async function waitForBanner(expected, label, timeoutMs = 10000) {
  await waitUntil(async () => (await hasBanner()) === expected, label, timeoutMs);
}

function bundleEntrySource() {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import UpdateBanner from ${JSON.stringify(UI_PATH)};

window.__TEST_CLIENT_BUILD_ID__ = __BUILD_ID__;
const root = document.getElementById('root');
if (!root) throw new Error('test shell root ausente');
createRoot(root).render(React.createElement(UpdateBanner));
`;
}

function pwaStubSource() {
  return `
let latestOptions = {};
let updateCalls = 0;

export function useRegisterSW(options = {}) {
  latestOptions = options;
  if (typeof window !== 'undefined') {
    window.__testPwa = window.__testPwa || {};
    window.__testPwa.triggerExternal = () => latestOptions.onNeedReload?.();
    window.__testPwa.getUpdateCalls = () => updateCalls;
  }
  return {
    needRefresh: [false],
    updateServiceWorker: async () => { updateCalls += 1; },
  };
}
`;
}

async function buildComponentBundle(buildId, outputPath) {
  const result = await esbuild.build({
    stdin: {
      contents: bundleEntrySource(),
      resolveDir: ROOT,
      sourcefile: 'test-update-notification-entry.tsx',
      loader: 'tsx',
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    jsx: 'automatic',
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    outfile: outputPath,
    metafile: true,
    logLevel: 'silent',
    plugins: [{
      name: 'test-only-pwa-register-stub',
      setup(build) {
        build.onResolve({ filter: /^virtual:pwa-register\/react$/ }, () => ({
          path: 'virtual-pwa-register-react',
          namespace: 'test-pwa',
        }));
        build.onLoad({ filter: /.*/, namespace: 'test-pwa' }, () => ({
          contents: pwaStubSource(),
          loader: 'js',
        }));
      },
    }],
  });

  const inputs = Object.keys(result.metafile.inputs);
  assert(inputs.some((file) => /UpdateBanner\.tsx$/.test(file)), 'bundle deve conter UpdateBanner.tsx');
  assert(inputs.some((file) => /appUpdate\.ts$/.test(file)), 'bundle deve conter appUpdate.ts');
  assert(!inputs.some((file) => /(?:^|\/)App\.(?:tsx?|jsx?)$/.test(file)), 'bundle não pode importar App');
  assert(!inputs.some((file) => /(?:^|\/)main\.(?:tsx?|jsx?)$/.test(file)), 'bundle não pode importar main');
  return { outputPath, inputs };
}

function shellHtml(cssFileName) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Validação isolada do aviso de atualização</title>
  <link rel="stylesheet" href="/assets/${cssFileName}">
</head>
<body>
  <main style="padding: 2rem; font-family: system-ui, sans-serif">
    <h1>Validação isolada do aviso de atualização</h1>
    <p>Shell de teste local; não representa a marca nem o deployment de produção.</p>
  </main>
  <div id="root"></div>
  <script>
    (() => {
      const key = '__update_browser_boot_count__';
      const next = Number(sessionStorage.getItem(key) || 0) + 1;
      sessionStorage.setItem(key, String(next));
      document.documentElement.dataset.bootCount = String(next);
      window.__TEST_BOOT_COUNT__ = next;
    })();
  </script>
  <script src="/bundle.js"></script>
</body>
</html>`;
}

async function createIsolatedServer(bundlePaths) {
  let serverBuildId = LOCAL_BUILD_ID;
  let frontendBundlePath = bundlePaths.local.outputPath;
  let connectionCount = 0;
  let versionRequestCount = 0;
  const events = [];

  const httpServer = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const sendFile = (filePath, contentType) => {
      response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
      fs.createReadStream(filePath).pipe(response);
    };

    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(shellHtml(path.basename(CSS_PATH)));
      return;
    }
    if (url.pathname === '/bundle.js') {
      sendFile(frontendBundlePath, 'application/javascript; charset=utf-8');
      return;
    }
    if (url.pathname === `/assets/${path.basename(CSS_PATH)}`) {
      sendFile(CSS_PATH, 'text/css; charset=utf-8');
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  const io = new SocketIOServer(httpServer, {
    cors: { origin: true, methods: ['GET', 'POST'] },
    transports: ['polling', 'websocket'],
  });

  function payload() {
    return {
      buildId: serverBuildId,
      version: `browser-test-${serverBuildId}`,
      builtAt: '2026-11-16T00:00:00.000Z',
    };
  }

  function emitVersion(target) {
    target.emit('app_version', payload());
    events.push({ type: 'app_version', buildId: serverBuildId, at: nowIso() });
  }

  io.on('connection', (socket) => {
    connectionCount += 1;
    events.push({ type: 'connect', at: nowIso(), count: connectionCount });
    // Match the production compatibility event without causing a legacy notice.
    socket.emit('server_version', LEGACY_VERSION);
    emitVersion(socket);
    socket.on('request_app_version', () => {
      versionRequestCount += 1;
      events.push({ type: 'request_app_version', at: nowIso(), count: versionRequestCount });
      emitVersion(socket);
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : null;
  assert(port, 'servidor isolado não obteve porta TCP');

  return {
    httpServer,
    io,
    url: `http://127.0.0.1:${port}/`,
    get serverBuildId() { return serverBuildId; },
    get frontendBundlePath() { return frontendBundlePath; },
    get connectionCount() { return connectionCount; },
    get versionRequestCount() { return versionRequestCount; },
    events,
    setBuildId(buildId) {
      serverBuildId = buildId;
      log(`[server] app_version agora ${buildId}`);
    },
    emitVersionToAll() {
      io.emit('app_version', payload());
      events.push({ type: 'broadcast_app_version', buildId: serverBuildId, at: nowIso() });
    },
    resetVersionRequestCount() {
      versionRequestCount = 0;
    },
    switchFrontend(bundlePath) {
      frontendBundlePath = bundlePath;
      log(`[server] bundle frontend agora ${path.basename(bundlePath)}`);
    },
    forceReconnectClients() {
      for (const socket of io.sockets.sockets.values()) {
        // Closing the underlying connection, rather than calling disconnect(),
        // permits the real socket.io-client's automatic reconnection flow.
        socket.conn.close();
      }
    },
  };
}

async function closeIsolatedServer(server) {
  if (!server) return;
  for (const socket of server.io.sockets.sockets.values()) socket.disconnect(true);
  await new Promise((resolve) => server.io.close(() => resolve()));
  await new Promise((resolve) => server.httpServer.close(() => resolve()));
}

async function runCase(name, fn) {
  const started = Date.now();
  log(`[case ${name}] INÍCIO`);
  try {
    await fn();
    const durationMs = Date.now() - started;
    cases.push({ name, status: 'pass', durationMs });
    log(`[case ${name}] PASS (${durationMs}ms)`);
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error && error.stack ? error.stack : String(error);
    cases.push({ name, status: 'fail', durationMs, error: message });
    log(`[case ${name}] FALHA (${durationMs}ms): ${error && error.message ? error.message : error}`);
    if (!fatalError) fatalError = error;
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-notification-browser-'));
  log(`Harness iniciado; ROOT=${ROOT}`);
  log(`Chromium=${CHROMIUM_PATH}`);
  log(`Playwright=${PRIVATE_PLAYWRIGHT}`);
  log(`build local opaco=${LOCAL_BUILD_ID}`);
  log(`CSS compilado usado=${CSS_PATH}`);

  const localBundle = await buildComponentBundle(LOCAL_BUILD_ID, path.join(tempDir, 'bundle-local.js'));
  const remote3Bundle = await buildComponentBundle(REMOTE_BUILD_3, path.join(tempDir, 'bundle-remote-3.js'));
  log(`Bundle UpdateBanner local criado com ${localBundle.inputs.length} entradas esbuild`);
  log(`Bundle UpdateBanner novo criado com ${remote3Bundle.inputs.length} entradas esbuild`);

  isolated = await createIsolatedServer({ local: localBundle, remote3: remote3Bundle });
  log(`Servidor HTTP + Socket.IO isolado em ${isolated.url}`);

  browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  page = await context.newPage();
  page.on('console', (message) => log(`[browser console:${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => log(`[browser pageerror] ${error.message}`));
  await page.goto(isolated.url, { waitUntil: 'domcontentloaded' });
  await waitUntil(() => page.evaluate(() => !!document.querySelector('#root')), 'shell DOM', 10000);
  await waitUntil(() => isolated.connectionCount >= 1, 'conexão Socket.IO inicial', 10000);
  await sleep(500);
  assert.equal(await browserBootCount(), 1, 'boot inicial deve ser 1');

  await runCase('1-builds-iguais-sem-banner', async () => {
    assert.equal(isolated.serverBuildId, LOCAL_BUILD_ID);
    await waitForBanner(false, 'banner indevido para build igual');
    assert.equal(await browserBootCount(), 1, 'build igual não pode recarregar');
  });

  await runCase('2-servidor-muda-e-banner-real-aparece', async () => {
    isolated.setBuildId(REMOTE_BUILD_1);
    isolated.emitVersionToAll();
    await waitForBanner(true, 'banner após app_version diferente');
    assert.equal(await page.getByText('Atualização disponível', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Atualizar agora', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Mais tarde', exact: true }).count(), 1);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    log(`Screenshot real do aviso salva em ${SCREENSHOT_PATH}`);
  });

  await runCase('3-35s-sem-reload-e-banner-persiste', async () => {
    const initialBoot = await browserBootCount();
    assert.equal(initialBoot, 1);
    log('[case 3] aguardando 35 segundos reais; progresso a cada 5s');
    for (let elapsed = 1; elapsed <= 35; elapsed += 1) {
      await sleep(1000);
      if (elapsed % 5 === 0 || elapsed === 1) log(`[case 3] progresso ${elapsed}/35s`);
      assert.equal(await browserBootCount(), initialBoot, `reload inesperado em ${elapsed}s`);
    }
    await waitForBanner(true, 'banner após espera real de 35s', 2000);
    assert.equal(await page.getByText('Atualização disponível', { exact: true }).count(), 1);
  });

  await runCase('4-mais-tarde-esconde-sem-reload', async () => {
    await page.getByRole('button', { name: 'Mais tarde', exact: true }).click();
    await waitForBanner(false, 'Mais tarde esconder banner', 3000);
    assert.equal(await browserBootCount(), 1, 'Mais tarde não pode recarregar');
  });

  await runCase('5-novo-build-opaco-faz-banner-reaparecer', async () => {
    isolated.setBuildId(REMOTE_BUILD_2);
    isolated.emitVersionToAll();
    await waitForBanner(true, 'novo build após dismiss reaparecer');
    assert.equal(await browserBootCount(), 1, 'novo aviso não pode recarregar');
  });

  await runCase('6-reconexao-pede-e-recebe-versao', async () => {
    const connectionsBefore = isolated.connectionCount;
    isolated.resetVersionRequestCount();
    isolated.setBuildId(REMOTE_BUILD_3);
    isolated.forceReconnectClients();
    await waitUntil(
      () => isolated.connectionCount > connectionsBefore && isolated.versionRequestCount >= 1,
      'reconexão e request_app_version',
      15000,
    );
    await waitForBanner(true, 'banner recebido depois da reconexão', 5000);
    assert.equal(await browserBootCount(), 1, 'reconexão não pode recarregar');
    log(`[case 6] conexão=${isolated.connectionCount}, request_app_version=${isolated.versionRequestCount}`);
  });

  await runCase('7-clique-atualizar-recarrega-bundle-novo', async () => {
    // Simulate a newly published frontend bundle before the real user click.
    isolated.switchFrontend(remote3Bundle.outputPath);
    isolated.setBuildId(REMOTE_BUILD_3);
    isolated.emitVersionToAll();
    await waitForBanner(true, 'banner antes do clique de atualização');
    assert.equal(await page.evaluate(() => window.__TEST_CLIENT_BUILD_ID__), LOCAL_BUILD_ID);
    assert.equal(await browserBootCount(), 1);

    await page.getByRole('button', { name: 'Atualizar agora', exact: true }).click({ noWaitAfter: true });
    await waitUntil(
      async () => (await browserBootCount()) === 2,
      'document.reload real e bootcount=2',
      20000,
      150,
    );
    await waitUntil(
      async () => (await page.evaluate(() => window.__TEST_CLIENT_BUILD_ID__).catch(() => null)) === REMOTE_BUILD_3,
      'bundle novo carregado com build matching',
      10000,
      150,
    );
    await sleep(1000);
    await waitForBanner(false, 'banner ausente no bundle novo matching', 5000);
    assert.equal(await browserBootCount(), 2, 'reload esperado deve produzir exatamente bootcount=2');
    assert.equal(await page.evaluate(() => window.__TEST_CLIENT_BUILD_ID__), REMOTE_BUILD_3);
  });

  await runCase('8-callback-pwa-externo-nao-recarrega', async () => {
    const before = await browserBootCount();
    await page.evaluate(() => {
      if (!window.__testPwa || typeof window.__testPwa.triggerExternal !== 'function') {
        throw new Error('stub PWA não expôs triggerExternal');
      }
      window.__testPwa.triggerExternal();
    });
    await waitForBanner(true, 'onNeedReload externo sinalizar banner', 5000);
    await sleep(500);
    assert.equal(await browserBootCount(), before, 'ativação externa não pode recarregar esta aba');
    assert.equal(await page.evaluate(() => navigator.serviceWorker?.controller ?? null), null, 'nenhum SW deve estar ativo no fixture');
  });

  const allPassed = cases.length === 8 && cases.every((entry) => entry.status === 'pass');
  const results = {
    status: allPassed ? 'pass' : 'fail',
    generatedAt: nowIso(),
    project: ROOT,
    browser: {
      engine: 'Chromium headless via Playwright CLI',
      executablePath: CHROMIUM_PATH,
      version: await browser.version(),
      url: isolated.url,
      serviceWorkers: 'blocked in fixture; virtual:pwa-register/react is a test stub',
    },
    testFixture: {
      realReact: true,
      realDom: true,
      realUpdateBannerBundle: true,
      esbuildEntry: 'src/components/UpdateBanner.tsx plus direct imports only',
      compiledCssAsset: CSS_PATH,
      localBuildId: LOCAL_BUILD_ID,
      remoteBuildIds: [REMOTE_BUILD_1, REMOTE_BUILD_2, REMOTE_BUILD_3],
      serverProtocol: ['server_version', 'app_version', 'request_app_version'],
      isolatedLoopbackSocketIo: true,
      screenshot: SCREENSHOT_PATH,
    },
    cases,
    limitations: [
      'Não é teste do PWA real/deployment: service worker foi bloqueado e virtual:pwa-register/react usa stub controlado pelo harness.',
      'Não importa o App completo, env, banco ou server.ts de produção; o Socket.IO do fixture é local e implementa apenas o protocolo necessário.',
      'O cenário 7 troca o bundle servido no fixture antes do clique; isso simula o novo frontend publicado sem alterar metadados reais nem fontes da aplicação.',
      'A captura visual usa o CSS compilado existente em dist/assets, mas o shell HTML é deliberadamente mínimo e não representa a tela de produção.',
    ],
  };
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`);
  log(`Resultados JSON salvos em ${RESULTS_PATH}`);
  if (!allPassed) throw fatalError || new Error('um ou mais casos falharam');
}

(async () => {
  try {
    await main();
  } catch (error) {
    fatalError = fatalError || error;
    log(`FALHA FINAL: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
    if (context) {
      try { await context.close(); } catch {}
    }
    if (browser) {
      try { await browser.close(); } catch {}
    }
    if (isolated) {
      try { await closeIsolatedServer(isolated); } catch (error) { log(`Falha encerrando servidor: ${error.message}`); }
    }
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
    try {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(LOG_PATH, `${logLines.join('\n')}\n`);
    } catch (error) {
      process.stderr.write(`Não foi possível gravar stdout.log: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
})();
