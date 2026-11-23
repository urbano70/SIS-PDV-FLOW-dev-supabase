#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'server.ts');
const REPORT_PATH = '/home/ubuntu/pdv-liberacao-pedido-20261123/teste-fluxo-relatorio.md';
const TENANTS = ['tenant-a', 'tenant-b'];
const EVENTS = ['new_order', 'add_item_to_order', 'pay_items', 'confirm_baixa', 'force_release_table'];
const source = fs.readFileSync(SERVER_PATH, 'utf8');
const sourceFile = ts.createSourceFile(SERVER_PATH, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const isFunctionNode = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);
const nodeLine = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function findInitializer(name) {
  let found;
  walk(sourceFile, (node) => {
    if (found || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== name) return;
    if (node.initializer) found = node.initializer;
  });
  assert.ok(found, `initializer AST ausente: ${name}`);
  return found;
}

function extractHandlers() {
  const handlers = new Map();
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'onTenantCommand') return;
    const event = node.arguments[0];
    if (!ts.isStringLiteral(event) || !EVENTS.includes(event.text)) return;
    let callback = node.arguments[1];
    if (callback && ts.isCallExpression(callback) && ts.isIdentifier(callback.expression) && callback.expression.text === 'requireAdmin') {
      callback = callback.arguments[0];
    }
    assert.ok(callback && isFunctionNode(callback), `callback AST ausente: ${event.text}`);
    handlers.set(event.text, { node: callback, line: nodeLine(callback), wrapperLine: nodeLine(node) });
  });
  assert.deepEqual([...handlers.keys()].sort(), [...EVENTS].sort(), 'os cinco callbacks não foram extraídos do server.ts');
  return handlers;
}

const extracted = extractHandlers();
const helperNodes = {
  replaceStagedOrderState: findInitializer('replaceStagedOrderState'),
  ensureCurrentCommandSession: findInitializer('ensureCurrentCommandSession'),
  onTenantCommand: findInitializer('onTenantCommand'),
  requireAdmin: findInitializer('requireAdmin'),
};

function transpileExpression(text, label) {
  const result = ts.transpileModule(`result = (${text});`, {
    fileName: `${label}.ts`,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      sourceMap: false,
      removeComments: false,
    },
  });
  return result.outputText;
}

function evaluateNode(node, context, label) {
  context.result = undefined;
  new vm.Script(transpileExpression(node.getText(sourceFile), label), { filename: `${label}.ts` }).runInContext(context);
  const value = context.result;
  delete context.result;
  assert.equal(typeof value, 'function', `${label} não produziu função`);
  return value;
}

class OrderCommandError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'OrderCommandError';
    this.code = code;
    this.status = status;
  }
}

function makeAck(tenantId, patch = {}) {
  return { ok: false, tenantId: String(tenantId || ''), ...patch };
}

function makeState(options = {}) {
  const orderId = options.orderId || 'order-8';
  const order = {
    id: orderId,
    tableId: options.orderTableId === undefined ? 8 : options.orderTableId,
    waiterId: 'waiter-1',
    waiterName: 'Garçom Fake',
    status: options.orderStatus || 'pending',
    isComanda: Boolean(options.isComanda),
    timestamp: '2026-11-23T23:00:00.000Z',
    items: clone(options.items || [{ id: 'pao', name: 'Pão', price: 7, quantity: 1 }]),
    paymentLog: clone(options.paymentLog || []),
    deliveryLog: [],
    ...(options.orderExtra || {}),
  };
  const entity = {
    id: options.tableId === undefined ? 8 : options.tableId,
    status: options.tableStatus || 'occupied',
    currentOrder: options.entityCurrentOrder === undefined ? orderId : options.entityCurrentOrder,
    linkedTo: options.linkedTo === undefined ? null : options.linkedTo,
  };
  return {
    orders: [order],
    tables: options.isComanda ? [] : [entity],
    comandas: options.isComanda ? [entity] : [],
    waiters: [{ id: 'waiter-1', name: 'João Fake', status: 'active' }],
    menu: [{ type: 'food', name: 'Comidas', items: [{ id: 'pao', name: 'Pão' }] }],
    isCashRegisterOpen: options.isCashRegisterOpen !== false,
    openCashRegisters: {},
    isAdmin: false,
    dailyCounter: 0,
    lastOrderDate: '',
  };
}

