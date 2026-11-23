import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FiscalExportPaginationLimitError, readTenantRows } from '../src/lib/fiscal/pagination.ts';

const root = new URL('..', import.meta.url);
const serverSource = fs.readFileSync(new URL('server.ts', root), 'utf8');
const edgeSource = fs.readFileSync(new URL('supabase/functions/fiscal-xml-email/index.ts', root), 'utf8');
const supabaseConfig = fs.readFileSync(new URL('supabase/config.toml', root), 'utf8');

// The live fiscal_notes schema has no dh_recbto; neither explicit export SELECT may request it.
assert.doesNotMatch(serverSource, /select\('id,chave_acesso,xml_assinado,xml_proc_nfe,modelo,ambiente,status,autorizado_em,dh_recbto,created_at'\)/);
assert.doesNotMatch(edgeSource, /'id,chave_acesso,xml_assinado,xml_proc_nfe,modelo,ambiente,status,autorizado_em,dh_recbto,created_at'/);

const exactRows = Array.from({ length: 10_000 }, (_, id) => ({ id }));
let exactProbeOffset = -1;
const exactResult = await readTenantRows({
  resource: 'fiscal_notes',
  fetchPage: async (from, to) => exactRows.slice(from, to + 1),
  hasAdditionalRow: async (offset) => {
    exactProbeOffset = offset;
    return false;
  },
});
assert.equal(exactResult.length, 10_000);
assert.equal(exactProbeOffset, 10_000, 'teto exato deve sondar a linha seguinte');

let truncatedProbeOffset = -1;
await assert.rejects(
  () => readTenantRows({
    resource: 'fiscal_note_events',
    fetchPage: async (from, to) => Array.from({ length: Math.min(to + 1, 10_001) - from }, (_, index) => ({ id: from + index })),
    hasAdditionalRow: async (offset) => {
      truncatedProbeOffset = offset;
      return true;
    },
  }),
  (error: unknown) => error instanceof FiscalExportPaginationLimitError
    && /excede o limite seguro de 10000/.test(error.message)
    && /nenhum arquivo foi gerado/.test(error.message),
);
assert.equal(truncatedProbeOffset, 10_000);

// The function keeps an application-level fallback, while the cached SDK owns the outer CORS/auth boundary.
assert.match(edgeSource, /if \(request\.method === 'OPTIONS'\) return new Response\('ok', \{ headers: corsHeaders \}\)/);
assert.match(edgeSource, /headers: \{ \.\.\.corsHeaders, 'Content-Type': 'application\/json; charset=utf-8' \}/);
assert.match(edgeSource, /withSupabase\(\{ auth: 'user' \}/);
assert.match(supabaseConfig, /verify_jwt\s*=\s*true/);

console.log('fiscal XML boundary tests: ok');
