import assert from 'node:assert/strict';
import { authorizationDateFromResult } from '../src/lib/fiscal/authorization-date.ts';

const sefazDate = '2026-10-31T23:55:10-04:00';

assert.equal(
  authorizationDateFromResult({ status: 'AUTORIZADO', dhRecbto: sefazDate }),
  sefazDate,
);
assert.equal(
  authorizationDateFromResult({ status: 'AUTORIZADO_COM_ALERTA', dhRecbto: sefazDate }),
  sefazDate,
);
// A reconsulta de uma nota antiga nunca substitui a data fiscal já persistida.
assert.equal(
  authorizationDateFromResult(
    { status: 'AUTORIZADO', dhRecbto: '2026-11-23T12:00:00-04:00' },
    sefazDate,
  ),
  undefined,
);
// Contingência pendente não é autorização SEFAZ e não recebe now fabricado.
assert.equal(
  authorizationDateFromResult({ status: 'CONTINGENCIA_PENDENTE_TRANSMISSAO', dhRecbto: sefazDate }),
  undefined,
);
assert.equal(
  authorizationDateFromResult({ status: 'AUTORIZADO', dhRecbto: '' }),
  undefined,
);

console.log('fiscal authorization date tests: ok');
