import type { RequestHandler } from "express";
import type { SubscriptionPlan } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { asyncHandler } from "../../lib/async-handler.js";

export type PlanFeature = "CAMPAIGNS" | "QUOTATIONS" | "INVOICES" | "ADVANCED_REPORTING" | "API_ACCESS";
export type LimitMetric = "CUSTOMERS" | "USERS" | "WHATSAPP_NUMBERS";

export const PLAN_CATALOG = {
  STARTER: { users: 2, customers: 1_000, whatsAppNumbers: 1, features: [] as PlanFeature[] },
  GROWTH: { users: 5, customers: 10_000, whatsAppNumbers: 1, features: ["CAMPAIGNS", "QUOTATIONS", "INVOICES", "ADVANCED_REPORTING"] as PlanFeature[] },
  PRO: { users: 15, customers: null, whatsAppNumbers: 1, features: ["CAMPAIGNS", "QUOTATIONS", "INVOICES", "ADVANCED_REPORTING", "API_ACCESS"] as PlanFeature[] }
} satisfies Record<SubscriptionPlan, { users: number; customers: number | null; whatsAppNumbers: number; features: PlanFeature[] }>;

export async function getEntitlement(businessId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!subscription) throw new AppError(403, "SUBSCRIPTION_REQUIRED", "A subscription is required");
  const now = new Date();
  const trialActive = subscription.status === "TRIALING" && subscription.trialEnd > now;
  const active = subscription.status === "ACTIVE" || trialActive;
  const effectivePlan: SubscriptionPlan = trialActive ? "PRO" : subscription.plan;
  return { subscription, active, trialActive, effectivePlan, limits: PLAN_CATALOG[effectivePlan] };
}

export const requireActiveSubscription: RequestHandler = asyncHandler(async (req, _res, next) => {
  const entitlement = await getEntitlement(req.auth!.businessId);
  if (!entitlement.active) throw new AppError(402, "SUBSCRIPTION_INACTIVE", "Your trial or subscription is not active");
  next();
});

export const requireFeature = (feature: PlanFeature): RequestHandler => asyncHandler(async (req, _res, next) => {
  const entitlement = await getEntitlement(req.auth!.businessId);
  if (!entitlement.active) throw new AppError(402, "SUBSCRIPTION_INACTIVE", "Your trial or subscription is not active");
  if (!entitlement.limits.features.includes(feature)) throw new AppError(403, "PLAN_UPGRADE_REQUIRED", `The ${feature.toLowerCase().replaceAll("_", " ")} feature requires a higher plan`);
  next();
});

export const requireFeatureOnMutation = (feature: PlanFeature): RequestHandler => (req, res, next) => { if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; } requireFeature(feature)(req, res, next); };

export async function assertWithinPlanLimit(businessId: string, metric: LimitMetric) {
  const entitlement = await getEntitlement(businessId);
  if (!entitlement.active) throw new AppError(402, "SUBSCRIPTION_INACTIVE", "Your trial or subscription is not active");
  const limit = metric === "CUSTOMERS" ? entitlement.limits.customers : metric === "USERS" ? entitlement.limits.users : entitlement.limits.whatsAppNumbers;
  if (limit === null) return;
  const current = metric === "CUSTOMERS"
    ? await prisma.customer.count({ where: { businessId, deletedAt: null } })
    : metric === "USERS"
      ? await prisma.businessMember.count({ where: { businessId, status: "ACTIVE" } })
      : await prisma.whatsAppAccount.count({ where: { businessId, connectionStatus: { not: "DISCONNECTED" } } });
  if (current >= limit) throw new AppError(403, "PLAN_LIMIT_REACHED", `${metric.toLowerCase().replaceAll("_", " ")} limit reached (${current}/${limit})`);
}
