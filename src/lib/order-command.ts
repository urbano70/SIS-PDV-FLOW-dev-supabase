export interface OrderCommandAck {
  ok: boolean;
  code?: string;
  message?: string;
  tenantId: string;
  orderId?: string | number;
  status?: string;
  alreadyApplied?: boolean;
  [key: string]: unknown;
}

export interface OrderCommandSocket {
  connected: boolean;
  id?: string | null;
  emit: (...args: any[]) => any;
}

export interface OrderCommandScope {
  tenantId: string;
  socketId: string | null;
  lifecycle: string | number;
}

export interface OrderCommandErrorOptions {
  code: string;
  message: string;
  ack?: OrderCommandAck;
  requestId?: string;
}

export class OrderCommandError extends Error {
  readonly code: string;
  readonly ack?: OrderCommandAck;
  readonly requestId?: string;

  constructor({ code, message, ack, requestId }: OrderCommandErrorOptions) {
    super(message);
    this.name = 'OrderCommandError';
    this.code = code;
    this.ack = ack;
    this.requestId = requestId;
  }
}

export interface SendOrderCommandOptions {
  socket: OrderCommandSocket;
  event: string;
  tenantId: string;
  requestId?: string;
  payload?: Record<string, unknown>;
  orderId?: string | number;
  timeoutMs?: number;
  canMutate?: () => boolean;
  getScope?: () => OrderCommandScope;
  refreshSnapshot?: () => void | Promise<void>;
}

