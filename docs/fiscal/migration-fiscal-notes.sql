-- Migration: tabela fiscal_notes para emissão direta SEFAZ-MT
-- Executar no Supabase antes de habilitar emissão em qualquer ambiente.
-- Esta migration é compatível com dados legados da integração DotCompany.

CREATE TABLE IF NOT EXISTS fiscal_notes (
  id                TEXT PRIMARY KEY,          -- UUID da intenção fiscal
  tenant_id         TEXT NOT NULL,
  order_id          TEXT,
  modelo            TEXT DEFAULT '65',         -- '55' NF-e | '65' NFC-e
  serie             TEXT,
  numero            INTEGER,
  ambiente          TEXT NOT NULL DEFAULT 'homologacao',
  status            TEXT NOT NULL DEFAULT 'RASCUNHO',
  chave_acesso      TEXT,
  protocolo         TEXT,
  cstat             TEXT,
  xmotivo           TEXT,
  qr_code           TEXT,
  url_danfe         TEXT,                      -- mantido para compatibilidade legada
  xml_assinado      TEXT,
  xml_proc_nfe      TEXT,
  hash_payload      TEXT,
  total             NUMERIC(10,2),
  cpf_consumidor    TEXT,
  error_detail      TEXT,
  nota_id           INTEGER,                   -- id legado DotCompany — mantido para auditoria
  idempotency_key   TEXT,                      -- legado DotCompany
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir unicidade de número por estabelecimento/modelo/série/ambiente
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_notes_numero_uniq
  ON fiscal_notes (tenant_id, modelo, serie, ambiente, numero)
  WHERE numero IS NOT NULL;

-- Índices operacionais
CREATE INDEX IF NOT EXISTS fiscal_notes_tenant_order  ON fiscal_notes (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS fiscal_notes_chave         ON fiscal_notes (chave_acesso);
CREATE INDEX IF NOT EXISTS fiscal_notes_status        ON fiscal_notes (tenant_id, status);

-- RLS: cada tenant acessa apenas seus próprios documentos
ALTER TABLE fiscal_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY fiscal_notes_tenant_isolation ON fiscal_notes
  USING (tenant_id = current_setting('app.tenant_id', true));

-- Colunas adicionadas em relação ao schema legado (rodar se a tabela já existir)
-- ALTER TABLE fiscal_notes ADD COLUMN IF NOT EXISTS modelo TEXT DEFAULT '65';
-- ALTER TABLE fiscal_notes ADD COLUMN IF NOT EXISTS serie TEXT;
-- ALTER TABLE fiscal_notes ADD COLUMN IF NOT EXISTS numero INTEGER;
-- ALTER TABLE fiscal_notes ADD COLUMN IF NOT EXISTS hash_payload TEXT;
-- ALTER TABLE fiscal_notes ADD COLUMN IF NOT EXISTS xml_assinado TEXT;
-- ALTER TABLE fiscal_notes ADD COLUMN IF NOT EXISTS xml_proc_nfe TEXT;
-- ALTER TABLE fiscal_notes ADD COLUMN IF NOT EXISTS cstat TEXT;
-- ALTER TABLE fiscal_notes ADD COLUMN IF NOT EXISTS xmotivo TEXT;
