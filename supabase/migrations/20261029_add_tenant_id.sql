-- Multi-tenant isolation: add tenant_id to all tables
-- Existing rows get DEFAULT 'default' to preserve data

ALTER TABLE orders         ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE tables         ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE comandas       ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE waiters        ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE menu           ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE stock          ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE config         ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE pizza_flavors  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE pizza_crusts   ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_orders_tenant    ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tables_tenant    ON tables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_comandas_tenant  ON comandas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_waiters_tenant   ON waiters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_menu_tenant      ON menu(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_tenant     ON stock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_config_tenant    ON config(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pizza_flavors_tenant ON pizza_flavors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pizza_crusts_tenant  ON pizza_crusts(tenant_id);