export const createOrderRequestId = (prefix = 'order') => {
  const cryptoObject = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (cryptoObject?.randomUUID) return `${prefix}-${cryptoObject.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

const scopeFor = (options: SendOrderCommandOptions): OrderCommandScope =>
  options.getScope?.() ?? {
    tenantId: options.tenantId,
    socketId: options.socket.id || null,
    lifecycle: options.tenantId,
  };

const sameScope = (before: OrderCommandScope, after: OrderCommandScope): boolean =>
  before.tenantId === after.tenantId &&
  before.socketId === after.socketId &&
  before.lifecycle === after.lifecycle;

const safeRefresh = (options: SendOrderCommandOptions): void => {
  if (!options.refreshSnapshot) return;
  try {
    Promise.resolve(options.refreshSnapshot()).catch(() => undefined);
  } catch {
    // Reconciliation is best effort and must never turn an already explicit
    // command result into an unhandled rejection.
  }
};

const commandError = (
  options: SendOrderCommandOptions,
  code: string,
  message: string,
  ack?: OrderCommandAck,
): OrderCommandError => new OrderCommandError({
  code,
  message,
  ack,
  requestId: options.requestId,
});

const normalizeAck = (raw: unknown): OrderCommandAck => {
  if (!raw || typeof raw !== 'object' || typeof (raw as any).ok !== 'boolean') {
    throw new Error('ACK inválido: o servidor não informou ok.');
  }
  const ack = raw as Record<string, unknown>;
  if (typeof ack.tenantId !== 'string' || !ack.tenantId) {
    throw new Error('ACK inválido: o servidor não informou tenantId.');
  }
  return ack as OrderCommandAck;
};

/**
 * Emits exactly once. Explicit server rejections resolve as an ACK with ok:false;
 * local readiness/scope failures and timeouts reject. There is intentionally no
 * retry here, especially for payment commands.
 */
export const sendOrderCommand = (options: SendOrderCommandOptions): Promise<OrderCommandAck> => {
  const requestId = options.requestId || createOrderRequestId();
  const effectiveOptions = { ...options, requestId };
  const before = scopeFor(effectiveOptions);
  const isReady = effectiveOptions.socket.connected &&
    (!effectiveOptions.canMutate || effectiveOptions.canMutate());

  if (!effectiveOptions.tenantId || before.tenantId !== effectiveOptions.tenantId) {
    const error = commandError(effectiveOptions, 'scope_changed', 'A conta ativa mudou; o comando não foi enviado.');
    safeRefresh(effectiveOptions);
    return Promise.reject(error);
  }
  if (!isReady) {
    const error = commandError(effectiveOptions, 'not_ready', 'A conexão ainda não está sincronizada; o comando não foi enviado.');
    safeRefresh(effectiveOptions);
    return Promise.reject(error);
  }

  const commandPayload = {
    ...(effectiveOptions.payload || {}),
    tenantId: effectiveOptions.tenantId,
    requestId,
  };
  const timeoutMs = Math.max(1, effectiveOptions.timeoutMs ?? 10_000);

  return new Promise<OrderCommandAck>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = commandError(
        effectiveOptions,
        'timeout',
        'O servidor não confirmou o comando dentro do prazo.',
      );
      safeRefresh(effectiveOptions);
      reject(error);
    }, timeoutMs);

    const fail = (error: OrderCommandError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      safeRefresh(effectiveOptions);
      reject(error);
    };

    const finish = (rawAck: unknown) => {
      if (settled) return;
      let ack: OrderCommandAck;
      try {
        ack = normalizeAck(rawAck);
      } catch (error: any) {
        fail(commandError(effectiveOptions, 'invalid_ack', error?.message || 'ACK inválido do servidor.'));
        return;
      }
      if (ack.tenantId !== effectiveOptions.tenantId) {
        fail(commandError(effectiveOptions, 'scope_changed', 'A confirmação pertence a outra conta.', ack));
        return;
      }
      if (ack.ok && effectiveOptions.orderId !== undefined &&
          (ack.orderId === undefined || String(ack.orderId) !== String(effectiveOptions.orderId))) {
        fail(commandError(effectiveOptions, 'scope_changed', 'A confirmação pertence a outro pedido.', ack));
        return;
      }
      const after = scopeFor(effectiveOptions);
      if (!sameScope(before, after)) {
        fail(commandError(effectiveOptions, 'scope_changed', 'A conexão ou a conta mudou antes da confirmação.', ack));
        return;
      }
      if (ack.ok && (!effectiveOptions.socket.connected ||
          (effectiveOptions.canMutate && !effectiveOptions.canMutate()))) {
        fail(commandError(effectiveOptions, 'not_ready', 'A conexão deixou de estar pronta antes da confirmação.', ack));
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (!ack.ok) safeRefresh(effectiveOptions);
      resolve(ack);
    };

    try {
      // The ACK callback is deliberately the final socket argument for every
      // supported command, including new_order whose returned orderId is server-generated.
      effectiveOptions.socket.emit(effectiveOptions.event, commandPayload, finish);
    } catch (error: any) {
      fail(commandError(effectiveOptions, 'emit_failed', error?.message || 'Não foi possível enviar o comando.'));
    }
  });
};

export const orderCommandMessage = (result: OrderCommandAck | unknown, financial = false): string => {
  const ack = result && typeof result === 'object' ? result as Partial<OrderCommandAck> : null;
  const code = String((ack as any)?.code || (result as any)?.code || '').toLowerCase();
  if (financial && ['timeout', 'scope_changed', 'not_ready', 'invalid_ack', 'emit_failed'].includes(code)) {
    return 'Pagamento não confirmado. Confira o pedido antes de tentar novamente.';
  }
  if (code === 'auth_error' || code === 'unauthorized' || code === 'forbidden' || code === 'not_authorized') {
    return ack?.message || 'Sessão sem autorização para esta conta. Atualize a conexão e tente novamente.';
  }
  if (code === 'order_not_found' || code === 'pedido_nao_encontrado') {
    return ack?.message || 'Pedido não encontrado nesta conta. Atualize o pedido antes de tentar novamente.';
  }
  if (code === 'finalized' || code === 'order_finalized' || code === 'aguardando_baixa') {
    return ack?.message || 'Este pedido não aceita novas alterações neste estado.';
  }
  if (code === 'timeout' || code === 'scope_changed' || code === 'not_ready') {
    return 'O servidor não confirmou a operação. Atualize a tela e tente novamente.';
  }
  return ack?.message || (result instanceof Error ? result.message : 'O servidor rejeitou a operação.');
};
