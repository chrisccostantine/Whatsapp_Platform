import { prisma } from "../../lib/prisma.js";
import { getCloudProvider } from "../whatsapp/account.service.js";
import { finishCampaignIfSettled } from "./campaign.service.js";

export async function processCampaignRecipient(recipientId: string) {
  const recipient = await prisma.campaignRecipient.findUnique({ where: { id: recipientId }, include: { campaign: { include: { template: true } }, customer: true, message: true } });
  if (!recipient || !["PENDING", "QUEUED"].includes(recipient.status)) return;
  if (recipient.campaign.status === "PAUSED") return;
  if (recipient.campaign.status === "CANCELLED") return skipRecipient(recipient.id, recipient.campaignId, "CAMPAIGN_CANCELLED", "Campaign was cancelled");
  if (!recipient.customer.marketingOptIn || recipient.customer.optedOutAt || recipient.customer.deletedAt || !recipient.customer.normalizedPhone) return skipRecipient(recipient.id, recipient.campaignId, "CONSENT_REQUIRED", "Customer is not eligible for marketing messages");
  if (recipient.campaign.template.status !== "APPROVED" || recipient.campaign.template.category !== "MARKETING") return skipRecipient(recipient.id, recipient.campaignId, "TEMPLATE_NOT_ELIGIBLE", "Template is no longer approved for marketing");
  await prisma.campaign.updateMany({ where: { id: recipient.campaignId, status: "SCHEDULED" }, data: { status: "PROCESSING", startedAt: new Date() } });
  const { account, provider } = await getCloudProvider(recipient.businessId);
  if (!provider.sendTemplate) throw new Error("WhatsApp provider does not support template messages");
  const conversation = await prisma.conversation.upsert({
    where: { businessId_customerId_channel: { businessId: recipient.businessId, customerId: recipient.customerId, channel: "WHATSAPP" } },
    update: {}, create: { businessId: recipient.businessId, customerId: recipient.customerId, assignedUserId: recipient.customer.assignedUserId, channel: "WHATSAPP", status: "OPEN" }
  });
  let message = recipient.message ?? await prisma.message.findUnique({ where: { businessId_idempotencyKey: { businessId: recipient.businessId, idempotencyKey: `campaign:${recipient.id}` } } });
  if (message?.providerMessageId) return;
  if (!message) {
    message = await prisma.message.create({ data: {
      businessId: recipient.businessId, conversationId: conversation.id, whatsAppAccountId: account.id, templateId: recipient.campaign.templateId,
      direction: "OUTBOUND", type: "TEXT", status: "QUEUED", body: recipient.campaign.template.body, idempotencyKey: `campaign:${recipient.id}`,
      templateName: recipient.campaign.template.name, templateCategory: recipient.campaign.template.category
    } });
    await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { messageId: message.id } });
  }
  const variables = Array.isArray(recipient.variables) ? recipient.variables.filter((item): item is string => typeof item === "string") : [];
  const sent = await provider.sendTemplate({ recipientPhone: recipient.phone, templateName: recipient.campaign.template.name, language: recipient.campaign.template.language, bodyVariables: variables });
  await prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: message!.id }, data: { providerMessageId: sent.providerMessageId, status: "SENT", sentAt: sent.acceptedAt } });
    const changed = await tx.campaignRecipient.updateMany({ where: { id: recipient.id, status: { in: ["PENDING", "QUEUED"] } }, data: { status: "SENT", sentAt: sent.acceptedAt, errorCode: null, errorMessage: null } });
    if (changed.count) await tx.campaign.update({ where: { id: recipient.campaignId }, data: { sentCount: { increment: 1 } } });
  });
  await finishCampaignIfSettled(recipient.campaignId);
}

export async function markCampaignRecipientFailed(recipientId: string, error: Error) {
  const recipient = await prisma.campaignRecipient.findUnique({ where: { id: recipientId }, select: { campaignId: true, messageId: true, status: true } });
  if (!recipient || !["PENDING", "QUEUED"].includes(recipient.status)) return;
  const message = error.message.slice(0, 500);
  await prisma.$transaction(async (tx) => {
    const changed = await tx.campaignRecipient.updateMany({ where: { id: recipientId, status: { in: ["PENDING", "QUEUED"] } }, data: { status: "FAILED", failedAt: new Date(), errorCode: "DELIVERY_FAILED", errorMessage: message } });
    if (recipient.messageId) await tx.message.update({ where: { id: recipient.messageId }, data: { status: "FAILED", errorCode: "DELIVERY_FAILED", errorMessage: message } });
    if (changed.count) await tx.campaign.update({ where: { id: recipient.campaignId }, data: { failedCount: { increment: 1 }, lastError: message } });
  });
  await finishCampaignIfSettled(recipient.campaignId);
}

async function skipRecipient(recipientId: string, campaignId: string, code: string, message: string) {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.campaignRecipient.updateMany({ where: { id: recipientId, status: { in: ["PENDING", "QUEUED"] } }, data: { status: "SKIPPED", skippedAt: new Date(), errorCode: code, errorMessage: message } });
    if (changed.count) await tx.campaign.update({ where: { id: campaignId }, data: { skippedCount: { increment: 1 } } });
  });
  await finishCampaignIfSettled(campaignId);
}
