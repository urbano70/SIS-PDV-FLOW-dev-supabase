import { io } from "socket.io-client";

const tenant = new URLSearchParams(window.location.search).get('tenant') || '';
const socket = io({
  query: tenant ? { tenant } : {},
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  timeout: 20000,
});

export default socket;
