-- Adiciona colunas que podem estar ausentes na tabela waiters de produção
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS cpf       text;
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS password  text;
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'pending';
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS uid       text;
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS phone     text;
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS birth_date text;
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS tenant_id text;
