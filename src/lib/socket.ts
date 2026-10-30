import { io } from "socket.io-client";

const tenant = new URLSearchParams(window.location.search).get('tenant') || '';
const socket = io({ query: tenant ? { tenant } : {} });

export default socket;
