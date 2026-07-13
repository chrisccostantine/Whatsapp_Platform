import { beforeEach, describe, expect, it, vi } from "vitest";
const findFirst = vi.fn();
vi.mock("../src/lib/prisma.js", () => ({ prisma: { customer: { findFirst } } }));
vi.mock("../src/config/env.js", () => ({ env: {} }));
const { assertCustomerOwnership } = await import("../src/modules/customers/customer.service.js");

describe("tenant isolation", () => {
  beforeEach(() => findFirst.mockReset());
  it("always scopes customer ownership by business", async () => {
    findFirst.mockResolvedValue({ id: "customer-a", businessId: "business-a" });
    await assertCustomerOwnership("business-a", "customer-a");
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "customer-a", businessId: "business-a", deletedAt: null } });
  });
  it("does not return a resource absent from the authenticated tenant", async () => {
    findFirst.mockResolvedValue(null);
    await expect(assertCustomerOwnership("business-a", "customer-from-business-b")).rejects.toMatchObject({ status: 404, code: "CUSTOMER_NOT_FOUND" });
  });
});