function createEnvironment(options = {}) {
  let tenantId = options.tenantId || 'tenant-a';
  let commitResolved = false;
  let commitAttempts = 0;
  const durableCommits = [];
  const sideEffects = [];
  const socketEvents = [];
  const audits = [];
  const sessions = [];
  let uuidCounter = 0;
  const stateOptions = options.stateOptions || {};
  const stateByTenant = Object.fromEntries(TENANTS.map((tenant) => [tenant, makeState(stateOptions)]));
  const state = () => stateByTenant[tenantId];
  const role = options.role || 'admin';

  const socket = {
    id: 'socket-fake',
    connected: true,
    tenantId,
    tenantGeneration: 1,
    waiterId: 'waiter-1',
    waiterName: 'João Fake',
    activeCashRegisterName: null,
    authContext: { tenantId, role, waiterId: 'waiter-1' },
    handlers: {},
    on(event, handler) { this.handlers[event] = handler; },
    emit(event, payload) {
      socketEvents.push({ event, payload: clone(payload), durable: commitResolved });
    },
  };

  const record = (kind, payload) => sideEffects.push({ kind, payload: clone(payload), durable: commitResolved });
  const io = {
    to() {
      return { emit(event, payload) { record(event, payload); } };
    },
    sockets: { adapter: { rooms: new Map() } },
  };

  const commitCriticalOrderState = async (input) => {
    commitAttempts += 1;
    if (options.commitReject) {
      throw new OrderCommandError('ORDER_STATE_COMMIT_FAILED', 'commit fake rejeitado', 503);
    }
    // The mock does not mutate the state and clones only after the simulated durable commit resolves.
    commitResolved = true;
    durableCommits.push(clone(input));
    return { ok: true, tenantId: input.tenantId, orderId: input.order?.id };
  };

  const context = vm.createContext({
    console,
    socket,
    io,
    JSON,
    Math,
    Date,
    Set,
    Object,
    Number,
    String,
    Boolean,
    Array,
    Promise,
    Error,
    OrderCommandError,
    makeAck,
    _tid: () => tenantId,
    _st: () => state(),
    _room: () => `room:${tenantId}`,
    getState: (id) => stateByTenant[id],
    loadTenantIfNeeded: async () => undefined,
    commitCriticalOrderState,
    isPlaygroundReservedItem: () => false,
    getEffectiveItemPrice: (item) => Number(item?.price) || 0,
    randomUUID: () => `uuid-${++uuidCounter}`,
    emitPrintOrder: (payload) => record('print_order', payload),
    applyStockReduction: (_st, _tenant, items) => record('stock_reduction', items),
    writeAudit: (tenant, type, actor, message, details) => audits.push({ tenant, type, actor, message, details: clone(details), durable: commitResolved }),
    saveToSupabase: async (...args) => record('save_to_supabase', args),
    cashRegisterConfigPatch: (st, patch) => ({ ...st, ...patch }),
    activateClientSession: (...args) => sessions.push({ type: 'activate', args: clone(args) }),
    getClientSession: () => null,
    invalidateClientSession: (...args) => sessions.push({ type: 'invalidate', args: clone(args) }),
    isAdminForTenant: (id) => role === 'admin' && String(id) === tenantId,
    isApprovedWaiterSocket: (id) => {
      if (role === 'admin' && String(id) === tenantId) return true;
      const waiter = stateByTenant[id]?.waiters?.find((candidate) => String(candidate.id) === String(socket.waiterId));
      return role === 'waiter' && String(id) === tenantId && waiter?.status === 'active';
    },
    commandSessionIsCurrent: (id) => socket.connected !== false && String(socket.tenantId) === String(id) && Number(socket.tenantGeneration) === 1 && context.isApprovedWaiterSocket(id),
    withTenantCommand: async (_id, operation) => operation(),
    ackCommandEvents: new Set(EVENTS),
  });

  context.replaceStagedOrderState = evaluateNode(helperNodes.replaceStagedOrderState, context, 'replaceStagedOrderState');
  context.ensureCurrentCommandSession = evaluateNode(helperNodes.ensureCurrentCommandSession, context, 'ensureCurrentCommandSession');
  const handlers = Object.fromEntries(EVENTS.map((event) => [event, evaluateNode(extracted.get(event).node, context, `handler-${event}`)]));
  const actualOnTenantCommand = evaluateNode(helperNodes.onTenantCommand, context, 'onTenantCommand');
  const actualRequireAdmin = evaluateNode(helperNodes.requireAdmin, context, 'requireAdmin');

  return {
    context,
    socket,
    handlers,
    actualOnTenantCommand,
    actualRequireAdmin,
    stateByTenant,
    get state() { return state(); },
    sideEffects,
    socketEvents,
    audits,
    sessions,
    durableCommits,
    get commitAttempts() { return commitAttempts; },
    get commitResolved() { return commitResolved; },
    useTenant(id) {
      assert.ok(TENANTS.includes(id), `tenant fixture desconhecido: ${id}`);
      tenantId = id;
      socket.tenantId = id;
      socket.authContext = { ...socket.authContext, tenantId: id };
    },
    async direct(event, payload) {
      return handlers[event](payload);
    },
    register(event, protectedHandler = handlers[event]) {
      actualOnTenantCommand(event, protectedHandler);
      assert.equal(typeof socket.handlers[event], 'function', `wrapper não registrou ${event}`);
      return socket.handlers[event];
    },
  };
}

