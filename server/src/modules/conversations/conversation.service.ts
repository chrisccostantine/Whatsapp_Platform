import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

export type ConversationAuth = { businessId: string; userId: string; role: string };
export const conversationSummaryInclude = {
  customer: { include: { tags: { include: { tag: true } } } },
  assignedUser: { select: { id: true, firstName: true, lastName: true } }
} satisfies Prisma.ConversationInclude;

export async function assertConversationAccess(auth: ConversationAuth, conversationId: string, requireAssignment = true) {
  const conversation = await prisma.conversation.findFirst({ where: {
    id: conversationId, businessId: auth.businessId,
    ...(requireAssignment && auth.role === "SALES_AGENT" ? { assignedUserId: auth.userId } : {})
  }, include: conversationSummaryInclude });
  if (!conversation) throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found or is not assigned to you");
  return conversation;
}

