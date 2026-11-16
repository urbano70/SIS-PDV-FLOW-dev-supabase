-- Modo Parquinho — migração aditiva, executar manualmente no Supabase SQL Editor.
-- Não cria turno separado: shift_started_at é capturado do config:app no lançamento.
-- Nenhum ledger possui ON DELETE CASCADE; baixa/exclusão de pedido preserva auditoria.

BEGIN;

CREATE TABLE IF NOT EXISTS public.parquinho_operators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  phone         text,
  cpf           text,
  birth_date    date,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'inactive')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parquinho_operators ADD COLUMN IF NOT EXISTS role text
  NOT NULL DEFAULT 'playground_operator' CHECK (role = 'playground_operator');
CREATE UNIQUE INDEX IF NOT EXISTS parquinho_operators_tenant_id_uq
  ON public.parquinho_operators (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS parquinho_operators_tenant_name_uq
  ON public.parquinho_operators (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS parquinho_operators_tenant_status_idx
  ON public.parquinho_operators (tenant_id, status);
CREATE INDEX IF NOT EXISTS parquinho_operators_tenant_cpf_idx
  ON public.parquinho_operators (tenant_id, cpf) WHERE cpf IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.parquinho_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text NOT NULL,
  request_id         text NOT NULL,
  order_id           text NOT NULL,
  order_item_id      text NOT NULL,
  table_id           integer NOT NULL,
  product_id         text NOT NULL,
  product_name       text NOT NULL DEFAULT 'Parquinho',
  child_name        text,
  operator_id        uuid NOT NULL,
  operator_name      text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  shift_started_at   timestamptz NOT NULL,
  original_quantity  integer NOT NULL DEFAULT 1 CHECK (original_quantity = 1),
  original_price     numeric(12,2) NOT NULL CHECK (original_price >= 0),
  unit_price         numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  total_price        numeric(12,2) NOT NULL CHECK (total_price >= 0),
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'paid', 'finalized', 'removed', 'cancelled')),
  removed_by         text,
  reason             text,
  status_changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS parquinho_entries_tenant_request_uq
  ON public.parquinho_entries (tenant_id, request_id);
CREATE UNIQUE INDEX IF NOT EXISTS parquinho_entries_tenant_item_uq
  ON public.parquinho_entries (tenant_id, order_item_id);
CREATE INDEX IF NOT EXISTS parquinho_entries_tenant_shift_idx
  ON public.parquinho_entries (tenant_id, shift_started_at, created_at);
