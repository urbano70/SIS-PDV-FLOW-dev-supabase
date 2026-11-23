import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PREMIUM_ACCOUNT_PLAN_ID,
  canSelectAccountPlan,
  resolveAccountPlanSelection,
} from '../src/lib/accountPlanSelection.ts';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

assert.equal(PREMIUM_ACCOUNT_PLAN_ID, 'premium');
assert.equal(canSelectAccountPlan('premium'), true, 'Premium permanece selecionável');
assert.equal(canSelectAccountPlan('free'), false, 'Free fica suspenso');
assert.equal(canSelectAccountPlan('essencial'), false, 'Essencial fica suspenso');
assert.equal(canSelectAccountPlan('future-plan'), false, 'novos planos ficam bloqueados por padrão');

assert.equal(resolveAccountPlanSelection('free', 'premium'), 'premium');
assert.equal(resolveAccountPlanSelection('premium', 'free'), 'premium');
assert.equal(resolveAccountPlanSelection('essencial', 'essencial'), 'essencial');

const panel = read('src/pages/UserPanel.tsx');
assert.match(panel, /!canSelectAccountPlan\(planId\)/, 'handler rejeita seleção suspensa');
assert.match(panel, /disabled=\{savingPlan \|\| !selectable\}/, 'cartões suspensos usam disabled nativo');
assert.match(panel, /aria-disabled=\{!selectable\}/, 'estado suspenso é anunciado');
assert.match(panel, /aria-pressed=\{active\}/, 'plano atual é exposto como estado selecionado');
assert.match(panel, /Até segunda ordem, somente o Premium pode ser selecionado/);
assert.match(panel, /Indisponível/);

console.log('test-premium-only: ok');
