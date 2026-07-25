// server.js owns the actual Socket.IO server instance; routes/access.js
// needs to be able to forcibly disconnect a specific user's live socket(s)
// when Admin kicks a session. Rather than pass `io` around awkwardly, both
// sides import this small shared registry.

let ioInstance = null;
const jtiToSocketIds = new Map(); // jti -> Set<socketId>

export function setIo(io) {
  ioInstance = io;
}

export function registerSocketSession(jti, socketId) {
  if (!jtiToSocketIds.has(jti)) jtiToSocketIds.set(jti, new Set());
  jtiToSocketIds.get(jti).add(socketId);
}

export function unregisterSocketSession(jti, socketId) {
  const set = jtiToSocketIds.get(jti);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) jtiToSocketIds.delete(jti);
}

export function isJtiOnline(jti) {
  return jtiToSocketIds.has(jti) && jtiToSocketIds.get(jti).size > 0;
}

/** Forcibly disconnect every live socket for a session. Returns how many were disconnected. */
export function kickJti(jti, reason = 'Your session was ended by an administrator.') {
  const set = jtiToSocketIds.get(jti);
  if (!ioInstance || !set) return 0;
  let count = 0;
  for (const socketId of set) {
    const s = ioInstance.sockets.sockets.get(socketId);
    if (s) {
      s.emit('kicked', { message: reason });
      s.disconnect(true);
      count++;
    }
  }
  jtiToSocketIds.delete(jti);
  return count;
}
