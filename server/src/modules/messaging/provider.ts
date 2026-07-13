import type { MessageType } from "@prisma/client";
export type SendMessageInput = { businessId: string; conversationId: string; messageId: string; recipientPhone: string; type: MessageType; body?: string };
export type ProviderSendResult = { providerMessageId: string; acceptedAt: Date };
export type SendTemplateInput = { recipientPhone: string; templateName: string; language: string; bodyVariables: string[] };
export interface MessagingProvider { readonly channel: "MOCK_WHATSAPP" | "WHATSAPP"; send(input: SendMessageInput): Promise<ProviderSendResult>; sendTemplate?(input: SendTemplateInput): Promise<ProviderSendResult>; }

