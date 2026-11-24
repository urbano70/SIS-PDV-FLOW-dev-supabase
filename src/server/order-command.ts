export type OrderCommandEntity = {
  id: number | string;
  status: string;
  currentOrder?: string | null;
  linkedTo?: number | string | null;
  expectedCurrentOrder?: string | null;
};

export type OrderCommandCommitInput = {
  tenantId: string;
  order?: any | null;
  tables?: OrderCommandEntity[];
  comandas?: OrderCommandEntity[];
};

export class OrderCommandError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'OrderCommandError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const text = (value: unknown): string => String(value ?? '').trim();
const sameId = (left: unknown, right: unknown): boolean =>
  left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right);

const clone = <T>(value: T): T => {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
};

const asJson = (value: unknown): unknown => value === undefined || value === null ? [] : clone(value);

export const orderToCommitRow = (order: any): Record<string, unknown> => ({
  id: text(order?.id),
  table_id: order?.tableId === undefined || order?.tableId === null ? null : text(order.tableId),
  waiter_id: order?.waiterId === undefined || order?.waiterId === null ? null : text(order.waiterId),
  waiter_name: order?.waiterName === undefined || order?.waiterName === null ? null : text(order.waiterName),
  status: text(order?.status) || 'open',
  is_comanda: Boolean(order?.isComanda),
  timestamp: order?.timestamp || new Date().toISOString(),
  items: asJson(order?.items),
  payment_log: asJson(order?.paymentLog),
  delivery_log: asJson(order?.deliveryLog),
});

export const entityToCommitRow = (entity: OrderCommandEntity): Record<string, unknown> => {
  const id = Number(entity?.id);
  if (!Number.isInteger(id)) {
    throw new OrderCommandError('ORDER_STATE_COMMIT_INVALID_ENTITY', 'Identificador de mesa/comanda inválido.');
  }
  const row: Record<string, unknown> = {
    id,
    status: text(entity?.status) || 'free',
    current_order: entity?.currentOrder === undefined || entity?.currentOrder === null ? null : text(entity.currentOrder),
    linked_to: entity?.linkedTo === undefined || entity?.linkedTo === null ? null : text(entity.linkedTo),
  };
  if (Object.prototype.hasOwnProperty.call(entity, 'expectedCurrentOrder')) {
    row.expected_current_order = entity.expectedCurrentOrder === undefined || entity.expectedCurrentOrder === null
      ? null
      : text(entity.expectedCurrentOrder);
  }
  return row;
};

const normalizeTenant = (tenantId: unknown): string => {
  const value = text(tenantId);
  if (!value) throw new OrderCommandError('TENANT_REQUIRED', 'Tenant obrigatório.');
  return value;
};

const mapCommitError = (error: any, fallbackCode: string): OrderCommandError => {
  const message = text(error?.message || error);
  const errorCode = text(error?.code).toUpperCase();
  if (error instanceof OrderCommandError) return error;
  if (/order_state_commit_expected_current_order|order_state_commit_(table|comanda)_missing/i.test(message)) {
    return new OrderCommandError('ORDER_STATE_COMMIT_CONFLICT',
      'O vínculo da mesa/comanda mudou. Atualize o pedido antes de tentar novamente.', 409);
  }
  const missingRpc = errorCode === 'PGRST202' || errorCode === '42883' ||
    /function .*order_state_commit.*does not exist|could not find the function .*order_state_commit/i.test(message);
  if (missingRpc) {
    return new OrderCommandError(
      'ORDER_STATE_COMMIT_RPC_MISSING',
      'Dependência de persistência ausente: aplique a migration order_state_commit antes de liberar pedidos.',
      503,
      { sourceCode: errorCode || undefined },
    );
  }
  return new OrderCommandError(fallbackCode, 'Não foi possível persistir o estado do pedido com segurança.', 503);
};

const assertExpectedLink = (actual: unknown, expected: unknown, collection: string, id: number): void => {
  const actualValue = actual === undefined ? null : actual;
  const expectedValue = expected === undefined ? null : expected;
  if (actualValue === null && expectedValue === null) return;
  if (actualValue !== null && expectedValue !== null && sameId(actualValue, expectedValue)) return;
  throw new OrderCommandError(
    'ORDER_STATE_COMMIT_CONFLICT',
    `Estado da ${collection === 'tables' ? 'mesa' : 'comanda'} mudou; atualize o pedido e tente novamente.`,
    409,
    { collection, id },
  );
};

