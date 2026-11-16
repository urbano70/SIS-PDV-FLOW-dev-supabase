/**
 * Pure state helpers for the multi-cash-register lifecycle.
 *
 * `openCashRegisters` is an ownership map, not a physical-connection map:
 * the presence of a name means that register is logically open, while an empty
 * value means that no socket currently claims the open register.
 */
export type CashRegisterOwners = Record<string, string>;

export interface CashRegisterState {
  isCashRegisterOpen: boolean;
  shiftStartedAt: string;
  openCashRegisters: CashRegisterOwners;
}

export interface CashRegisterCloseOptions {
  cashRegisterName?: string | null;
  socketId?: string | null;
}

const normalizedName = (name: unknown): string | null => {
  if (typeof name !== 'string') return null;
  const value = name.trim();
  return value ? value : null;
};

/** Return logical names, including names whose socket claim is empty. */
export const getOpenCashRegisterNames = (owners: CashRegisterOwners | null | undefined): string[] =>
  Object.keys(owners || {}).filter((name) => !!normalizedName(name));

/** Rehydrate persisted logical names without inventing a socket claim. */
export const restoreOpenCashRegisterOwners = (names: unknown): CashRegisterOwners => {
  const owners: CashRegisterOwners = {};
  if (!Array.isArray(names)) return owners;
  for (const rawName of names) {
    const name = normalizedName(rawName);
    if (name) owners[name] = '';
  }
  return owners;
};

/** A legacy unnamed open register is represented by the global boolean. */
export const hasLogicalOpenCashRegisters = (
  isCashRegisterOpen: boolean,
  owners: CashRegisterOwners | null | undefined,
): boolean => isCashRegisterOpen === true || getOpenCashRegisterNames(owners).length > 0;

/** A shift starts only on the global closed -> open transition. */
export const shouldStartCashRegisterShift = (
  isCashRegisterOpen: boolean,
  owners: CashRegisterOwners | null | undefined,
): boolean => !hasLogicalOpenCashRegisters(isCashRegisterOpen, owners);

/** Claim an open logical register, preserving the shift across reconnects. */
export const openCashRegisterState = (
  state: CashRegisterState,
  options: { cashRegisterName?: string | null; socketId?: string | null; now: string },
): CashRegisterState => {
  const owners = { ...(state.openCashRegisters || {}) };
  const name = normalizedName(options.cashRegisterName);
  if (name) owners[name] = options.socketId || '';

  return {
    ...state,
    isCashRegisterOpen: true,
    // Do not reset for a second named register, force-assume, or reconnect.
    shiftStartedAt: shouldStartCashRegisterShift(state.isCashRegisterOpen, state.openCashRegisters)
      ? options.now
      : state.shiftStartedAt,
    openCashRegisters: owners,
  };
};

/** Release only a socket claim, retaining the logical open name. */
export const releaseCashRegisterClaims = (
  owners: CashRegisterOwners | null | undefined,
  socketId: string,
): CashRegisterOwners => {
  const next = { ...(owners || {}) };
  for (const name of Object.keys(next)) {
    if (next[name] === socketId) next[name] = '';
  }
  return next;
};

/** Explicitly close one logical name, or close names owned by an unnamed caller. */
export const closeCashRegisterState = (
  state: CashRegisterState,
  options: CashRegisterCloseOptions = {},
): CashRegisterState => {
  const owners = { ...(state.openCashRegisters || {}) };
  const name = normalizedName(options.cashRegisterName);
  if (name) {
    delete owners[name];
  } else if (options.socketId) {
    for (const ownerName of Object.keys(owners)) {
      if (owners[ownerName] === options.socketId) delete owners[ownerName];
    }
  }

  return {
    ...state,
    // Closing one named register must not close the tenant while another name remains open.
    isCashRegisterOpen: getOpenCashRegisterNames(owners).length > 0,
    openCashRegisters: owners,
  };
};
