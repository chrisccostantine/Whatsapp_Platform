import { beforeEach, describe, expect, it, vi } from "vitest";
const preferenceFindUnique = vi.fn(); const notificationUpsert = vi.fn();
vi.mock("../src/lib/prisma.js", () => ({ prisma: { notificationPreference: { findUnique: preferenceFindUnique }, notification: { upsert: notificationUpsert } } }));
const { createNotification } = await import("../src/modules/notifications/notification.service.js");

describe("notification isolation", () => {
  beforeEach(() => { preferenceFindUnique.mockReset(); notificationUpsert.mockReset(); preferenceFindUnique.mockResolvedValue(null); notificationUpsert.mockResolvedValue({ id: "notification-a" }); });
  it("scopes preference and deduplication lookups to business and user", async () => { await createNotification({ businessId: "business-a", userId: "user-a", type: "NEW_MESSAGE", title: "New message", body: "Hello", entityId: "message-a", dedupeKey: "message-a" }); expect(preferenceFindUnique).toHaveBeenCalledWith({ where: { businessId_userId: { businessId: "business-a", userId: "user-a" } }, select: { enabledTypes: true } }); expect(notificationUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId_userId_dedupeKey: { businessId: "business-a", userId: "user-a", dedupeKey: "message-a" } } })); });
  it("honors disabled notification types", async () => { preferenceFindUnique.mockResolvedValue({ enabledTypes: ["FOLLOW_UP_DUE"] }); await expect(createNotification({ businessId: "business-a", userId: "user-a", type: "NEW_MESSAGE", title: "New message", body: "Hello" })).resolves.toBeNull(); expect(notificationUpsert).not.toHaveBeenCalled(); });
});
