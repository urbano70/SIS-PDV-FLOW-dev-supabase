-- Disposable local PostgreSQL fixture for
-- supabase/migrations/20261116_tenant_scoped_primary_keys.sql
--
-- NEVER run this file against Supabase or another shared/production database:
-- it drops and recreates only its disposable public test tables.
-- The migration is included four times:
--   1) expected failure: extra global UNIQUE(id)
--   2) expected failure: FK depending on old id PK
--   3) expected success: conversion
--   4) expected success: idempotent rerun
\set ON_ERROR_STOP off

DROP TABLE IF EXISTS public.order_refs CASCADE;
DROP TABLE IF EXISTS public.orders, public.tables, public.comandas CASCADE;

CREATE TABLE public.orders (
  id          text NOT NULL,
  tenant_id   text NOT NULL DEFAULT 'default',
  status      text NOT NULL,
  note        text NOT NULL,
  CONSTRAINT orders_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tables (
  id          integer NOT NULL,
  tenant_id   text NOT NULL DEFAULT 'default',
  status      text NOT NULL,
  CONSTRAINT tables_pkey PRIMARY KEY (id)
);

CREATE TABLE public.comandas (
  id          integer NOT NULL,
  tenant_id   text NOT NULL DEFAULT 'default',
  status      text NOT NULL,
  CONSTRAINT comandas_pkey PRIMARY KEY (id)
);

INSERT INTO public.orders (id, tenant_id, status, note)
VALUES ('100', 'tenant_a', 'open', 'tenant A order must survive');
INSERT INTO public.tables (id, tenant_id, status)
VALUES (16, 'tenant_a', 'occupied');
INSERT INTO public.comandas (id, tenant_id, status)
VALUES (16, 'tenant_a', 'free');

-- The old global id PK correctly blocks a second tenant before migration.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.tables (id, tenant_id, status)
    VALUES (16, 'tenant_b', 'waiting_payment');
    RAISE EXCEPTION 'Expected tenant_b tables.id=16 to be blocked before migration';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.comandas (id, tenant_id, status)
    VALUES (16, 'tenant_b', 'waiting_payment');
    RAISE EXCEPTION 'Expected tenant_b comandas.id=16 to be blocked before migration';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$$;

-- Expected failure 1: a non-PK global unique index must never be silently
-- removed. The migration transaction must leave the old schema and data intact.
CREATE UNIQUE INDEX orders_global_id_unique ON public.orders (id) INCLUDE (note);
\ir ../supabase/migrations/20261116_tenant_scoped_primary_keys.sql

DO $$
DECLARE
  v_def text;
  v_rows integer;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(con.oid)
    INTO v_def
  FROM pg_catalog.pg_constraint AS con
  WHERE con.conrelid = 'public.orders'::regclass
    AND con.conname = 'orders_pkey';
  IF v_def <> 'PRIMARY KEY (id)' THEN
    RAISE EXCEPTION 'Global unique guard did not roll back orders PK; got %', v_def;
  END IF;

  SELECT count(*) INTO v_rows FROM public.orders;
  IF v_rows <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = '100' AND tenant_id = 'tenant_a' AND note = 'tenant A order must survive'
  ) THEN
    RAISE EXCEPTION 'Global unique guard changed orders data';
  END IF;
END
$$;

DROP INDEX orders_global_id_unique;

-- Expected failure 2: an FK tied to the old id-only key must stop the
-- transaction with no CASCADE/drop side effect.
CREATE TABLE public.order_refs (
  ref_id    integer PRIMARY KEY,
  order_id  text NOT NULL REFERENCES public.orders (id),
  marker    text NOT NULL
);
INSERT INTO public.order_refs (ref_id, order_id, marker)
VALUES (1, '100', 'FK must survive failed migration');

\ir ../supabase/migrations/20261116_tenant_scoped_primary_keys.sql

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(con.oid)
    INTO v_def
  FROM pg_catalog.pg_constraint AS con
  WHERE con.conrelid = 'public.orders'::regclass
    AND con.conname = 'orders_pkey';
  IF v_def <> 'PRIMARY KEY (id)' THEN
    RAISE EXCEPTION 'FK guard did not roll back orders PK; got %', v_def;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.order_refs
    WHERE ref_id = 1 AND order_id = '100' AND marker = 'FK must survive failed migration'
  ) THEN
    RAISE EXCEPTION 'FK guard removed the dependent row';
  END IF;
