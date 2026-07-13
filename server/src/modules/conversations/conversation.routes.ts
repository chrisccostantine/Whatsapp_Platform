import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { emitToBusiness, emitToConversation } from "../../realtime/socket.js";
import { mockWhatsAppProvider } from "../messaging/mock.provider.js";
import { getCloudProvider } from "../whatsapp/account.service.js";
import { assertConversationAccess, conversationSummaryInclude } from "./conversation.service.js";

export const conversationRouter = Router();
conversationRouter.use(authenticate);
const authOf = (req: { auth?: { businessId: string; userId: string; role: string } }) => req.auth!;
const requireMockProvider = () => { if (process.env.NODE_ENV === "production") throw new AppError(409, "MOCK_PROVIDER_DISABLED", "Connect an official WhatsApp provider before sending production messages"); };

conversationRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ status: z.enum(["OPEN", "PENDING", "RESOLVED", "ARCHIVED"]).optional(), search: z.string().trim().max(100).optional(), assigned: z.enum(["me", "unassigned", "all"]).default("all"), cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
  const auth = authOf(req);
  const assignedWhere = auth.role === "SALES_AGENT" || query.assigned === "me" ? { assignedUserId: auth.userId } : query.assigned === "unassigned" ? { assignedUserId: null } : {};
  const items = await prisma.conversation.findMany({ where: {
    businessId: auth.businessId, ...(query.status ? { status: query.status } : { status: { not: "ARCHIVED" } }), ...assignedWhere,
    ...(query.search ? { OR: [{ customer: { firstName: { contains: query.search, mode: "insensitive" } } }, { customer: { lastName: { contains: query.search, mode: "insensitive" } } }, { customer: { normalizedPhone: { contains: query.search } } }, { lastMessagePreview: { contains: query.search, mode: "insensitive" } }] } : {})
  }, include: conversationSummaryInclude, orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }], take: query.limit, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
  return ok(res, { items, nextCursor: items.length === query.limit ? items.at(-1)?.id : null });
}));

conversationRouter.post("/", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const { customerId, channel } = z.object({ customerId: z.string().uuid(), channel: z.enum(["MOCK_WHATSAPP","WHATSAPP"]).default("MOCK_WHATSAPP") }).parse(req.body); const auth = authOf(req);
  if(channel==="MOCK_WHATSAPP")requireMockProvider();else await getCloudProvider(auth.businessId);
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId: auth.businessId, deletedAt: null } });
  if (!customer) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer was not found");
  const conversation = await prisma.conversation.upsert({ where: { businessId_customerId_channel: { businessId: auth.businessId, customerId, channel } }, update: {}, create: { businessId: auth.businessId, customerId, channel, assignedUserId: auth.role === "SALES_AGENT" ? auth.userId : customer.assignedUserId }, include: conversationSummaryInclude });
  emitToBusiness(auth.businessId, "conversation:updated", conversation);
  return ok(res, conversation, "Conversation ready", 201);
}));

