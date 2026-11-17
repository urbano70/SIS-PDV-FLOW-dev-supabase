#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { loadTsModule } = require('./testsHelpers.cjs');

const {
  closeCashRegisterState,
  getOpenCashRegisterNames,
  hasLogicalOpenCashRegisters,
  openCashRegisterState,
  releaseCashRegisterClaims,
  restoreOpenCashRegisterOwners,
} = loadTsModule('src/server/cash-register-state.ts', 'cash-register-state');

const state = (overrides = {}) => ({
  isCashRegisterOpen: false,
  shiftStartedAt: '2026-11-15T23:00:00.000Z',
  openCashRegisters: {},
  ...overrides,
});

const open = (current, name, socketId, now) => openCashRegisterState(current, {
  cashRegisterName: name,
  socketId,
  now,
});

async function main() {
  // Two named registers share one shift; closing A leaves B globally open.
  let current = open(state(), 'Caixa A', 'socket-a', '2026-11-16T01:00:00.000Z');
  const shift = current.shiftStartedAt;
  current = open(current, 'Caixa B', 'socket-b', '2026-11-16T02:00:00.000Z');
  assert.equal(current.shiftStartedAt, shift, 'abrir o segundo caixa não reseta o turno');
  current = closeCashRegisterState(current, { cashRegisterName: 'Caixa A' });
  assert.equal(current.isCashRegisterOpen, true, 'fechar A mantém B aberto');
  assert.deepEqual(getOpenCashRegisterNames(current.openCashRegisters), ['Caixa B']);

  // Logout/disconnect releases ownership but does not logically close the register.
  current = { ...current, openCashRegisters: releaseCashRegisterClaims(current.openCashRegisters, 'socket-b') };
  assert.deepEqual(current.openCashRegisters, { 'Caixa B': '' });
  assert.equal(current.isCashRegisterOpen, true, 'desconexão não fecha o caixa lógico');

  // A persisted open name from yesterday remains the exact shift marker overnight.
  const yesterday = '2026-11-15T23:30:00.000Z';
  let overnight = state({
    isCashRegisterOpen: true,
    shiftStartedAt: yesterday,
    openCashRegisters: restoreOpenCashRegisterOwners(['Caixa B']),
  });
  overnight = open(overnight, 'Caixa C', 'socket-c', '2026-11-16T23:45:00.000Z');
  assert.equal(overnight.shiftStartedAt, yesterday, 'caixa adicional no dia seguinte preserva o mesmo turno');

  // Closing the last logical name makes the tenant globally closed.
  overnight = closeCashRegisterState(overnight, { cashRegisterName: 'Caixa B' });
  overnight = closeCashRegisterState(overnight, { cashRegisterName: 'Caixa C' });
  assert.equal(overnight.isCashRegisterOpen, false, 'fechar o último caixa fecha globalmente');

  // The next real open starts a new UTC shift.
  const next = open(overnight, 'Caixa D', 'socket-d', '2026-11-17T00:05:00.000Z');
  assert.equal(next.shiftStartedAt, '2026-11-17T00:05:00.000Z');

  // Restart restores names without an active claim; reclaiming does not reset the shift.
  const restored = state({
    isCashRegisterOpen: true,
    shiftStartedAt: yesterday,
    openCashRegisters: restoreOpenCashRegisterOwners(['Caixa D', 'Caixa E']),
  });
  assert.deepEqual(restored.openCashRegisters, { 'Caixa D': '', 'Caixa E': '' });
  const reclaimed = open(restored, 'Caixa D', 'new-socket', '2026-11-17T09:00:00.000Z');
  assert.equal(reclaimed.shiftStartedAt, yesterday);
  assert.equal(reclaimed.openCashRegisters['Caixa D'], 'new-socket');
  assert.equal(reclaimed.openCashRegisters['Caixa E'], '');

  // Legacy unnamed state keeps the global boolean and starts normally only when closed.
  const legacyOpen = open(state({ isCashRegisterOpen: true, shiftStartedAt: yesterday }), 'Caixa A', 'socket-a', '2026-11-16T10:00:00.000Z');
  assert.equal(legacyOpen.shiftStartedAt, yesterday);
  const legacyClosed = closeCashRegisterState(state({ isCashRegisterOpen: true, shiftStartedAt: yesterday }), { socketId: 'legacy-socket' });
  assert.equal(legacyClosed.isCashRegisterOpen, false);
  assert.equal(hasLogicalOpenCashRegisters(legacyClosed.isCashRegisterOpen, legacyClosed.openCashRegisters), false);
  const unnamedNamedClose = closeCashRegisterState(state({
    isCashRegisterOpen: true,
    openCashRegisters: { 'Caixa legado': 'legacy-socket' },
  }), { socketId: 'legacy-socket' });
  assert.equal(unnamedNamedClose.isCashRegisterOpen, false, 'fechamento legado remove o nome que o socket possui');

  console.log('cash register state tests passed');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
