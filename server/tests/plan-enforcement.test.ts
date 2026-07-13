import { beforeEach, describe, expect, it, vi } from "vitest";
const subscriptionFindUnique = vi.fn(); const customerCount = vi.fn();
vi.mock("../src/lib/prisma.js", () => ({ prisma: { subscription: { findUnique: subscriptionFindUnique }, customer: { count: customerCount }, businessMember: { count: vi.fn() }, whatsAppAccount: { count: vi.fn() } } }));
const { assertWithinPlanLimit, getEntitlement } = await import("../src/modules/subscriptions/plan.service.js");

describe("subscription enforcement", () => {
  beforeEach(() => { subscriptionFindUnique.mockReset(); customerCount.mockReset(); });
  it("grants full capabilities during an active trial", async () => { subscriptionFindUnique.mockResolvedValue({ plan: "STARTER", status: "TRIALING", trialEnd: new Date(Date.now() + 86_400_000) }); const result = await getEntitlement("business-a"); expect(result.effectivePlan).toBe("PRO"); expect(result.limits.features).toContain("ADVANCED_REPORTING"); });
  it("enforces tenant-scoped customer limits", async () => { subscriptionFindUnique.mockResolvedValue({ plan: "STARTER", status: "ACTIVE", trialEnd: new Date(0) }); customerCount.mockResolvedValue(1_000); await expect(assertWithinPlanLimit("business-a", "CUSTOMERS")).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" }); expect(customerCount).toHaveBeenCalledWith({ where: { businessId: "business-a", deletedAt: null } }); });
  it("rejects expired subscriptions", async () => { subscriptionFindUnique.mockResolvedValue({ plan: "GROWTH", status: "TRIALING", trialEnd: new Date(0) }); await expect(getEntitlement("business-a")).resolves.toMatchObject({ active: false }); });
});
