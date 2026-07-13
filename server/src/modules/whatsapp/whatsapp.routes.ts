import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env.js";
import { decryptSecret, encryptSecret, verifyMetaSignature } from "../../lib/encryption.js";
import { AppError } from "../../lib/errors.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { prisma } from "../../lib/prisma.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { enqueueWhatsAppWebhook } from "../../queues/whatsapp.queue.js";
import { emitToBusiness, emitToConversation } from "../../realtime/socket.js";
import { assertConversationAccess } from "../conversations/conversation.service.js";
import { getCloudProvider } from "./account.service.js";
import { WhatsAppCloudProvider } from "./cloud.provider.js";
import { routeParam } from "../../lib/route-param.js";

export const whatsAppRouter = Router();
const safeAccount = { id: true, whatsAppBusinessAccountId: true, phoneNumberId: true, displayPhoneNumber: true, verifiedName: true, metaAppId: true, connectionStatus: true, lastSyncAt: true, lastError: true, createdAt: true, updatedAt: true } as const;
const tokenMatches = (left: string, right: string) => { const a=Buffer.from(left);const b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b); };
const templateStatus=(status:string)=>status==="APPROVED"||status==="REJECTED"||status==="PAUSED"||status==="DISABLED"?status:status==="PENDING"||status==="IN_APPEAL"?"PENDING" as const:"DISABLED" as const;
const webhookEnvelopeSchema=z.object({
  object:z.literal("whatsapp_business_account"),
  entry:z.array(z.object({
    changes:z.array(z.object({
      value:z.object({metadata:z.object({phone_number_id:z.string()})}).passthrough()
    }))
  }).passthrough())
}).passthrough();

whatsAppRouter.get("/webhook", asyncHandler(async (req, res) => {
  const query = z.object({ "hub.mode": z.literal("subscribe"), "hub.verify_token": z.string(), "hub.challenge": z.string() }).safeParse(req.query);
  if (!query.success) throw new AppError(403, "WEBHOOK_VERIFICATION_FAILED", "Webhook verification failed");
  const accounts = await prisma.whatsAppAccount.findMany({ where: { connectionStatus: "CONNECTED" }, select: { encryptedVerifyToken: true } });
  const valid = (env.META_WEBHOOK_VERIFY_TOKEN ? tokenMatches(query.data["hub.verify_token"], env.META_WEBHOOK_VERIFY_TOKEN) : false) || accounts.some((account) => { try { return tokenMatches(query.data["hub.verify_token"], decryptSecret(account.encryptedVerifyToken)); } catch { return false; } });
  if (!valid) throw new AppError(403, "WEBHOOK_VERIFICATION_FAILED", "Webhook verification failed");
  res.status(200).send(query.data["hub.challenge"]);
}));

whatsAppRouter.post("/webhook", asyncHandler(async (req, res) => {
  if (!req.rawBody || !verifyMetaSignature(req.rawBody, req.header("x-hub-signature-256"))) throw new AppError(401, "INVALID_WEBHOOK_SIGNATURE", "Webhook signature is invalid");
  const envelope = webhookEnvelopeSchema.parse(req.body);
  const phoneNumberId = envelope.entry[0]?.changes[0]?.value.metadata.phone_number_id;
  const account = phoneNumberId ? await prisma.whatsAppAccount.findFirst({ where: { phoneNumberId, connectionStatus: "CONNECTED" } }) : null;
  if (!account) { res.status(200).json({ success: true }); return; }
  const eventKey = createHash("sha256").update(req.rawBody).digest("hex");
  const event = await prisma.whatsAppWebhookEvent.upsert({ where: { accountId_eventKey: { accountId: account.id, eventKey } }, update: {}, create: { businessId: account.businessId, accountId: account.id, eventKey, payload: envelope as Prisma.InputJsonObject } });
  res.status(200).json({ success: true });
  void enqueueWhatsAppWebhook(event.id).catch(async (error: unknown) => { const message=error instanceof Error?error.message:"Queue unavailable";await prisma.whatsAppWebhookEvent.update({where:{id:event.id,businessId:account.businessId},data:{status:"FAILED",lastError:message.slice(0,500)}}); });
}));

