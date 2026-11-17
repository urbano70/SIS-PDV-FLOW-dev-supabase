-- Adiciona campos de contato ao perfil do garçom
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS phone      text;
ALTER TABLE waiters ADD COLUMN IF NOT EXISTS birth_date text;