function mutationEffects(env) {
  return env.sideEffects.filter((entry) => ['update_orders', 'update_tables', 'update_comandas', 'kitchen_new_order', 'print_order', 'stock_reduction'].includes(entry.kind));
}

function assertAllMutationEffectsDurable(env) {
  assert.ok(mutationEffects(env).every((entry) => entry.durable), 'houve broadcast/efeito de mutação antes do commit durável');
  assert.ok(env.audits.every((entry) => entry.durable), 'houve auditoria antes do commit durável');
}

const tests = [];
function test(name, event, fn) {
  tests.push({ name, event, line: extracted.get(event).line, fn });
}

// Force release: finalized orders retain their paid history and existing flags.
test('force final occupied preserva histórico pago/status/flags', 'force_release_table', async () => {
  const paymentLog = [{ amount: 7, method: 'pix', requestId: 'pay-1' }];
  const env = createEnvironment({ stateOptions: { orderStatus: 'finalizada', paymentLog, orderExtra: { forceReleased: false, customFlag: 'keep' }, tableId: '8' } });
  const beforeOrder = clone(env.state.orders[0]);
  const ack = await env.direct('force_release_table', { orderId: 'order-8', tableId: 8, isComanda: false });
  assert.equal(ack.ok, true);
  assert.equal(ack.alreadyApplied, true);
  assert.deepEqual(env.state.orders[0], { ...beforeOrder });
  assert.deepEqual(env.state.orders[0].paymentLog, paymentLog);
  assert.equal(env.state.tables[0].status, 'free');
  assert.equal(env.state.tables[0].currentOrder, null);
  assert.equal(env.state.tables[0].linkedTo, null);
  assert.equal(env.durableCommits.length, 1);
  assert.deepEqual(env.durableCommits[0].order.paymentLog, paymentLog);
  assertAllMutationEffectsDurable(env);
});

