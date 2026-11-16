#!/usr/bin/env node
/*
 * Local-only runner for test-tenant-scoped-primary-keys.sql.
 *
 * It deliberately uses an in-memory Postgres-WASM database and never reads
 * DATABASE_URL, Supabase credentials, or any application environment.
 * Install the fallback dependency outside this repository:
 *   mkdir -p /home/ubuntu/pdv-estabilidade/sql-engine
 *   cd /home/ubuntu/pdv-estabilidade/sql-engine
 *   npm init -y
 *   npm install --no-audit --no-fund @electric-sql/pglite
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const fixturePath = resolve(repoRoot, 'scripts/test-tenant-scoped-primary-keys.sql');
const migrationPath = resolve(repoRoot, 'supabase/migrations/20261116_tenant_scoped_primary_keys.sql');
const pgliteEntry = process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite';

const { PGlite } = await import(pgliteEntry);
const fixture = await readFile(fixturePath, 'utf8');
const migration = await readFile(migrationPath, 'utf8');

// psql directives are intentionally limited to \set, \ir, and \echo in the
// fixture. Split at \ir so each migration attempt can be caught independently.
const chunks = [];
let sql = '';
for (const line of fixture.split(/\r?\n/)) {
  const include = line.match(/^\\ir\s+(.+)\s*$/);
  if (include) {
    chunks.push({ kind: 'sql', sql });
    chunks.push({ kind: 'migration', path: include[1] });
    sql = '';
  } else if (!/^\\(?:set|echo)\b/.test(line)) {
    sql += `${line}\n`;
  }
}
chunks.push({ kind: 'sql', sql });

const db = new PGlite('memory://tenant-scoped-primary-key-test');
let migrationAttempt = 0;
let expectedFailures = 0;
try {
  for (const chunk of chunks) {
    if (chunk.kind === 'sql') {
      if (chunk.sql.trim()) await db.exec(chunk.sql);
      continue;
    }

    migrationAttempt += 1;
    try {
      await db.exec(migration);
    } catch (error) {
      if (migrationAttempt > 2) throw error;
      expectedFailures += 1;
      console.log(`Expected rollback ${migrationAttempt}: ${error.message.split('\n')[0]}`);
      // An error inside the migration's explicit transaction leaves it
      // aborted. Roll it back before the fixture checks the preserved state.
      try {
        await db.exec('ROLLBACK');
      } catch {
        // PGlite may already have rolled back the failed multi-statement call.
      }
    }
  }

  if (migrationAttempt !== 4 || expectedFailures !== 2) {
    throw new Error(`Unexpected migration-attempt count: attempts=${migrationAttempt}, expectedFailures=${expectedFailures}`);
  }

  const result = await db.query(`
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      con.conname AS constraint_name,
      pg_catalog.pg_get_constraintdef(con.oid) AS constraint_definition
    FROM pg_catalog.pg_constraint AS con
    JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('orders', 'tables', 'comandas')
      AND con.contype = 'p'
    ORDER BY c.relname
  `);

  const expected = [
    ['comandas', 'comandas_pkey', 'PRIMARY KEY (tenant_id, id)'],
    ['orders', 'orders_pkey', 'PRIMARY KEY (tenant_id, id)'],
    ['tables', 'tables_pkey', 'PRIMARY KEY (tenant_id, id)'],
  ];
  const actual = result.rows.map((row) => [row.table_name, row.constraint_name, row.constraint_definition]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected final PK state: ${JSON.stringify(actual)}`);
  }

  const coexistence = await db.query(`
    SELECT
      (SELECT count(*) FROM public.orders) AS orders_count,
      (SELECT count(*) FROM public.tables) AS tables_count,
      (SELECT count(*) FROM public.comandas) AS comandas_count,
      (SELECT count(*) FROM public.orders WHERE id = '100' AND tenant_id IN ('tenant_a', 'tenant_b')) AS shared_order_ids,
      (SELECT count(*) FROM public.tables WHERE id = 16 AND tenant_id IN ('tenant_a', 'tenant_b')) AS shared_table_ids,
      (SELECT count(*) FROM public.comandas WHERE id = 16 AND tenant_id IN ('tenant_a', 'tenant_b')) AS shared_comanda_ids
  `);
  const row = coexistence.rows[0];
  const counts = [row.orders_count, row.tables_count, row.comandas_count, row.shared_order_ids, row.shared_table_ids, row.shared_comanda_ids].map(Number);
  if (JSON.stringify(counts) !== JSON.stringify([2, 2, 2, 2, 2, 2])) {
    throw new Error(`Tenant coexistence/data-preservation assertion failed: ${JSON.stringify(counts)}`);
  }

  console.log('Final PK verification:');
  for (const row of result.rows) {
    console.log(`  ${row.schema_name}.${row.table_name}: ${row.constraint_name} ${row.constraint_definition}`);
  }
  console.log('PASS: tenant-scoped primary-key migration, rollback guards, data preservation, duplicate ids, and idempotence');
} finally {
  await db.close();
}
