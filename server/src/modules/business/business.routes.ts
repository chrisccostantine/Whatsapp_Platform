import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";

export const businessRouter = Router();
businessRouter.use(authenticate);

const onboardingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(["CLOTHING", "FURNITURE", "BEAUTY", "ELECTRONICS", "SERVICES", "OTHER"]),
  country: z.string().length(2).default("LB"),
  currency: z.enum(["USD", "LBP"]),
  phone: z.string().trim().min(6).max(30),
  employeeRange: z.string().trim().max(40),
  mainObjective: z.string().trim().max(250)
});

businessRouter.patch("/onboarding", requireRole("OWNER"), asyncHandler(async (req, res) => {
  const input = onboardingSchema.parse(req.body);
  const business = await prisma.business.update({ where: { id: req.auth!.businessId }, data: { ...input, country: input.country.toUpperCase(), timezone: "Asia/Beirut", onboardingComplete: true } });
  await prisma.auditLog.create({ data: { businessId: business.id, actorId: req.auth!.userId, action: "BUSINESS_ONBOARDING_COMPLETED", entityType: "Business", entityId: business.id } });
  return ok(res, business, "Onboarding completed");
}));

businessRouter.get("/members", asyncHandler(async (req, res) => {
  const members = await prisma.businessMember.findMany({ where: { businessId: req.auth!.businessId, status: "ACTIVE" }, select: { id: true, role: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "asc" } });
  return ok(res, members);
}));
