-- Fila durável para NFC-e emitidas em contingência offline (tpEmis='9')
-- Garante transmissão após restauração da conectividade com SEFAZ-MT.
-- Backoff exponencial: tentativas 0→1min, 1→2min, 2→4min ... máx 60min.

CREATE TABLE IF NOT EXISTS fiscal_contingencia_queue (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT        NOT NULL,
  -- Snapshot completo da IntencaoFiscal: inclui xmlAssinado, chaveAcesso, numero, serie, dhCont...
  intencao_json         JSONB       NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE','TRANSMITINDO','AUTORIZADO','REJEITADO','FALHA_PERMANENTE')),
  tentativas            INTEGER     NOT NULL DEFAULT 0,
  max_tentativas        INTEGER     NOT NULL DEFAULT 5,
  -- NULL = disponível imediatamente; futuro = aguardando backoff
  proxima_tentativa_em  TIMESTAMPTZ,
  -- Prazo máximo para transmissão (7 dias = janela cancelamento por substituição)
  prazo_transmissao_em  TIMESTAMPTZ,
  protocolo             TEXT,
  cstat                 TEXT,
  xmotivo               TEXT,
  erro                  TEXT,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fcq_tenant_status
  ON fiscal_contingencia_queue(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_fcq_proxima_tentativa
  ON fiscal_contingencia_queue(proxima_tentativa_em)
  WHERE status = 'PENDENTE';

-- ── Dequeue atômico ──────────────────────────────────────────────────────────
-- Marca até p_limit itens como TRANSMITINDO e os retorna, evitando
-- processamento duplo entre containers (FOR UPDATE SKIP LOCKED).
CREATE OR REPLACE FUNCTION fiscal_contingencia_dequeue(
  p_tenant_id TEXT,
  p_limit     INT DEFAULT 1
)
RETURNS SETOF fiscal_contingencia_queue
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE fiscal_contingencia_queue
  SET
    status        = 'TRANSMITINDO',
    atualizado_em = now()
  WHERE id IN (
    SELECT id
    FROM fiscal_contingencia_queue
    WHERE tenant_id = p_tenant_id
      AND status    = 'PENDENTE'
      AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em <= now())
      AND (prazo_transmissao_em IS NULL OR prazo_transmissao_em  > now())
    ORDER BY criado_em
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE fiscal_contingencia_queue ENABLE ROW LEVEL SECURITY;

-- Acesso somente via service_role (backend fiscal)
CREATE POLICY fiscal_contingencia_queue_service_only
  ON fiscal_contingencia_queue
  USING (auth.role() = 'service_role');