whatsAppRouter.use(authenticate);
whatsAppRouter.get("/account", asyncHandler(async (req, res) => ok(res, await prisma.whatsAppAccount.findUnique({ where: { businessId: req.auth!.businessId }, select: safeAccount }))));

whatsAppRouter.post("/account/connect", requireRole("OWNER"), asyncHandler(async (req, res) => {
  const input = z.object({ whatsAppBusinessAccountId: z.string().min(5).max(100), phoneNumberId: z.string().min(5).max(100), accessToken: z.string().min(20).max(1000), verifyToken: z.string().min(16).max(200), metaAppId: z.string().max(100).optional() }).parse(req.body);
  const provider = new WhatsAppCloudProvider(input.phoneNumberId, input.accessToken); const profile = await provider.testConnection();
  const optionalProfile={...(profile.verified_name?{verifiedName:profile.verified_name}:{}),...((input.metaAppId??env.META_APP_ID)?{metaAppId:input.metaAppId??env.META_APP_ID}:{})};
  const account = await prisma.whatsAppAccount.upsert({ where: { businessId: req.auth!.businessId }, update: { whatsAppBusinessAccountId: input.whatsAppBusinessAccountId, phoneNumberId: input.phoneNumberId, displayPhoneNumber: profile.display_phone_number, encryptedAccessToken: encryptSecret(input.accessToken), encryptedVerifyToken: encryptSecret(input.verifyToken), connectionStatus: "CONNECTED", lastError: null, disconnectedAt: null,...optionalProfile }, create: { businessId: req.auth!.businessId, whatsAppBusinessAccountId: input.whatsAppBusinessAccountId, phoneNumberId: input.phoneNumberId, displayPhoneNumber: profile.display_phone_number, encryptedAccessToken: encryptSecret(input.accessToken), encryptedVerifyToken: encryptSecret(input.verifyToken), connectionStatus: "CONNECTED",...optionalProfile }, select: safeAccount });
  await prisma.auditLog.create({ data: { businessId: req.auth!.businessId, actorId: req.auth!.userId, action: "WHATSAPP_CONNECTED", entityType: "WhatsAppAccount", entityId: account.id } });
  return ok(res, account, "WhatsApp account connected", 201);
}));

whatsAppRouter.post("/account/test", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const { account, provider } = await getCloudProvider(req.auth!.businessId); const profile = await provider.testConnection();
  await prisma.whatsAppAccount.update({ where: { id: account.id, businessId: req.auth!.businessId }, data: { lastError: null } });
  return ok(res, profile, "WhatsApp connection is healthy");
}));

whatsAppRouter.delete("/account", requireRole("OWNER"), asyncHandler(async (req, res) => {
  const account = await prisma.whatsAppAccount.findUnique({ where: { businessId: req.auth!.businessId } });
  if (account) { await prisma.whatsAppAccount.update({ where: { id: account.id, businessId: req.auth!.businessId }, data: { connectionStatus: "DISCONNECTED", encryptedAccessToken: encryptSecret(randomUUID()), encryptedVerifyToken: encryptSecret(randomUUID()), disconnectedAt: new Date(), lastError: null } }); await prisma.auditLog.create({ data: { businessId: req.auth!.businessId, actorId: req.auth!.userId, action: "WHATSAPP_DISCONNECTED", entityType: "WhatsAppAccount", entityId: account.id } }); }
  return ok(res, null, "WhatsApp account disconnected");
}));

