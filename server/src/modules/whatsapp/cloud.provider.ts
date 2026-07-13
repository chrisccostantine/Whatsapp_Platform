import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { MessagingProvider, ProviderSendResult, SendMessageInput, SendTemplateInput } from "../messaging/provider.js";

const sendResponse = z.object({ messages: z.array(z.object({ id: z.string() })).min(1) });
const phoneResponse = z.object({ id: z.string(), display_phone_number: z.string(), verified_name: z.string().optional() });
const templateResponse = z.object({ data: z.array(z.object({ id: z.string().optional(), name: z.string(), language: z.string(), category: z.enum(["MARKETING","UTILITY","AUTHENTICATION"]), status: z.string(), components: z.array(z.object({ type: z.string(), text: z.string().optional(), buttons: z.array(z.unknown()).optional(), example: z.unknown().optional() })).default([]) })), paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional() }).optional() });
const templateCreateResponse = z.object({ id: z.string(), status: z.string(), category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]) });
const graphErrorResponse = z.object({ error: z.object({ message: z.string().optional(), code: z.number().optional(), error_subcode: z.number().optional() }) });
const successResponse = z.object({ success: z.union([z.boolean(), z.literal("true")]) });
export type CreateTemplateInput = { name: string; language: string; category: "MARKETING" | "UTILITY"; header?: { text: string; example?: string }; body: string; bodyExamples: string[]; footer?: string; buttons: { type: "QUICK_REPLY"; text: string }[] };

export class WhatsAppCloudProvider implements MessagingProvider {
  readonly channel = "WHATSAPP" as const;
  constructor(private readonly phoneNumberId: string, private readonly accessToken: string) {}
  private async graph(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers); headers.set("Authorization", `Bearer ${this.accessToken}`); headers.set("Content-Type", "application/json");
    const response = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) { const parsed = graphErrorResponse.safeParse(payload); const metaMessage = parsed.success ? parsed.data.error.message?.slice(0, 300) : undefined; throw new AppError(502, "WHATSAPP_API_ERROR", metaMessage ? `Meta rejected the WhatsApp request: ${metaMessage}` : "Meta rejected the WhatsApp request", { status: response.status, ...(parsed.success ? { code: parsed.data.error.code, subcode: parsed.data.error.error_subcode } : {}) }); }
    return payload;
  }
  async send(input: SendMessageInput): Promise<ProviderSendResult> {
    if (input.type !== "TEXT" || !input.body) throw new AppError(400, "UNSUPPORTED_MESSAGE_TYPE", "This message type is not supported yet");
    const payload = sendResponse.parse(await this.graph(`${this.phoneNumberId}/messages`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.recipientPhone.replace(/^\+/, ""), type: "text", text: { preview_url: false, body: input.body } }) }));
    return { providerMessageId: payload.messages[0]!.id, acceptedAt: new Date() };
  }
  async sendTemplate(input: SendTemplateInput): Promise<ProviderSendResult> {
    const components = input.bodyVariables.length ? [{ type: "body", parameters: input.bodyVariables.map((text) => ({ type: "text", text })) }] : undefined;
    const payload = sendResponse.parse(await this.graph(`${this.phoneNumberId}/messages`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", to: input.recipientPhone.replace(/^\+/, ""), type: "template", template: { name: input.templateName, language: { code: input.language }, ...(components ? { components } : {}) } }) }));
    return { providerMessageId: payload.messages[0]!.id, acceptedAt: new Date() };
  }
  async testConnection() { return phoneResponse.parse(await this.graph(`${this.phoneNumberId}?fields=id,display_phone_number,verified_name`)); }
  async fetchTemplates(wabaId: string) {
    const all: z.infer<typeof templateResponse>["data"] = []; let after: string | undefined;
    for (let page=0; page<10; page++) { const query = new URLSearchParams({ limit: "100", fields: "id,name,language,category,status,components" }); if (after) query.set("after", after); const result = templateResponse.parse(await this.graph(`${wabaId}/message_templates?${query}`)); all.push(...result.data); after = result.paging?.cursors?.after; if (!after) break; }
    return all;
  }
  async createTemplate(wabaId: string, input: CreateTemplateInput) {
    const components: unknown[] = [];
    if (input.header) components.push({ type: "HEADER", format: "TEXT", text: input.header.text, ...(input.header.example ? { example: { header_text: [input.header.example] } } : {}) });
    components.push({ type: "BODY", text: input.body, ...(input.bodyExamples.length ? { example: { body_text: [input.bodyExamples] } } : {}) });
    if (input.footer) components.push({ type: "FOOTER", text: input.footer });
    if (input.buttons.length) components.push({ type: "BUTTONS", buttons: input.buttons });
    return templateCreateResponse.parse(await this.graph(`${wabaId}/message_templates`, { method: "POST", body: JSON.stringify({ name: input.name, language: input.language, category: input.category, components }) }));
  }
  async subscribeWaba(wabaId: string) { const result = successResponse.parse(await this.graph(`${wabaId}/subscribed_apps`, { method: "POST", body: JSON.stringify({}) })); return result.success === true || result.success === "true"; }
  async getMedia(mediaId: string) { return z.object({ url: z.string().url(), mime_type: z.string(), sha256: z.string().optional(), file_size: z.coerce.number().optional() }).parse(await this.graph(mediaId)); }
  async downloadMedia(url: string) {
    if (!url.startsWith("https://lookaside.fbsbx.com/") && !url.startsWith("https://graph.facebook.com/")) throw new AppError(400, "INVALID_MEDIA_URL", "Meta returned an invalid media URL");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new AppError(502, "MEDIA_DOWNLOAD_FAILED", "WhatsApp media could not be downloaded");
    const length=Number(response.headers.get("content-length")??0);if(length>20*1024*1024)throw new AppError(413,"MEDIA_TOO_LARGE","Media exceeds the 20 MB download limit");
    return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type") ?? "application/octet-stream" };
  }
}
