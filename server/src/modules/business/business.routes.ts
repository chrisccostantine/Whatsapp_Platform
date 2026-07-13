import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { AppError } from "../../lib/errors.js";
import { routeParam } from "../../lib/route-param.js";
import { getEntitlement } from "../subscriptions/plan.service.js";
import { audit } from "../audit/audit.service.js";

export const businessRouter = Router();
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

businessRouter.post("/invitations/accept", asyncHandler(async (req, res) => {
  const input = z.object({ token: z.string().min(32), firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60), password: z.string().min(8).max(128) }).parse(req.body);
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: tokenHash(input.token) } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) throw new AppError(400, "INVALID_INVITATION", "Invitation is invalid or expired");
  const entitlement = await getEntitlement(invitation.businessId); const memberCount = await prisma.businessMember.count({ where: { businessId: invitation.businessId, status: "ACTIVE" } }); if (!entitlement.active || memberCount >= entitlement.limits.users) throw new AppError(403, "PLAN_LIMIT_REACHED", "This workspace cannot add another member on its current plan");
  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing && !(await bcrypt.compare(input.password, existing.passwordHash))) throw new AppError(401, "INVALID_CREDENTIALS", "Use the password for your existing account");
  const result = await prisma.$transaction(async (tx) => {
    const user = existing ?? await tx.user.create({ data: { email: invitation.email, passwordHash: await bcrypt.hash(input.password, 12), firstName: input.firstName, lastName: input.lastName } });
    const membership = await tx.businessMember.upsert({ where: { businessId_userId: { businessId: invitation.businessId, userId: user.id } }, update: { role: invitation.role, status: "ACTIVE" }, create: { businessId: invitation.businessId, userId: user.id, role: invitation.role } });
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    await tx.auditLog.create({ data: { businessId: invitation.businessId, actorId: user.id, action: "EMPLOYEE_INVITATION_ACCEPTED", entityType: "BusinessMember", entityId: membership.id } });
    return membership;
  });
  return ok(res, result, "Invitation accepted; you can now sign in");
}));
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
  const members = await prisma.businessMember.findMany({ where: { businessId: req.auth!.businessId }, select: { id: true, role: true, status: true, createdAt: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "asc" } });
  return ok(res, members);
}));

businessRouter.get("/invitations", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => ok(res, await prisma.invitation.findMany({ where: { businessId: req.auth!.businessId, acceptedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, role: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: "desc" } }))));
businessRouter.post("/invitations", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const input = z.object({ email: z.string().email().transform((value) => value.trim().toLowerCase()), role: z.enum(["ADMIN", "SALES_AGENT", "VIEWER"]) }).parse(req.body);
  if (req.auth!.role === "ADMIN" && input.role === "ADMIN") throw new AppError(403, "FORBIDDEN", "Only owners can invite administrators");
  const entitlement = await getEntitlement(req.auth!.businessId); if (!entitlement.active) throw new AppError(402, "SUBSCRIPTION_INACTIVE", "Your trial or subscription is not active"); const [members, pending] = await Promise.all([prisma.businessMember.count({ where: { businessId: req.auth!.businessId, status: "ACTIVE" } }), prisma.invitation.count({ where: { businessId: req.auth!.businessId, acceptedAt: null, expiresAt: { gt: new Date() } } })]);
  if (members + pending >= entitlement.limits.users) throw new AppError(403, "PLAN_LIMIT_REACHED", `Team member limit reached (${members + pending}/${entitlement.limits.users})`);
  const alreadyMember = await prisma.businessMember.findFirst({ where: { businessId: req.auth!.businessId, user: { email: input.email }, status: "ACTIVE" } }); if (alreadyMember) throw new AppError(409, "ALREADY_A_MEMBER", "This person is already a workspace member");
  const token = randomBytes(32).toString("base64url"); const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const invitation = await prisma.invitation.upsert({ where: { businessId_email: { businessId: req.auth!.businessId, email: input.email } }, update: { role: input.role, tokenHash: tokenHash(token), expiresAt, acceptedAt: null }, create: { businessId: req.auth!.businessId, email: input.email, role: input.role, tokenHash: tokenHash(token), expiresAt } });
  await audit(req, "EMPLOYEE_INVITED", { entityType: "Invitation", entityId: invitation.id, metadata: { email: input.email, role: input.role } });
  return ok(res, { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt, token }, "Invitation created", 201);
}));

businessRouter.patch("/members/:id", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const input = z.object({ role: z.enum(["ADMIN", "SALES_AGENT", "VIEWER"]).optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() }).refine((value) => value.role || value.status, "A role or status is required").parse(req.body);
  const member = await prisma.businessMember.findFirst({ where: { id: routeParam(req.params.id), businessId: req.auth!.businessId }, include: { user: { select: { email: true } } } });
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Workspace member was not found"); if (member.role === "OWNER") throw new AppError(409, "OWNER_PROTECTED", "The workspace owner cannot be changed here"); if (req.auth!.role === "ADMIN" && (member.role === "ADMIN" || input.role === "ADMIN")) throw new AppError(403, "FORBIDDEN", "Only owners can manage administrators");
  if (input.status === "ACTIVE" && member.status === "DISABLED") { const entitlement = await getEntitlement(req.auth!.businessId); const memberCount = await prisma.businessMember.count({ where: { businessId: req.auth!.businessId, status: "ACTIVE" } }); if (!entitlement.active || memberCount >= entitlement.limits.users) throw new AppError(403, "PLAN_LIMIT_REACHED", "Team member limit reached"); }
  const updated = await prisma.businessMember.update({ where: { id: member.id }, data: input });
  await audit(req, input.status === "DISABLED" ? "EMPLOYEE_DISABLED" : "EMPLOYEE_ROLE_CHANGED", { entityType: "BusinessMember", entityId: member.id, metadata: { email: member.user.email, fromRole: member.role, ...input } });
  return ok(res, updated, "Team member updated");
}));
