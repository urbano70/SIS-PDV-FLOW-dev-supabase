-- Migration: tabela fiscal_series e função fiscal_series_next
-- Garante numeração sequencial sem colisão em múltiplos containers/instâncias.
-- Executar no Supabase após migration-fiscal-notes.sql

CREATE TABLE IF NOT EXISTS fiscal_series (
  id          TEXT PRIMARY KEY,   -- "${tenantId}:${modelo}:${serie}:${ambiente}"
  tenant_id   TEXT NOT NULL,
  modelo      TEXT NOT NULL,
  serie       TEXT NOT NULL,
  ambiente    TEXT NOT NULL,
  ultimo_numero INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE fiscal_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY fiscal_series_tenant_isolation ON fiscal_series
  USING (tenant_id = current_setting('app.tenant_id', true));

-- Função atômica: upsert + incremento. Retorna o próximo número reservado.
CREATE OR REPLACE FUNCTION fiscal_series_next(
  p_id        TEXT,
  p_tenant_id TEXT,
  p_modelo    TEXT,
  p_serie     TEXT,
  p_ambiente  TEXT
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO fiscal_series (id, tenant_id, modelo, serie, ambiente, ultimo_numero, updated_at)
    VALUES (p_id, p_tenant_id, p_modelo, p_serie, p_ambiente, 1, NOW())
  ON CONFLICT (id) DO UPDATE
    SET ultimo_numero = fiscal_series.ultimo_numero + 1,
        updated_at = NOW()
  RETURNING ultimo_numero INTO v_numero;
  RETURN v_numero;
END;
$$;

-- Índice auxiliar para listagem por tenant
CREATE INDEX IF NOT EXISTS fiscal_series_tenant ON fiscal_series (tenant_id);