test('force retry é idempotente sem segundo commit', 'force_release_table', async () => {
  const env = createEnvironment({ stateOptions: { tableId: 8 } });
  const first = await env.direct('force_release_table', { orderId: 'order-8', tableId: '8', isComanda: false });
  const snapshot = clone(env.state);
  const auditsAfterFirst = env.audits.length;
  const second = await env.direct('force_release_table', { orderId: 'order-8', tableId: 8, isComanda: false });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyApplied, true);
  assert.equal(env.durableCommits.length, 1);
  assert.deepEqual(clone(env.state), snapshot);
  assert.equal(env.audits.length, auditsAfterFirst);
});

test('force não toca mesa com pedido atual mais novo', 'force_release_table', async () => {
  const env = createEnvironment({ stateOptions: { tableId: '8' } });
  env.state.tables.push({ id: 9, status: 'occupied', currentOrder: 'order-newer', linkedTo: null });
  const beforeNewer = clone(env.state.tables[1]);
  await env.direct('force_release_table', { orderId: 'order-8', tableId: '8', isComanda: false });
  assert.deepEqual(env.state.tables[1], beforeNewer);
  assert.equal(env.state.tables[0].status, 'free');
});

test('force ativo não cria pagamento falso', 'force_release_table', async () => {
  const env = createEnvironment({ stateOptions: { paymentLog: [] } });
  const ack = await env.direct('force_release_table', { orderId: 'order-8', tableId: 8, isComanda: false });
  assert.equal(ack.ok, true);
  assert.equal(env.state.orders[0].status, 'finalizada');
  assert.equal(env.state.orders[0].forceReleased, true);
  assert.deepEqual(env.state.orders[0].paymentLog, []);
  assert.equal(env.durableCommits[0].order.paymentLog.length, 0);
});

test('force é isolado por tenant mesmo com IDs iguais', 'force_release_table', async () => {
  const env = createEnvironment();
  const otherBefore = clone(env.stateByTenant['tenant-b']);
  await env.direct('force_release_table', { orderId: 'order-8', tableId: 8, isComanda: false });
  assert.deepEqual(env.stateByTenant['tenant-b'], otherBefore);
  assert.equal(env.durableCommits[0].tenantId, 'tenant-a');
  env.useTenant('tenant-b');
  assert.equal(env.state.orders[0].status, 'pending');
  assert.equal(env.state.tables[0].status, 'occupied');
});

