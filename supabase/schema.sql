-- ============================================================
-- FechaConta PDV — Schema Supabase (PostgreSQL)
-- Equivalente às coleções Firestore
-- ============================================================

-- Habilita extensão para UUIDs (opcional, usamos IDs próprios)
create extension if not exists "pgcrypto";

-- ── waiters ──────────────────────────────────────────────────
create table if not exists waiters (
  id          text primary key,
  name        text not null,
  cpf         text,
  password    text,
  status      text not null default 'pending', -- pending | active | inactive | rejected
  uid         text,
  created_at  timestamptz not null default now()
);

-- ── tables ───────────────────────────────────────────────────
create table if not exists tables (
  id            integer primary key,
  status        text not null default 'free', -- free | occupied | waiting_payment | aguardando_baixa
  current_order text,
  linked_to     integer
);

-- ── comandas ─────────────────────────────────────────────────
create table if not exists comandas (
  id            integer primary key,
  status        text not null default 'free',
  current_order text,
  linked_to     integer
);

-- ── orders ───────────────────────────────────────────────────
-- items, payment_log e delivery_log são arrays JSON (equivalem aos campos do Firestore)
create table if not exists orders (
  id            text primary key,
  table_id      text,
  waiter_id     text,
  waiter_name   text,
  status        text not null default 'open',  -- open | paid | cancelled
  is_comanda    boolean not null default false,
  timestamp     timestamptz not null default now(),
  items         jsonb not null default '[]',
  payment_log   jsonb not null default '[]',
  delivery_log  jsonb not null default '[]'
);

-- ── menu ─────────────────────────────────────────────────────
-- Cada linha = uma categoria. items é um array de MenuItems em JSON.
create table if not exists menu (
  id            text primary key,  -- nome da categoria
  name          text not null,
  position      integer not null default 0,
  items         jsonb not null default '[]',
  visible       boolean not null default true,
  subcategories jsonb not null default '[]'
);
-- migration: add columns if table already existed
ALTER TABLE menu ADD COLUMN IF NOT EXISTS visible boolean not null default true;
ALTER TABLE menu ADD COLUMN IF NOT EXISTS subcategories jsonb not null default '[]';

-- ── stock ─────────────────────────────────────────────────────
create table if not exists stock (
  id           text primary key,
  menu_item_id text not null,
  name         text,
  quantity     numeric not null default 0,
  min_quantity numeric not null default 0,
  unit         text not null default 'un',
  history      jsonb not null default '[]'
);

-- ── pizza_flavors ─────────────────────────────────────────────
create table if not exists pizza_flavors (
  id        text primary key,
  name      text not null,
  category  text,
  price     numeric,
  available boolean not null default true
);

-- ── pizza_crusts ──────────────────────────────────────────────
create table if not exists pizza_crusts (
  id   text primary key,
  name text not null
);

-- ── config ───────────────────────────────────────────────────
-- id = 'app' | 'pizzaria'
-- data armazena o objeto inteiro em JSON (equivale ao doc do Firestore)
create table if not exists config (
  id   text primary key,
  data jsonb not null default '{}'
);

-- ── Realtime: habilita publicações para as tabelas principais ──
-- Usa DO/EXCEPTION para não falhar se a tabela já estiver na publicação
do $$ begin
  alter publication supabase_realtime add table orders;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table tables;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table comandas;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table waiters;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table menu;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table stock;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table config;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table pizza_flavors;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table pizza_crusts;
exception when others then null; end $$;

-- ── Controle de Presença ─────────────────────────────────────
-- Um token por tenant por dia; colaboradores confirmam via QR
create table if not exists fin_attendance_tokens (
  id         text primary key,
  tenant_id  text not null,
  date       date not null,
  token      text not null unique,
  created_at timestamptz default now(),
  unique(tenant_id, date)
);

-- Registro de presença: cada colaborador confirma uma vez por dia
create table if not exists fin_attendance_records (
  id            text primary key,
  tenant_id     text not null,
  employee_id   text not null,
  employee_name text not null,
  date          date not null,
  confirmed_at  timestamptz default now(),
  token_id      text not null,
  unique(tenant_id, employee_id, date)
);

alter table fin_attendance_tokens  disable row level security;
alter table fin_attendance_records disable row level security;

-- ── RLS (Row Level Security) ──────────────────────────────────
-- Por enquanto desabilitado: o servidor acessa via service_role key (bypass RLS)
-- Habilite e crie políticas quando adicionar auth por tenant
alter table waiters      disable row level security;
alter table tables       disable row level security;
alter table comandas     disable row level security;
alter table orders       disable row level security;
alter table menu         disable row level security;
alter table stock        disable row level security;
alter table pizza_flavors disable row level security;
alter table pizza_crusts  disable row level security;
alter table config        disable row level security;
