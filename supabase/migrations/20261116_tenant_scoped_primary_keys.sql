-- Tenant-scoped primary keys for the three runtime-shared tables.
--
-- Scope is intentionally limited to public.orders, public.tables, and
-- public.comandas.  This migration never updates or deletes user rows and
-- never changes RLS, policies, publications, users, menu, fiscal, or stock.
-- Run in the Supabase SQL Editor (or another PostgreSQL session) as one file.

BEGIN;

-- ALTER TABLE needs an ACCESS EXCLUSIVE lock.  Do not wait indefinitely for
-- application traffic or an abandoned transaction to release it.
SET LOCAL lock_timeout = '5s';

-- Acquire locks in a stable order before any catalog/data validation.  The
-- transaction rolls back as a whole if any check or ALTER TABLE fails.
LOCK TABLE public.orders, public.tables, public.comandas IN ACCESS EXCLUSIVE MODE;

DO $migration$
DECLARE
  target               record;
  v_relid              oid;
  v_relkind            "char";
  v_relpersistence     "char";
  v_relispartition     boolean;
  v_id_attnum          smallint;
  v_tenant_attnum      smallint;
  v_id_type            oid;
  v_tenant_type        oid;
  v_id_notnull         boolean;
  v_tenant_notnull     boolean;
  v_pk_name            text;
  v_pk_attnums         smallint[];
  v_rows_before        bigint;
  v_rows_after         bigint;
  v_has_null_tenant    boolean;
  v_has_duplicates     boolean;
  v_already_composite  boolean;
  v_fk                 record;
  v_unique             record;