// Payment transitions.
test('pagamento ADM integral finaliza e libera', 'pay_items', async () => {
  const env = createEnvironment({ role: 'admin', stateOptions: { tableId: '8' } });
  const ack = await env.direct('pay_items', { orderId: 'order-8', selectedItems: { pao: 1 }, paymentMethod: 'pix', fromAdmin: true, adminCashRegisterName: 'ADM', requestId: 'req-adm-1' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(env.state.orders[0].status, 'finalizada');
  assert.equal(env.state.tables[0].status, 'free');
  assert.equal(env.state.tables[0].currentOrder, null);
  assert.equal(env.state.orders[0].paymentLog.length, 1);
  assert.equal(env.state.orders[0].paymentLog[0].amount, 7);
  assert.equal(env.state.orders[0].paymentLog[0].requestId, 'req-adm-1');
  assertAllMutationEffectsDurable(env);
});

test('pagamento integral de garçom fica aguardando baixa', 'pay_items', async () => {
  const env = createEnvironment({ role: 'waiter', stateOptions: { tableId: 8 } });
  const ack = await env.direct('pay_items', { orderId: 'order-8', selectedItems: { pao: 1 }, paymentMethod: 'dinheiro', fromAdmin: false, requestId: 'req-waiter-1' });
  assert.equal(ack.ok, true);
  assert.equal(env.state.orders[0].status, 'aguardando_baixa');
  assert.equal(env.state.tables[0].status, 'aguardando_baixa');
  assert.equal(env.state.tables[0].currentOrder, 'order-8');
  assert.equal(env.state.orders[0].paymentLog.length, 1);
});

test('pagamento parcial não libera a mesa', 'pay_items', async () => {
  const env = createEnvironment({ role: 'waiter' });
  const ack = await env.direct('pay_items', { orderId: 'order-8', selectedItems: {}, partialAmount: 3, paymentMethod: 'pix', requestId: 'req-partial-1' });
  assert.equal(ack.ok, true);
  assert.equal(env.state.orders[0].status, 'pending');
  assert.equal(env.state.tables[0].status, 'occupied');
  assert.equal(env.state.tables[0].currentOrder, 'order-8');
  assert.equal(env.state.orders[0].paymentLog[0].type, 'partial');
});

test('pagamento de pedido finalizado rejeita sem novo log', 'pay_items', async () => {
  const paymentLog = [{ amount: 7, method: 'pix', requestId: 'old' }];
  const env = createEnvironment({ stateOptions: { orderStatus: 'finalizada', paymentLog } });
  const before = clone(env.state);
  const ack = await env.direct('pay_items', { orderId: 'order-8', selectedItems: { pao: 1 }, paymentMethod: 'pix', fromAdmin: true, requestId: 'new' });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'ORDER_ALREADY_FINALIZED');
  assert.equal(env.commitAttempts, 0);
  assert.deepEqual(env.state, before);
});

test('retry com requestId duplicado não grava segundo pagamento', 'pay_items', async () => {
  const env = createEnvironment({ role: 'admin' });
  await env.direct('pay_items', { orderId: 'order-8', selectedItems: { pao: 1 }, paymentMethod: 'pix', fromAdmin: true, requestId: 'same-request' });
  const afterFirst = clone(env.state.orders[0].paymentLog);
  const second = await env.direct('pay_items', { orderId: 'order-8', selectedItems: { pao: 1 }, paymentMethod: 'pix', fromAdmin: true, requestId: 'same-request' });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyApplied, true);
  assert.equal(env.durableCommits.length, 1);
  assert.deepEqual(clone(env.state.orders[0].paymentLog), afterFirst);
});

test('seleção de item já pago é inválida sem persistência', 'pay_items', async () => {
  const env = createEnvironment({ stateOptions: { items: [{ id: 'pao', name: 'Pão', price: 7, quantity: 1, paid: true }] } });
  const before = clone(env.state);
  const ack = await env.direct('pay_items', { orderId: 'order-8', selectedItems: { pao: 1 }, paymentMethod: 'pix', requestId: 'invalid-paid' });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'PAYMENT_QUANTITY_INVALID');
  assert.equal(env.commitAttempts, 0);
  assert.deepEqual(env.state, before);
});

// Cashier confirmation.
test('confirm_baixa finaliza e libera', 'confirm_baixa', async () => {
  const env = createEnvironment({ role: 'admin', stateOptions: { orderStatus: 'aguardando_baixa', tableStatus: 'aguardando_baixa', tableId: '8' } });
  const ack = await env.direct('confirm_baixa', { orderId: 'order-8' });
  assert.equal(ack.ok, true);
  assert.equal(env.state.orders[0].status, 'finalizada');
  assert.equal(env.state.tables[0].status, 'free');
  assert.equal(env.state.tables[0].currentOrder, null);
  assert.equal(env.state.orders[0].paymentLog.length, 0);
});

test('confirm_baixa retry é idempotente', 'confirm_baixa', async () => {
  const env = createEnvironment({ stateOptions: { orderStatus: 'aguardando_baixa', tableStatus: 'aguardando_baixa' } });
  await env.direct('confirm_baixa', { orderId: 'order-8' });
  const snapshot = clone(env.state);
  const retry = await env.direct('confirm_baixa', { orderId: 'order-8' });
  assert.equal(retry.ok, true);
  assert.equal(retry.alreadyApplied, true);
  assert.equal(env.durableCommits.length, 1);
  assert.deepEqual(clone(env.state), snapshot);
});