whatsAppRouter.get("/templates", asyncHandler(async (req, res) => ok(res, await prisma.whatsAppTemplate.findMany({ where: { businessId: req.auth!.businessId }, orderBy: [{ status: "asc" }, { name: "asc" }] }))));
const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only"),
  language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/), category: z.enum(["MARKETING", "UTILITY"]),
  header: z.object({ text: z.string().trim().min(1).max(60), example: z.string().trim().min(1).max(60).optional() }).optional(),
  body: z.string().trim().min(1).max(1024), bodyExamples: z.array(z.string().trim().min(1).max(1024)).max(20).default([]),
  footer: z.string().trim().max(60).optional(), buttons: z.array(z.object({ type: z.literal("QUICK_REPLY"), text: z.string().trim().min(1).max(25) })).max(3).default([])
}).superRefine((input, ctx) => {
  const bodyVariables = [...input.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])); const unique = [...new Set(bodyVariables)];
  if (unique.some((value, index) => value !== index + 1)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: "Body variables must be sequential: {{1}}, {{2}}, and so on" });
  if (/\{\{|\}\}/.test(input.body.replace(/\{\{\d+\}\}/g, ""))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: "Variables must use numeric placeholders such as {{1}}" });
  if (input.bodyExamples.length !== unique.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bodyExamples"], message: `Provide exactly ${unique.length} body variable examples` });
  const headerVariables = [...(input.header?.text ?? "").matchAll(/\{\{(\d+)\}\}/g)];
  if (headerVariables.length > 1 || (headerVariables.length === 1 && headerVariables[0]?.[1] !== "1")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["header", "text"], message: "A text header can contain only {{1}}" });
  if (headerVariables.length && !input.header?.example) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["header", "example"], message: "Provide an example for the header variable" });
  if (new Set(input.buttons.map((button) => button.text.toLowerCase())).size !== input.buttons.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["buttons"], message: "Quick reply button labels must be unique" });
});
whatsAppRouter.post("/templates", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const input = createTemplateSchema.parse(req.body); const { account, provider } = await getCloudProvider(req.auth!.businessId); const submitted = await provider.createTemplate(account.whatsAppBusinessAccountId, input);
  const variables = [...new Set([...input.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))];
  const header = input.header ? { type: "HEADER", format: "TEXT", text: input.header.text, ...(input.header.example ? { example: { header_text: [input.header.example] } } : {}) } : null;
  const headerJson = header ? JSON.parse(JSON.stringify(header)) as Prisma.InputJsonObject : Prisma.JsonNull; const buttonsJson = input.buttons.length ? JSON.parse(JSON.stringify(input.buttons)) as Prisma.InputJsonArray : Prisma.JsonNull;
  const template = await prisma.whatsAppTemplate.upsert({ where: { accountId_name_language: { accountId: account.id, name: input.name, language: input.language } }, update: { metaTemplateId: submitted.id, category: submitted.category, status: templateStatus(submitted.status), header: headerJson, body: input.body, footer: input.footer || null, buttons: buttonsJson, variables }, create: { businessId: req.auth!.businessId, accountId: account.id, metaTemplateId: submitted.id, name: input.name, language: input.language, category: submitted.category, status: templateStatus(submitted.status), header: headerJson, body: input.body, footer: input.footer || null, buttons: buttonsJson, variables } });
  await prisma.auditLog.create({ data: { businessId: req.auth!.businessId, actorId: req.auth!.userId, action: "WHATSAPP_TEMPLATE_SUBMITTED", entityType: "WhatsAppTemplate", entityId: template.id, metadata: { name: template.name, language: template.language, category: template.category } } });
  return ok(res, template, "Template submitted to Meta for review", 201);
}));
whatsAppRouter.post("/templates/sync", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const { account, provider } = await getCloudProvider(req.auth!.businessId); const templates = await provider.fetchTemplates(account.whatsAppBusinessAccountId);
  for (const template of templates) {
    const header = template.components.find((component) => component.type === "HEADER"); const body = template.components.find((component) => component.type === "BODY"); const footer = template.components.find((component) => component.type === "FOOTER"); const buttons = template.components.find((component) => component.type === "BUTTONS"); const bodyText = body?.text ?? ""; const variables = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    const optionalTemplate={...(template.id?{metaTemplateId:template.id}:{}),...(footer?.text?{footer:footer.text}:{})};
    await prisma.whatsAppTemplate.upsert({ where: { accountId_name_language: { accountId: account.id, name: template.name, language: template.language } }, update: { category: template.category, status: templateStatus(template.status), header: header ? JSON.parse(JSON.stringify(header)) as Prisma.InputJsonObject : Prisma.JsonNull, body: bodyText, buttons: buttons ? JSON.parse(JSON.stringify(buttons.buttons ?? [])) as Prisma.InputJsonArray : Prisma.JsonNull, variables,...optionalTemplate }, create: { businessId: req.auth!.businessId, accountId: account.id, name: template.name, language: template.language, category: template.category, status: templateStatus(template.status), header: header ? JSON.parse(JSON.stringify(header)) as Prisma.InputJsonObject : Prisma.JsonNull, body: bodyText, buttons: buttons ? JSON.parse(JSON.stringify(buttons.buttons ?? [])) as Prisma.InputJsonArray : Prisma.JsonNull, variables,...optionalTemplate } });
  }
  await prisma.whatsAppAccount.update({ where: { id: account.id, businessId: req.auth!.businessId }, data: { lastSyncAt: new Date() } });
  return ok(res, { synced: templates.length }, "WhatsApp templates synchronized");
}));

