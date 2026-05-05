-- ============================================================
-- SIS-PDV-FLOW — Supabase Schema
-- Execute no SQL Editor do Supabase Dashboard
-- ============================================================

create table if not exists tables (
  id integer primary key,
  status text not null default 'free' check (status in ('free', 'occupied', 'bill_requested', 'linked')),
  current_order text,
  linked_to integer
);

create table if not exists comandas (
  id integer primary key,
  status text not null default 'free' check (status in ('free', 'occupied', 'bill_requested', 'linked')),
  current_order text,
  linked_to integer
);

create table if not exists orders (
  id text primary key,
  table_id integer not null,
  items jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending', 'preparing', 'ready', 'finalizada')),
  timestamp text not null,
  waiter_id text,
  waiter_name text,
  observations text,
  is_comanda boolean default false,
  discount numeric,
  discount_type text,
  partial_payments jsonb default '[]',
  payment_log jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists waiters (
  id text primary key,
  socket_id text,
  name text not null,
  password text,
  phone text,
  cpf text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'inactive'))
);

create table if not exists stock (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  quantity numeric not null default 0,
  unit text not null,
  min_quantity numeric default 0
);

create table if not exists menu (
  id text primary key,
  name text not null,
  type text not null,
  items jsonb not null default '[]'
);

create table if not exists config (
  id text primary key default 'app',
  is_cash_register_open boolean default false,
  daily_counter integer default 0,
  last_order_date text default ''
);

-- ============================================================
-- Row Level Security — acesso público (modo teste)
-- ============================================================

alter table tables   enable row level security;
alter table comandas enable row level security;
alter table orders   enable row level security;
alter table waiters  enable row level security;
alter table stock    enable row level security;
alter table menu     enable row level security;
alter table config   enable row level security;

create policy "public_all" on tables   for all using (true) with check (true);
create policy "public_all" on comandas for all using (true) with check (true);
create policy "public_all" on orders   for all using (true) with check (true);
create policy "public_all" on waiters  for all using (true) with check (true);
create policy "public_all" on stock    for all using (true) with check (true);
create policy "public_all" on menu     for all using (true) with check (true);
create policy "public_all" on config   for all using (true) with check (true);

-- ============================================================
-- Realtime — habilitar para todas as tabelas
-- ============================================================

alter publication supabase_realtime add table tables;
alter publication supabase_realtime add table comandas;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table waiters;
alter publication supabase_realtime add table stock;
alter publication supabase_realtime add table menu;
alter publication supabase_realtime add table config;
