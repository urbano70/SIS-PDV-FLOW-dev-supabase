import { io } from "socket.io-client";

export type SocketAuthRole = 'anonymous' | 'admin' | 'waiter';

const tenant = new URLSearchParams(window.location.search).get('tenant') || '';
const socket = io({
  query: tenant ? { tenant } : {},
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  timeout: 20000,
});

// App.tsx and FirebaseProvider both need to be able to authenticate the shared
// socket.  A reconnect must authenticate once, but two listeners can otherwise
// send the same JWT twice while the first server-side load is still in flight.
// Keep this guard at the singleton boundary so callers do not need to coordinate
// with one another. A new socket.id (including every reconnect) gets one fresh
// emission; a changed token on the same connection is also allowed through.
const rawEmit = socket.emit.bind(socket);
let lastAdminConnectSocketId: string | null = null;
let lastAdminConnectToken: string | null = null;
let socketAuthRole: SocketAuthRole = 'anonymous';
let autoAuthSuspended = false;

socket.emit = ((event: string, ...args: any[]) => {
  if (event === 'admin_connect') {
    const token = args[0] == null ? null : String(args[0]);
    const connectionId = socket.id || '__pending_connection__';
    if (token && connectionId === lastAdminConnectSocketId && token === lastAdminConnectToken) {
      return socket;
    }
    lastAdminConnectSocketId = connectionId;
    lastAdminConnectToken = token;
  }
  return rawEmit(event as any, ...args);
}) as typeof socket.emit;

export const getSocketAuthRole = (): SocketAuthRole => socketAuthRole;

export const setSocketAuthRole = (role: SocketAuthRole): void => {
  socketAuthRole = role;
};

export const isAutoAuthSuspended = (): boolean => autoAuthSuspended;

export const setAutoAuthSuspended = (suspended: boolean): void => {
  autoAuthSuspended = suspended;
};

/** Resolve the auth role expected by a page without mutating the live socket role. */
export const recomputeAutoAuthRole = (
  pathname = typeof window === 'undefined' ? '' : window.location.pathname,
): SocketAuthRole => {
  if (/^\/waiter(?:\/|$)/.test(pathname)) return 'waiter';
  if (/^\/app(?:\/|$)/.test(pathname)) return 'admin';
  return 'anonymous';
};

export default socket;
