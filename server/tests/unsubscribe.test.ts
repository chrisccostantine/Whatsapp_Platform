import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.js", () => ({ prisma: {} }));
const { isUnsubscribeMessage } = await import("../src/modules/consent/consent.service.js");

describe("WhatsApp unsubscribe keywords", () => {
  it.each(["STOP", " stop ", "Unsubscribe", "CANCEL", "إلغاء", "الغاء"])("recognizes %s", (message) => expect(isUnsubscribeMessage(message)).toBe(true));
  it("ignores ordinary messages", () => expect(isUnsubscribeMessage("Please send the blue option")).toBe(false));
});