CREATE INDEX IF NOT EXISTS parquinho_entries_tenant_order_idx
  ON public.parquinho_entries (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS parquinho_entries_tenant_table_idx
  ON public.parquinho_entries (tenant_id, table_id, created_at);

-- Revoke direct browser access. The application server uses service_role or the
-- PostgreSQL connection configured for the backend; operator credentials never
-- travel through Supabase anon/authenticated clients.
ALTER TABLE public.parquinho_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parquinho_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parquinho_operators FROM anon, authenticated;
REVOKE ALL ON TABLE public.parquinho_entries FROM anon, authenticated;
GRANT ALL ON TABLE public.parquinho_operators TO service_role;
GRANT ALL ON TABLE public.parquinho_entries TO service_role;
DROP POLICY IF EXISTS parquinho_operators_service_only ON public.parquinho_operators;
DROP POLICY IF EXISTS parquinho_entries_service_only ON public.parquinho_entries;
CREATE POLICY parquinho_operators_service_only ON public.parquinho_operators
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY parquinho_entries_service_only ON public.parquinho_entries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- The PDV browser uses authenticated Socket.IO, not direct access to these
-- tables. Keep service_role access; otherwise a restricted operator could
-- bypass the socket projection with the browser's public Supabase key.
REVOKE ALL ON TABLE public.orders, public.tables, public.comandas,
  public.waiters, public.menu, public.config FROM anon, authenticated;
GRANT ALL ON TABLE public.orders, public.tables, public.comandas,
  public.waiters, public.menu, public.config TO service_role;

CREATE OR REPLACE FUNCTION public.parquinho_sync_entry_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  item jsonb;
  old_item jsonb;
  entry_id uuid;
  next_status text;
  removed_by_value text;
  reason_value text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR old_item IN SELECT value FROM jsonb_array_elements(COALESCE(OLD.items, '[]'::jsonb)) LOOP
      IF old_item->>'source' = 'parquinho' AND NULLIF(old_item->>'parquinhoEntryId', '') IS NOT NULL THEN
        entry_id := (old_item->>'parquinhoEntryId')::uuid;
        UPDATE public.parquinho_entries
           SET status = CASE WHEN status IN ('removed', 'cancelled', 'finalized') THEN status ELSE 'cancelled' END,
               reason = COALESCE(NULLIF(old_item->>'removalReason', ''), 'Pedido excluído'),
               removed_by = COALESCE(NULLIF(old_item->>'removedBy', ''), 'Sistema'),
               status_changed_at = now()
         WHERE tenant_id = OLD.tenant_id AND id = entry_id;
      END IF;
    END LOOP;
    RETURN OLD;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
    IF item->>'source' = 'parquinho' AND NULLIF(item->>'parquinhoEntryId', '') IS NOT NULL THEN
      entry_id := (item->>'parquinhoEntryId')::uuid;
      next_status := CASE
        WHEN item->>'removed' = 'true' THEN 'removed'
        WHEN lower(COALESCE(NEW.status, '')) IN ('cancelled', 'canceled', 'cancelada') THEN 'cancelled'
        WHEN lower(COALESCE(NEW.status, '')) IN ('finalizada', 'finalized', 'paid') THEN 'finalized'
        WHEN item->>'paid' = 'true' THEN 'paid'
        ELSE 'active'
      END;
      removed_by_value := NULLIF(item->>'removedBy', '');
      reason_value := NULLIF(item->>'removalReason', '');
      UPDATE public.parquinho_entries
         SET status = next_status,
             removed_by = COALESCE(removed_by_value, removed_by),
             reason = COALESCE(reason_value, reason),
             status_changed_at = CASE WHEN status IS DISTINCT FROM next_status THEN now() ELSE status_changed_at END
       WHERE tenant_id = NEW.tenant_id AND id = entry_id;
    END IF;
  END LOOP;

  -- A snapshot-based legacy flow may physically omit an item instead of
  -- marking it removed. Preserve that audit transition as well.
  IF TG_OP = 'UPDATE' THEN
    FOR old_item IN SELECT value FROM jsonb_array_elements(COALESCE(OLD.items, '[]'::jsonb)) LOOP
      IF old_item->>'source' = 'parquinho' AND NULLIF(old_item->>'parquinhoEntryId', '') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) n
            WHERE n->>'parquinhoEntryId' = old_item->>'parquinhoEntryId'
         ) THEN
        entry_id := (old_item->>'parquinhoEntryId')::uuid;
        UPDATE public.parquinho_entries
           SET status = CASE WHEN status IN ('cancelled', 'removed') THEN status ELSE 'removed' END,
               removed_by = COALESCE(removed_by, 'Sistema'),
               reason = COALESCE(reason, 'Item removido do pedido'),
               status_changed_at = now()
         WHERE tenant_id = NEW.tenant_id AND id = entry_id;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_parquinho_entry_audit ON public.orders;
CREATE TRIGGER orders_parquinho_entry_audit
  AFTER INSERT OR DELETE OR UPDATE OF items, status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.parquinho_sync_entry_status();

