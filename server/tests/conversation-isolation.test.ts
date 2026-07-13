import { beforeEach, describe, expect, it, vi } from "vitest";
const findFirst = vi.fn();
vi.mock("../src/lib/prisma.js", () => ({ prisma: { conversation: { findFirst } } }));
const { assertConversationAccess } = await import("../src/modules/conversations/conversation.service.js");

describe("conversation tenant and assignment isolation", () => {
  beforeEach(() => findFirst.mockReset());
  it("scopes every lookup to the authenticated business", async () => {
    findFirst.mockResolvedValue({ id: "conversation-a" });
    await assertConversationAccess({ businessId: "business-a", userId: "owner-a", role: "OWNER" }, "conversation-a");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conversation-a", businessId: "business-a" } }));
  });
  it("also scopes sales agents to their assignment", async () => {
    findFirst.mockResolvedValue(null);
    await expect(assertConversationAccess({ businessId: "business-a", userId: "agent-a", role: "SALES_AGENT" }, "conversation-b"))
      .rejects.toMatchObject({ status: 404, code: "CONVERSATION_NOT_FOUND" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conversation-b", businessId: "business-a", assignedUserId: "agent-a" } }));
  });
});

