import { beforeEach, describe, expect, it, vi } from "vitest";
const update = vi.fn().mockResolvedValue({ id: "message-a" });
vi.mock("../src/lib/prisma.js", () => ({ prisma: { message: { update } } }));
vi.mock("../src/realtime/socket.js", () => ({ emitToBusiness: vi.fn(), emitToConversation: vi.fn() }));
const { MockWhatsAppProvider } = await import("../src/modules/messaging/mock.provider.js");

describe("mock WhatsApp provider", () => {
  beforeEach(() => { vi.useFakeTimers(); update.mockClear(); });
  it("accepts a message and simulates delivered then read", async () => {
    const result = await new MockWhatsAppProvider().send({ businessId: "business-a", conversationId: "conversation-a", messageId: "message-a", recipientPhone: "+9613123456", type: "TEXT", body: "Hello" });
    expect(result.providerMessageId).toMatch(/^mock-/);
    await vi.advanceTimersByTimeAsync(1000);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "READ" }) }));
  });
});
