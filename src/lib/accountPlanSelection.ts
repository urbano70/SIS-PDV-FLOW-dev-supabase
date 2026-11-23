export const PREMIUM_ACCOUNT_PLAN_ID = 'premium';

/**
 * Until account-plan selection is reopened, Premium is the only selectable
 * option in the account panel. Unknown plan IDs stay blocked by default.
 */
export function canSelectAccountPlan(planId: string): boolean {
  return planId === PREMIUM_ACCOUNT_PLAN_ID;
}

/**
 * Pure selection rule used by focused tests and UI guards. Existing plans are
 * preserved for display; suspended plans cannot replace the current value.
 */
export function resolveAccountPlanSelection(currentPlan: string, requestedPlan: string): string {
  return canSelectAccountPlan(requestedPlan) ? requestedPlan : currentPlan;
}