conversationRouter.get("/:id", asyncHandler(async (req, res) => {
  const conversation = await assertConversationAccess(authOf(req), req.params.id!);
  const [messages, notes] = await prisma.$transaction([
    prisma.message.findMany({ where: { businessId: req.auth!.businessId, conversationId: conversation.id }, include: { attachments: true, senderUser: { select: { id: true, firstName: true, lastName: true } }, replyTo: { select: { id: true, body: true } } }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.internalNote.findMany({ where: { businessId: req.auth!.businessId, conversationId: conversation.id, deletedAt: null }, include: { author: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" }, take: 100 })
  ]);
  return ok(res, { conversation, messages, internalNotes: notes });
}));

conversationRouter.post("/:id/read", asyncHandler(async (req, res) => {
  const conversation = await assertConversationAccess(authOf(req), req.params.id!);
  await prisma.conversation.update({ where: { id: conversation.id, businessId: req.auth!.businessId }, data: { unreadCount: 0 } });
  emitToBusiness(req.auth!.businessId, "conversation:updated", { conversationId: conversation.id, unreadCount: 0 });
  return ok(res, null, "Conversation marked as read");
}));

conversationRouter.post("/:id/messages", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const input = z.object({ body: z.string().trim().min(1).max(4096), type: z.enum(["TEXT"]).default("TEXT"), replyToId: z.string().uuid().optional(), idempotencyKey: z.string().min(8).max(100).optional() }).parse(req.body);
  const auth = authOf(req); const conversation = await assertConversationAccess(auth, req.params.id!);
  const cloud = conversation.channel === "WHATSAPP" ? await getCloudProvider(auth.businessId) : undefined;
  if(conversation.channel === "MOCK_WHATSAPP")requireMockProvider();
  if(conversation.channel === "WHATSAPP" && !conversation.customer.normalizedPhone) throw new AppError(400,"CUSTOMER_PHONE_REQUIRED","Customer needs a valid phone number before messaging");
  if(conversation.channel === "WHATSAPP" && (!conversation.sessionExpiresAt || conversation.sessionExpiresAt <= new Date())) throw new AppError(409,"TEMPLATE_REQUIRED","The 24-hour customer-service window is closed; send an approved template");
  const idempotencyKey = input.idempotencyKey ?? req.header("idempotency-key") ?? randomUUID();
  const existing = await prisma.message.findUnique({ where: { businessId_idempotencyKey: { businessId: auth.businessId, idempotencyKey } }, include: { attachments: true, senderUser: { select: { id: true, firstName: true, lastName: true } } } });
  if (existing) return ok(res, existing, "Message already accepted");
  if (input.replyToId) {
    const reply = await prisma.message.findFirst({ where: { id: input.replyToId, conversationId: conversation.id, businessId: auth.businessId } });
    if (!reply) throw new AppError(400, "INVALID_REPLY", "Reply target is not part of this conversation");
  }
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({ data: { businessId: auth.businessId, conversationId: conversation.id, senderUserId: auth.userId, direction: "OUTBOUND", type: input.type, status: "QUEUED", body: input.body, idempotencyKey, ...(cloud ? { whatsAppAccountId: cloud.account.id } : {}), ...(input.replyToId ? { replyToId: input.replyToId } : {}) }, include: { attachments: true, senderUser: { select: { id: true, firstName: true, lastName: true } } } });
    await tx.conversation.update({ where: { id: conversation.id, businessId: auth.businessId }, data: { lastMessagePreview: input.body.slice(0, 160), lastMessageAt: now } });
    await tx.activity.create({ data: { businessId: auth.businessId, customerId: conversation.customerId, actorId: auth.userId, type: "MESSAGE_SENT", metadata: { messageId: created.id, conversationId: conversation.id } } });
    return created;
  });
  try {
    const provider=cloud?.provider??mockWhatsAppProvider;const result = await provider.send({ businessId: auth.businessId, conversationId: conversation.id, messageId: message.id, recipientPhone: conversation.customer.normalizedPhone ?? "mock", type: input.type, body: input.body });
    const sent = await prisma.message.update({ where: { id: message.id, businessId: auth.businessId }, data: { status: "SENT", providerMessageId: result.providerMessageId, sentAt: result.acceptedAt }, include: { attachments: true, senderUser: { select: { id: true, firstName: true, lastName: true } } } });
    emitToConversation(conversation.id, "message:created", sent); emitToBusiness(auth.businessId, "conversation:updated", { conversationId: conversation.id, lastMessagePreview: input.body, lastMessageAt: now });
    return ok(res, sent, "Message sent", 201);
  } catch {
    await prisma.message.update({ where: { id: message.id, businessId: auth.businessId }, data: { status: "FAILED", errorCode: "MOCK_PROVIDER_ERROR", errorMessage: "Mock provider rejected the message" } });
    throw new AppError(502, "MESSAGE_SEND_FAILED", "Message could not be sent");
  }
}));

conversationRouter.post("/:id/internal-notes", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(req.body); const auth = authOf(req);
  const conversation = await assertConversationAccess(auth, req.params.id!);
  const note = await prisma.internalNote.create({ data: { businessId: auth.businessId, conversationId: conversation.id, authorId: auth.userId, body }, include: { author: { select: { id: true, firstName: true, lastName: true } } } });
  emitToConversation(conversation.id, "internal-note:created", note);
  return ok(res, note, "Internal note added", 201);
}));

