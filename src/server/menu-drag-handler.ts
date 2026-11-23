import { moveMenuItem, type MenuMoveFailure, type MenuMoveRequest } from './menu-drag.ts';

type Ack = (result: Record<string, any>) => void;

type MenuState = { menu: any[] };

type HandlerDependencies = {
  socket: any;
  io: any;
  getTenantId: () => string;
  getState: (tenantId: string) => MenuState;
  isAdminForTenant: (tenantId: string) => boolean;
  withTenantCommand: <T>(tenantId: string, operation: () => Promise<T>) => Promise<T>;
  persistMenu: (menu: any[], tenantId: string) => Promise<void>;
  isReservedItem?: (item: any, tenantId: string) => boolean;
};

const ackFrom = (args: any[]): Ack | undefined => [...args].reverse().find((candidate) => typeof candidate === 'function');
const failureMessage = (failure: MenuMoveFailure): string => failure.message;

/** Registers the admin-only catalog move without importing the production server. */
export function registerMenuDragHandler(deps: HandlerDependencies): void {
  deps.socket.on('move_menu_item', (...args: any[]) => {
    const ack = ackFrom(args);
    const request = (args.find((candidate) => candidate && typeof candidate === 'object') || {}) as Partial<MenuMoveRequest>;
    const tenantId = String(deps.getTenantId() || '').trim();
    let responded = false;
    const respond = (result: Record<string, any>): void => {
      if (responded) return;
      responded = true;
      ack?.(result);
    };
    const fail = (code: string, message: string): false => {
      deps.socket.emit('error_message', message);
      respond({ ok: false, code, message });
      return false;
    };

    if (!tenantId || !deps.isAdminForTenant(tenantId)) {
      return Promise.resolve(fail('UNAUTHORIZED', 'Acesso restrito ao administrador.')) as any;
    }
    if (deps.socket.connected === false) {
      return Promise.resolve(fail('DISCONNECTED', 'Sem conexão com o servidor; o catálogo não foi alterado.')) as any;
    }

    const run = async (): Promise<boolean> => {
      const previousTenant = deps.socket.__commandTenantId;
      deps.socket.__commandTenantId = tenantId;
      try {
        if (!deps.isAdminForTenant(tenantId)) {
          return fail('UNAUTHORIZED', 'Sessão administrativa alterada; autentique novamente neste estabelecimento.');
        }
        const state = deps.getState(tenantId);
        const moved = moveMenuItem(state.menu, request);
        if (moved.ok !== true) return fail(moved.code, failureMessage(moved));
        if (!moved.changed) {
          respond({ ok: true, changed: false, itemId: moved.itemId, source: moved.source, target: moved.target });
          return true;
        }
        const movedItem = moved.menu
          .flatMap((category: any) => [
            ...(Array.isArray(category?.items) ? category.items : []),
            ...(Array.isArray(category?.subcategories) ? category.subcategories.flatMap((subcategory: any) => subcategory.items || []) : []),
          ])
          .find((item: any) => String(item?.id ?? '') === String(moved.itemId));
        if (deps.isReservedItem?.(movedItem, tenantId)) {
          return fail('RESERVED_ITEM', 'O produto reservado do Modo Parquinho não pode ser movido por este cadastro.');
        }

        // Keep the previous in-memory snapshot until every category row is durable.
        await deps.persistMenu(moved.menu, tenantId);
        state.menu = moved.menu;
        deps.io.to(`tenant:${tenantId}`).emit('update_menu', state.menu);
        respond({ ok: true, changed: true, itemId: moved.itemId, source: moved.source, target: moved.target });
        return true;
      } catch (error: any) {
        console.error(`[menu-move][${tenantId}] persistência rejeitada:`, error?.message || error);
        return fail('PERSISTENCE_FAILED', 'Não foi possível salvar o movimento; o catálogo permaneceu inalterado.');
      } finally {
        if (previousTenant === undefined) delete deps.socket.__commandTenantId;
        else deps.socket.__commandTenantId = previousTenant;
      }
    };

    return deps.withTenantCommand(tenantId, run).catch((error: any) => {
      console.error(`[menu-move][${tenantId}] fila rejeitada:`, error?.message || error);
      return fail('PERSISTENCE_FAILED', 'Não foi possível salvar o movimento; o catálogo permaneceu inalterado.');
    }) as any;
  });
}
