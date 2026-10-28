-- ============================================================
-- SIS-PDV — Schema PostgreSQL local (sem Supabase cloud)
-- Executado automaticamente ao criar o container PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── waiters ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waiters (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  cpf        TEXT,
  password   TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',
  uid        TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── tables ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tables (
  id            INTEGER PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'free',
  current_order TEXT,
  linked_to     INTEGER
);

-- ── comandas ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comandas (
  id            INTEGER PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'free',
  current_order TEXT,
  linked_to     INTEGER
);

-- ── orders ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  table_id     TEXT,
  waiter_id    TEXT,
  waiter_name  TEXT,
  status       TEXT NOT NULL DEFAULT 'open',
  is_comanda   BOOLEAN NOT NULL DEFAULT false,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now(),
  items        JSONB NOT NULL DEFAULT '[]',
  payment_log  JSONB NOT NULL DEFAULT '[]',
  delivery_log JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_timestamp ON orders(timestamp);
CREATE INDEX IF NOT EXISTS idx_orders_table_id  ON orders(table_id);

-- ── menu ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  items         JSONB NOT NULL DEFAULT '[]',
  visible       BOOLEAN NOT NULL DEFAULT true,
  subcategories JSONB NOT NULL DEFAULT '[]',
  type          TEXT
);

-- ── stock ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock (
  id           TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL,
  name         TEXT,
  quantity     NUMERIC NOT NULL DEFAULT 0,
  min_quantity NUMERIC NOT NULL DEFAULT 0,
  unit         TEXT NOT NULL DEFAULT 'un',
  history      JSONB NOT NULL DEFAULT '[]'
);

-- ── pizza_flavors ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pizza_flavors (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  category  TEXT,
  price     NUMERIC,
  available BOOLEAN NOT NULL DEFAULT true
);

-- ── pizza_crusts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pizza_crusts (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- ── config ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'
);

-- ── fin_attendance_tokens ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_attendance_tokens (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL DEFAULT 'local',
  date       DATE NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, date)
);

-- ── fin_attendance_records ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_attendance_records (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'local',
  employee_id   TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  date          DATE NOT NULL,
  confirmed_at  TIMESTAMPTZ DEFAULT now(),
  token_id      TEXT NOT NULL,
  UNIQUE(tenant_id, employee_id, date)
);

-- ── fin_employees ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_employees (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}'
);

-- ── fin_payments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_payments (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'
);

-- ── fin_expenses ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_expenses (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'
);
