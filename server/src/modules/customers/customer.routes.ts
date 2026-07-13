import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { assertCustomerOwnership, customerInclude, normalizeEmail, normalizePhone } from "./customer.service.js";
import { routeParam } from "../../lib/route-param.js";
import { setMarketingConsent } from "../consent/consent.service.js";
import { assertWithinPlanLimit } from "../subscriptions/plan.service.js";

export const customerRouter = Router();
customerRouter.use(authenticate);
const editable = z.object({
  firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().nullable().optional(), email: z.string().email().nullable().optional(), company: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(250).nullable().optional(), city: z.string().trim().max(80).nullable().optional(), country: z.string().length(2).default("LB"),
  source: z.enum(["WHATSAPP", "INSTAGRAM", "FACEBOOK", "WEBSITE", "PHONE", "WALK_IN", "REFERRAL", "OTHER"]).default("OTHER"),
  lifecycleStage: z.enum(["NEW_LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST", "EXISTING_CUSTOMER"]).default("NEW_LEAD"),
  assignedUserId: z.string().uuid().nullable().optional(), marketingOptIn: z.boolean().default(false), tagIds: z.array(z.string().uuid()).max(20).default([])
});

customerRouter.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().optional(), stage: z.string().optional() }).parse(req.query);
  const where = { businessId: req.auth!.businessId, deletedAt: null, ...(query.stage ? { lifecycleStage: query.stage as never } : {}), ...(query.search ? { OR: [
    { firstName: { contains: query.search, mode: "insensitive" as const } }, { lastName: { contains: query.search, mode: "insensitive" as const } },
    { normalizedPhone: { contains: query.search } }, { normalizedEmail: { contains: query.search.toLowerCase() } }
  ] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.customer.findMany({ where, include: customerInclude, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.customer.count({ where })
  ]);
  return ok(res, { items, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
}));

customerRouter.post("/", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  await assertWithinPlanLimit(req.auth!.businessId, "CUSTOMERS");
  const input = editable.parse(req.body);
  const { tagIds, ...data } = input;
  const customer = await prisma.$transaction(async (tx) => {
    if (data.assignedUserId) await tx.businessMember.findFirstOrThrow({ where: { businessId: req.auth!.businessId, userId: data.assignedUserId, status: "ACTIVE" } });
    if (tagIds.length) {
      const count = await tx.tag.count({ where: { businessId: req.auth!.businessId, id: { in: tagIds } } });
      if (count !== tagIds.length) throw new Error("Invalid tags");
    }
    const created = await tx.customer.create({ data: { ...data, ...(data.marketingOptIn ? { marketingOptInSource: "CRM_CREATE", marketingOptInAt: new Date() } : {}), businessId: req.auth!.businessId, normalizedPhone: normalizePhone(data.phone), normalizedEmail: normalizeEmail(data.email), tags: { create: tagIds.map((tagId) => ({ businessId: req.auth!.businessId, tagId })) } }, include: customerInclude });
    if (data.marketingOptIn) await tx.consentRecord.create({ data: { businessId: req.auth!.businessId, customerId: created.id, recordedById: req.auth!.userId, status: "OPTED_IN", source: "CRM_CREATE" } });
    await tx.activity.create({ data: { businessId: req.auth!.businessId, customerId: created.id, actorId: req.auth!.userId, type: "CUSTOMER_CREATED" } });
    return created;
  });
  return ok(res, customer, "Customer created", 201);
}));

customerRouter.get("/:id", asyncHandler(async (req, res) => {
  const customerId=routeParam(req.params.id);await assertCustomerOwnership(req.auth!.businessId, customerId);
  const customer = await prisma.customer.findFirstOrThrow({ where: { id: customerId, businessId: req.auth!.businessId }, include: { ...customerInclude, notes: { where: { deletedAt: null }, include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" } }, activities: { orderBy: { createdAt: "desc" }, take: 100 }, quotations: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 20 }, invoices: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 20 }, orders: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 20 } } });
  return ok(res, customer);
}));

customerRouter.patch("/:id", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const existing = await assertCustomerOwnership(req.auth!.businessId, routeParam(req.params.id));
  const input = editable.partial().omit({ tagIds: true }).parse(req.body); const { marketingOptIn, ...changes } = input;
  await prisma.customer.update({ where: { id: existing.id }, data: { ...changes, ...(input.phone !== undefined ? { normalizedPhone: normalizePhone(input.phone) } : {}), ...(input.email !== undefined ? { normalizedEmail: normalizeEmail(input.email) } : {}) } });
  if (marketingOptIn !== undefined && marketingOptIn !== existing.marketingOptIn) await setMarketingConsent({ businessId: req.auth!.businessId, customerId: existing.id, recordedById: req.auth!.userId, optedIn: marketingOptIn, source: "CRM_UPDATE" });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: existing.id }, include: customerInclude });
  return ok(res, customer, "Customer updated");
}));

customerRouter.delete("/:id", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const customer = await assertCustomerOwnership(req.auth!.businessId, routeParam(req.params.id));
  await prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: new Date() } });
  await prisma.auditLog.create({ data: { businessId: req.auth!.businessId, actorId: req.auth!.userId, action: "CUSTOMER_DELETED", entityType: "Customer", entityId: customer.id } });
  return ok(res, null, "Customer deleted");
}));

customerRouter.post("/:id/notes", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const customer = await assertCustomerOwnership(req.auth!.businessId, routeParam(req.params.id));
  const { content } = z.object({ content: z.string().trim().min(1).max(5000) }).parse(req.body);
  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.customerNote.create({ data: { businessId: req.auth!.businessId, customerId: customer.id, authorId: req.auth!.userId, content } });
    await tx.activity.create({ data: { businessId: req.auth!.businessId, customerId: customer.id, actorId: req.auth!.userId, type: "NOTE_ADDED" } });
    return created;
  });
  return ok(res, note, "Note added", 201);
}));
