# Tenant-scoped primary keys (orders, tables, comandas)

## Ownership and scope

This change owns only:

- `supabase/migrations/20261116_tenant_scoped_primary_keys.sql`
- `scripts/test-tenant-scoped-primary-keys.sql`
- `scripts/test-tenant-scoped-primary-keys.mjs`
- this migration runbook

It changes only the primary-key definition on `public.orders`, `public.tables`, and `public.comandas`. It intentionally does **not** touch `server.ts`, UI/provider files, CSS, realtime policies, RLS policies, users, menu, fiscal tables, stock, or `src/db-pg.ts`.

## What the migration does

The migration runs in one explicit transaction and waits at most five seconds to acquire the required `ACCESS EXCLUSIVE` table locks. Before dropping anything, it verifies that each relation is a normal permanent table in the `public` schema, that `id` and `tenant_id` exist and are `NOT NULL`, that no `tenant_id` value is null, and that no duplicate `(tenant_id, id)` pair exists.

For each table it accepts only the existing primary-key shape `PRIMARY KEY (id)` or the already-correct shape `PRIMARY KEY (tenant_id, id)`. During conversion it drops the existing primary key **without `CASCADE`** and recreates it with the same constraint name and the explicit column order `(tenant_id, id)`. No `UPDATE`, `DELETE`, row reassignment, or tenant inference occurs. Row counts are checked before and after the DDL as an additional no-row-deletion guard.

The migration refuses to continue if either of these unsafe dependencies exists:

1. A second global unique index on exactly `id`, which would still block the same ID in another tenant. Arbitrary unique indexes and constraints are never dropped automatically.
2. A foreign key that references the old id-only key. The error identifies the dependent schema, table, constraint, and definition and instructs the operator to migrate it to `(tenant_id, id)` explicitly.

If any validation or DDL statement fails, the complete transaction is aborted. An already-correct schema is a no-op, so rerunning the file is safe. After `COMMIT`, the file sends `NOTIFY pgrst, 'reload schema'` and emits a verification query. Expected definitions are:

```text
public.comandas  comandas_pkey  PRIMARY KEY (tenant_id, id)
public.orders    orders_pkey    PRIMARY KEY (tenant_id, id)
public.tables    tables_pkey    PRIMARY KEY (tenant_id, id)
```

## Supabase SQL Editor procedure

1. Confirm that the tenant-column migration has already run and that existing rows have the intended `tenant_id` (the prior migration's default is `default`; this PK migration does not change it).
2. Review the target database for any old-key foreign keys or non-PK global `UNIQUE(id)` indexes. The migration performs these checks itself and fails safely if it finds one.
3. Open the Supabase SQL Editor, paste the complete contents of [`20261116_tenant_scoped_primary_keys.sql`](../supabase/migrations/20261116_tenant_scoped_primary_keys.sql), and run it as one script during a short low-write window. Do not split the transaction or remove the checks.
4. Confirm the final verification result contains exactly three rows with `PRIMARY KEY (tenant_id, id)` and the original constraint names (`orders_pkey`, `tables_pkey`, `comandas_pkey`).
5. If the SQL Editor reports a five-second lock timeout, retry during a quieter window; do not increase the lock timeout blindly.

The script's post-commit notification refreshes the PostgREST schema cache. If the SQL Editor or deployment tooling reports notifications separately, a manual schema reload can be requested after the successful commit.

## Runtime integration

The parent change now uses the composite conflict target explicitly in Supabase upserts, bootstrap table/comanda inserts, and the PostgreSQL adapter:

```sql
INSERT INTO orders (id, tenant_id, ...)
VALUES ($1, $2, ...)
ON CONFLICT (tenant_id, id) DO UPDATE
SET ...;
```

Updates and deletes must include the tenant predicate in addition to the ID, for example `WHERE tenant_id = $tenant AND id = $id`. Apply this migration before deploying the updated runtime. Existing `ON CONFLICT (id)` for unrelated tables whose IDs already contain tenant prefixes is unchanged.

## Local validation

The repository has no local `psql` binary or configured database in this environment. The supplied runner therefore uses an in-memory Postgres-WASM database and never reads `DATABASE_URL`, Supabase credentials, or application runtime state. Install its dependency outside the repository, then run:

```bash
mkdir -p /home/ubuntu/pdv-estabilidade/sql-engine
cd /home/ubuntu/pdv-estabilidade/sql-engine
npm init -y
npm install --no-audit --no-fund @electric-sql/pglite
cd /home/ubuntu/repos/SIS-PDV-FLOW-dev-supabase
PGLITE_MODULE_PATH=/home/ubuntu/pdv-estabilidade/sql-engine/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-tenant-scoped-primary-keys.mjs
```

The test creates disposable `public` fixture tables and verifies:

- tenant A's table/comanda ID `16` is blocked for tenant B before migration;
- the extra global `UNIQUE(orders.id)` case fails and preserves the old PK and row;
- the dependent-FK case fails and preserves both the old PK and referencing row;
- conversion allows table ID `16` and order ID `100` to coexist for tenants A and B;
- original values remain intact;
- no global unique `id` index remains;
- constraint names remain unchanged;
- running the migration a second time succeeds as a no-op.

The SQL fixture itself is also available for a disposable local PostgreSQL database with `psql`:

```bash
psql --file=/home/ubuntu/repos/SIS-PDV-FLOW-dev-supabase/scripts/test-tenant-scoped-primary-keys.sql "$LOCAL_DISPOSABLE_DATABASE_URL"
```

It intentionally permits the first two migration invocations to fail because those are the rollback cases; the final `PASS:` line and the final verification query are the success criteria. **Never** point this fixture at Supabase or another shared/production database: it drops and recreates its disposable target tables.

## Validation result in this workspace

The isolated Postgres-WASM run passed. It reported the expected rollback messages for the global unique-index and old-FK cases, then verified:

```text
public.comandas: comandas_pkey PRIMARY KEY (tenant_id, id)
public.orders:   orders_pkey   PRIMARY KEY (tenant_id, id)
public.tables:   tables_pkey   PRIMARY KEY (tenant_id, id)
PASS: tenant-scoped primary-key migration, rollback guards, data preservation, duplicate ids, and idempotence
```

No production/server load, API call, credential, or Git commit was used for this validation.
