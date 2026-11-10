-- Criar bucket privado para backups automáticos
-- Executar no Supabase → SQL Editor

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('backups', 'backups', false, 104857600, ARRAY['application/json'])
ON CONFLICT (id) DO NOTHING;

-- Policy: apenas service_role (backend) pode ler/escrever
-- O bucket é privado — acesso externo só via URL assinada gerada pelo servidor