END
$$;

DROP TABLE public.order_refs;

-- Expected success: all three old id PKs become tenant_id,id PKs.
\ir ../supabase/migrations/20261116_tenant_scoped_primary_keys.sql

-- Expected success: already-correct PKs are left untouched on rerun.
\ir ../supabase/migrations/20261116_tenant_scoped_primary_keys.sql

-- The same numeric table/comanda id and the same text order id can now exist
-- independently for tenant B, without changing tenant A's original values.
INSERT INTO public.tables (id, tenant_id, status)
VALUES (16, 'tenant_b', 'waiting_payment');
INSERT INTO public.comandas (id, tenant_id, status)
VALUES (16, 'tenant_b', 'occupied');
INSERT INTO public.orders (id, tenant_id, status, note)
VALUES ('100', 'tenant_b', 'open', 'tenant B order must coexist');

DO $$
DECLARE
  t text;
  v_def text;
  v_name text;
  v_rows integer;
  v_global_id_indexes integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders', 'tables', 'comandas']
  LOOP
    SELECT con.conname, pg_catalog.pg_get_constraintdef(con.oid)
      INTO v_name, v_def
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = format('public.%I', t)::regclass
      AND con.contype = 'p';

    IF v_name <> t || '_pkey' OR v_def <> 'PRIMARY KEY (tenant_id, id)' THEN
      RAISE EXCEPTION '% PK mismatch after migration: name=%, definition=%', t, v_name, v_def;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_rows FROM public.orders;
  IF v_rows <> 2
     OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = '100' AND tenant_id = 'tenant_a' AND note = 'tenant A order must survive')
     OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = '100' AND tenant_id = 'tenant_b' AND note = 'tenant B order must coexist') THEN
    RAISE EXCEPTION 'Orders tenant isolation/data preservation assertion failed';
  END IF;

  SELECT count(*) INTO v_rows FROM public.tables;
  IF v_rows <> 2
     OR NOT EXISTS (SELECT 1 FROM public.tables WHERE id = 16 AND tenant_id = 'tenant_a' AND status = 'occupied')
     OR NOT EXISTS (SELECT 1 FROM public.tables WHERE id = 16 AND tenant_id = 'tenant_b' AND status = 'waiting_payment') THEN
    RAISE EXCEPTION 'Tables tenant isolation/data preservation assertion failed';
  END IF;

  SELECT count(*) INTO v_rows FROM public.comandas;
  IF v_rows <> 2
     OR NOT EXISTS (SELECT 1 FROM public.comandas WHERE id = 16 AND tenant_id = 'tenant_a' AND status = 'free')
     OR NOT EXISTS (SELECT 1 FROM public.comandas WHERE id = 16 AND tenant_id = 'tenant_b' AND status = 'occupied') THEN
    RAISE EXCEPTION 'Comandas tenant isolation/data preservation assertion failed';
  END IF;

  SELECT count(*) INTO v_global_id_indexes
  FROM pg_catalog.pg_index AS i
  WHERE i.indrelid IN ('public.orders'::regclass, 'public.tables'::regclass, 'public.comandas'::regclass)
    AND i.indisunique
    AND i.indpred IS NULL
    AND i.indexprs IS NULL
    AND i.indnkeyatts = 1
    AND i.indkey[0] = (
      SELECT a.attnum
      FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = i.indrelid
        AND a.attname = 'id'
        AND NOT a.attisdropped
    );
  IF v_global_id_indexes <> 0 THEN
    RAISE EXCEPTION 'A global unique id index remains after successful conversion';
  END IF;
END
$$;

SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  pg_catalog.pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('orders', 'tables', 'comandas')
  AND con.contype = 'p'
ORDER BY c.relname;

\echo 'PASS: tenant-scoped primary-key migration, rollback guards, data preservation, duplicate ids, and idempotence'
