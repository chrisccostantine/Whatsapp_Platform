import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { routeParam } from "../../lib/route-param.js";
import { setMarketingConsent } from "./consent.service.js";

export const consentRouter = Router();
consentRouter.use(authenticate);

consentRouter.get("/customers", asyncHandler(async (req, res) => {
  const query = z.object({ status: z.enum(["all", "opted-in", "not-opted-in", "unsubscribed"]).default("all"), search: z.string().trim().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
  const customers = await prisma.customer.findMany({ where: {
    businessId: req.auth!.businessId, deletedAt: null,
    ...(query.status === "opted-in" ? { marketingOptIn: true, optedOutAt: null } : query.status === "unsubscribed" ? { optedOutAt: { not: null } } : query.status === "not-opted-in" ? { marketingOptIn: false } : {}),
    ...(query.search ? { OR: [{ firstName: { contains: query.search, mode: "insensitive" } }, { lastName: { contains: query.search, mode: "insensitive" } }, { normalizedPhone: { contains: query.search } }] } : {})
  }, select: { id: true, firstName: true, lastName: true, normalizedPhone: true, marketingOptIn: true, marketingOptInSource: true, marketingOptInAt: true, optedOutAt: true, consentNotes: true }, orderBy: { updatedAt: "desc" }, take: query.limit });
  return ok(res, customers);
}));

consentRouter.get("/customers/:id/history", asyncHandler(async (req, res) => {
  const records = await prisma.consentRecord.findMany({ where: { businessId: req.auth!.businessId, customerId: routeParam(req.params.id) }, include: { recordedBy: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" } });
  return ok(res, records);
}));

consentRouter.patch("/customers/:id", requireRole("OWNER", "ADMIN", "SALES_AGENT"), asyncHandler(async (req, res) => {
  const input = z.object({ optedIn: z.boolean(), source: z.string().trim().min(2).max(80), notes: z.string().trim().max(500).nullable().optional() }).parse(req.body);
  const customer = await setMarketingConsent({ businessId: req.auth!.businessId, customerId: routeParam(req.params.id), recordedById: req.auth!.userId, ...input });
  return ok(res, customer, input.optedIn ? "Marketing consent recorded" : "Customer unsubscribed");
}));