-- Single transaction for validation, idempotency, order JSON, table occupancy,
-- and the immutable ledger row. Price/product/config/operator are resolved on
-- the server/database; the browser sends no trusted monetary field.
CREATE OR REPLACE FUNCTION public.playground_add_entry(
  p_tenant_id       text,
  p_request_id      text,
  p_table_id        integer,
  p_child_name      text,
  p_operator_id     uuid,
  p_operator_name   text,
  p_order_id        text DEFAULT NULL,
  p_shift_started_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  cfg              jsonb := '{}'::jsonb;
  app_cfg          jsonb := '{}'::jsonb;
  module_enabled   boolean := false;
  register_open    boolean := false;
  child_required   boolean := false;
  canonical_price  numeric(12,2);
  canonical_product text := 'parquinho:' || p_tenant_id;
  canonical_name   text := 'Parquinho';
  operator_row     public.parquinho_operators%ROWTYPE;
  table_row        public.tables%ROWTYPE;
  order_row        public.orders%ROWTYPE;
  existing_entry  public.parquinho_entries%ROWTYPE;
  new_entry_id     uuid;
  new_item_id      text;
  selected_order_id text;
  selected_shift   timestamptz;
  new_item         jsonb;
  normalized_child text := NULLIF(btrim(regexp_replace(COALESCE(p_child_name, ''), '\s+', ' ', 'g')), '');
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id) = '' THEN RAISE EXCEPTION 'tenant inválido'; END IF;
  IF p_request_id IS NULL OR btrim(p_request_id) = '' THEN RAISE EXCEPTION 'requestId obrigatório'; END IF;
  IF p_table_id IS NULL OR p_table_id < 1 THEN RAISE EXCEPTION 'mesa inválida'; END IF;

  SELECT * INTO operator_row FROM public.parquinho_operators
   WHERE tenant_id = p_tenant_id AND id = p_operator_id FOR UPDATE;
  IF NOT FOUND OR operator_row.status <> 'approved' THEN RAISE EXCEPTION 'Operador não aprovado'; END IF;

  SELECT * INTO existing_entry FROM public.parquinho_entries
   WHERE tenant_id = p_tenant_id AND request_id = p_request_id;
  IF FOUND THEN
    IF existing_entry.operator_id <> p_operator_id OR existing_entry.table_id <> p_table_id
       OR existing_entry.child_name IS DISTINCT FROM normalized_child THEN
      RAISE EXCEPTION 'requestId já utilizado por outro lançamento';
    END IF;
    SELECT * INTO order_row FROM public.orders
     WHERE tenant_id = p_tenant_id AND id = existing_entry.order_id;
    SELECT * INTO table_row FROM public.tables
     WHERE tenant_id = p_tenant_id AND id = existing_entry.table_id;
    RETURN jsonb_build_object('entry', to_jsonb(existing_entry), 'order', to_jsonb(order_row), 'table', to_jsonb(table_row), 'idempotent', true);
  END IF;

  SELECT data INTO cfg FROM public.config
   WHERE tenant_id = p_tenant_id AND id = p_tenant_id || ':pizzaria' FOR SHARE;
  SELECT data INTO app_cfg FROM public.config
   WHERE tenant_id = p_tenant_id AND id = p_tenant_id || ':app' FOR SHARE;
  module_enabled := COALESCE((cfg->>'parquinhoEnabled')::boolean, false);
  child_required := COALESCE((cfg->>'parquinhoChildNameRequired')::boolean, false);
  IF jsonb_typeof(cfg->'parquinhoPrice') = 'number' THEN
    IF (cfg->>'parquinhoPrice')::numeric < 0 THEN RAISE EXCEPTION 'Valor do Parquinho inválido'; END IF;
    canonical_price := round((cfg->>'parquinhoPrice')::numeric, 2);
  END IF;
  register_open := COALESCE((app_cfg->>'isCashRegisterOpen')::boolean, false);
  IF NOT module_enabled THEN RAISE EXCEPTION 'Modo Parquinho desativado'; END IF;
  IF canonical_price IS NULL OR canonical_price < 0 THEN RAISE EXCEPTION 'Valor do Parquinho não configurado'; END IF;
  IF NOT register_open THEN RAISE EXCEPTION 'O caixa está fechado'; END IF;
  IF child_required AND normalized_child IS NULL THEN RAISE EXCEPTION 'Nome da criança obrigatório'; END IF;

  SELECT * INTO table_row FROM public.tables
   WHERE tenant_id = p_tenant_id AND id = p_table_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mesa não encontrada'; END IF;
  IF table_row.linked_to IS NOT NULL OR table_row.status = 'linked' THEN
    RAISE EXCEPTION 'Mesa unificada: selecione a mesa principal';
  END IF;
  IF table_row.status = 'aguardando_baixa' THEN RAISE EXCEPTION 'Mesa aguardando baixa'; END IF;

  selected_order_id := NULLIF(table_row.current_order, '');
  IF selected_order_id IS NOT NULL THEN
    SELECT * INTO order_row FROM public.orders
     WHERE tenant_id = p_tenant_id AND id = selected_order_id FOR UPDATE;
    IF NOT FOUND OR lower(COALESCE(order_row.status, '')) IN ('finalizada', 'finalized', 'paid', 'cancelled', 'cancelada', 'canceled') THEN
      selected_order_id := NULL;
    ELSIF lower(COALESCE(order_row.status, '')) = 'aguardando_baixa' THEN
      RAISE EXCEPTION 'Pedido aguardando baixa';
    END IF;
  END IF;

  selected_shift := COALESCE(NULLIF(app_cfg->>'shiftStartedAt', '')::timestamptz, p_shift_started_at, now());
  new_entry_id := gen_random_uuid();
  new_item_id := gen_random_uuid()::text;
  new_item := jsonb_build_object(
    'id', new_item_id,
    'menuItemId', canonical_product,
    'productId', canonical_product,
    'name', canonical_name,
    'type', 'outros',
    'source', 'parquinho',
    'flavors', '[]'::jsonb,
    'extras', '[]'::jsonb,
    'size', 'M',
    'observations', CASE WHEN normalized_child IS NULL THEN '' ELSE 'Criança: ' || normalized_child END,
    'childName', normalized_child,
    'operatorId', operator_row.id,
    'operatorName', operator_row.name,
    'parquinhoEntryId', new_entry_id,
    'shiftStartedAt', selected_shift,
    'quantity', 1,
    'unitPrice', canonical_price,
    'price', canonical_price,
    'timestamp', now()
  );

  IF selected_order_id IS NULL THEN
    selected_order_id := COALESCE(NULLIF(p_order_id, ''), gen_random_uuid()::text);
    INSERT INTO public.orders
      (id, tenant_id, table_id, waiter_id, waiter_name, status, is_comanda, timestamp, items, payment_log, delivery_log)
    VALUES
      (selected_order_id, p_tenant_id, p_table_id::text, operator_row.id::text, operator_row.name,
       'pending', false, now(), jsonb_build_array(new_item), '[]'::jsonb, '[]'::jsonb)
    RETURNING * INTO order_row;
  ELSE
    UPDATE public.orders
       SET items = COALESCE(items, '[]'::jsonb) || jsonb_build_array(new_item)
     WHERE tenant_id = p_tenant_id AND id = selected_order_id
     RETURNING * INTO order_row;
  END IF;

  INSERT INTO public.parquinho_entries
    (id, tenant_id, request_id, order_id, order_item_id, table_id, product_id, product_name,
     child_name, operator_id, operator_name, shift_started_at, original_quantity,
     original_price, unit_price, total_price, status)
  VALUES
    (new_entry_id, p_tenant_id, p_request_id, selected_order_id, new_item_id, p_table_id,
     canonical_product, canonical_name, normalized_child, operator_row.id, operator_row.name,
     selected_shift, 1, canonical_price, canonical_price, canonical_price, 'active')
  RETURNING * INTO existing_entry;

  -- Set occupancy only for a live parquinho order; payment/baixa updates are
  -- handled by the ordinary order flow and the audit trigger.
  UPDATE public.tables SET status = 'occupied', current_order = selected_order_id, linked_to = NULL
   WHERE tenant_id = p_tenant_id AND id = p_table_id
   RETURNING * INTO table_row;

  RETURN jsonb_build_object(
    'entry', to_jsonb(existing_entry),
    'order', to_jsonb(order_row),
    'table', to_jsonb(table_row),
    'item', new_item,
    'idempotent', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.playground_add_entry(text, text, integer, text, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.playground_add_entry(text, text, integer, text, uuid, text, text, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.parquinho_sync_entry_status() FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Optional verification after execution:
-- SELECT relname AS tabela, relrowsecurity AS rls_ativada FROM pg_class
--  WHERE relnamespace = 'public'::regnamespace
--    AND relname IN ('parquinho_operators','parquinho_entries');
