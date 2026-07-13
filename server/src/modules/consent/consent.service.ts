import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

const unsubscribeKeywords = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "إلغاء", "الغاء"]);

export function isUnsubscribeMessage(body: string) {
  return unsubscribeKeywords.has(body.normalize("NFKC").trim().toUpperCase());
}

type ConsentInput = {
  businessId: string;
  customerId: string;
  recordedById?: string;
  optedIn: boolean;
  source: string;
  notes?: string | null;
};

export async function setMarketingConsent(input: ConsentInput) {
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, businessId: input.businessId, deletedAt: null } });
  if (!customer) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer was not found");
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.customer.update({ where: { id: customer.id }, data: input.optedIn ? {
      marketingOptIn: true, marketingOptInSource: input.source, marketingOptInAt: now, optedOutAt: null, consentNotes: input.notes ?? null
    } : {
      marketingOptIn: false, optedOutAt: now, consentNotes: input.notes ?? null
    } });
    await tx.consentRecord.create({ data: {
      businessId: input.businessId, customerId: customer.id, recordedById: input.recordedById,
      status: input.optedIn ? "OPTED_IN" : "OPTED_OUT", source: input.source, notes: input.notes
    } });
    return result;
  });
  if (!input.optedIn) await skipPendingRecipients(input.businessId, customer.id, "Customer withdrew marketing consent");
  return updated;
}

async function skipPendingRecipients(businessId: string, customerId: string, reason: string) {
  const pending = await prisma.campaignRecipient.findMany({
    where: { businessId, customerId, status: { in: ["PENDING", "QUEUED"] } }, select: { id: true, campaignId: true }
  });
  const byCampaign = new Map<string, string[]>();
  for (const recipient of pending) byCampaign.set(recipient.campaignId, [...(byCampaign.get(recipient.campaignId) ?? []), recipient.id]);
  for (const [campaignId, ids] of byCampaign) {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.campaignRecipient.updateMany({ where: { id: { in: ids }, status: { in: ["PENDING", "QUEUED"] } }, data: { status: "SKIPPED", skippedAt: new Date(), errorCode: "CONSENT_WITHDRAWN", errorMessage: reason } });
      if (changed.count) await tx.campaign.update({ where: { id: campaignId }, data: { skippedCount: { increment: changed.count } } });
    });
  }
}
