-- Commit atômico dos snapshots críticos de pedido e vínculos de mesa/comanda.
-- Aditivo: não cria colunas, não apaga dados e não chama a função sobre pedidos.
-- Tenant é argumento validado pelo servidor; somente service_role pode executar.
BEGIN;

CREATE OR REPLACE FUNCTION public.order_state_commit(
  p_tenant_id text,
  p_order jsonb,
  p_tables jsonb,
  p_comandas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  entity jsonb;
  entity_id integer;
  current_link text;
  order_id text;
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id) = '' THEN
    RAISE EXCEPTION 'order_state_commit_tenant_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_order IS NOT NULL AND jsonb_typeof(p_order) <> 'object' THEN
    RAISE EXCEPTION 'order_state_commit_order_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(COALESCE(p_tables, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_comandas, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'order_state_commit_entities_invalid' USING ERRCODE = 'P0001';
  END IF;

  order_id := NULLIF(btrim(p_order->>'id'), '');
  IF p_order IS NOT NULL AND order_id IS NULL THEN
    RAISE EXCEPTION 'order_state_commit_order_id_required' USING ERRCODE = 'P0001';
  END IF;

  -- Valida/bloqueia vínculos antes de gravar. Um comando antigo não pode
  -- liberar a mesma mesa se ela já estiver associada a outro pedido.
  FOR entity IN SELECT value FROM jsonb_array_elements(COALESCE(p_tables, '[]'::jsonb)) LOOP
    IF jsonb_typeof(entity) <> 'object' OR NULLIF(entity->>'id', '') IS NULL THEN
      RAISE EXCEPTION 'order_state_commit_table_invalid' USING ERRCODE = 'P0001';
    END IF;
    entity_id := (entity->>'id')::integer;
    SELECT t.current_order INTO current_link
      FROM public.tables AS t
     WHERE t.tenant_id = p_tenant_id AND t.id = entity_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_state_commit_table_missing' USING ERRCODE = 'P0001';
    END IF;
    IF entity ? 'expected_current_order'
       AND current_link IS DISTINCT FROM NULLIF(entity->>'expected_current_order', '') THEN
      RAISE EXCEPTION 'order_state_commit_expected_current_order' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR entity IN SELECT value FROM jsonb_array_elements(COALESCE(p_comandas, '[]'::jsonb)) LOOP
    IF jsonb_typeof(entity) <> 'object' OR NULLIF(entity->>'id', '') IS NULL THEN
      RAISE EXCEPTION 'order_state_commit_comanda_invalid' USING ERRCODE = 'P0001';
    END IF;
    entity_id := (entity->>'id')::integer;
    SELECT c.current_order INTO current_link
      FROM public.comandas AS c
     WHERE c.tenant_id = p_tenant_id AND c.id = entity_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_state_commit_comanda_missing' USING ERRCODE = 'P0001';
    END IF;
    IF entity ? 'expected_current_order'
       AND current_link IS DISTINCT FROM NULLIF(entity->>'expected_current_order', '') THEN
      RAISE EXCEPTION 'order_state_commit_expected_current_order' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF p_order IS NOT NULL THEN
    INSERT INTO public.orders (
      id, tenant_id, table_id, waiter_id, waiter_name, status, is_comanda,
      timestamp, items, payment_log, delivery_log
    ) VALUES (
      order_id,
      p_tenant_id,
      NULLIF(p_order->>'table_id', ''),
      NULLIF(p_order->>'waiter_id', ''),
      NULLIF(p_order->>'waiter_name', ''),
      COALESCE(NULLIF(p_order->>'status', ''), 'open'),
      COALESCE((p_order->>'is_comanda')::boolean, false),
      NULLIF(p_order->>'timestamp', ''),
      COALESCE(p_order->'items', '[]'::jsonb),
      COALESCE(p_order->'payment_log', '[]'::jsonb),
      COALESCE(p_order->'delivery_log', '[]'::jsonb)
    )
    ON CONFLICT (tenant_id, id) DO UPDATE SET
      table_id = EXCLUDED.table_id,
      waiter_id = EXCLUDED.waiter_id,
      waiter_name = EXCLUDED.waiter_name,
      status = EXCLUDED.status,
      is_comanda = EXCLUDED.is_comanda,
      timestamp = EXCLUDED.timestamp,
      items = EXCLUDED.items,
      payment_log = EXCLUDED.payment_log,
      delivery_log = EXCLUDED.delivery_log
    WHERE public.orders.tenant_id = EXCLUDED.tenant_id;
  END IF;

  FOR entity IN SELECT value FROM jsonb_array_elements(COALESCE(p_tables, '[]'::jsonb)) LOOP
    INSERT INTO public.tables (id, tenant_id, status, current_order, linked_to)
    VALUES (
      (entity->>'id')::integer,
      p_tenant_id,
      COALESCE(NULLIF(entity->>'status', ''), 'free'),
      NULLIF(entity->>'current_order', ''),
      NULLIF(entity->>'linked_to', '')
    )
    ON CONFLICT (tenant_id, id) DO UPDATE SET
      status = EXCLUDED.status,
      current_order = EXCLUDED.current_order,
      linked_to = EXCLUDED.linked_to
    WHERE public.tables.tenant_id = EXCLUDED.tenant_id;
  END LOOP;

  FOR entity IN SELECT value FROM jsonb_array_elements(COALESCE(p_comandas, '[]'::jsonb)) LOOP
    INSERT INTO public.comandas (id, tenant_id, status, current_order, linked_to)
    VALUES (
      (entity->>'id')::integer,
      p_tenant_id,
      COALESCE(NULLIF(entity->>'status', ''), 'free'),
      NULLIF(entity->>'current_order', ''),
      NULLIF(entity->>'linked_to', '')
    )
    ON CONFLICT (tenant_id, id) DO UPDATE SET
      status = EXCLUDED.status,
      current_order = EXCLUDED.current_order,
      linked_to = EXCLUDED.linked_to
    WHERE public.comandas.tenant_id = EXCLUDED.tenant_id;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'tenantId', p_tenant_id, 'orderId', order_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.order_state_commit(text, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.order_state_commit(text, jsonb, jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.order_state_commit(text, jsonb, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.order_state_commit(text, jsonb, jsonb, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
