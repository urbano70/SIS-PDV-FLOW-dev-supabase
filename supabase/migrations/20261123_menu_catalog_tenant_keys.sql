-- Tenant isolation for catalog/config records.
-- Apply after 20261029_add_tenant_id.sql and before deploying code that relies
-- on duplicate local IDs across tenants. This migration never infers or moves
-- rows: missing tenant IDs, duplicate pairs, foreign-key dependencies, or
-- custom primary keys fail closed for manual reconciliation.

BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.config, public.menu, public.pizza_crusts, public.pizza_flavors, public.stock
  IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  target_table text;
  pk_name text;
  pk_definition text;
  pk_index_oid oid;
  has_null_tenant boolean;
  has_duplicate_pair boolean;
  has_other_unique_id boolean;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['menu', 'config', 'stock', 'pizza_flavors', 'pizza_crusts'] LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'Tabela public.% não existe; aplique o schema antes desta migração.', target_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND column_name = 'tenant_id'
    ) THEN
      RAISE EXCEPTION 'public.%.tenant_id ausente; aplique 20261029_add_tenant_id.sql antes desta migração.', target_table;
    END IF;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE tenant_id IS NULL)',
      target_table
    ) INTO has_null_tenant;
    IF has_null_tenant THEN
      RAISE EXCEPTION 'public.% contém tenant_id NULL; atribua a procedência correta sem inferência e execute novamente.', target_table;
    END IF;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I GROUP BY tenant_id, id HAVING count(*) > 1)',
      target_table
    ) INTO has_duplicate_pair;
    IF has_duplicate_pair THEN
      RAISE EXCEPTION 'public.% contém pares tenant_id,id duplicados; reconcilie sem apagar dados e execute novamente.', target_table;
    END IF;

    SELECT c.conname, pg_get_constraintdef(c.oid), c.conindid
      INTO pk_name, pk_definition, pk_index_oid
    FROM pg_constraint c
    WHERE c.conrelid = format('public.%I', target_table)::regclass
      AND c.contype = 'p';

    IF pk_name IS NULL THEN
      RAISE EXCEPTION 'public.% não possui chave primária; esta migração não adivinha uma chave.', target_table;
    END IF;

    IF pk_definition <> 'PRIMARY KEY (id)' AND pk_definition <> 'PRIMARY KEY (tenant_id, id)' THEN
      RAISE EXCEPTION 'public.% possui chave primária customizada (%); revisão manual necessária.', target_table, pk_definition;
    END IF;

    -- Não remove índices únicos arbitrários. A chave id-only atual é trocada;
    -- qualquer outro índice único global sobre id exige revisão explícita.
    SELECT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_attribute a
        ON a.attrelid = i.indrelid
       AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = format('public.%I', target_table)::regclass
        AND i.indisunique
        AND i.indnkeyatts = 1
        AND a.attname = 'id'
        AND i.indexrelid <> pk_index_oid
    ) INTO has_other_unique_id;
    IF has_other_unique_id THEN
      RAISE EXCEPTION 'public.% possui índice único adicional em id; remova/revise manualmente antes da migração.', target_table;
    END IF;

    IF pk_definition = 'PRIMARY KEY (tenant_id, id)' THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', target_table, pk_name);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (tenant_id, id)', target_table, target_table || '_tenant_id_id_pkey');
  END LOOP;
END $$;

-- PostgREST applies this notification when the transaction commits.
NOTIFY pgrst, 'reload schema';
COMMIT;
