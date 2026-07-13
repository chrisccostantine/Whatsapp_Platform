import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate } from "../../middleware/auth.js";
import { getEntitlement, PLAN_CATALOG } from "./plan.service.js";

export const subscriptionRouter = Router();
subscriptionRouter.use(authenticate);

subscriptionRouter.get("/plans", (_req, res) => ok(res, PLAN_CATALOG));
subscriptionRouter.get("/current", asyncHandler(async (req, res) => {
  const businessId = req.auth!.businessId;
  const [entitlement, customers, users, whatsAppNumbers] = await Promise.all([
    getEntitlement(businessId),
    prisma.customer.count({ where: { businessId, deletedAt: null } }),
    prisma.businessMember.count({ where: { businessId, status: "ACTIVE" } }),
    prisma.whatsAppAccount.count({ where: { businessId, connectionStatus: { not: "DISCONNECTED" } } })
  ]);
  return ok(res, { subscription: entitlement.subscription, effectivePlan: entitlement.effectivePlan, trialActive: entitlement.trialActive, active: entitlement.active, limits: entitlement.limits, usage: { customers, users, whatsAppNumbers } });
}));
