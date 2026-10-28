#!/usr/bin/env node
/**
 * SCRIPT DE MIGRAÇÃO — Supabase → PostgreSQL Local
 *
 * Exporta TODOS os dados do Supabase atual e importa para o
 * PostgreSQL local do container Docker.
 *
 * Uso:
 *   node docker/migrate-from-supabase.js
 *
 * Variáveis de ambiente necessárias:
 *   SUPABASE_URL            — URL do projeto Supabase de origem
 *   SUPABASE_SERVICE_ROLE_KEY — chave service_role do Supabase
 *   DATABASE_URL            — URL do PostgreSQL local de destino
 *                             ex: postgresql://pdv:senha@localhost:5432/pdv
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { Pool }         = require('pg');

// ─── Validar variáveis ────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL      = process.env.DATABASE_URL || 'postgresql://pdv:pdv123@localhost:5432/pdv';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const pool     = new Pool({ connectionString: DATABASE_URL });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const log  = (msg)         => console.log(`\n▶  ${msg}`);
const ok   = (msg)         => console.log(`   ✅  ${msg}`);
const warn = (msg)         => console.log(`   ⚠️   ${msg}`);
const err  = (msg, e)      => console.error(`   ❌  ${msg}`, e?.message || e);

async function fetchAll(table, query = '*') {
  const { data, error } = await supabase.from(table).select(query);
  if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  return data || [];
}

async function upsertLocal(table, id, data) {
  const { id: _id, ...rest } = data;
  await pool.query(
    `INSERT INTO ${table} (id, data)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [String(id), rest]
  );
}

// ─── Migrar cada tabela ───────────────────────────────────────────────────────

async function migrateWaiters() {
  log('Garçons (waiters)');
  const rows = await fetchAll('waiters');
  if (!rows.length) { warn('Nenhum garçom encontrado.'); return; }
  for (const r of rows) {
    await upsertLocal('waiters', r.id, r);
  }
  ok(`${rows.length} garçon(s) migrado(s).`);
}

async function migrateOrders() {
  log('Pedidos (orders)');
  const rows = await fetchAll('orders');
  if (!rows.length) { warn('Nenhum pedido encontrado.'); return; }
  for (const r of rows) {
    await upsertLocal('orders', r.id, r);
  }
  ok(`${rows.length} pedido(s) migrado(s).`);
}

async function migrateTables() {
  log('Mesas (tables)');
  const rows = await fetchAll('tables');
  if (!rows.length) { warn('Nenhuma mesa encontrada — usando padrão (40 mesas livres).'); return; }
  for (const r of rows) {
    await upsertLocal('tables', r.id, r);
  }
  ok(`${rows.length} mesa(s) migrada(s).`);
}

async function migrateComandas() {
  log('Comandas');
  const rows = await fetchAll('comandas');
  if (!rows.length) { warn('Nenhuma comanda encontrada — usando padrão (50 comandas livres).'); return; }
  for (const r of rows) {
    await upsertLocal('comandas', r.id, r);
  }
  ok(`${rows.length} comanda(s) migrada(s).`);
}

async function migrateMenu() {
  log('Cardápio (menu)');
  const rows = await fetchAll('menu');
  if (!rows.length) { warn('Nenhuma categoria no cardápio.'); return; }
  for (const r of rows) {
    await upsertLocal('menu', r.id || r.name, r);
  }
  ok(`${rows.length} categoria(s) do cardápio migrada(s).`);
}

async function migrateStock() {
  log('Estoque (stock)');
  const rows = await fetchAll('stock');
  if (!rows.length) { warn('Nenhum item de estoque encontrado.'); return; }
  for (const r of rows) {
    await upsertLocal('stock', r.id, r);
  }
  ok(`${rows.length} item(ns) de estoque migrado(s).`);
}

async function migratePizzaFlavors() {
  log('Sabores de pizza (pizza_flavors)');
  const rows = await fetchAll('pizza_flavors');
  if (!rows.length) { warn('Nenhum sabor encontrado.'); return; }
  for (const r of rows) {
    await upsertLocal('pizza_flavors', r.id || r.name, r);
  }
  ok(`${rows.length} sabor(es) migrado(s).`);
}

async function migratePizzaCrusts() {
  log('Bordas de pizza (pizza_crusts)');
  const rows = await fetchAll('pizza_crusts');
  if (!rows.length) { warn('Nenhuma borda encontrada.'); return; }
  for (const r of rows) {
    await upsertLocal('pizza_crusts', r.id || r.name, r);
  }
  ok(`${rows.length} borda(s) migrada(s).`);
}

async function migrateConfig() {
  log('Configurações (config)');
  const rows = await fetchAll('config');
  if (!rows.length) { warn('Nenhuma configuração encontrada.'); return; }
  for (const r of rows) {
    await upsertLocal('config', r.id, r);
  }
  ok(`${rows.length} configuração(ões) migrada(s).`);
}

async function migrateFinAttendance() {
  log('Presença — tokens (fin_attendance_tokens)');
  try {
    const rows = await fetchAll('fin_attendance_tokens');
    for (const r of rows) await upsertLocal('fin_attendance_tokens', r.id, r);
    ok(`${rows.length} registro(s) migrado(s).`);
  } catch (e) { warn(`Tabela não encontrada ou vazia — pulando. (${e.message})`); }

  log('Presença — registros (fin_attendance_records)');
  try {
    const rows = await fetchAll('fin_attendance_records');
    for (const r of rows) await upsertLocal('fin_attendance_records', r.id, r);
    ok(`${rows.length} registro(s) migrado(s).`);
  } catch (e) { warn(`Tabela não encontrada ou vazia — pulando. (${e.message})`); }
}

// ─── Verificação pós-migração ────────────────────────────────────────────────
async function verify() {
  log('Verificação do banco destino');
  const tables = [
    'waiters','orders','tables','comandas','menu',
    'stock','pizza_flavors','pizza_crusts','config',
    'fin_attendance_tokens','fin_attendance_records'
  ];
  for (const t of tables) {
    const res = await pool.query(`SELECT COUNT(*) FROM ${t}`);
    console.log(`   ${t.padEnd(30)} → ${res.rows[0].count} registros`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('  MIGRAÇÃO: Supabase → PostgreSQL Local');
  console.log('════════════════════════════════════════════════════');
  console.log(`  Origem:  ${SUPABASE_URL}`);
  console.log(`  Destino: ${DATABASE_URL}`);
  console.log('════════════════════════════════════════════════════\n');

  try {
    // Testar conexão com destino
    await pool.query('SELECT 1');
    ok('Conexão com PostgreSQL local estabelecida.');

    await migrateWaiters();
    await migrateMenu();        // menu antes dos pedidos (dependência de tipo)
    await migrateOrders();
    await migrateTables();
    await migrateComandas();
    await migrateStock();
    await migratePizzaFlavors();
    await migratePizzaCrusts();
    await migrateConfig();
    await migrateFinAttendance();

    await verify();

    console.log('\n════════════════════════════════════════════════════');
    console.log('  ✅  Migração concluída com sucesso!');
    console.log('  Os dados do Supabase foram copiados para o');
    console.log('  PostgreSQL local. O sistema original não foi');
    console.log('  alterado — os dados do Supabase continuam lá');
    console.log('  como backup.');
    console.log('════════════════════════════════════════════════════\n');

  } catch (e) {
    err('Erro durante a migração:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
