-- Executar no Supabase SQL Editor

-- ─── Tabela de tenants ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT 'Meu Restaurante',
  plan        TEXT NOT NULL DEFAULT 'free',
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Adicionar tenant_id nas tabelas existentes ───────────────────────────────
ALTER TABLE tables        ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE comandas      ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE orders        ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE menu          ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE stock         ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE waiters       ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE pizza_flavors ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE pizza_crusts  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE config        ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;

-- ─── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tables_tenant        ON tables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_comandas_tenant      ON comandas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant        ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_menu_tenant          ON menu(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_tenant         ON stock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_waiters_tenant       ON waiters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pizza_flavors_tenant ON pizza_flavors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pizza_crusts_tenant  ON pizza_crusts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_config_tenant        ON config(tenant_id);

-- ─── Unique constraint para config ───────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE config ADD CONSTRAINT config_name_tenant_unique UNIQUE (id, tenant_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- Migrar dados existentes (se houver) para tenant padrão
-- UPDATE tables SET tenant_id = 'tenant_demo' WHERE tenant_id IS NULL;
-- etc. (usuário precisa rodar manualmente com o seu tenant_id real)
