import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const WORKTREE_ROOT = resolve(SCRIPT_DIR, '..');
export const BUILD_INFO_PATH = resolve(WORKTREE_ROOT, '.build-info.json');

const PACKAGE_JSON_PATH = resolve(WORKTREE_ROOT, 'package.json');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readPackageVersion() {
  let packageJson;

  try {
    packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Não foi possível ler ${PACKAGE_JSON_PATH}: ${error.message}`, { cause: error });
  }

  if (!packageJson || typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
    throw new Error(`O campo version de ${PACKAGE_JSON_PATH} é obrigatório.`);
  }

  return packageJson.version.trim();
}

function readGitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: WORKTREE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function formatBuildTimestampPtBr(builtAtISO) {
  const builtAt = new Date(builtAtISO);

  if (!Number.isFinite(builtAt.getTime())) {
    throw new Error(`builtAtISO inválido: ${builtAtISO}`);
  }

  return builtAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function validateBuildInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${BUILD_INFO_PATH} deve conter um objeto JSON.`);
  }

  const { buildId, version, builtAtISO } = value;

  if (typeof buildId !== 'string' || !UUID_PATTERN.test(buildId)) {
    throw new Error(`${BUILD_INFO_PATH} contém um buildId inválido.`);
  }

  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error(`${BUILD_INFO_PATH} contém uma version inválida.`);
  }

  if (typeof builtAtISO !== 'string' || !builtAtISO.trim() || !Number.isFinite(new Date(builtAtISO).getTime())) {
    throw new Error(`${BUILD_INFO_PATH} contém um builtAtISO inválido.`);
  }

  return { buildId, version, builtAtISO };
}

function saveBuildInfo(metadata) {
  writeFileSync(BUILD_INFO_PATH, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

export function prepareBuildInfo() {
  const packageVersion = readPackageVersion();
  const gitSha = readGitSha();
  const metadata = {
    buildId: randomUUID(),
    version: `v${packageVersion}${gitSha ? `+${gitSha}` : ''}`,
    builtAtISO: new Date().toISOString(),
  };

  return saveBuildInfo(validateBuildInfo(metadata));
}

export function loadBuildInfo() {
  let raw;

  try {
    raw = readFileSync(BUILD_INFO_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return prepareBuildInfo();
    }
    throw new Error(`Não foi possível ler ${BUILD_INFO_PATH}: ${error.message}`, { cause: error });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${BUILD_INFO_PATH} contém JSON inválido: ${error.message}`, { cause: error });
  }

  return validateBuildInfo(parsed);
}