// Add-item and new-order durability/idempotency.
test('add_item rejeita pedido finalizado', 'add_item_to_order', async () => {
  const env = createEnvironment({ stateOptions: { orderStatus: 'finalizada' } });
  const before = clone(env.state);
  const ack = await env.direct('add_item_to_order', { orderId: 'order-8', item: { id: 'cafe', name: 'Café', price: 4, quantity: 1 } });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'ORDER_FINALIZED');
  assert.equal(env.commitAttempts, 0);
  assert.deepEqual(env.state, before);
});

test('add_item duplicado responde ACK já aplicado', 'add_item_to_order', async () => {
  const env = createEnvironment();
  const ack = await env.direct('add_item_to_order', { orderId: 'order-8', item: { id: 'pao', name: 'Pão', price: 7, quantity: 1 } });
  assert.equal(ack.ok, true);
  assert.equal(ack.alreadyApplied, true);
  assert.equal(env.commitAttempts, 0);
  assert.equal(env.state.orders[0].items.length, 1);
});

test('falha de persistência em add_item não altera pedido/mesa', 'add_item_to_order', async () => {
  const env = createEnvironment({ commitReject: true });
  const before = clone(env.state);
  await assert.rejects(
    env.direct('add_item_to_order', { orderId: 'order-8', item: { id: 'cafe', name: 'Café', price: 4, quantity: 1 } }),
    (error) => error instanceof OrderCommandError && error.code === 'ORDER_STATE_COMMIT_FAILED',
  );
  assert.equal(env.commitAttempts, 1);
  assert.equal(env.durableCommits.length, 0);
  assert.deepEqual(env.state, before);
  assert.equal(mutationEffects(env).length, 0);
  assert.equal(env.audits.length, 0);
});

test('new_order com ponteiro final cria novo pedido e retorna ID gerado', 'new_order', async () => {
  const oldPaymentLog = [{ amount: 7, method: 'pix', requestId: 'historic' }];
  const env = createEnvironment({ stateOptions: { orderStatus: 'finalizada', paymentLog: oldPaymentLog, tableId: 8, orderTableId: 8 } });
  const oldOrder = clone(env.state.orders[0]);
  const ack = await env.direct('new_order', {
    tableId: '8',
    isComanda: false,
    requestId: 'browser-nonce-not-order-id',
    items: [{ id: 'cafe', name: 'Café', price: 4, quantity: 1 }],
  });
  assert.equal(ack.ok, true);
  assert.ok(ack.orderId && ack.orderId !== 'order-8', 'ACK deve trazer ID gerado pelo servidor');
  assert.equal(env.state.orders.length, 2);
  assert.deepEqual(env.state.orders.find((order) => order.id === 'order-8'), oldOrder);
  const fresh = env.state.orders.find((order) => String(order.id) === String(ack.orderId));
  assert.ok(fresh, 'pedido novo não foi aplicado ao estado');
  assert.equal(fresh.status, 'pending');
  assert.deepEqual(fresh.paymentLog || [], []);
  assert.equal(fresh.requestId, undefined);
  assert.equal(String(env.state.tables[0].currentOrder), String(ack.orderId));
  assert.equal(env.durableCommits[0].order.id, ack.orderId);
});

// Exercise the actual inferred ACK/session/admin wrappers around extracted callbacks.
test('wrapper real ACK de sucesso é único e tenant-scoped', 'new_order', async () => {
  const env = createEnvironment({ role: 'admin' });
  const wrapped = env.register('new_order');
  const acks = [];
  await wrapped({ tableId: 8, isComanda: false, items: [{ id: 'cafe', name: 'Café', price: 4, quantity: 1 }] }, (ack) => acks.push(ack));
  assert.equal(acks.length, 1);
  assert.equal(acks[0].ok, true);
  assert.equal(acks[0].tenantId, 'tenant-a');
  assert.ok(acks[0].orderId);
  assertAllMutationEffectsDurable(env);
});

