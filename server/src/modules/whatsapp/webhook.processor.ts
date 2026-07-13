import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { emitToBusiness, emitToConversation } from "../../realtime/socket.js";
import { normalizePhone } from "../customers/customer.service.js";

const media = z.object({ id: z.string(), mime_type: z.string().optional(), sha256: z.string().optional(), filename: z.string().optional() });
const incomingMessage = z.object({ id: z.string(), from: z.string(), timestamp: z.string(), type: z.string(), text: z.object({ body: z.string() }).optional(), image: media.optional(), document: media.optional(), audio: media.optional(), context: z.object({ id: z.string() }).optional() });
const statusUpdate = z.object({ id: z.string(), status: z.enum(["sent","delivered","read","failed"]), timestamp: z.string(), errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() })).optional() });
const valueSchema = z.object({ metadata: z.object({ phone_number_id: z.string() }), contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(), messages: z.array(incomingMessage).optional(), statuses: z.array(statusUpdate).optional() });
const payloadSchema = z.object({ entry: z.array(z.object({ changes: z.array(z.object({ value: valueSchema })) })) });

const messageType = (value: string) => value === "image" ? "IMAGE" as const : value === "document" ? "DOCUMENT" as const : value === "audio" ? "AUDIO" as const : "TEXT" as const;

export async function processWebhookEvent(eventId: string) {
  const event = await prisma.whatsAppWebhookEvent.findUnique({ where: { id: eventId }, include: { account: true } });
  if (!event || event.status === "PROCESSED") return;
  await prisma.whatsAppWebhookEvent.update({ where: { id: event.id, businessId: event.businessId }, data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null } });
  try {
    const payload = payloadSchema.parse(event.payload);
    for (const entry of payload.entry) for (const change of entry.changes) {
      if (change.value.metadata.phone_number_id !== event.account.phoneNumberId) continue;
      for (const item of change.value.messages ?? []) await processIncoming(event.businessId, event.accountId, item, change.value.contacts?.[0]?.profile?.name);
      for (const item of change.value.statuses ?? []) await processStatus(event.businessId, item);
    }
    await prisma.whatsAppWebhookEvent.update({ where: { id: event.id, businessId: event.businessId }, data: { status: "PROCESSED", processedAt: new Date() } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown webhook processing error";
    await prisma.whatsAppWebhookEvent.update({ where: { id: event.id, businessId: event.businessId }, data: { status: "FAILED", lastError: message } });
    throw error;
  }
}

async function processIncoming(businessId: string, accountId: string, item: z.infer<typeof incomingMessage>, profileName?: string) {
  const duplicate = await prisma.message.findUnique({ where: { businessId_providerMessageId: { businessId, providerMessageId: item.id } } });
  if (duplicate) return;
  const normalizedPhone = normalizePhone(`+${item.from}`); const names = profileName?.trim().split(/\s+/) ?? [];
  const customer = await prisma.customer.upsert({ where: { businessId_normalizedPhone: { businessId, normalizedPhone: normalizedPhone! } }, update: { lastContactAt: new Date(Number(item.timestamp) * 1000) }, create: { businessId, firstName: names[0] ?? normalizedPhone!, lastName: names.slice(1).join(" ") || null, phone: normalizedPhone, normalizedPhone, source: "WHATSAPP", lastContactAt: new Date(Number(item.timestamp) * 1000) } });
  const receivedAt = new Date(Number(item.timestamp) * 1000); const sessionExpiresAt = new Date(receivedAt.getTime() + 24 * 3_600_000); const body = item.text?.body ?? (item.image ? "Image" : item.document ? item.document.filename ?? "Document" : item.audio ? "Audio" : "Unsupported WhatsApp message");
  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.upsert({ where: { businessId_customerId_channel: { businessId, customerId: customer.id, channel: "WHATSAPP" } }, update: { status: "OPEN", unreadCount: { increment: 1 }, lastMessagePreview: body.slice(0,160), lastMessageAt: receivedAt, lastCustomerMessageAt: receivedAt, sessionExpiresAt }, create: { businessId, customerId: customer.id, assignedUserId: customer.assignedUserId, channel: "WHATSAPP", status: "OPEN", unreadCount: 1, lastMessagePreview: body.slice(0,160), lastMessageAt: receivedAt, lastCustomerMessageAt: receivedAt, sessionExpiresAt } });
    const message = await tx.message.create({ data: { businessId, conversationId: conversation.id, whatsAppAccountId: accountId, providerMessageId: item.id, direction: "INBOUND", type: messageType(item.type), status: "RECEIVED", body, receivedAt, ...(item.context?.id ? { idempotencyKey: `reply:${item.context.id}:${item.id}` } : {}) } });
    const mediaItem = item.image ?? item.document ?? item.audio;
    if (mediaItem) await tx.messageAttachment.create({ data: { businessId, messageId: message.id, fileName: mediaItem.filename ?? `${item.type}-${mediaItem.id}`, mimeType: mediaItem.mime_type ?? "application/octet-stream", size: 0, url: `provider://whatsapp/${mediaItem.id}`, providerMediaId: mediaItem.id, ...(mediaItem.sha256 ? { checksum: mediaItem.sha256 } : {}) } });
    await tx.activity.create({ data: { businessId, customerId: customer.id, type: "MESSAGE_RECEIVED", metadata: { messageId: message.id, conversationId: conversation.id } } });
    return { conversation, message };
  });
  emitToConversation(result.conversation.id, "message:created", result.message); emitToBusiness(businessId, "conversation:updated", result.conversation);
}

async function processStatus(businessId: string, item: z.infer<typeof statusUpdate>) {
  const existing = await prisma.message.findUnique({ where: { businessId_providerMessageId: { businessId, providerMessageId: item.id } } });
  if (!existing) return;
  const timestamp = new Date(Number(item.timestamp) * 1000); const status = item.status.toUpperCase() as "SENT"|"DELIVERED"|"READ"|"FAILED"; const firstError = item.errors?.[0];
  const updated = await prisma.message.update({ where: { id: existing.id, businessId }, data: { status, ...(status === "SENT" ? { sentAt: timestamp } : status === "DELIVERED" ? { deliveredAt: timestamp } : status === "READ" ? { readAt: timestamp } : { errorCode: firstError?.code?.toString() ?? "META_SEND_FAILED", errorMessage: firstError?.message ?? firstError?.title ?? "WhatsApp delivery failed" }) } });
  emitToConversation(existing.conversationId, "message:status", { messageId: existing.id, status: updated.status, timestamp: timestamp.toISOString() }); emitToBusiness(businessId, "conversation:updated", { conversationId: existing.conversationId });
}
