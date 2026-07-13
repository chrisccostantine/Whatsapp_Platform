import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { routeParam } from "../../lib/route-param.js";
import { enqueueCampaignRecipients } from "../../queues/campaign.queue.js";
import { audienceSchema, createCampaignSchema } from "./campaign.schemas.js";
import { estimateAudience, launchCampaign } from "./campaign.service.js";

export const campaignRouter = Router();
campaignRouter.use(authenticate);

campaignRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ status: z.enum(["DRAFT", "SCHEDULED", "PROCESSING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"]).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
  const where = { businessId: req.auth!.businessId, ...(query.status ? { status: query.status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.campaign.findMany({ where, include: { template: { select: { name: true, language: true, status: true } }, createdBy: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.campaign.count({ where })
  ]);
  return ok(res, { items, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
}));

campaignRouter.post("/estimate", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => ok(res, await estimateAudience(req.auth!.businessId, audienceSchema.parse(req.body)))));

campaignRouter.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const input = createCampaignSchema.parse(req.body);
  const template = await prisma.whatsAppTemplate.findFirst({ where: { id: input.templateId, businessId: req.auth!.businessId, category: "MARKETING", status: "APPROVED" } });
  if (!template) throw new AppError(409, "APPROVED_MARKETING_TEMPLATE_REQUIRED", "Select an approved marketing template");
  const expected = Array.isArray(template.variables) ? template.variables.length : 0;
  if (input.bodyVariables.length !== expected) throw new AppError(400, "TEMPLATE_VARIABLE_MISMATCH", `This template requires ${expected} variables`);
  const campaign = await prisma.campaign.create({ data: { businessId: req.auth!.businessId, createdById: req.auth!.userId, templateId: template.id, name: input.name, audience: { filters: input.audience, bodyVariables: input.bodyVariables }, scheduledAt: input.scheduledAt ?? null } });
  await prisma.auditLog.create({ data: { businessId: req.auth!.businessId, actorId: req.auth!.userId, action: "CAMPAIGN_CREATED", entityType: "Campaign", entityId: campaign.id } });
  return ok(res, campaign, "Campaign draft created", 201);
}));

campaignRouter.get("/:id", asyncHandler(async (req, res) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: routeParam(req.params.id), businessId: req.auth!.businessId }, include: { template: true, createdBy: { select: { firstName: true, lastName: true } } } });
  if (!campaign) throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found");
  return ok(res, campaign);
}));

campaignRouter.get("/:id/recipients", asyncHandler(async (req, res) => {
  const campaignId = routeParam(req.params.id); const status = z.enum(["PENDING", "QUEUED", "SENT", "DELIVERED", "READ", "REPLIED", "FAILED", "SKIPPED"]).optional().parse(req.query.status);
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, businessId: req.auth!.businessId }, select: { id: true } });
  if (!campaign) throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found");
  const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId, businessId: req.auth!.businessId, ...(status ? { status } : {}) }, include: { customer: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" }, take: 500 });
  return ok(res, recipients);
}));

campaignRouter.get("/:id/report", asyncHandler(async (req, res) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: routeParam(req.params.id), businessId: req.auth!.businessId } });
  if (!campaign) throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found");
  const percentage = (value: number) => campaign.totalRecipients ? Math.round(value * 10_000 / campaign.totalRecipients) / 100 : 0;
  return ok(res, { ...campaign, rates: { sent: percentage(campaign.sentCount), delivered: percentage(campaign.deliveredCount), read: percentage(campaign.readCount), replied: percentage(campaign.replyCount), failed: percentage(campaign.failedCount) } });
}));

campaignRouter.post("/:id/launch", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => { const campaign = await launchCampaign(req.auth!.businessId, routeParam(req.params.id)); await prisma.auditLog.create({ data: { businessId: req.auth!.businessId, actorId: req.auth!.userId, action: "CAMPAIGN_LAUNCHED", entityType: "Campaign", entityId: campaign.id } }); return ok(res, campaign, "Campaign queued"); }));

campaignRouter.post("/:id/pause", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const result = await prisma.campaign.updateMany({ where: { id: routeParam(req.params.id), businessId: req.auth!.businessId, status: { in: ["SCHEDULED", "PROCESSING"] } }, data: { status: "PAUSED" } });
  if (!result.count) throw new AppError(409, "CAMPAIGN_NOT_PAUSABLE", "Campaign cannot be paused");
  return ok(res, null, "Campaign paused");
}));

campaignRouter.post("/:id/resume", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const campaignId = routeParam(req.params.id); const result = await prisma.campaign.updateMany({ where: { id: campaignId, businessId: req.auth!.businessId, status: "PAUSED" }, data: { status: "PROCESSING", startedAt: new Date() } });
  if (!result.count) throw new AppError(409, "CAMPAIGN_NOT_PAUSED", "Campaign is not paused");
  const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId, status: { in: ["PENDING", "QUEUED"] } }, select: { id: true } });
  await enqueueCampaignRecipients(recipients.map((item) => item.id), null, `resume-${Date.now()}`);
  return ok(res, null, "Campaign resumed");
}));

campaignRouter.post("/:id/cancel", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const campaignId = routeParam(req.params.id); const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, businessId: req.auth!.businessId } });
  if (!campaign || ["COMPLETED", "CANCELLED"].includes(campaign.status)) throw new AppError(409, "CAMPAIGN_NOT_CANCELLABLE", "Campaign cannot be cancelled");
  await prisma.$transaction(async (tx) => { const skipped = await tx.campaignRecipient.updateMany({ where: { campaignId, status: { in: ["PENDING", "QUEUED"] } }, data: { status: "SKIPPED", skippedAt: new Date(), errorCode: "CAMPAIGN_CANCELLED" } }); await tx.campaign.update({ where: { id: campaignId }, data: { status: "CANCELLED", completedAt: new Date(), skippedCount: { increment: skipped.count } } }); });
  return ok(res, null, "Campaign cancelled");
}));
