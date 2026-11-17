import { randomUUID } from 'node:crypto';
import {
  PLAYGROUND_OPERATOR_ROLE,
  canonicalMoney,
  ensurePlaygroundProduct,
  hashPlaygroundPassword,
  isNonEmptyName,
  isValidPlaygroundStatus,
  mapPlaygroundEntryRow,
  normalizeChildName,
  normalizeOperatorName,
  normalizePlaygroundConfig,
  playgroundEventAllowedForOperator,
  projectPlaygroundData,
  publicOperator,
  verifyPlaygroundPassword,
} from './playground-core.ts';
import {
  pgPlaygroundAddEntry,
  pgPlaygroundFindOperators,
  pgPlaygroundListEntries,
  pgPlaygroundSetOperatorStatus,
  pgPlaygroundUpsertOperator,
} from '../db-pg.ts';

export { PLAYGROUND_OPERATOR_ROLE };

const PLAYGROUND_ROOM_PREFIX = 'playground:';
const PLAYGROUND_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessionsByToken = new Map<string, {
  token: string;
  tenantId: string;
  operatorId: string;
  socket: any | null;
  expiresAt: number;
}>();
const sessionBySocket = new Map<string, string>();

export interface PlaygroundServerDeps {
  socket: any;
  io: any;
  db: any | null;
  usePostgres: boolean;
  buildId: string;
  getTenantId: () => string;
  getState: (tenantId: string) => any;
  loadTenantIfNeeded: (tenantId: string) => Promise<void>;
  enqueueWrite?: (collection: string, data: any, docId: string, tenantId: string) => void;
  saveToSupabase?: (collection: string, data: any, docId?: string, tenantId?: string) => Promise<void>;
  generateOrderId?: (state: any, tenantId: string) => string | number;
  withTenantCommand?: <T>(tenantId: string, operation: () => Promise<T>) => Promise<T>;
  rowToOrder?: (row: any) => any;
  rowToTable?: (row: any) => any;
  isAdmin?: () => boolean;
  isDedicatedConnection?: () => boolean;
}