const commitPostgres = async (pool: any, input: {
  tenantId: string;
  orderRow: Record<string, unknown> | null;
  tableRows: Record<string, unknown>[];
  comandaRows: Record<string, unknown>[];
}): Promise<Record<string, unknown>> => {
  if (!pool || typeof pool.connect !== 'function') {
    throw new OrderCommandError(
      'ORDER_STATE_COMMIT_UNAVAILABLE',
      'Persistência transacional indisponível; nenhuma alteração foi aplicada.',
      503,
    );
  }
  let client: any;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Lock entity rows before the order write. Every caller uses this order,
    // preventing a concurrent release from clearing a changed current_order.
    for (const [collection, rows] of [['tables', input.tableRows], ['comandas', input.comandaRows]] as const) {
      for (const row of rows) {
        const locked = await client.query(
          `SELECT current_order FROM ${collection} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
          [input.tenantId, row.id],
        );
        if (locked.rowCount !== 1) {
          throw new OrderCommandError('ORDER_STATE_COMMIT_ENTITY_MISSING', 'Mesa/comanda não encontrada no tenant autorizado.', 409);
        }
        if (Object.prototype.hasOwnProperty.call(row, 'expected_current_order')) {
          assertExpectedLink(locked.rows[0].current_order, row.expected_current_order, collection, Number(row.id));
        }
      }
    }

    if (input.orderRow) {
      const row = input.orderRow;
      await client.query(
        `INSERT INTO orders
          (id, tenant_id, table_id, waiter_id, waiter_name, status, is_comanda, timestamp, items, payment_log, delivery_log)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)
         ON CONFLICT (tenant_id,id) DO UPDATE SET
           table_id=EXCLUDED.table_id, waiter_id=EXCLUDED.waiter_id,
           waiter_name=EXCLUDED.waiter_name, status=EXCLUDED.status,
           is_comanda=EXCLUDED.is_comanda, timestamp=EXCLUDED.timestamp,
           items=EXCLUDED.items, payment_log=EXCLUDED.payment_log,
           delivery_log=EXCLUDED.delivery_log
         WHERE orders.tenant_id = EXCLUDED.tenant_id`,
        [
          row.id,
          input.tenantId,
          row.table_id,
          row.waiter_id,
          row.waiter_name,
          row.status,
          row.is_comanda,
          row.timestamp,
          JSON.stringify(row.items ?? []),
          JSON.stringify(row.payment_log ?? []),
          JSON.stringify(row.delivery_log ?? []),
        ],
      );
    }

    for (const [collection, rows] of [['tables', input.tableRows], ['comandas', input.comandaRows]] as const) {
      for (const row of rows) {
        await client.query(
          `INSERT INTO ${collection} (id, tenant_id, status, current_order, linked_to)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id,id) DO UPDATE SET
             status=EXCLUDED.status, current_order=EXCLUDED.current_order, linked_to=EXCLUDED.linked_to
           WHERE ${collection}.tenant_id = EXCLUDED.tenant_id`,
          [row.id, input.tenantId, row.status, row.current_order, row.linked_to],
        );
      }
    }
    await client.query('COMMIT');
    return { ok: true, orderId: input.orderRow?.id ?? undefined };
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    }
    throw mapCommitError(error, 'ORDER_STATE_COMMIT_FAILED');
  } finally {
    client?.release();
  }
};

export const commitOrderState = async (deps: {
  usePostgres: boolean;
  db?: any | null;
  pgPool?: any;
}, input: OrderCommandCommitInput): Promise<Record<string, unknown>> => {
  const tenantId = normalizeTenant(input.tenantId);
  const orderRow = input.order === null || input.order === undefined ? null : orderToCommitRow(input.order);
  if (orderRow && !text(orderRow.id)) {
    throw new OrderCommandError('ORDER_STATE_COMMIT_INVALID_ORDER', 'Pedido inválido.');
  }
  const tableRows = (input.tables || []).map(entityToCommitRow);
  const comandaRows = (input.comandas || []).map(entityToCommitRow);

  if (deps.usePostgres) {
    return commitPostgres(deps.pgPool, { tenantId, orderRow, tableRows, comandaRows });
  }
  if (!deps.db || typeof deps.db.rpc !== 'function') {
    throw new OrderCommandError(
      'ORDER_STATE_COMMIT_UNAVAILABLE',
      'Persistência transacional indisponível; nenhuma alteração foi aplicada.',
      503,
    );
  }
  try {
    const result = await deps.db.rpc('order_state_commit', {
      p_tenant_id: tenantId,
      p_order: orderRow,
      p_tables: tableRows,
      p_comandas: comandaRows,
    });
    if (result?.error) throw result.error;
    if (!result?.data || typeof result.data !== 'object' || result.data.ok !== true ||
        (result.data.tenantId && text(result.data.tenantId) !== tenantId)) {
      throw new OrderCommandError('ORDER_STATE_COMMIT_INVALID_RESPONSE',
        'O servidor não confirmou a gravação do pedido. Atualize antes de tentar novamente.', 503);
    }
    return result.data;
  } catch (error) {
    throw mapCommitError(error, 'ORDER_STATE_COMMIT_FAILED');
  }
};

export const makeAck = (tenantId: string, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  ok: false,
  tenantId: text(tenantId),
  ...patch,
});
