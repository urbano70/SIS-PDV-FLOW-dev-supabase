-- Adiciona colunas ausentes à fiscal_notes (criada anteriormente fora das migrations)
-- e adiciona intencao_json para renderização do DANFE NFC-e sem join com orders.

ALTER TABLE fiscal_notes
  ADD COLUMN IF NOT EXISTS modelo    TEXT,
  ADD COLUMN IF NOT EXISTS serie     TEXT,
  ADD COLUMN IF NOT EXISTS numero    INTEGER,
  ADD COLUMN IF NOT EXISTS hash_payload TEXT,
  ADD COLUMN IF NOT EXISTS cstat     TEXT,
  ADD COLUMN IF NOT EXISTS xmotivo   TEXT,
  ADD COLUMN IF NOT EXISTS xml_assinado TEXT,
  ADD COLUMN IF NOT EXISTS xml_proc_nfe TEXT,
  ADD COLUMN IF NOT EXISTS cpf_consumidor TEXT,
  -- Snapshot da IntencaoFiscal sem os XMLs (emitente + items + pagamentos + totais)
  -- Usado exclusivamente para renderização do DANFE no browser.
  ADD COLUMN IF NOT EXISTS intencao_json JSONB;

CREATE INDEX IF NOT EXISTS idx_fiscal_notes_chave
  ON fiscal_notes(chave_acesso);
