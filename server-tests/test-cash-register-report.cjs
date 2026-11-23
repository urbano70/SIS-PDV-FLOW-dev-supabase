#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./testsHelpers.cjs');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/cash-register-report.fixture.json'), 'utf8'));
const {
  buildCashRegisterReportDocument,
  buildCashRegisterReportEscPos,
  renderCashRegisterReportHtml,
  summarizeCashRegisterOrders,
} = loadTsModule('src/lib/cashRegisterReport.ts', 'cash-register-report');

const summary = summarizeCashRegisterOrders(fixture.orders, {
  shiftStartedAt: fixture.shiftStartedAt,
  cashRegisterName: fixture.cashRegisterName,
  categoryNames: { pizzas: 'Pizzas', bebidas: 'Bebidas' },
});
assert.equal(summary.orderCount, 1, 'o filtro usa o início persistente do turno, inclusive após meia-noite');
assert.deepEqual(summary.methodTotals, { Dinheiro: 20, cartao_credito: 27 }, 'mantém múltiplos pagamentos e não duplica partialPayments legado');
assert.equal(summary.totalPaid, 47);
assert.equal(summary.totalGross, 50, 'preço de linha é preservado como total bruto');
assert.equal(summary.totalDiscount, 5, 'desconto de item e desconto da ordem são somados');
assert.equal(summary.totalNet, 45);
assert.equal(summary.totalCash, 20);
assert.deepEqual(summary.cardTotals, { Visa: 27 });
assert.equal(Object.values(summary.categoryTotals).reduce((sum, row) => sum + row.total, 0), 45, 'classes conciliam com o total líquido');

const input = {
  type: 'close',
  cashRegisterName: fixture.cashRegisterName,
  shiftStartedAt: fixture.shiftStartedAt,
  createdAt: fixture.createdAt,
  reportData: { ...summary, ...fixture.reportDataAdditions },
};
const document = buildCashRegisterReportDocument(input, '80mm');
assert.equal(document.model.width, 48, '80 mm usa 48 colunas de área imprimível');
assert(document.text.includes('MEIOS DE PAGAMENTO'));
assert(document.text.includes('Computado') && document.text.includes('Digitado') && document.text.includes('Diferença'));
assert(document.text.includes('VENDAS') && document.text.includes('CLASSES') && document.text.includes('VALES'));
assert(document.text.includes('Abertura') && document.text.includes('Suprimento') && document.text.includes('Sangria'));
assert(document.text.includes('Visa'));
assert(document.text.includes('Pizza Grande com nome muito'));
assert(document.text.includes('longo para quebrar na largura'));
assert(document.lines.every(line => line.text.length <= 48), 'nenhuma linha física excede a largura de 80 mm');

const escpos = buildCashRegisterReportEscPos(input, '80mm');
assert.equal(escpos[0], 0x1b);
assert(escpos.some((value, index) => value === 0x57 && escpos[index - 1] === 0x1d), 'define a área imprimível Bematech/ESC-POS');
assert.deepEqual(Array.from(escpos.slice(-7)), [0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00], 'alimenta e corta no fim');

const html = renderCashRegisterReportHtml(input, '80mm');
assert(html.includes('width:72mm'));
assert(html.includes('N/D — movimentações não coletadas') === false);
assert(html.includes('Pizza Grande com nome muito'));
assert(html.includes('longo para quebrar na largura'));

const unavailable = buildCashRegisterReportDocument({
  type: 'close',
  cashRegisterName: 'Caixa sem dados',
  shiftStartedAt: fixture.shiftStartedAt,
  createdAt: fixture.createdAt,
  reportData: { totalPaid: 12 },
}, '80mm');
assert(unavailable.text.includes('N/D — não coletado'));
assert(unavailable.text.includes('N/D — bandeiras não coletadas'));
assert(unavailable.text.includes('N/D — vales não coletados'));
assert(unavailable.text.includes('N/D — movimentações não coletadas'));
assert(!unavailable.text.includes('TOTAL VALES:                         R$ 0,00'), 'não inventa vale zero quando o campo não foi coletado');

console.log('cash register report tests passed');
