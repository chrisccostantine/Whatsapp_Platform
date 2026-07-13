import { Router } from "express";
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/response.js";
import { authenticate } from "../../middleware/auth.js";
import { hashToken, issueTokenPair, rotateRefreshToken } from "./token.service.js";

export const authRouter = Router();
const credentials = z.object({ email: z.string().email().transform((v) => v.trim().toLowerCase()), password: z.string().min(8).max(128) });
const registerSchema = credentials.extend({ firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60), businessName: z.string().trim().min(2).max(120) });
const context = (req: Request) => ({
  ...(typeof req.headers["user-agent"] === "string" ? { userAgent: req.headers["user-agent"] } : {}),
  ...(req.ip ? { ipAddress: req.ip } : {})
});
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/api/v1/auth", maxAge: 30 * 86_400_000 };

authRouter.post("/register", asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const slug = `${input.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${randomUUID().slice(0, 8)}`;
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: input.email, passwordHash, firstName: input.firstName, lastName: input.lastName } });
    const business = await tx.business.create({ data: { name: input.businessName, slug } });
    const membership = await tx.businessMember.create({ data: { userId: user.id, businessId: business.id, role: "OWNER" } });
    await tx.subscription.create({ data: { businessId: business.id, trialEnd: new Date(Date.now() + 14 * 86_400_000) } });
    return { user, business, membership };
  });
  const tokens = await issueTokenPair({ userId: result.user.id, businessId: result.business.id, membershipId: result.membership.id, role: result.membership.role }, context(req));
  res.cookie("refreshToken", tokens.refreshToken, cookieOptions);
  return ok(res, { accessToken: tokens.accessToken, user: { id: result.user.id, email: result.user.email, firstName: result.user.firstName, lastName: result.user.lastName }, business: result.business }, "Account created", 201);
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: { memberships: { where: { status: "ACTIVE" }, include: { business: true } } } });
  if (!user || !user.isActive || !(await bcrypt.compare(input.password, user.passwordHash))) throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  const membership = user.memberships[0];
  if (!membership || membership.business.deletedAt) throw new AppError(403, "MEMBERSHIP_REQUIRED", "No active workspace membership found");
  const tokens = await issueTokenPair({ userId: user.id, businessId: membership.businessId, membershipId: membership.id, role: membership.role }, context(req));
  await prisma.auditLog.create({ data: { businessId: membership.businessId, actorId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, ipAddress: req.ip } });
  res.cookie("refreshToken", tokens.refreshToken, cookieOptions);
  return ok(res, { accessToken: tokens.accessToken, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName }, business: membership.business }, "Logged in");
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const token = z.string().min(1).parse(req.cookies.refreshToken);
  const tokens = await rotateRefreshToken(token, context(req));
  res.cookie("refreshToken", tokens.refreshToken, cookieOptions);
  return ok(res, { accessToken: tokens.accessToken }, "Session refreshed");
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  const token = req.cookies.refreshToken as string | undefined;
  if (token) await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie("refreshToken", cookieOptions);
  return ok(res, null, "Logged out");
}));

authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  const auth = req.auth!;
  const membership = await prisma.businessMember.findUniqueOrThrow({ where: { id: auth.membershipId }, include: { user: true, business: { include: { subscription: true } } } });
  return ok(res, { user: { id: membership.user.id, email: membership.user.email, firstName: membership.user.firstName, lastName: membership.user.lastName }, business: membership.business, role: membership.role });
}));

authRouter.post("/forgot-password", asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email().transform((v) => v.toLowerCase()) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  let developmentToken: string | undefined;
  if (user) {
    const token = randomBytes(32).toString("base64url"); developmentToken = token;
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3_600_000) } });
    // Production email providers consume this token through a future notification adapter.
  }
  return ok(res, process.env.NODE_ENV === "development" ? { developmentToken } : null, "If the account exists, reset instructions will be sent");
}));

authRouter.post("/reset-password", asyncHandler(async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(20), password: z.string().min(8).max(128) }).parse(req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) throw new AppError(400, "INVALID_RESET_TOKEN", "Reset link is invalid or expired");
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } })
  ]);
  return ok(res, null, "Password reset successfully");
}));

authRouter.post("/change-password", authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(128) }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new AppError(400, "INVALID_PASSWORD", "Current password is incorrect");
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({ data: { businessId: req.auth!.businessId, actorId: user.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id } })
  ]);
  res.clearCookie("refreshToken", cookieOptions);
  return ok(res, null, "Password changed; sign in again");
}));
