import type { RequestHandler } from "express";
import type { MembershipRole } from "@prisma/client";
import { verifyAccessToken } from "../modules/auth/token.service.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { asyncHandler } from "../lib/async-handler.js";

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  const claims = await verifyAccessToken(token);
  const membership = await prisma.businessMember.findFirst({ where: {
    id: claims.membershipId, userId: claims.userId, businessId: claims.businessId, status: "ACTIVE",
    business: { deletedAt: null }, user: { isActive: true, deletedAt: null }
  }});
  if (!membership) throw new AppError(403, "MEMBERSHIP_REQUIRED", "Active business membership is required");
  req.auth = { ...claims, role: membership.role };
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method); const selfService = req.originalUrl.startsWith("/api/v1/notifications") || req.originalUrl === "/api/v1/auth/change-password";
  if (mutation && !selfService) { const subscription = await prisma.subscription.findUnique({ where: { businessId: claims.businessId }, select: { status: true, trialEnd: true } }); const active = subscription?.status === "ACTIVE" || (subscription?.status === "TRIALING" && subscription.trialEnd > new Date()); if (!active) throw new AppError(402, "SUBSCRIPTION_INACTIVE", "Your workspace is read-only because its trial or subscription is not active"); }
  next();
});

export const requireRole = (...roles: MembershipRole[]): RequestHandler => (req, _res, next) => {
  if (!req.auth || !roles.includes(req.auth.role)) return next(new AppError(403, "FORBIDDEN", "You do not have permission to perform this action"));
  next();
};
