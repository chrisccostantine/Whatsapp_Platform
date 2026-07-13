import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { emitToBusiness, emitToConversation } from "../../realtime/socket.js";
import type { MessagingProvider, ProviderSendResult, SendMessageInput } from "./provider.js";

export class MockWhatsAppProvider implements MessagingProvider {
  readonly channel = "MOCK_WHATSAPP" as const;
  async send(input: SendMessageInput): Promise<ProviderSendResult> {
    const result = { providerMessageId: `mock-${randomUUID()}`, acceptedAt: new Date() };
    this.scheduleStatus(input.businessId, input.conversationId, input.messageId);
    return result;
  }
  private scheduleStatus(businessId: string, conversationId: string, messageId: string) {
    const progress = async (status: "DELIVERED" | "READ") => {
      const timestamp = new Date();
      const message = await prisma.message.update({ where: { id: messageId, businessId }, data: { status, ...(status === "DELIVERED" ? { deliveredAt: timestamp } : { readAt: timestamp }) } });
      const payload = { messageId, status, timestamp: timestamp.toISOString() };
      emitToConversation(conversationId, "message:status", payload); emitToBusiness(businessId, "conversation:updated", { conversationId, message });
    };
    setTimeout(() => void progress("DELIVERED").catch(() => undefined), 350);
    setTimeout(() => void progress("READ").catch(() => undefined), 900);
  }
}

export const mockWhatsAppProvider = new MockWhatsAppProvider();
