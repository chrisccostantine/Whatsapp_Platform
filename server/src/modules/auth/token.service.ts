import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { MembershipRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

type AccessClaims = { userId: string; businessId: string; membershipId: string; role: MembershipRole };
const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function signAccessToken(claims: AccessClaims) {
  return new SignJWT({ ...claims }).setProtectedHeader({ alg: "HS256" }).setSubject(claims.userId)
    .setIssuedAt().setExpirationTime(env.ACCESS_TOKEN_EXPIRES_IN as Parameters<InstanceType<typeof SignJWT>["setExpirationTime"]>[0]).sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, accessSecret);
    if (!payload.userId || !payload.businessId || !payload.membershipId || !payload.role) throw new Error("claims");
    return payload as unknown as AccessClaims;
  } catch {
    throw new AppError(401, "INVALID_ACCESS_TOKEN", "Authentication is required");
  }
}

export async function issueTokenPair(claims: AccessClaims, context: { userAgent?: string; ipAddress?: string }, familyId = randomUUID()) {
  const refreshToken = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_IN_DAYS * 86_400_000);
  await prisma.refreshToken.create({ data: {
    userId: claims.userId, familyId, tokenHash: hashToken(refreshToken), expiresAt,
    ...(context.userAgent ? { userAgent: context.userAgent } : {}), ...(context.ipAddress ? { ipAddress: context.ipAddress } : {})
  }});
  return { accessToken: await signAccessToken(claims), refreshToken, expiresAt };
}

export async function rotateRefreshToken(token: string, context: { userAgent?: string; ipAddress?: string }) {
  const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { memberships: true } } } });
  if (!current || current.expiresAt <= new Date()) throw new AppError(401, "INVALID_REFRESH_TOKEN", "Session has expired");
  if (current.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw new AppError(401, "REFRESH_TOKEN_REUSE", "Session has been revoked");
  }
  const membership = current.user.memberships.find((item) => item.status === "ACTIVE");
  if (!membership || !current.user.isActive) throw new AppError(403, "ACCOUNT_DISABLED", "Account access is disabled");
  const next = await issueTokenPair({ userId: current.userId, businessId: membership.businessId, membershipId: membership.id, role: membership.role }, context, current.familyId);
  const replacement = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(next.refreshToken) } });
  await prisma.refreshToken.update({ where: { id: current.id }, data: { revokedAt: new Date(), replacedBy: replacement.id } });
  return next;
}
