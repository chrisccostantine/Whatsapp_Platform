import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../src/queues/campaign.queue.js", () => ({ enqueueCampaignRecipients: vi.fn() }));
const { campaignAudienceWhere } = await import("../src/modules/campaigns/campaign.service.js");

describe("campaign audience eligibility", () => {
  it("always requires active marketing consent and tenant ownership", () => {
    const where = campaignAudienceWhere("business-a", { selectedTagIds: [], excludedTagIds: [], lifecycleStages: [], sources: [], assignedUserId: null });
    expect(where).toMatchObject({ businessId: "business-a", deletedAt: null, marketingOptIn: true, optedOutAt: null, normalizedPhone: { not: null } });
  });
  it("applies tags, exclusions, stages, sources, and assignment", () => {
    const where = campaignAudienceWhere("business-a", { selectedTagIds: ["tag-a", "tag-b"], excludedTagIds: ["tag-x"], lifecycleStages: ["WON"], sources: ["WHATSAPP"], assignedUserId: "user-a" });
    expect(where).toMatchObject({ lifecycleStage: { in: ["WON"] }, source: { in: ["WHATSAPP"] }, assignedUserId: "user-a", tags: { none: { tagId: { in: ["tag-x"] } } } });
    expect(where.AND).toHaveLength(2);
  });
});
