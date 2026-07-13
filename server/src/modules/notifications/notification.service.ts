import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export const NOTIFICATION_TYPES: NotificationType[] = ["NEW_MESSAGE", "CONVERSATION_ASSIGNED", "LEAD_ASSIGNED", "FOLLOW_UP_DUE", "FOLLOW_UP_OVERDUE", "QUOTATION_ACCEPTED", "INVOICE_OVERDUE", "CAMPAIGN_COMPLETED", "WHATSAPP_CONNECTION_PROBLEM"];

export async function createNotification(input: { businessId: string; userId: string; type: NotificationType; title: string; body: string; entityType?: string; entityId?: string; dedupeKey?: string }) {
  const preference = await prisma.notificationPreference.findUnique({ where: { businessId_userId: { businessId: input.businessId, userId: input.userId } }, select: { enabledTypes: true } });
  const enabled = !preference || (Array.isArray(preference.enabledTypes) && preference.enabledTypes.includes(input.type));
  if (!enabled) return null;
  return prisma.notification.upsert({
    where: { businessId_userId_dedupeKey: { businessId: input.businessId, userId: input.userId, dedupeKey: input.dedupeKey ?? `${input.type}:${input.entityId ?? crypto.randomUUID()}` } },
    update: {},
    create: { ...input, dedupeKey: input.dedupeKey ?? null }
  });
}

async function notifyManagers(businessId: string, notification: Omit<Parameters<typeof createNotification>[0], "businessId" | "userId">) {
  const managers = await prisma.businessMember.findMany({ where: { businessId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } });
  await Promise.all(managers.map(({ userId }) => createNotification({ businessId, userId, ...notification })));
}

export async function generateOperationalNotifications(now = new Date()) {
  const reminderWindow = new Date(now.getTime() + 15 * 60_000);
  const due = await prisma.followUp.findMany({ where: { deletedAt: null, status: { in: ["PENDING", "IN_PROGRESS"] }, reminderAt: { lte: reminderWindow }, dueAt: { gte: now } }, select: { id: true, businessId: true, assignedUserId: true, title: true, dueAt: true } });
  await Promise.all(due.map((item) => createNotification({ businessId: item.businessId, userId: item.assignedUserId, type: "FOLLOW_UP_DUE", title: "Follow-up due soon", body: `${item.title} is due ${item.dueAt.toLocaleString()}`, entityType: "FollowUp", entityId: item.id, dedupeKey: `follow-up-due:${item.id}` })));

  const overdue = await prisma.followUp.findMany({ where: { deletedAt: null, status: { in: ["PENDING", "IN_PROGRESS"] }, dueAt: { lt: now } }, select: { id: true, businessId: true, assignedUserId: true, title: true } });
  if (overdue.length) await prisma.followUp.updateMany({ where: { id: { in: overdue.map((item) => item.id) }, status: { in: ["PENDING", "IN_PROGRESS"] } }, data: { status: "OVERDUE" } });
  await Promise.all(overdue.map((item) => createNotification({ businessId: item.businessId, userId: item.assignedUserId, type: "FOLLOW_UP_OVERDUE", title: "Follow-up overdue", body: item.title, entityType: "FollowUp", entityId: item.id, dedupeKey: `follow-up-overdue:${item.id}` })));

  const invoices = await prisma.invoice.findMany({ where: { deletedAt: null, dueDate: { lt: now }, paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }, select: { id: true, businessId: true, invoiceNumber: true } });
  if (invoices.length) await prisma.invoice.updateMany({ where: { id: { in: invoices.map((item) => item.id) } }, data: { paymentStatus: "OVERDUE" } });
  await Promise.all(invoices.map((item) => notifyManagers(item.businessId, { type: "INVOICE_OVERDUE", title: "Invoice overdue", body: `${item.invoiceNumber} is overdue`, entityType: "Invoice", entityId: item.id, dedupeKey: `invoice-overdue:${item.id}` })));

  const failedAccounts = await prisma.whatsAppAccount.findMany({ where: { connectionStatus: "ERROR" }, select: { id: true, businessId: true, lastError: true, updatedAt: true } });
  await Promise.all(failedAccounts.map((item) => notifyManagers(item.businessId, { type: "WHATSAPP_CONNECTION_PROBLEM", title: "WhatsApp connection problem", body: item.lastError ?? "Reconnect your WhatsApp account", entityType: "WhatsAppAccount", entityId: item.id, dedupeKey: `whatsapp-error:${item.id}:${item.updatedAt.toISOString().slice(0, 10)}` })));

  const acceptedQuotations = await prisma.quotation.findMany({ where: { deletedAt: null, status: "ACCEPTED" }, select: { id: true, businessId: true, createdById: true, quotationNumber: true }, take: 500, orderBy: { updatedAt: "desc" } });
  await Promise.all(acceptedQuotations.map((item) => createNotification({ businessId: item.businessId, userId: item.createdById, type: "QUOTATION_ACCEPTED", title: "Quotation accepted", body: item.quotationNumber, entityType: "Quotation", entityId: item.id, dedupeKey: `quotation-accepted:${item.id}` })));
}

export function preferenceJson(types: NotificationType[]): Prisma.InputJsonValue { return types; }
