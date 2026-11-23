#!/usr/bin/env node
'use strict';
// Source/contract tests only: no React mount, server, auth, database or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const dashboard = read('src/components/Dashboard.tsx');
const paymentModal = read('src/components/PaymentModal.tsx');
const helperSource = read('src/lib/order-command.ts');

function parse(fileName, source, kind = ts.ScriptKind.TSX) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
}
function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}
function findArrow(source, name) {
  const file = parse('Dashboard.tsx', source);
  let found = null;
  visit(file, node => {
    if (found || !ts.isVariableDeclaration(node) || node.name.getText(file) !== name) return;
    if (node.initializer && ts.isArrowFunction(node.initializer)) found = node.initializer;
  });
  assert.ok(found, `${name} não encontrado`);
  return { file, node: found };
}
function assertFirstGuard(name) {
  const { file, node } = findArrow(dashboard, name);
  assert.ok(ts.isBlock(node.body), `${name} deve ter corpo em bloco`);
  const first = node.body.statements[0];
  assert.ok(ts.isIfStatement(first), `${name} deve começar pelo guard de prontidão`);
  assert.equal(first.expression.getText(file), '!canMutate()', `${name} deve usar exatamente !canMutate()`);
  assert.match(first.thenStatement.getText(file), /return;/, `${name} deve retornar sem fechar a seleção/enviar`);
}
assertFirstGuard('handleAddItem');
assertFirstGuard('confirmQuantitySelection');
assert.ok(!dashboard.includes('pendingOpsRef'), 'fila de closures antiga não pode permanecer');
assert.ok(!dashboard.includes('Imprimindo comprovante'), 'mensagem de impressão falsa não pode permanecer');
assert.ok(paymentModal.includes('Promise<boolean | void> | boolean | void'), 'callback legado/assíncrono não coberto');
assert.ok(paymentModal.includes('isSubmittingRef.current'), 'lock por ref ausente no modal');
assert.ok(paymentModal.includes('if (isSubmittingRef.current) return;'), 'duplo clique não está bloqueado');
assert.ok(paymentModal.includes('disabled={isSubmitting}'), 'estado de envio não desabilita ações');
assert.ok(dashboard.includes("event: 'pay_items'"), 'pagamento não usa helper comum');
assert.ok(dashboard.includes("event: 'confirm_baixa'"), 'baixa não usa helper comum');
assert.ok(dashboard.includes("event: 'force_release_table'"), 'force release não usa helper comum');
assert.ok(dashboard.includes("event: 'new_order'") && dashboard.includes("event: 'add_item_to_order'"), 'os dois caminhos de inclusão não estão cobertos');

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-command-client-'));
  const bundle = path.join(tempDir, 'order-command.cjs');
  try {
  esbuild.buildSync({
    stdin: { contents: helperSource, sourcefile: 'order-command.ts', loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile: bundle,
    logLevel: 'silent',
  });
  const {
    sendOrderCommand,
    OrderCommandError,
    orderCommandMessage,
  } = require(bundle);

  const makeSocket = ({ connected = true, id = 'socket-a', callback, delay = 0 } = {}) => {
    const calls = [];
    return {
      connected,
      id,
      calls,
      emit(event, payload, ack) {
        calls.push({ event, payload, ack });
        if (callback) {
          if (delay) setTimeout(() => callback(payload, ack), delay);
          else callback(payload, ack);
        }
        return this;
      },
    };
  };
  const scope = { tenantId: 'tenant-a', socketId: 'socket-a', lifecycle: 1 };
  const base = {
    socket: makeSocket({ callback: (_payload, ack) => ack({ ok: true, tenantId: 'tenant-a', orderId: 'order-1', status: 'pending' }) }),
    event: 'add_item_to_order',
    tenantId: 'tenant-a',
    requestId: 'request-1',
    orderId: 'order-1',
    payload: { orderId: 'order-1', item: { id: 'item-1' } },
    canMutate: () => true,
    getScope: () => scope,
    timeoutMs: 50,
  };

  // 1) ready=false never emits and does not create a silent queue.
  {
    const socket = makeSocket();
    await awaitReject(sendOrderCommand({ ...base, socket, canMutate: () => false }), 'not_ready');
    assert.equal(socket.calls.length, 0);
  }

  // 2) Explicit ACK false is surfaced, with the exact scope envelope intact.
  {
    let refreshes = 0;
    const socket = makeSocket({ callback: (_payload, ack) => ack({
      ok: false,
      code: 'ORDER_FINALIZED',
      message: 'Pedido finalizado.',
      tenantId: 'tenant-a',
      orderId: 'order-1',
      status: 'finalizada',
    }) });
    const result = await sendOrderCommand({ ...base, socket, refreshSnapshot: () => { refreshes += 1; } });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ORDER_FINALIZED');
    assert.equal(socket.calls[0].payload.tenantId, 'tenant-a');
    assert.equal(socket.calls[0].payload.requestId, 'request-1');
    assert.equal(refreshes, 1);
  }

  // 3) Timeout is explicit, emits exactly once and never retries a command.
  {
    let refreshes = 0;
    const socket = makeSocket();
    const error = await awaitReject(sendOrderCommand({
      ...base,
      socket,
      timeoutMs: 5,
      refreshSnapshot: () => { refreshes += 1; },
    }), 'timeout');
    assert.equal(error.name, 'OrderCommandError');
    assert.equal(socket.calls.length, 1);
    assert.equal(refreshes, 1);
  }

  // 4) A tenant/socket/lifecycle change before ACK cannot become success.
  {
    let current = { ...scope };
    const socket = makeSocket({ callback: (_payload, ack) => {
      current = { ...current, tenantId: 'tenant-b' };
      ack({ ok: true, tenantId: 'tenant-a', orderId: 'order-1' });
    } });
    await awaitReject(sendOrderCommand({ ...base, socket, getScope: () => current }), 'scope_changed');
  }

  // 5) new_order accepts the backend-generated order ID, not the client nonce.
  {
    const socket = makeSocket({ callback: (_payload, ack) => ack({
      ok: true,
      tenantId: 'tenant-a',
      orderId: '202611230001',
      status: 'pending',
    }) });
    const result = await sendOrderCommand({
      ...base,
      socket,
      event: 'new_order',
      orderId: undefined,
      requestId: 'client-nonce-1',
      payload: { tableId: 8, items: [] },
    });
    assert.equal(result.ok, true);
    assert.equal(result.orderId, '202611230001');
  }

  // 6) Finalized/already-applied recovery is a successful ACK, not a retry.
  {
    const socket = makeSocket({ callback: (_payload, ack) => ack({
      ok: true,
      tenantId: 'tenant-a',
      orderId: 'order-1',
      status: 'finalizada',
      alreadyApplied: true,
    }) });
    const result = await sendOrderCommand({ ...base, socket, event: 'confirm_baixa' });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyApplied, true);
    assert.equal(socket.calls.length, 1);
  }

  // 7) A payment rejection is checked before downstream fiscal/print effects.
  {
    let effects = 0;
    const socket = makeSocket({ callback: (_payload, ack) => ack({
      ok: false,
      tenantId: 'tenant-a',
      orderId: 'order-1',
      code: 'ORDER_FINALIZED',
    }) });
    const ack = await sendOrderCommand({ ...base, socket, event: 'pay_items' });
    if (ack.ok) effects += 1;
    assert.equal(effects, 0);
    assert.equal(orderCommandMessage(new OrderCommandError({ code: 'timeout', message: 'timeout' }), true), 'Pagamento não confirmado. Confira o pedido antes de tentar novamente.');
  }

  console.log('test-order-command-client: ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

function awaitReject(promise, expectedCode) {
  return Promise.resolve(promise).then(
    () => { throw new Error(`esperava rejeição ${expectedCode}`); },
    error => {
      assert.equal(error.code, expectedCode, `código esperado ${expectedCode}`);
      return error;
    },
  );
}