const roomFor = (tenantId: string) => `${PLAYGROUND_ROOM_PREFIX}${tenantId}`;
const asText = (value: unknown): string => String(value ?? '').trim();
const safeTenant = (value: unknown): string => asText(value);
const normalizeShiftStartedAt = (value: unknown): string | null => {
  const textValue = asText(value);
  if (!textValue) return null;
  const parsed = new Date(textValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const leavePlaygroundRooms = (socket: any) => {
  for (const room of Array.from(socket?.rooms || []) as string[]) {
    if (room.startsWith(PLAYGROUND_ROOM_PREFIX)) socket.leave(room);
  }
};

const switchPlaygroundTenant = (socket: any, tenantId: string) => {
  const tid = safeTenant(tenantId);
  if (!tid) throw new Error('tenantId obrigatório');
  for (const room of Array.from(socket?.rooms || []) as string[]) {
    if (room.startsWith('tenant:') || room.startsWith(PLAYGROUND_ROOM_PREFIX)) socket.leave(room);
  }
  socket.join(roomFor(tid));
  socket.playgroundTenantId = tid;
  socket.playgroundGeneration = (Number(socket.playgroundGeneration) || 0) + 1;
  socket.playgroundConnection = true;
  return socket.playgroundGeneration;
};

const currentSocketTenant = (deps: PlaygroundServerDeps): string =>
  safeTenant(deps.socket.playgroundTenantId || deps.getTenantId());

const getPayloadAndAck = (payload: any, callback: any) => {
  if (typeof payload === 'function') return { payload: {}, callback: payload };
  return { payload: payload || {}, callback: typeof callback === 'function' ? callback : null };
};

const sendAck = (socket: any, event: string, callback: any, response: any) => {
  const ack = { ok: response?.ok === true, ...response };
  if (callback) callback(ack);
  socket.emit(`${event}_ack`, ack);
  return ack;
};

const dbRows = async (db: any, table: string, tenantId: string): Promise<any[]> => {
  const result = await db.from(table).select('*').eq('tenant_id', tenantId).order('name', { ascending: true });
  if (result?.error) throw result.error;
  return result?.data || [];
};

const readOperators = async (deps: PlaygroundServerDeps, tenantId: string): Promise<any[]> => {
  if (deps.usePostgres) return pgPlaygroundFindOperators(tenantId);
  if (!deps.db) throw new Error('Persistência do Parquinho indisponível');
  return dbRows(deps.db, 'parquinho_operators', tenantId);
};

const findOperator = async (deps: PlaygroundServerDeps, tenantId: string, operatorId: string): Promise<any | null> => {
  const rows = await readOperators(deps, tenantId);
  return rows.find((row: any) => String(row.id) === String(operatorId)) || null;
};

const saveOperator = async (deps: PlaygroundServerDeps, row: any): Promise<any> => {
  if (deps.usePostgres) return pgPlaygroundUpsertOperator(row);
  if (!deps.db) throw new Error('Persistência do Parquinho indisponível');
  const result = await deps.db.from('parquinho_operators').upsert(row, { onConflict: 'tenant_id,id' }).select('*').single();
  if (result?.error) throw result.error;
  return result.data || row;
};

const setOperatorStatus = async (deps: PlaygroundServerDeps, tenantId: string, operatorId: string, status: string): Promise<any | null> => {
  if (deps.usePostgres) return pgPlaygroundSetOperatorStatus(tenantId, operatorId, status);
  if (!deps.db) throw new Error('Persistência do Parquinho indisponível');
  const result = await deps.db.from('parquinho_operators').update({ status, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', operatorId).select('*').maybeSingle();
  if (result?.error) throw result.error;
  return result.data || null;
};

const listEntries = async (deps: Pick<PlaygroundServerDeps, 'db' | 'usePostgres'>, tenantId: string, shiftStartedAt?: string): Promise<any[]> => {
  if (deps.usePostgres) return pgPlaygroundListEntries(tenantId, shiftStartedAt);
  if (!deps.db) throw new Error('Persistência do Parquinho indisponível');
  let query = deps.db.from('parquinho_entries').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true });
  const normalizedShift = normalizeShiftStartedAt(shiftStartedAt);
  if (normalizedShift) query = query.eq('shift_started_at', normalizedShift);
  const result = await query;
  if (result?.error) throw result.error;
  return result?.data || [];
};

const atomicAddEntry = async (deps: PlaygroundServerDeps, args: {
  tenantId: string;
  requestId: string;
  tableId: number;
  childName: string | null;
  operatorId: string;
  operatorName: string;
  orderId: string | null;
  shiftStartedAt: string;
}): Promise<any> => {
  const injected = (deps as any).addEntryAtomic;
  if (typeof injected === 'function') return injected(args);
  if (deps.usePostgres) return pgPlaygroundAddEntry(args);
  if (!deps.db) throw new Error('Persistência do Parquinho indisponível');
  const result = await deps.db.rpc('playground_add_entry', {
    p_tenant_id: args.tenantId,
    p_request_id: args.requestId,
    p_table_id: args.tableId,
    p_child_name: args.childName,
    p_operator_id: args.operatorId,
    p_operator_name: args.operatorName,
    p_order_id: args.orderId,
    p_shift_started_at: args.shiftStartedAt,
  });
  if (result?.error) throw result.error;
  return result?.data;
};

const rowToOrder = (deps: PlaygroundServerDeps, row: any): any => {
  if (!row) return null;
  if (typeof deps.rowToOrder === 'function') return deps.rowToOrder(row);
  return row.table_id !== undefined ? {
    id: row.id,
    tableId: row.table_id,
    waiterId: row.waiter_id,
    waiterName: row.waiter_name,
    status: row.status,
    isComanda: row.is_comanda,
    timestamp: row.timestamp,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
    paymentLog: typeof row.payment_log === 'string' ? JSON.parse(row.payment_log) : (row.payment_log || []),
    deliveryLog: typeof row.delivery_log === 'string' ? JSON.parse(row.delivery_log) : (row.delivery_log || []),
  } : row;
};

const rowToTable = (deps: PlaygroundServerDeps, row: any): any => {
  if (!row) return null;
  if (typeof deps.rowToTable === 'function') return deps.rowToTable(row);
  return row.current_order !== undefined ? {
    id: row.id, status: row.status, currentOrder: row.current_order, linkedTo: row.linked_to,
  } : row;
};

const updateStateFromAtomicResult = (deps: PlaygroundServerDeps, tenantId: string, result: any) => {
  const state = deps.getState(tenantId);
  const order = rowToOrder(deps, result?.order);
  const table = rowToTable(deps, result?.table);
  if (order?.id !== undefined) {
    const index = (state.orders || []).findIndex((candidate: any) => String(candidate.id) === String(order.id));
    if (index >= 0) state.orders[index] = { ...state.orders[index], ...order };
    else state.orders.push(order);
  } else if (result?.item) {
    const target = (state.orders || []).find((candidate: any) => String(candidate.id) === String(result.item.order_id || result.item.orderId));
    if (target) target.items = [...(target.items || []), result.item];
  }
  if (table?.id !== undefined) {
    const tableIndex = (state.tables || []).findIndex((candidate: any) => String(candidate.id) === String(table.id));
    if (tableIndex >= 0) state.tables[tableIndex] = { ...state.tables[tableIndex], ...table };
  }
};

const sessionForSocket = (socket: any): any | null => {
  const token = sessionBySocket.get(socket.id);
  const session = token ? sessionsByToken.get(token) || null : null;
  if (session && session.expiresAt <= Date.now()) {
    removeSession(session);
    return null;
  }
  return session;
};

const removeSession = (session: any) => {
  if (!session) return;
  sessionsByToken.delete(session.token);
  if (session.socket) {
    sessionBySocket.delete(session.socket.id);
    leavePlaygroundRooms(session.socket);
    session.socket.playgroundConnection = false;
    session.socket.playgroundTenantId = undefined;
  }
};

const detachSessionSocket = (socket: any) => {
  const session = sessionForSocket(socket);
  if (!session) return;
  sessionBySocket.delete(socket.id);
  leavePlaygroundRooms(socket);
  socket.playgroundConnection = false;
  socket.playgroundTenantId = undefined;
  if (session.socket === socket) session.socket = null;
};

const buildData = async (deps: PlaygroundServerDeps, tenantId: string) => {
  const state = deps.getState(tenantId);
  const persisted = await listEntries(deps, tenantId);
  return projectPlaygroundData({ tenantId, state, buildId: deps.buildId, persistedEntries: persisted });
};

const emitDataToOperators = async (deps: PlaygroundServerDeps, tenantId: string) => {
  const data = await buildData(deps, tenantId);
  deps.io.to(roomFor(tenantId)).emit('parquinho_data', data);
  return data;
};

export const publishPlaygroundProjection = async (
  deps: Pick<PlaygroundServerDeps, 'db' | 'usePostgres' | 'getState' | 'buildId' | 'io'>,
  tenantId: string,
) => {
  const persisted = await listEntries(deps, tenantId);
  const data = projectPlaygroundData({
    tenantId, state: deps.getState(tenantId), buildId: deps.buildId, persistedEntries: persisted,
  });
  deps.io.to(roomFor(tenantId)).emit('parquinho_data', data);
  return data;
};

const requireApprovedSession = async (deps: PlaygroundServerDeps, tenantId: string): Promise<any> => {
  const session = sessionForSocket(deps.socket);
  if (!session || session.tenantId !== tenantId) throw new Error('Sessão do operador inválida');
  const operator = await findOperator(deps, tenantId, session.operatorId);
  if (!operator || operator.status !== 'approved') {
    deps.socket.emit('parquinho_operator_status', { status: operator?.status || 'inactive' });
    removeSession(session);
    throw new Error('Operador não aprovado ou inativo');
  }
  session.socket = deps.socket;
  session.expiresAt = Date.now() + PLAYGROUND_SESSION_TTL_MS;
  return { session, operator };
};

const canonicalRequestId = (payload: any): string => {
  const requestId = asText(payload?.requestId);
  if (!requestId || requestId.length > 160) throw new Error('requestId obrigatório');
  return requestId;
};

const getDedicatedTenant = (deps: PlaygroundServerDeps, payload: any): string => {
  const queryTenant = safeTenant(deps.socket.handshake?.query?.tenant);
  const bodyTenant = safeTenant(payload?.tenantId);
  const tenantId = queryTenant || bodyTenant;
  if (!tenantId) throw new Error('tenantId obrigatório');
  if (queryTenant && bodyTenant && queryTenant !== bodyTenant) throw new Error('tenant divergente');
  if (typeof deps.isDedicatedConnection === 'function' && !deps.isDedicatedConnection()) {
    throw new Error('Use a conexão dedicada do Parquinho');
  }
  return tenantId;
};

export const registerPlaygroundSocketHandlers = (deps: PlaygroundServerDeps): void => {
  const { socket } = deps;
  const isAdmin = () => typeof deps.isAdmin === 'function' && deps.isAdmin();

  socket.on('parquinho_register', async (rawPayload: any, rawAck: any) => {
    const { payload, callback } = getPayloadAndAck(rawPayload, rawAck);
    try {
      const tenantId = getDedicatedTenant(deps, payload);
      await deps.loadTenantIfNeeded(tenantId);
      const name = normalizeOperatorName(payload.name);
      if (!isNonEmptyName(name)) throw new Error('Nome obrigatório');
      const password = String(payload.password ?? '');
      const rows = await readOperators(deps, tenantId);
      const existing = rows.find((row: any) =>
        (payload.cpf && row.cpf && String(row.cpf) === String(payload.cpf)) ||
        (normalizeOperatorName(row.name).toLowerCase() === name.toLowerCase() && String(row.phone || '') === String(payload.phone || ''))
      );
      if (existing && !(await verifyPlaygroundPassword(password, existing.password_hash))) {
        throw new Error('Cadastro já existe; informe a senha original para atualizar.');
      }
      const row = await saveOperator(deps, {
        id: existing?.id || randomUUID(),
        tenant_id: tenantId,
        name,
        password_hash: await hashPlaygroundPassword(password),
        phone: payload.phone ? String(payload.phone).trim() : null,
        cpf: payload.cpf ? String(payload.cpf).trim() : null,
        birth_date: payload.birthDate ? String(payload.birthDate) : null,
        status: existing?.status || 'pending',
        role: PLAYGROUND_OPERATOR_ROLE,
      });
      const operator = publicOperator(row);
      // Operador pendente entra na sala para receber notificação quando o ADM aprovar
      if (operator.status === 'pending') {
        socket.join(roomFor(tenantId));
        socket.playgroundTenantId = tenantId;
      }
      const message = operator.status === 'approved' ? 'Cadastro atualizado.' : 'Cadastro enviado para aprovação do ADM.';
      sendAck(socket, 'parquinho_register', callback, { ok: true, message, operator });
    } catch (error: any) {
      sendAck(socket, 'parquinho_register', callback, { ok: false, message: error?.message || 'Não foi possível cadastrar.' });
    }
  });

  socket.on('parquinho_login', async (rawPayload: any, rawAck: any) => {
    const { payload, callback } = getPayloadAndAck(rawPayload, rawAck);
    try {
      const tenantId = getDedicatedTenant(deps, payload);
      await deps.loadTenantIfNeeded(tenantId);
      const name = normalizeOperatorName(payload.name);
      const rows = await readOperators(deps, tenantId);
      const candidates = rows.filter((row: any) => normalizeOperatorName(row.name).toLowerCase() === name.toLowerCase());
      let operatorRow: any = null;
      for (const candidate of candidates) {
        if (await verifyPlaygroundPassword(payload.password, candidate.password_hash)) {
          operatorRow = candidate;
          break;
        }
      }
      if (!operatorRow) throw new Error('Nome ou senha incorretos.');
      const operator = publicOperator(operatorRow);
      if (operatorRow.status !== 'approved') {
        if (operatorRow.status === 'pending') {
          // Operador pendente: entra na sala para receber notificação de aprovação
          socket.join(roomFor(tenantId));
          socket.playgroundTenantId = tenantId;
          sendAck(socket, 'parquinho_login', callback, {
            ok: true,
            message: 'Aguardando aprovação do ADM.',
            operator,
          });
        } else {
          sendAck(socket, 'parquinho_login', callback, {
            ok: false,
            message: 'Operador inativo.',
            operator,
          });
        }
        return;
      }
      const token = randomUUID() + randomUUID().replaceAll('-', '');
      const oldToken = sessionBySocket.get(socket.id);
      if (oldToken) removeSession(sessionsByToken.get(oldToken));
      const session = { token, tenantId, operatorId: String(operatorRow.id), socket, expiresAt: Date.now() + PLAYGROUND_SESSION_TTL_MS };
      sessionsByToken.set(token, session);
      sessionBySocket.set(socket.id, token);
      switchPlaygroundTenant(socket, tenantId);
      const data = await buildData(deps, tenantId);
      sendAck(socket, 'parquinho_login', callback, { ok: true, message: 'Login realizado.', token, operator, data });
    } catch (error: any) {
      sendAck(socket, 'parquinho_login', callback, { ok: false, message: error?.message || 'Não foi possível entrar.' });
    }
  });

  socket.on('parquinho_resume', async (rawPayload: any, rawAck: any) => {
    const { payload, callback } = getPayloadAndAck(rawPayload, rawAck);
    try {
      const tenantId = getDedicatedTenant(deps, payload);
      const token = asText(payload.token);
      const session = sessionsByToken.get(token);
      if (!session || session.tenantId !== tenantId) throw new Error('Sessão expirada. Faça login novamente.');
      if (session.expiresAt <= Date.now()) {
        removeSession(session);
        throw new Error('Sessão expirada. Faça login novamente.');
      }
      await deps.loadTenantIfNeeded(tenantId);
      const operatorRow = await findOperator(deps, tenantId, session.operatorId);
      if (!operatorRow || operatorRow.status !== 'approved') throw new Error('Operador não aprovado ou inativo.');
      if (session.socket && session.socket !== socket) {
        sessionBySocket.delete(session.socket.id);
        leavePlaygroundRooms(session.socket);
        session.socket.playgroundConnection = false;
        session.socket.playgroundTenantId = undefined;
      }
      session.socket = socket;
      session.expiresAt = Date.now() + PLAYGROUND_SESSION_TTL_MS;
      sessionBySocket.set(socket.id, token);
      switchPlaygroundTenant(socket, tenantId);
      const data = await buildData(deps, tenantId);
      sendAck(socket, 'parquinho_resume', callback, { ok: true, message: 'Sessão restaurada.', token, operator: publicOperator(operatorRow), data });
    } catch (error: any) {
      sendAck(socket, 'parquinho_resume', callback, { ok: false, message: error?.message || 'Não foi possível restaurar a sessão.' });
    }
  });

  socket.on('parquinho_logout', (rawPayload: any, rawAck: any) => {
    const { callback } = getPayloadAndAck(rawPayload, rawAck);
    removeSession(sessionForSocket(socket));
    leavePlaygroundRooms(socket);
    socket.playgroundTenantId = undefined;
    sendAck(socket, 'parquinho_logout', callback, { ok: true, message: 'Sessão encerrada.' });
  });

  socket.on('parquinho_request_data', async (rawPayload: any, rawAck: any) => {
    const { payload, callback } = getPayloadAndAck(rawPayload, rawAck);
    try {
      const tenantId = currentSocketTenant(deps);
      await requireApprovedSession(deps, tenantId);
      const data = await buildData(deps, tenantId);
      sendAck(socket, 'parquinho_request_data', callback, { ok: true, message: 'Dados carregados.', data });
    } catch (error: any) {
      sendAck(socket, 'parquinho_request_data', callback, { ok: false, message: error?.message || 'Acesso negado.' });
    }
  });

  socket.on('parquinho_add_entry', async (rawPayload: any, rawAck: any) => {
    const { payload, callback } = getPayloadAndAck(rawPayload, rawAck);
    try {
      const requestId = canonicalRequestId(payload);
      const tableId = Number(payload.tableId);
      if (!Number.isInteger(tableId) || tableId < 1) throw new Error('Mesa inválida');
      const childName = normalizeChildName(payload.childName);
      const command = async () => {
        const tenantId = currentSocketTenant(deps);
        const { operator } = await requireApprovedSession(deps, tenantId);
        const state = deps.getState(tenantId);
        const config = normalizePlaygroundConfig(tenantId, state.pizzariaConfig || {});
        if (!config.parquinhoEnabled) throw new Error('Modo Parquinho desativado.');
        if (canonicalMoney(config.parquinhoPrice) === null) throw new Error('Valor do Parquinho não configurado.');
        if (!state.isCashRegisterOpen) throw new Error('O caixa está fechado.');
        if (config.parquinhoChildNameRequired && !isNonEmptyName(childName)) throw new Error('Nome da criança obrigatório.');
        const table = (state.tables || []).find((candidate: any) => Number(candidate.id) === tableId);
        if (!table) throw new Error('Mesa não encontrada.');
        const existingOrder = table.currentOrder ? (state.orders || []).find((order: any) => String(order.id) === String(table.currentOrder)) : null;
        if (existingOrder && ['aguardando_baixa', 'finalizada', 'finalized', 'paid', 'cancelled', 'cancelada', 'canceled'].includes(String(existingOrder.status || '').toLowerCase())) {
          throw new Error('A mesa não possui pedido aberto para lançamento.');
        }
        const orderId = existingOrder ? String(existingOrder.id) : String(deps.generateOrderId?.(state, tenantId) ?? `parquinho-${randomUUID()}`);
        const result = await atomicAddEntry(deps, {
          tenantId,
          requestId,
          tableId,
          childName: childName || null,
          operatorId: String(operator.id),
          operatorName: operator.name,
          orderId: existingOrder ? null : orderId,
          shiftStartedAt: String(state.shiftStartedAt || new Date().toISOString()),
        });
        updateStateFromAtomicResult(deps, tenantId, result);
        const entryRow = result?.entry || result;
        const entry = entryRow?.order_id ? mapPlaygroundEntryRow(entryRow, tenantId) : entryRow;
        const currentState = deps.getState(tenantId);
        deps.io.to(`tenant:${tenantId}`).emit('update_orders', currentState.orders || []);
        deps.io.to(`tenant:${tenantId}`).emit('update_tables', currentState.tables || []);
        await emitDataToOperators(deps, tenantId);
        return entry;
      };
      const tenantId = currentSocketTenant(deps);
      const entry = deps.withTenantCommand ? await deps.withTenantCommand(tenantId, command) : await command();
      sendAck(socket, 'parquinho_add_entry', callback, { ok: true, message: 'Lançamento registrado.', entry });
    } catch (error: any) {
      sendAck(socket, 'parquinho_add_entry', callback, { ok: false, message: error?.message || 'Não foi possível registrar o lançamento.' });
    }
  });

  socket.on('parquinho_get_operators', async (rawPayload: any, rawAck: any) => {
    const { callback } = getPayloadAndAck(rawPayload, rawAck);
    try {
      if (!isAdmin()) throw new Error('Acesso restrito ao administrador.');
      const tenantId = deps.getTenantId();
      const rows = await readOperators(deps, tenantId);
      sendAck(socket, 'parquinho_get_operators', callback, { ok: true, message: 'Operadores carregados.', operators: rows.map(publicOperator) });
    } catch (error: any) {
      sendAck(socket, 'parquinho_get_operators', callback, { ok: false, message: error?.message || 'Acesso negado.' });
    }
  });

  socket.on('parquinho_set_operator_status', async (rawPayload: any, rawAck: any) => {
    const { payload, callback } = getPayloadAndAck(rawPayload, rawAck);
    try {
      if (!isAdmin()) throw new Error('Acesso restrito ao administrador.');
      if (!isValidPlaygroundStatus(payload.status)) throw new Error('Status inválido.');
      const tenantId = deps.getTenantId();
      const row = await setOperatorStatus(deps, tenantId, asText(payload.operatorId), payload.status);
      if (!row) throw new Error('Operador não encontrado.');
      // Broadcast to all sockets in the playground room (includes pending operators without session)
      io.to(roomFor(tenantId)).emit('parquinho_operator_status', { operatorId: String(row.id), status: row.status });
      // Clean up session if operator was revoked/inactivated
      for (const session of [...sessionsByToken.values()]) {
        if (session.tenantId === tenantId && session.operatorId === String(row.id)) {
          if (row.status !== 'approved') removeSession(session);
        }
      }
      await emitDataToOperators(deps, tenantId);
      sendAck(socket, 'parquinho_set_operator_status', callback, { ok: true, message: 'Status atualizado.', operator: publicOperator(row) });
    } catch (error: any) {
      sendAck(socket, 'parquinho_set_operator_status', callback, { ok: false, message: error?.message || 'Não foi possível atualizar o status.' });
    }
  });

  socket.on('parquinho_get_report', async (rawPayload: any, rawAck: any) => {
    const { payload, callback } = getPayloadAndAck(rawPayload, rawAck);
    try {
      if (!isAdmin()) throw new Error('Acesso restrito ao administrador.');
      const tenantId = deps.getTenantId();
      const state = deps.getState(tenantId);
      const shiftStartedAt = normalizeShiftStartedAt(payload.shiftStartedAt) || normalizeShiftStartedAt(state.shiftStartedAt) || '';
      const rows = await listEntries(deps, tenantId, shiftStartedAt || undefined);
      const entries = rows.map((row: any) => mapPlaygroundEntryRow(row, tenantId));
      const shifts = [...new Set((await listEntries(deps, tenantId))
        .map((row: any) => normalizeShiftStartedAt(row.shift_started_at))
        .filter((shift): shift is string => Boolean(shift)))];
      sendAck(socket, 'parquinho_get_report', callback, { ok: true, message: 'Relatório carregado.', entries, shiftStartedAt, shifts });
    } catch (error: any) {
      sendAck(socket, 'parquinho_get_report', callback, { ok: false, message: error?.message || 'Não foi possível carregar o relatório.' });
    }
  });

  socket.on('disconnect', () => {
    detachSessionSocket(socket);
    leavePlaygroundRooms(socket);
  });
};

export const isPlaygroundOperatorSocketEventAllowed = playgroundEventAllowedForOperator;
export { roomFor as playgroundRoomFor, switchPlaygroundTenant };
