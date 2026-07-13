import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../modules/auth/token.service.js";
import { prisma } from "../lib/prisma.js";

let io: Server | undefined;
export const businessRoom = (businessId: string) => `business:${businessId}`;
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;

export function initializeSocket(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.CLIENT_URL, credentials: true }, transports: ["websocket", "polling"] });
  io.use(async (socket, next) => {
    try {
      const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : "";
      const claims = await verifyAccessToken(token);
      const membership = await prisma.businessMember.findFirst({ where: { id: claims.membershipId, userId: claims.userId, businessId: claims.businessId, status: "ACTIVE", business: { deletedAt: null }, user: { isActive: true, deletedAt: null } } });
      if (!membership) return next(new Error("Membership is inactive"));
      socket.data.auth = { ...claims, role: membership.role };
      await socket.join(businessRoom(claims.businessId));
      next();
    } catch { next(new Error("Authentication failed")); }
  });
  io.on("connection", (socket) => {
    socket.on("conversation:join", async (conversationId: unknown, acknowledge?: (result: { success: boolean }) => void) => {
      if (typeof conversationId !== "string") return acknowledge?.({ success: false });
      const auth = socket.data.auth as { businessId: string; userId: string; role: string };
      const exists = await prisma.conversation.findFirst({ where: { id: conversationId, businessId: auth.businessId, ...(auth.role === "SALES_AGENT" ? { assignedUserId: auth.userId } : {}) }, select: { id: true } });
      if (!exists) return acknowledge?.({ success: false });
      await socket.join(conversationRoom(conversationId)); acknowledge?.({ success: true });
    });
    socket.on("conversation:leave", (conversationId: unknown) => { if (typeof conversationId === "string") void socket.leave(conversationRoom(conversationId)); });
  });
  return io;
}

export function emitToBusiness(businessId: string, event: string, payload: unknown) { io?.to(businessRoom(businessId)).emit(event, payload); }
export function emitToConversation(conversationId: string, event: string, payload: unknown) { io?.to(conversationRoom(conversationId)).emit(event, payload); }
