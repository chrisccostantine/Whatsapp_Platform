import type { SubscriptionPlan } from "@prisma/client";

export interface BillingProvider {
  createCheckout(input: { businessId: string; plan: SubscriptionPlan; billingCycle: "monthly" | "yearly" }): Promise<{ redirectUrl: string }>;
  cancelSubscription(businessId: string): Promise<void>;
}

export class UnconfiguredBillingProvider implements BillingProvider {
  async createCheckout(): Promise<{ redirectUrl: string }> { throw new Error("Billing provider is not configured"); }
  async cancelSubscription(): Promise<void> { throw new Error("Billing provider is not configured"); }
}
