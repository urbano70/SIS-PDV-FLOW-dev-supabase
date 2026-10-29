-- SIS-PDV-FLOW — Schema PostgreSQL local
-- Executado automaticamente na criação do container

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  table_id TEXT,
  waiter_id TEXT,
  waiter_name TEXT,
  status TEXT DEFAULT 'open',
  is_comanda BOOLEAN DEFAULT false,
  timestamp TEXT,
  items JSONB DEFAULT '[]',
  payment_log JSONB DEFAULT '[]',
  delivery_log JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  status TEXT DEFAULT 'free',
  current_order TEXT,
  linked_to TEXT
);

CREATE TABLE IF NOT EXISTS comandas (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  status TEXT DEFAULT 'free',
  current_order TEXT,
  linked_to TEXT
);

CREATE TABLE IF NOT EXISTS waiters (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS menu (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT,
  position INTEGER DEFAULT 0,
  type TEXT,
  visible BOOLEAN DEFAULT true,
  items JSONB DEFAULT '[]',
  subcategories JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS stock (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  menu_item_id TEXT,
  name TEXT,
  quantity NUMERIC DEFAULT 0,
  min_quantity NUMERIC DEFAULT 0,
  unit TEXT DEFAULT 'un',
  history JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS config (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pizza_flavors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT,
  category TEXT,
  price NUMERIC,
  available BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS pizza_crusts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table_id ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_stock_menu_item_id ON stock(menu_item_id);
