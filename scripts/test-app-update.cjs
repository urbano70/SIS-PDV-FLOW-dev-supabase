#!/usr/bin/env node
'use strict';

/**
 * Regression tests for the explicit PWA update flow.
 *
 * The runtime part bundles only src/lib/appUpdate.ts with esbuild. It does not
 * import React, the app, sockets, a database, environment configuration, or
 * make network requests. UI/server/Vite checks below are source assertions.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const HELPER_PATH = path.join(ROOT, 'src/lib/appUpdate.ts');
const UI_PATH = path.join(ROOT, 'src/components/UpdateBanner.tsx');
const MAIN_PATH = path.join(ROOT, 'src/main.tsx');
const SERVER_PATH = path.join(ROOT, 'server.ts');
const VITE_PATH = path.join(ROOT, 'vite.config.ts');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function bundleHelper() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-update-test-'));
  const outfile = path.join(tempDir, 'appUpdate.cjs');
  try {
    const result = esbuild.buildSync({
      entryPoints: [HELPER_PATH],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      outfile,
      metafile: true,
      logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile.inputs);
    assert.equal(inputs.length, 1, 'o bundle do teste deve conter apenas o helper');
    assert.equal(path.basename(inputs[0]), 'appUpdate.ts', 'o bundle deve importar somente appUpdate.ts');
    assert(!inputs.some(file => /(?:App|UpdateBanner)\.(?:tsx?|jsx?)$/.test(file)), 'o teste não deve importar o app React');

    const modulePath = require.resolve(outfile);
    const api = require(modulePath);
    delete require.cache[modulePath];
    return api;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

class EventTargetMock {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener({ type });
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function testBuildComparison(isDifferentBuild) {
  const local = '2026.11.15-release-rc.2';
  assert.equal(isDifferentBuild({ buildId: local }, local), false, 'mesmo build deve ser falso');
  assert.equal(isDifferentBuild({ buildId: '2026.11.15-release-rc.1' }, local), true, 'rollback/downgrade também é build diferente');
  assert.equal(isDifferentBuild({ buildId: '2026.11.15-release-rc.3' }, local), true, 'build posterior diferente deve ser detectado');

  for (const malformed of [
    undefined,
    null,
    false,
    0,
    '2026.11.15-release-rc.3',
    {},
    [],
    { buildId: undefined },
    { buildId: null },
    { buildId: 123 },
    { buildId: '' },
    { buildId: '   ' },
  ]) {
    assert.equal(isDifferentBuild(malformed, local), false, `buildId inválido deveria ser falso: ${String(malformed)}`);
  }

  // No numeric or lexical ordering is implied: IDs are opaque exact strings.
  assert.equal(isDifferentBuild({ buildId: 'v2.10.0-rc.1' }, 'v2.9.0-rc.9'), true);
  assert.equal(isDifferentBuild({ buildId: 'v2.9.0-rc.9' }, 'v2.10.0-rc.1'), true);
  assert.equal(isDifferentBuild({ buildId: 'alpha-10' }, 'alpha-2'), true);
  assert.equal(isDifferentBuild({ buildId: 'alpha-2' }, 'alpha-2'), false);
}

async function testManualUpdate(updateAppManually) {
  let reloads = 0;
  let activationCalls = 0;
  await updateAppManually(
    undefined,
    async () => { activationCalls += 1; },
    undefined,
    () => { reloads += 1; },
  );
  assert.equal(activationCalls, 0, 'sem registration/service worker não deve ativar nada');
  assert.equal(reloads, 1, 'o caminho manual sem registration recarrega apenas ao concluir');

  let updateCalls = 0;
  let installReloads = 0;
  const installing = new EventTargetMock();
  installing.state = 'installing';
  const installPromise = updateAppManually(
    {
      update: async () => { updateCalls += 1; },
      installing,
      waiting: undefined,
    },
    async () => {},
    undefined,
    () => { installReloads += 1; },
  );
  await flushMicrotasks();
  assert.equal(updateCalls, 1, 'registration.update() deve ser aguardado');
  assert.equal(installReloads, 0, 'não deve recarregar enquanto a instalação está pendente');
  installing.state = 'installed';
  installing.dispatch('statechange');
  await installPromise;
  assert.equal(installReloads, 1, 'deve recarregar após a instalação');

  let waitingReloads = 0;
  let activationObserved = false;
  const serviceWorker = new EventTargetMock();
  const waitingPromise = updateAppManually(
    {
      update: async () => {},
      installing: undefined,
      waiting: {},
    },
    async () => {
      activationObserved = true;
      assert.equal(serviceWorker.listenerCount('controllerchange'), 1, 'controllerchange deve ser observado antes da ativação');
    },
    serviceWorker,
    () => { waitingReloads += 1; },
  );
  await flushMicrotasks();
  assert.equal(activationObserved, true, 'a ativação deve ser solicitada');
  assert.equal(waitingReloads, 0, 'waiting não pode recarregar antes de controllerchange');
  serviceWorker.dispatch('controllerchange');
  await waitingPromise;
  assert.equal(waitingReloads, 1, 'só deve recarregar depois de controllerchange');

  let rejectedReloads = 0;
  await assert.rejects(
    updateAppManually(
      { update: async () => { throw new Error('update recusado'); } },
      async () => {},
      undefined,
      () => { rejectedReloads += 1; },
    ),
    /update recusado/,
  );
  assert.equal(rejectedReloads, 0, 'falha em registration.update() não pode recarregar');

  let activationRejectedReloads = 0;
  await assert.rejects(
    updateAppManually(
      { update: async () => {}, installing: undefined, waiting: {} },
      async () => { throw new Error('ativação recusada'); },
      new EventTargetMock(),
      () => { activationRejectedReloads += 1; },
    ),
    /ativação recusada/,
  );
  assert.equal(activationRejectedReloads, 0, 'falha de ativação não pode recarregar');
}

function testUiSource() {
  const source = read(UI_PATH);
  const entrypoint = read(MAIN_PATH);
  assert.doesNotMatch(entrypoint, /\blocation\.reload\s*\(/, 'a inicialização não pode recarregar automaticamente');
  assert.doesNotMatch(entrypoint, /addEventListener\(\s*['"]controllerchange['"]/, 'controllerchange global não pode aplicar atualização sem clique');
  assert.match(source, /Atualizar agora/, 'o rótulo Atualizar agora é obrigatório');
  assert.match(source, /Mais tarde/, 'o rótulo Mais tarde é obrigatório');
  assert.doesNotMatch(source, /\b(?:setTimeout|setInterval)\s*\(/, 'a UI não deve iniciar countdown/timer');
  assert.doesNotMatch(source, /countdown|contagem regressiva/i, 'a UI não deve exibir countdown');
  assert.match(source, /await\s+updateAppManually\s*\(/, 'o reload deve passar pelo fluxo manual');
  assert.equal((source.match(/\bwindow\.location\.reload\s*\(\s*\)/g) || []).length, 1, 'deve existir somente o reload explícito do callback manual');
  assert.match(source, /,\s*\(\)\s*=>\s*window\.location\.reload\s*\(\s*\)\s*,/, 'reload deve ser callback do botão/manual helper');

  const needReload = source.match(/onNeedReload\s*\(\)\s*\{([\s\S]*?)\},\s*onRegisterError/);
  assert(needReload, 'onNeedReload deve ser configurado');
  assert.match(needReload[1], /setExternalUpdate\s*\(true\)/, 'outra aba deve apenas sinalizar a atualização');
  assert.doesNotMatch(needReload[1], /reload|updateServiceWorker/, 'outra aba não pode recarregar esta aba automaticamente');

  assert.match(source, /socket\.on\(\s*['"]app_version['"]\s*,/, 'deve ouvir app_version');
  assert.match(source, /socket\.emit\(\s*['"]request_app_version['"]\s*\)/, 'deve pedir app_version no check/mount');
  assert.match(source, /socket\.on\(\s*['"]connect['"]\s*,\s*check\s*\)/, 'deve pedir app_version ao reconectar');
  assert.match(source, /\n\s*check\(\);/, 'deve executar o check no mount');
}

function testServerSource() {
  const source = read(SERVER_PATH);
  assert.match(source, /['"]app_version['"]/, 'o servidor deve publicar app_version');
  assert.match(source, /\bbuildId\s*:\s*__BUILD_ID__\b/, 'payload app_version deve usar __BUILD_ID__');
  assert.match(source, /socket\.on\(\s*['"]request_app_version['"]\s*,/, 'o servidor deve aceitar request_app_version');
  assert.doesNotMatch(source, /\b(?:SERVER_VERSION|LATEST_PR)\s*=\s*271\b/, 'a constante legada 271 não pode continuar governando a versão');
}

function testViteConfig() {
  const source = read(VITE_PATH);
  assert.match(source, /registerType\s*:\s*['"]prompt['"]/, 'PWA deve usar registerType prompt');
  assert.match(source, /injectRegister\s*:\s*null/, 'registro PWA deve ser manual (injectRegister null)');
}

async function main() {
  const { isDifferentBuild, updateAppManually } = bundleHelper();
  testBuildComparison(isDifferentBuild);
  await testManualUpdate(updateAppManually);
  testUiSource();
  testServerSource();
  testViteConfig();
  console.log('OK: helper isolado, atualização manual, UI, servidor e configuração PWA passaram.');
}

main().catch(error => {
  console.error(`FALHOU: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
});