test('wrapper real ACK de rejeição é único e false', 'new_order', async () => {
  const env = createEnvironment({ role: 'admin', stateOptions: { isCashRegisterOpen: false } });
  const wrapped = env.register('new_order');
  const acks = [];
  await wrapped({ tableId: 8, isComanda: false, items: [{ id: 'cafe', name: 'Café', price: 4, quantity: 1 }] }, (ack) => acks.push(ack));
  assert.equal(acks.length, 1);
  assert.equal(acks[0].ok, false);
  assert.equal(acks[0].code, 'CASH_REGISTER_CLOSED');
  assert.equal(env.commitAttempts, 0);
});

test('wrapper requireAdmin rejeita garçom com ACK false único', 'force_release_table', async () => {
  const env = createEnvironment({ role: 'waiter' });
  const guarded = env.actualRequireAdmin(env.handlers.force_release_table);
  const wrapped = env.register('force_release_table', guarded);
  const acks = [];
  await wrapped({ orderId: 'order-8', tableId: 8, isComanda: false }, (ack) => acks.push(ack));
  assert.equal(acks.length, 1);
  assert.equal(acks[0].ok, false);
  assert.equal(env.commitAttempts, 0);
  assert.equal(env.state.tables[0].status, 'occupied');
});

async function run() {
  const results = [];
  for (const current of tests) {
    try {
      await current.fn();
      results.push({ ...current, ok: true });
      console.log(`ok - ${current.name}`);
    } catch (error) {
      results.push({ ...current, ok: false, error });
      console.error(`not ok - ${current.name}: ${error.stack || error}`);
    }
  }
  const failures = results.filter((entry) => !entry.ok);
  const passed = results.length - failures.length;
  const report = [
    '# Relatório do fluxo offline de liberação de pedido',
    '',
    `- Script: \`scripts/test-order-release-flow.cjs\``,
    `- Fonte extraída: \`server.ts\` (AST TypeScript; sem import do servidor, HTTP, banco, browser ou servidor real)`,
    `- Resultado: **${passed}/${results.length} testes aprovados**`,
    `- Handlers: ${EVENTS.map((event) => `${event} (server.ts:${extracted.get(event).line})`).join(', ')}`,
    '',
    '## Cobertura confirmada',
    '',
    'Fixtures offline com `tenant-a`/`tenant-b` e IDs iguais, pedido `order-8`, item `pao` de R$ 7, `paymentLog` controlado, IDs numéricos/string, staging real extraído (`replaceStagedOrderState`) e sessão real extraída (`ensureCurrentCommandSession`). O commit é um mock sem chamada externa: só clona o input após resolução e nunca muta o estado antes do commit.',
    '',
    '- force release final/ativo, preservação de histórico/status/flags, retry idempotente, mesa com pedido mais novo, isolamento por tenant e ausência de pagamento falso;',
    '- pagamento ADM integral/liberação, pagamento de garçom/`aguardando_baixa`, parcial sem liberação, finalizado rejeitado sem log, `requestId` duplicado e seleção já paga inválida;',
    '- `confirm_baixa`/retry, `add_item_to_order` finalizado/duplicado/falha de persistência atômica, `new_order` sobre ponteiro final com novo ID e histórico preservado;',
    '- ACK real inferido dos wrappers `onTenantCommand`/`requireAdmin`, incluindo sucesso e rejeição `false` sem callback duplicado.',
    '',
    '## Falhas confirmadas',
    '',
    failures.length === 0
      ? 'Nenhuma falha confirmada neste checkout.'
      : failures.map((entry) => `- **${entry.name}** — handler extraído em \`server.ts:${entry.line}\`: ${entry.error?.message || entry.error}`).join('\n'),
    '',
    '## Escopo e caveats',
    '',
    'Não foram executados lint/build, SQL, Git, HTTP, browser ou servidor real. O relatório não classifica bugs preexistentes fora destes cinco handlers. O processo retorna código 1 se qualquer cenário acima falhar.',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(`\nRelatório: ${REPORT_PATH}`);
  if (failures.length) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