whatsAppRouter.post("/templates/:templateId/send", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const input = z.object({ conversationId: z.string().uuid(), variables: z.array(z.string().max(1024)).max(20).default([]), idempotencyKey: z.string().min(8).max(100).optional() }).parse(req.body); const auth=req.auth!;
  const conversation = await assertConversationAccess(auth, input.conversationId); const template = await prisma.whatsAppTemplate.findFirst({ where: { id: routeParam(req.params.templateId,"templateId"), businessId: auth.businessId, status: "APPROVED" } });
  if (!template) throw new AppError(404, "APPROVED_TEMPLATE_NOT_FOUND", "Approved template was not found");
  const expected = Array.isArray(template.variables) ? template.variables.length : 0; if (input.variables.length !== expected) throw new AppError(400, "TEMPLATE_VARIABLE_MISMATCH", `This template requires ${expected} variables`);
  const { account, provider } = await getCloudProvider(auth.businessId); if (!provider.sendTemplate) throw new AppError(500, "PROVIDER_ERROR", "Provider does not support templates");
  const recipientPhone=conversation.customer.normalizedPhone;if(!recipientPhone)throw new AppError(400,"CUSTOMER_PHONE_REQUIRED","Customer needs a valid phone number before messaging");const idempotencyKey=input.idempotencyKey??`template:${randomUUID()}`; const existing=await prisma.message.findUnique({where:{businessId_idempotencyKey:{businessId:auth.businessId,idempotencyKey}}});if(existing)return ok(res,existing,"Template already accepted");
  const preview=input.variables.reduce((text,value,index)=>text.replaceAll(`{{${index+1}}}`,value),template.body); const queued=await prisma.message.create({data:{businessId:auth.businessId,conversationId:conversation.id,whatsAppAccountId:account.id,templateId:template.id,templateName:template.name,templateCategory:template.category,senderUserId:auth.userId,direction:"OUTBOUND",type:"TEXT",status:"QUEUED",body:preview,idempotencyKey}});
  try { const result=await provider.sendTemplate({recipientPhone,templateName:template.name,language:template.language,bodyVariables:input.variables});const sent=await prisma.message.update({where:{id:queued.id,businessId:auth.businessId},data:{status:"SENT",providerMessageId:result.providerMessageId,sentAt:result.acceptedAt}});await prisma.conversation.update({where:{id:conversation.id,businessId:auth.businessId},data:{lastMessageAt:result.acceptedAt,lastMessagePreview:preview.slice(0,160)}});emitToConversation(conversation.id,"message:created",sent);emitToBusiness(auth.businessId,"conversation:updated",{conversationId:conversation.id,lastMessagePreview:preview});return ok(res,sent,"Template message sent",201); }
  catch(error){await prisma.message.update({where:{id:queued.id,businessId:auth.businessId},data:{status:"FAILED",errorCode:"META_SEND_FAILED",errorMessage:"Template message was rejected"}});throw error;}
}));

whatsAppRouter.get("/media/:attachmentId", asyncHandler(async (req, res) => {
  const attachment=await prisma.messageAttachment.findFirst({where:{id:routeParam(req.params.attachmentId,"attachmentId"),businessId:req.auth!.businessId},include:{message:{include:{conversation:true}}}});if(!attachment?.providerMediaId)throw new AppError(404,"MEDIA_NOT_FOUND","Media was not found");
  await assertConversationAccess(req.auth!,attachment.message.conversationId);const{provider}=await getCloudProvider(req.auth!.businessId);const info=await provider.getMedia(attachment.providerMediaId);if((info.file_size??0)>20*1024*1024)throw new AppError(413,"MEDIA_TOO_LARGE","Media exceeds the 20 MB download limit");const download=await provider.downloadMedia(info.url);res.setHeader("Content-Type",download.mimeType);res.setHeader("Content-Disposition",`inline; filename="${attachment.fileName.replace(/["\r\n]/g,"")}"`);res.send(download.bytes);
}));
