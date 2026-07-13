import { io, type Socket } from "socket.io-client";
import { getAccessToken } from "./api";
let socket: Socket | undefined;
export function getSocket() {
  if (!socket) {
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";
    socket = io(apiUrl.replace(/\/api\/v1\/?$/, ""), { autoConnect: false, withCredentials: true, auth: (callback) => callback({ token: getAccessToken() }) });
  }
  return socket;
}
export function disconnectSocket() { socket?.disconnect(); socket = undefined; }
