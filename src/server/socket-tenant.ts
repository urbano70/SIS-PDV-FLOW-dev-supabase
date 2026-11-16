/**
 * Socket tenant isolation helpers.
 *
 * Socket.IO keeps a socket in every room it has joined until it explicitly
 * leaves it. A tenant switch must therefore remove every prior tenant room,
 * not only the room remembered in socket.tenantId.
 */
const TENANT_ROOM_PREFIX = 'tenant:';

export const leaveTenantRooms = (socket: any): void => {
  const rooms = socket?.rooms;
  if (!rooms || typeof rooms[Symbol.iterator] !== 'function') return;
  for (const room of Array.from(rooms as Iterable<unknown>)) {
    if (typeof room === 'string' && room.startsWith(TENANT_ROOM_PREFIX)) {
      socket.leave(room);
    }
  }
};

export const switchSocketTenant = (socket: any, tenantId: string): number => {
  const tid = String(tenantId || '').trim();
  if (!tid) throw new Error('tenantId obrigatório');
  leaveTenantRooms(socket);
  socket.tenantId = tid;
  socket.join(`${TENANT_ROOM_PREFIX}${tid}`);
  const generation = (Number(socket.tenantGeneration) || 0) + 1;
  socket.tenantGeneration = generation;
  return generation;
};
