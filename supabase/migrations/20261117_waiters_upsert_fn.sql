-- Função RPC para upsert de garçom sem depender do schema cache do PostgREST
CREATE OR REPLACE FUNCTION upsert_waiter(
  p_id        text,
  p_name      text,
  p_cpf       text,
  p_phone     text,
  p_birth_date text,
  p_password  text,
  p_status    text,
  p_uid       text,
  p_tenant_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO waiters (id, name, cpf, phone, birth_date, password, status, uid, tenant_id)
  VALUES (p_id, p_name, p_cpf, p_phone, p_birth_date, p_password, p_status, p_uid, p_tenant_id)
  ON CONFLICT (id) DO UPDATE SET
    name       = EXCLUDED.name,
    cpf        = EXCLUDED.cpf,
    phone      = EXCLUDED.phone,
    birth_date = EXCLUDED.birth_date,
    password   = EXCLUDED.password,
    status     = EXCLUDED.status,
    uid        = EXCLUDED.uid,
    tenant_id  = EXCLUDED.tenant_id;
END;
$$;
