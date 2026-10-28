#!/usr/bin/env node
/**
 * BACKUP COMPLETO DO SUPABASE
 *
 * Exporta todos os dados do Supabase para um arquivo JSON local.
 * Rode ANTES de qualquer migração para ter um backup de segurança.
 *
 * Uso:
 *   node docker/export-supabase-backup.js
 *
 * Gera: ./backup-supabase-YYYY-MM-DD.json
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLES = [
  'waiters',
  'orders',
  'tables',
  'comandas',
  'menu',
  'stock',
  'pizza_flavors',
  'pizza_crusts',
  'config',
  'fin_attendance_tokens',
  'fin_attendance_records',
];

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const outFile = path.join(process.cwd(), `backup-supabase-${date}.json`);

  console.log('\n════════════════════════════════════════════');
  console.log('  BACKUP COMPLETO DO SUPABASE');
  console.log('════════════════════════════════════════════');
  console.log(`  Projeto: ${SUPABASE_URL}`);
  console.log(`  Arquivo: ${outFile}`);
  console.log('════════════════════════════════════════════\n');

  const backup = { exportedAt: new Date().toISOString(), supabaseUrl: SUPABASE_URL, tables: {} };

  for (const table of TABLES) {
    process.stdout.write(`  Exportando ${table.padEnd(30)}`);
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw error;
      backup.tables[table] = data || [];
      console.log(`→ ${(data || []).length} registros ✅`);
    } catch (e) {
      backup.tables[table] = [];
      console.log(`→ 0 registros (erro: ${e.message}) ⚠️`);
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(backup, null, 2), 'utf8');

  const size = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`\n  ✅  Backup salvo: ${outFile} (${size} KB)`);
  console.log('  Guarde este arquivo em local seguro antes de migrar!\n');
}

main().catch(e => { console.error('Erro:', e); process.exit(1); });
