import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/prisma.js", () => ({ prisma: {} }));
const { normalizePhone } = await import("../src/modules/customers/customer.service.js");
describe("Lebanese phone normalization", () => {
  it("normalizes a local mobile number to E.164", () => expect(normalizePhone("03 123 456")).toBe("+9613123456"));
  it("rejects invalid numbers", () => expect(() => normalizePhone("123")).toThrow("valid phone"));
});