conversationRouter.patch("/:id/assignment", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const { assignedUserId } = z.object({ assignedUserId: z.string().uuid().nullable() }).parse(req.body); const auth = authOf(req);
  const conversation = await assertConversationAccess(auth, req.params.id!, false);
  if (assignedUserId) {
    const member = await prisma.businessMember.findFirst({ where: { businessId: auth.businessId, userId: assignedUserId, status: "ACTIVE" } });
    if (!member) throw new AppError(400, "INVALID_ASSIGNEE", "Assignee is not an active workspace member");
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.conversationAssignment.updateMany({ where: { businessId: auth.businessId, conversationId: conversation.id, unassignedAt: null }, data: { unassignedAt: new Date() } });
    if (assignedUserId) await tx.conversationAssignment.create({ data: { businessId: auth.businessId, conversationId: conversation.id, assignedUserId, assignedById: auth.userId } });
    await tx.activity.create({ data: { businessId: auth.businessId, customerId: conversation.customerId, actorId: auth.userId, type: "CONVERSATION_ASSIGNED", metadata: { conversationId: conversation.id, assignedUserId: assignedUserId ?? "unassigned" } } });
    return tx.conversation.update({ where: { id: conversation.id, businessId: auth.businessId }, data: { assignedUserId }, include: conversationSummaryInclude });
  });
  emitToBusiness(auth.businessId, "conversation:updated", updated); emitToConversation(conversation.id, "conversation:assignment", updated);
  return ok(res, updated, "Assignment updated");
}));

conversationRouter.patch("/:id/status", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(["OPEN", "PENDING", "RESOLVED", "ARCHIVED"]) }).parse(req.body); const auth = authOf(req);
  const conversation = await assertConversationAccess(auth, req.params.id!);
  const updated = await prisma.conversation.update({ where: { id: conversation.id, businessId: auth.businessId }, data: { status, archivedAt: status === "ARCHIVED" ? new Date() : null }, include: conversationSummaryInclude });
  emitToBusiness(auth.businessId, "conversation:updated", updated); emitToConversation(conversation.id, "conversation:status", updated);
  return ok(res, updated, "Conversation status updated");
}));

conversationRouter.post("/mock/incoming", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  requireMockProvider();
  const { customerId, body, providerMessageId } = z.object({ customerId: z.string().uuid(), body: z.string().trim().min(1).max(4096), providerMessageId: z.string().max(100).optional() }).parse(req.body); const auth = authOf(req);
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId: auth.businessId, deletedAt: null } });
  if (!customer) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer was not found");
  const externalId = providerMessageId ?? `mock-in-${randomUUID()}`;
  const duplicate = await prisma.message.findUnique({ where: { businessId_providerMessageId: { businessId: auth.businessId, providerMessageId: externalId } } });
  if (duplicate) return ok(res, duplicate, "Duplicate event ignored");
  const now = new Date(); const sessionExpiresAt = new Date(now.getTime() + 24 * 3_600_000);
  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.upsert({ where: { businessId_customerId_channel: { businessId: auth.businessId, customerId, channel: "MOCK_WHATSAPP" } }, update: { status: "OPEN", unreadCount: { increment: 1 }, lastMessagePreview: body.slice(0, 160), lastMessageAt: now, lastCustomerMessageAt: now, sessionExpiresAt }, create: { businessId: auth.businessId, customerId, channel: "MOCK_WHATSAPP", status: "OPEN", unreadCount: 1, lastMessagePreview: body.slice(0, 160), lastMessageAt: now, lastCustomerMessageAt: now, sessionExpiresAt, assignedUserId: customer.assignedUserId } });
    const message = await tx.message.create({ data: { businessId: auth.businessId, conversationId: conversation.id, providerMessageId: externalId, direction: "INBOUND", type: "TEXT", status: "RECEIVED", body, receivedAt: now } });
    await tx.activity.create({ data: { businessId: auth.businessId, customerId, type: "MESSAGE_RECEIVED", metadata: { messageId: message.id, conversationId: conversation.id } } });
    return { conversation, message };
  });
  emitToConversation(result.conversation.id, "message:created", result.message); emitToBusiness(auth.businessId, "conversation:updated", result.conversation);
  return ok(res, result, "Mock incoming message received", 201);
}));
