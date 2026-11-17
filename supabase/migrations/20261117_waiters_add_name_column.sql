-- Adiciona coluna name que estava ausente na tabela waiters de produção
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS name text;
