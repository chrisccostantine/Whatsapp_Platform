import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { assertCustomerOwnership } from "../customers/customer.service.js";

export const followUpRouter = Router();
followUpRouter.use(authenticate);
const schema = z.object({ customerId: z.string().uuid(), assignedUserId: z.string().uuid(), title: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).optional(), dueAt: z.coerce.date(), reminderAt: z.coerce.date().optional(), priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM") });

followUpRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ view: z.enum(["all", "today", "upcoming", "overdue"]).default("all") }).parse(req.query);
  const now = new Date(); const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0); const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dateWhere = query.view === "today" ? { dueAt: { gte: today, lt: tomorrow } } : query.view === "upcoming" ? { dueAt: { gte: tomorrow } } : query.view === "overdue" ? { dueAt: { lt: now }, status: { in: ["PENDING", "IN_PROGRESS"] as const } } : {};
  const roleWhere = req.auth!.role === "SALES_AGENT" ? { assignedUserId: req.auth!.userId } : {};
  const items = await prisma.followUp.findMany({ where: { businessId: req.auth!.businessId, deletedAt: null, ...roleWhere, ...dateWhere }, include: { customer: true, assignedUser: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { dueAt: "asc" } });
  return ok(res, items);
}));

followUpRouter.post("/", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const input = schema.parse(req.body); await assertCustomerOwnership(req.auth!.businessId, input.customerId);
  await prisma.businessMember.findFirstOrThrow({ where: { businessId: req.auth!.businessId, userId: input.assignedUserId, status: "ACTIVE" } });
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.followUp.create({ data: { ...input, businessId: req.auth!.businessId, createdById: req.auth!.userId } });
    await tx.activity.create({ data: { businessId: req.auth!.businessId, customerId: input.customerId, actorId: req.auth!.userId, type: "FOLLOW_UP_CREATED", metadata: { followUpId: created.id } } });
    return created;
  });
  return ok(res, item, "Follow-up created", 201);
}));

followUpRouter.patch("/:id/status", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) }).parse(req.body);
  const existing = await prisma.followUp.findFirstOrThrow({ where: { id: req.params.id, businessId: req.auth!.businessId, deletedAt: null, ...(req.auth!.role === "SALES_AGENT" ? { assignedUserId: req.auth!.userId } : {}) } });
  const item = await prisma.followUp.update({ where: { id: existing.id }, data: { status, completedAt: status === "COMPLETED" ? new Date() : null } });
  return ok(res, item, "Follow-up updated");
}));

