import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../../lib/prisma.js";

export function audit(req: Request, action: string, details: { entityType?: string; entityId?: string; metadata?: Prisma.InputJsonValue } = {}) {
  return prisma.auditLog.create({ data: { businessId: req.auth!.businessId, actorId: req.auth!.userId, action, ipAddress: req.ip, ...details } });
}
