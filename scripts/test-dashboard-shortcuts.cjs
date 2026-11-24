#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'src/components/Dashboard.tsx'), 'utf8');

const helperStart = dashboard.indexOf('const DashboardShortcutBadge =');
const orderDetailsStart = dashboard.indexOf('const OrderDetails = (');
const dashboardStart = dashboard.indexOf('export default function Dashboard');
assert(helperStart >= 0, 'helper DashboardShortcutBadge ausente');
assert(orderDetailsStart > helperStart, 'helper deve ficar antes de OrderDetails');
assert(dashboardStart > orderDetailsStart, 'Dashboard deve vir depois de OrderDetails');

const helper = dashboard.slice(helperStart, orderDetailsStart);
const orderDetails = dashboard.slice(orderDetailsStart, dashboardStart);
const dashboardActions = dashboard.slice(dashboardStart);

assert.match(
  helper,
  /<kbd className="inline-flex min-w-\[1\.5rem\][\s\S]*text-\[10px\][\s\S]*shadow-sm group-disabled:opacity-60">/,
  'badge deve ter tamanho, contraste, tipografia e estado desabilitado explícitos',
);
assert.equal((dashboard.match(/<kbd\b/g) || []).length, 1, 'as apresentações devem reutilizar um único elemento kbd no helper');
assert.match(helper, /border-\[#141414\]\/20 bg-white/);
assert.match(helper, /font-mono text-\[10px\] font-bold leading-none/);

assert.match(orderDetails, /<DashboardShortcutBadge shortcut="F2" \/>/, 'F2 deve aparecer junto de Adicionar Pedido');
assert.match(dashboardActions, /<DashboardShortcutBadge shortcut="F4" \/>/, 'F4 deve aparecer junto de Resumo');
assert.match(dashboardActions, /<DashboardShortcutBadge shortcut="F8" \/>/, 'F8 deve aparecer junto de Pagar');
assert.equal(
  (dashboard.match(/<DashboardShortcutBadge shortcut="F[248]" \/>/g) || []).length,
  3,
  'devem existir exatamente três apresentações de atalho',
);

assert.equal((dashboard.match(/focus-visible:ring-2/g) || []).length, 3, 'os três controles com atalho devem ter foco visível');
assert.match(orderDetails, /group-focus-visible:opacity-100/);
assert.match(dashboardActions, /className=\{`group flex items-center gap-1[\s\S]*focus-visible:ring-2/);
assert.match(dashboardActions, /className=\{`group px-3 py-1\.5[\s\S]*focus-visible:ring-2/);

const keyboardShortcuts = dashboard.slice(dashboard.indexOf('// ── Keyboard shortcuts'), dashboard.indexOf('const handleFixTables'));
for (const shortcut of ['F2', 'F4', 'F8']) {
  assert.match(keyboardShortcuts, new RegExp(`if \\(e\\.key === '${shortcut}'\\)`), `${shortcut} deve continuar no handler existente`);
}
assert.match(keyboardShortcuts, /setIsAddItemModalOpen\(true\)/);
assert.match(keyboardShortcuts, /printReceiptToPrinter\(s\.detailActiveOrderId, s\.detailPendingAmount\)/);
assert.match(keyboardShortcuts, /setIsPaymentModalOpen\(true\)/);

console.log('test-dashboard-shortcuts: ok');
