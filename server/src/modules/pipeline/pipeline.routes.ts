import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { AppError } from "../../lib/errors.js";
import { authenticate, requireRole } from "../../middleware/auth.js";

export const pipelineRouter = Router();
pipelineRouter.use(authenticate);
pipelineRouter.get("/", asyncHandler(async (req, res) => {
  const pipelines = await prisma.pipeline.findMany({ where: { businessId: req.auth!.businessId }, include: { stages: { orderBy: { position: "asc" }, include: { leads: { where: { deletedAt: null, ...(req.auth!.role === "SALES_AGENT" ? { assignedUserId: req.auth!.userId } : {}) }, include: { customer: true, assignedUser: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { updatedAt: "desc" } } } } } });
  return ok(res, pipelines);
}));
pipelineRouter.patch("/leads/:leadId/stage", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const { stageId } = z.object({ stageId: z.string().uuid() }).parse(req.body);
  const lead = await prisma.lead.findFirst({ where: { id: req.params.leadId, businessId: req.auth!.businessId, deletedAt: null, ...(req.auth!.role === "SALES_AGENT" ? { assignedUserId: req.auth!.userId } : {}) } });
  if (!lead) throw new AppError(404, "LEAD_NOT_FOUND", "Lead was not found");
  const stage = await prisma.pipelineStage.findFirst({ where: { id: stageId, businessId: req.auth!.businessId, pipelineId: lead.pipelineId } });
  if (!stage) throw new AppError(400, "INVALID_STAGE", "Stage does not belong to this pipeline");
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.lead.update({ where: { id: lead.id }, data: { stageId, probability: stage.probability } });
    await tx.activity.create({ data: { businessId: req.auth!.businessId, customerId: lead.customerId, actorId: req.auth!.userId, type: "LEAD_STAGE_CHANGED", metadata: { leadId: lead.id, fromStageId: lead.stageId, toStageId: stageId } } });
    return item;
  });
  return ok(res, updated, "Lead stage updated");
}));

