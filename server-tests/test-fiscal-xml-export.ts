import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import {
  buildFiscalXmlZip,
  fiscalMonthWindow,
  selectMonthlyFiscalExport,
  validateFiscalXmlEmailRequest,
} from '../src/lib/fiscal/xml-export.ts';

const key = (digit: string) => digit.repeat(44);

const notes = [
  {
    id: 'note-november', tenant_id: 'tenant-a', chave_acesso: key('1'), modelo: '65', ambiente: 'homologacao', status: 'AUTORIZADO',
    autorizado_em: '2026-11-30T23:30:00-04:00', xml_proc_nfe: '<nfeProc id="nov">', xml_assinado: null,
  },
  {
    id: 'note-october-cancelled', tenant_id: 'tenant-a', chave_acesso: key('2'), modelo: '65', ambiente: 'producao', status: 'CANCELADO',
    autorizado_em: '2026-10-31T23:30:00-04:00', xml_proc_nfe: '<nfeProc id="oct">', xml_assinado: null,
  },
  {
    id: 'note-without-xml', tenant_id: 'tenant-a', chave_acesso: key('3'), modelo: '55', ambiente: 'homologacao', status: 'AUTORIZADO',
    autorizado_em: '2026-11-04T12:00:00Z', xml_proc_nfe: null, xml_assinado: null,
  },
  {
    id: 'other-tenant', tenant_id: 'tenant-b', chave_acesso: key('4'), modelo: '65', ambiente: 'producao', status: 'AUTORIZADO',
    autorizado_em: '2026-11-05T12:00:00Z', xml_proc_nfe: '<nfeProc id="other">', xml_assinado: null,
  },
];

const events = [{
  id: 'cancel-event-1', tenant_id: 'tenant-a', fiscal_note_id: 'note-october-cancelled',
  chave_acesso: key('2'), tp_evento: '110111', status: 'REGISTRADO', protocolo: '1350001',
  dh_evento: '2026-11-01T05:00:00Z', xml_evento: '<evento id="cancelamento-real">',
}, {
  id: 'legacy-event-1', tenant_id: 'tenant-a', fiscal_note_id: 'note-november',
  chave_acesso: key('1'), tp_evento: '110999', status: 'REGISTRADO', protocolo: '1350002',
  dh_evento: null, created_at: '2026-11-15T12:00:00Z', xml_evento: '<evento id="legado-sem-data">',
}];

const window = fiscalMonthWindow(2026, 11);
assert.equal(window.start.toISOString(), '2026-11-01T04:00:00.000Z');
assert.equal(window.end.toISOString(), '2026-12-01T04:00:00.000Z');

// A cancellation in November keeps the authorized October document in the November package.
const selection = selectMonthlyFiscalExport(notes.filter((note) => note.tenant_id === 'tenant-a'), events, 2026, 11);
assert.deepEqual(selection.notes.map((note) => note.id), ['note-november', 'note-october-cancelled', 'note-without-xml']);
assert.equal(selection.events.length, 2);

const output = buildFiscalXmlZip(selection);
const files = unzipSync(output.bytes);
assert.equal(strFromU8(files['documentos/homologacao-65-' + key('1') + '-procNFe.xml']), '<nfeProc id="nov">');
assert.equal(strFromU8(files['documentos/producao-65-' + key('2') + '-procNFe.xml']), '<nfeProc id="oct">');
assert.equal(strFromU8(files['eventos/' + key('2') + '-110111-cancel-event-1.xml']), '<evento id="cancelamento-real">');
assert.equal(strFromU8(files['eventos/' + key('1') + '-110999-legacy-event-1.xml']), '<evento id="legado-sem-data">');
assert.equal(output.missing.length, 1);
assert.match(strFromU8(files['manifesto-ausencias.json']), /33333333333333333333333333333333333333333333/);
assert.equal(files['documentos/homologacao-55-' + key('3') + '-NFe.xml'], undefined);

assert.deepEqual(validateFiscalXmlEmailRequest({ year: '2026', month: '11', recipient: 'contador@example.com' }), {
  year: 2026, month: 11, recipient: 'contador@example.com',
});
assert.throws(() => validateFiscalXmlEmailRequest({ year: 2026, month: 13, recipient: 'contador@example.com' }), /Mês fiscal inválido/);
assert.throws(() => validateFiscalXmlEmailRequest({ year: 2026, month: 11, recipient: 'not-an-email' }), /e-mail/);

// Contract checks for the fake-provider path: no client attachment or tenant is accepted by the function.
const edgeSource = fs.readFileSync(new URL('../supabase/functions/fiscal-xml-email/index.ts', import.meta.url), 'utf8');
assert.match(edgeSource, /withSupabase\(\{ auth: 'user' \}/);
assert.match(edgeSource, /\.eq\('tenant_id', tenantId\)/);
assert.match(edgeSource, /attachments: \[\{ filename: zipName, content: bytesToBase64\(zip\) \}\]/);
assert.match(edgeSource, /RESEND_API_KEY/);
assert.match(edgeSource, /RESEND_FROM/);
assert.match(edgeSource, /if \(!apiKey \|\| !from\)/);
assert.doesNotMatch(edgeSource, /body\.(zip|attachment|base64)/);

console.log('fiscal XML export tests: ok');
