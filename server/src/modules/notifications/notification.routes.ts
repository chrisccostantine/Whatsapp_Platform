import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate } from "../../middleware/auth.js";
import { routeParam } from "../../lib/route-param.js";
import { AppError } from "../../lib/errors.js";
import { generateOperationalNotifications, NOTIFICATION_TYPES, preferenceJson } from "./notification.service.js";

export const notificationRouter = Router();
notificationRouter.use(authenticate);
notificationRouter.get("/", asyncHandler(async (req, res) => {
  await generateOperationalNotifications();
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), unreadOnly: z.coerce.boolean().default(false) }).parse(req.query);
  const where = { businessId: req.auth!.businessId, userId: req.auth!.userId, ...(query.unreadOnly ? { readAt: null } : {}) };
  const [items, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: query.limit }),
    prisma.notification.count({ where: { businessId: req.auth!.businessId, userId: req.auth!.userId, readAt: null } })
  ]);
  return ok(res, { items, unreadCount });
}));
notificationRouter.patch("/read-all", asyncHandler(async (req, res) => { await prisma.notification.updateMany({ where: { businessId: req.auth!.businessId, userId: req.auth!.userId, readAt: null }, data: { readAt: new Date() } }); return ok(res, null, "Notifications marked as read"); }));
notificationRouter.patch("/:id/read", asyncHandler(async (req, res) => { const changed = await prisma.notification.updateMany({ where: { id: routeParam(req.params.id), businessId: req.auth!.businessId, userId: req.auth!.userId }, data: { readAt: new Date() } }); if (!changed.count) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification was not found"); return ok(res, null, "Notification marked as read"); }));
notificationRouter.get("/preferences/current", asyncHandler(async (req, res) => { const value = await prisma.notificationPreference.findUnique({ where: { businessId_userId: { businessId: req.auth!.businessId, userId: req.auth!.userId } } }); return ok(res, { enabledTypes: value?.enabledTypes ?? NOTIFICATION_TYPES, availableTypes: NOTIFICATION_TYPES }); }));
notificationRouter.put("/preferences/current", asyncHandler(async (req, res) => { const { enabledTypes } = z.object({ enabledTypes: z.array(z.enum(NOTIFICATION_TYPES as [typeof NOTIFICATION_TYPES[number], ...typeof NOTIFICATION_TYPES[number][]])).max(NOTIFICATION_TYPES.length) }).parse(req.body); const value = await prisma.notificationPreference.upsert({ where: { businessId_userId: { businessId: req.auth!.businessId, userId: req.auth!.userId } }, update: { enabledTypes: preferenceJson(enabledTypes) }, create: { businessId: req.auth!.businessId, userId: req.auth!.userId, enabledTypes: preferenceJson(enabledTypes) } }); return ok(res, value, "Notification preferences saved"); }));
