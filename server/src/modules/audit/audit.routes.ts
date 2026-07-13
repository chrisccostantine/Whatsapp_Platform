import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";

export const auditRouter = Router();
auditRouter.use(authenticate, requireRole("OWNER", "ADMIN"));
auditRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(30), action: z.string().trim().max(100).optional() }).parse(req.query);
  const where = { businessId: req.auth!.businessId, ...(query.action ? { action: query.action } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({ where, select: { id: true, action: true, entityType: true, entityId: true, metadata: true, ipAddress: true, createdAt: true, actor: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.auditLog.count({ where })
  ]);
  return ok(res, { items, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
}));
