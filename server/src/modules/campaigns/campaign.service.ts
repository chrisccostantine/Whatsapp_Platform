import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { enqueueCampaignRecipients } from "../../queues/campaign.queue.js";
import { audienceSchema, type CampaignAudience } from "./campaign.schemas.js";

export function campaignAudienceWhere(businessId: string, audience: CampaignAudience): Prisma.CustomerWhereInput {
  return {
    businessId, deletedAt: null, marketingOptIn: true, optedOutAt: null, normalizedPhone: { not: null },
    ...(audience.lifecycleStages.length ? { lifecycleStage: { in: audience.lifecycleStages } } : {}),
    ...(audience.sources.length ? { source: { in: audience.sources } } : {}),
    ...(audience.assignedUserId ? { assignedUserId: audience.assignedUserId } : {}),
    ...(audience.excludedTagIds.length ? { tags: { none: { tagId: { in: audience.excludedTagIds } } } } : {}),
    ...(audience.selectedTagIds.length ? { AND: audience.selectedTagIds.map((tagId) => ({ tags: { some: { tagId } } })) } : {})
  };
}

export async function estimateAudience(businessId: string, audience: CampaignAudience) {
  const where = campaignAudienceWhere(businessId, audience);
  const [count, sample] = await prisma.$transaction([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, select: { id: true, firstName: true, lastName: true, normalizedPhone: true }, orderBy: { createdAt: "desc" }, take: 5 })
  ]);
  return { count, sample };
}

function renderVariables(values: string[], customer: { firstName: string; lastName: string | null; normalizedPhone: string | null; company: string | null }) {
  const replacements: Record<string, string> = { firstName: customer.firstName, lastName: customer.lastName ?? "", phone: customer.normalizedPhone ?? "", company: customer.company ?? "" };
  return values.map((value) => value.replace(/\{\{(firstName|lastName|phone|company)\}\}/g, (_match, key: string) => replacements[key] ?? ""));
}

export async function launchCampaign(businessId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, businessId }, include: { template: true } });
  if (!campaign) throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found");
  if (campaign.status !== "DRAFT") throw new AppError(409, "CAMPAIGN_ALREADY_LAUNCHED", "Only draft campaigns can be launched");
  if (campaign.template.status !== "APPROVED" || campaign.template.category !== "MARKETING") throw new AppError(409, "TEMPLATE_NOT_ELIGIBLE", "Campaigns require an approved marketing template");
  const stored = campaign.audience as { filters?: unknown; bodyVariables?: unknown };
  const audience = audienceSchema.parse(stored.filters ?? stored);
  const bodyVariables = Array.isArray(stored.bodyVariables) ? stored.bodyVariables.filter((item): item is string => typeof item === "string") : [];
  const expectedVariables = Array.isArray(campaign.template.variables) ? campaign.template.variables.length : 0;
  if (bodyVariables.length !== expectedVariables) throw new AppError(400, "TEMPLATE_VARIABLE_MISMATCH", `This template requires ${expectedVariables} variables`);
  const customers = await prisma.customer.findMany({ where: campaignAudienceWhere(businessId, audience), select: { id: true, firstName: true, lastName: true, normalizedPhone: true, company: true } });
  if (!customers.length) throw new AppError(409, "EMPTY_CAMPAIGN_AUDIENCE", "No opted-in customers match this audience");
  const scheduledAt = campaign.scheduledAt && campaign.scheduledAt > new Date() ? campaign.scheduledAt : null;
  await prisma.$transaction(async (tx) => {
    await tx.campaignRecipient.createMany({ data: customers.map((customer) => ({ businessId, campaignId, customerId: customer.id, phone: customer.normalizedPhone!, variables: renderVariables(bodyVariables, customer), status: "QUEUED", queuedAt: new Date() })) });
    await tx.campaign.update({ where: { id: campaignId }, data: { status: scheduledAt ? "SCHEDULED" : "PROCESSING", totalRecipients: customers.length, queuedCount: customers.length, startedAt: scheduledAt ? null : new Date(), lastError: null } });
  });
  const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId }, select: { id: true } });
  try { await enqueueCampaignRecipients(recipients.map((item) => item.id), scheduledAt); }
  catch (error) { const message = error instanceof Error ? error.message.slice(0, 500) : "Campaign queue unavailable"; await prisma.campaign.update({ where: { id: campaignId }, data: { status: "FAILED", completedAt: new Date(), lastError: message } }); throw error; }
  return prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
}

export async function finishCampaignIfSettled(campaignId: string) {
  const remaining = await prisma.campaignRecipient.count({ where: { campaignId, status: { in: ["PENDING", "QUEUED"] } } });
  if (!remaining) await prisma.campaign.updateMany({ where: { id: campaignId, status: { in: ["PROCESSING", "SCHEDULED"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
}
