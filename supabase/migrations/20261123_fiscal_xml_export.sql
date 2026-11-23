-- Exportação fiscal mensal: preserva a data fiscal e o evento de cancelamento separado
-- do XML autorizado. Aplicar manualmente no Supabase antes de publicar a função.
BEGIN;

ALTER TABLE fiscal_notes
  ADD COLUMN IF NOT EXISTS autorizado_em TIMESTAMPTZ;

-- Registros antigos permanecem sem uma data de autorização fabricada.
-- O exportador usa created_at como fallback quando não há data oficial armazenada.
-- Isso permite que a reconciliação posterior de uma nota em contingência grave
-- o dhRecbto real, sem confundir criação/emissão com autorização pela SEFAZ.
CREATE INDEX IF NOT EXISTS idx_fiscal_notes_tenant_autorizado
  ON fiscal_notes (tenant_id, autorizado_em);

CREATE TABLE IF NOT EXISTS fiscal_note_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  fiscal_note_id TEXT NOT NULL,
  chave_acesso TEXT NOT NULL,
  tp_evento TEXT NOT NULL,
  status TEXT NOT NULL,
  protocolo TEXT,
  dh_evento TIMESTAMPTZ,
  xml_evento TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fiscal_note_id, tp_evento, protocolo)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_note_events_tenant_date
  ON fiscal_note_events (tenant_id, dh_evento);
CREATE INDEX IF NOT EXISTS idx_fiscal_note_events_tenant_note
  ON fiscal_note_events (tenant_id, fiscal_note_id);

ALTER TABLE fiscal_note_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_note_events_service_only ON fiscal_note_events;
CREATE POLICY fiscal_note_events_service_only
  ON fiscal_note_events
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
COMMIT;
