import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";

export const tagRouter = Router();
tagRouter.use(authenticate);
tagRouter.get("/", asyncHandler(async (req, res) => ok(res, await prisma.tag.findMany({ where: { businessId: req.auth!.businessId }, orderBy: { name: "asc" } }))));
tagRouter.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), description: z.string().trim().max(250).optional() }).parse(req.body);
  return ok(res, await prisma.tag.create({ data: { ...input, businessId: req.auth!.businessId } }), "Tag created", 201);
}));
