import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { requireFeature } from "../subscriptions/plan.service.js";
import { buildReport, parseDateRange, toCsv } from "./report.service.js";

export const reportRouter = Router();
reportRouter.use(authenticate, requireRole("OWNER", "ADMIN", "VIEWER"));
reportRouter.get("/overview", asyncHandler(async (req, res) => { const { start, end } = parseDateRange(req.query); return ok(res, await buildReport(req.auth!.businessId, start, end)); }));
reportRouter.get("/export.csv", requireFeature("ADVANCED_REPORTING"), asyncHandler(async (req, res) => { const { start, end } = parseDateRange(req.query); const csv = toCsv(await buildReport(req.auth!.businessId, start, end)); res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="scalora-report-${start.toISOString().slice(0, 10)}-${end.toISOString().slice(0, 10)}.csv"`); res.send(csv); }));