BEGIN
  FOR target IN
    SELECT table_name
    FROM (VALUES ('orders'::text), ('tables'::text), ('comandas'::text)) AS names(table_name)
  LOOP
    -- Refuse views, foreign tables, partitions, temporary tables, and other
    -- non-normal relations.  Only the public base tables are in scope.
    SELECT c.oid, c.relkind, c.relpersistence, c.relispartition
      INTO v_relid, v_relkind, v_relpersistence, v_relispartition
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = target.table_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Tenant PK migration requires public.%I, but that relation does not exist.', target.table_name),
        HINT = 'Create the normal public table first; no other schema is modified.';
    END IF;

    IF v_relkind <> 'r' OR v_relpersistence <> 'p' OR v_relispartition THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Refusing tenant PK migration for public.%I: relation is not a normal permanent table.', target.table_name),
        DETAIL = format('relkind=%s, relpersistence=%s, relispartition=%s.', v_relkind, v_relpersistence, v_relispartition),
        HINT = 'The migration only supports ordinary permanent tables in the public schema.';
    END IF;

    -- Verify the required columns and their NOT NULL invariants before
    -- inspecting or replacing a primary key.
    SELECT a.attnum, a.atttypid, a.attnotnull
      INTO v_id_attnum, v_id_type, v_id_notnull
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = v_relid
      AND a.attname = 'id'
      AND NOT a.attisdropped;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Tenant PK migration requires public.%I.id.', target.table_name),
        HINT = 'Add the existing id column and its current primary key manually before retrying.';
    END IF;

    SELECT a.attnum, a.atttypid, a.attnotnull
      INTO v_tenant_attnum, v_tenant_type, v_tenant_notnull
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = v_relid
      AND a.attname = 'tenant_id'
      AND NOT a.attisdropped;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Tenant PK migration requires public.%I.tenant_id.', target.table_name),
        HINT = 'Apply the tenant_id migration first; this migration does not create or backfill tenant ids.';
    END IF;

    IF v_tenant_type <> 'text'::regtype THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Refusing public.%I: tenant_id must be text for this migration.', target.table_name),
        DETAIL = format('Found PostgreSQL type %s.', v_tenant_type::regtype),
        HINT = 'Convert the column explicitly and validate its data before retrying.';
    END IF;

    IF NOT v_id_notnull OR NOT v_tenant_notnull THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Refusing public.%I: id and tenant_id must both be NOT NULL before replacing the primary key.', target.table_name),
        HINT = 'Make the columns non-null after a manual data review; this migration does not rewrite rows.';
    END IF;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE tenant_id IS NULL)',
      'public', target.table_name
    ) INTO v_has_null_tenant;

    IF v_has_null_tenant THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Refusing public.%I: tenant_id contains NULL data.', target.table_name),
        HINT = 'Assign the correct tenant explicitly and rerun this migration; no tenant is inferred here.';
    END IF;

    -- This is an explicit duplicate-pair guard even though the old global id
    -- PK normally makes it impossible.  It protects custom/prepared schemas.
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1
         FROM %I.%I
         GROUP BY tenant_id, id
         HAVING count(*) > 1
       )',
      'public', target.table_name
    ) INTO v_has_duplicates;

    IF v_has_duplicates THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Refusing public.%I: duplicate (tenant_id, id) pairs exist.', target.table_name),
        HINT = 'Resolve duplicate tenant/id data manually; this migration does not delete or merge rows.';
    END IF;

    -- Count rows before DDL as a no-row-deletion guard.  The migration below
    -- contains no UPDATE or DELETE; the same count is checked after it.
    EXECUTE format('SELECT count(*) FROM %I.%I', 'public', target.table_name)
      INTO v_rows_before;

    -- Verify the current PK shape before dropping anything.  The original
    -- constraint name is captured and reused; an already-correct shape is a
    -- no-op so rerunning this file is safe.
    SELECT con.conname, con.conkey
      INTO v_pk_name, v_pk_attnums
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = v_relid
      AND con.contype = 'p';

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Refusing public.%I: no primary key was found to replace.', target.table_name),
        HINT = 'This migration only converts the existing id primary key; restore/inspect the schema manually.';
    END IF;

    IF v_pk_attnums = ARRAY[v_tenant_attnum, v_id_attnum]::smallint[] THEN
      v_already_composite := true;
    ELSIF v_pk_attnums = ARRAY[v_id_attnum]::smallint[] THEN
      v_already_composite := false;
    ELSE
      RAISE EXCEPTION USING
        MESSAGE = format('Refusing public.%I: current primary key is not exactly id or tenant_id,id.', target.table_name),
        DETAIL = format('Current constraint %I has key columns %s.', v_pk_name, v_pk_attnums),
        HINT = 'Review the custom primary key manually; this migration will not guess or replace it.';
    END IF;

    -- A second global UNIQUE(id) would still reject the same id in another
    -- tenant after the PK conversion.  Never drop arbitrary unique indexes or
    -- constraints: report them and require an explicit manual decision.
    FOR v_unique IN
      SELECT i.indexrelid::oid AS index_oid, ic.relname AS index_name
      FROM pg_catalog.pg_index AS i
      JOIN pg_catalog.pg_class AS ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = v_relid
        AND i.indisunique
        AND NOT i.indisprimary
        AND i.indpred IS NULL
        AND i.indexprs IS NULL
        AND i.indnkeyatts = 1
        AND i.indkey[0] = v_id_attnum
    LOOP
      RAISE EXCEPTION USING
        MESSAGE = format('Refusing public.%I: global unique index %I(id) would still block duplicate ids across tenants.', target.table_name, v_unique.index_name),
        HINT = 'Remove or redesign that explicitly reviewed index, then rerun. This migration never drops arbitrary unique objects.';
    END LOOP;

    IF NOT v_already_composite THEN
      -- A foreign key that references the old id-only key depends on the
      -- constraint being dropped.  Stop with a useful message; no CASCADE and
      -- no silent FK removal is ever used by this migration.
      FOR v_fk IN
        SELECT child_ns.nspname AS child_schema,
               child.relname AS child_table,
               con.conname AS constraint_name,
               pg_catalog.pg_get_constraintdef(con.oid) AS definition
        FROM pg_catalog.pg_constraint AS con
        JOIN pg_catalog.pg_class AS child ON child.oid = con.conrelid
        JOIN pg_catalog.pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
        WHERE con.contype = 'f'
          AND con.confrelid = v_relid
          AND con.confkey = ARRAY[v_id_attnum]::smallint[]
      LOOP
        RAISE EXCEPTION USING
          MESSAGE = format('Refusing public.%I: foreign key %I.%I.%I depends on the old id-only primary key.', target.table_name, v_fk.child_schema, v_fk.child_table, v_fk.constraint_name),
          DETAIL = v_fk.definition,
          HINT = 'Migrate that FK to tenant_id,id explicitly. No CASCADE or silent FK drop is performed.';
      END LOOP;

      -- DROP without CASCADE is intentional.  Any dependency not covered by
      -- the explicit FK guard aborts the same transaction instead of being
      -- removed implicitly.  ADD reuses the exact old PK constraint name.
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        'public', target.table_name, v_pk_name
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I PRIMARY KEY (tenant_id, id)',
        'public', target.table_name, v_pk_name
      );
    END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I', 'public', target.table_name)
      INTO v_rows_after;

    IF v_rows_after <> v_rows_before THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Tenant PK migration changed the row count of public.%I.', target.table_name),
        DETAIL = format('Rows before=%s, rows after=%s.', v_rows_before, v_rows_after),
        HINT = 'The transaction is being aborted; inspect the database before retrying.';
    END IF;
  END LOOP;
END
$migration$;

COMMIT;

-- PostgREST schema cache reload is intentionally after COMMIT, so a failed
-- migration cannot advertise a partially changed schema.
NOTIFY pgrst, 'reload schema';

-- Verification output expected for all three rows:
-- constraint_definition = PRIMARY KEY (tenant_id, id)
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
