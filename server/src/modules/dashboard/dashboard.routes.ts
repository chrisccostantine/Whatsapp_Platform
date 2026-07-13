import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate } from "../../middleware/auth.js";

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);
dashboardRouter.get("/summary", asyncHandler(async (req, res) => {
  const businessId = req.auth!.businessId; const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1); const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0); const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { currency: true } });
  const [customers, newLeads, followUpsToday, openLeads, wonLeads, recentActivity, stages, openConversations] = await prisma.$transaction([
    prisma.customer.count({ where: { businessId, deletedAt: null } }),
    prisma.customer.count({ where: { businessId, deletedAt: null, lifecycleStage: "NEW_LEAD", createdAt: { gte: monthStart } } }),
    prisma.followUp.count({ where: { businessId, deletedAt: null, dueAt: { gte: dayStart, lt: dayEnd }, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
    prisma.lead.count({ where: { businessId, deletedAt: null, stage: { isWon: false, isLost: false } } }),
    prisma.lead.count({ where: { businessId, deletedAt: null, stage: { isWon: true } } }),
    prisma.activity.findMany({ where: { businessId }, include: { customer: { select: { id: true, firstName: true, lastName: true } }, actor: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.pipelineStage.findMany({ where: { businessId }, select: { id: true, name: true, color: true, _count: { select: { leads: { where: { deletedAt: null } } } } }, orderBy: { position: "asc" } }),
    prisma.conversation.count({ where: { businessId, status: { in: ["OPEN", "PENDING"] } } })
  ]);
  const totalClosed = wonLeads + (await prisma.lead.count({ where: { businessId, deletedAt: null, stage: { isLost: true } } }));
  const [ordersThisMonth,revenue]=await prisma.$transaction([prisma.order.count({where:{businessId,deletedAt:null,createdAt:{gte:monthStart},status:{notIn:["CANCELLED","RETURNED"]}}}),prisma.payment.aggregate({where:{businessId,currency:business.currency,paidAt:{gte:monthStart}},_sum:{amount:true}})]);
  return ok(res, { metrics: { customers, newLeads, followUpsToday, openLeads, openConversations, ordersThisMonth, revenueThisMonth: revenue._sum.amount??0, revenueCurrency: business.currency, conversionRate: totalClosed ? Math.round((wonLeads / totalClosed) * 1000) / 10 : 0 }, leadsByStage: stages.map((s) => ({ name: s.name, value: s._count.leads, color: s.color })), recentActivity });
}));
