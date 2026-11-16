/**
 * TEST-ONLY DEPLOY RESET — explicit approval 2026-11-16.
 *
 * This is intentionally a hardcoded allowlist, not a generic reset feature:
 * only the approved test tenant may run it, and only once per build marker.
 * It never touches comandas, menu, waiters/users, stock, fiscal data,
 * cash-register reports, or legitimate config fields.
 */
export const TEST_RESET_TENANT_ID = 'c5c88a54-4bcc-477d-aa8e-d095423484d6';
export const TEST_RESET_MARKER_FIELD = 'lastTestTableResetBuildId';
export const TEST_RESET_DISABLE_ENV = 'PDV_TEST_RESET_ON_DEPLOY';

export const shouldRunTestTableReset = ({
  tenantId,
  buildId,
  marker,
  enabled = true,
}: {
  tenantId: string;
  buildId: string;
  marker?: unknown;
  enabled?: boolean;
}): boolean => {
  if (!enabled) return false;
  if (tenantId !== TEST_RESET_TENANT_ID) return false;
  if (!buildId || buildId === 'undefined' || buildId === 'null') return false;
  return marker !== buildId;
};

export const resetTestTableState = ({ orders, tables }: { orders: any[]; tables: any[] }) => ({
  // isComanda=true is the only order class retained by this table-only reset.
  orders: (orders || []).filter((order: any) => order?.isComanda === true),
  tables: (tables || []).map((table: any) => ({
    ...table,
    status: 'free',
    currentOrder: null,
    linkedTo: null,
  })),
});
