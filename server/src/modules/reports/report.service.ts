import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

const rangeSchema = z.object({ start: z.coerce.date().optional(), end: z.coerce.date().optional() });
export function parseDateRange(query: unknown) {
  const parsed = rangeSchema.parse(query); const end = parsed.end ?? new Date(); const start = parsed.start ?? new Date(end.getTime() - 29 * 86_400_000);
  end.setHours(23, 59, 59, 999); start.setHours(0, 0, 0, 0);
  if (start > end) throw new AppError(400, "INVALID_DATE_RANGE", "Start date must be before end date");
  if (end.getTime() - start.getTime() > 2 * 365 * 86_400_000) throw new AppError(400, "DATE_RANGE_TOO_LARGE", "Report date range cannot exceed two years");
  return { start, end };
}

const percent = (numerator: number, denominator: number) => denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
const money = (value: { toString(): string } | null | undefined) => Number(value?.toString() ?? 0);

export async function buildReport(businessId: string, start: Date, end: Date) {
  const [business, payments, ordersByStatus, leads, newCustomers, returningCustomers, campaigns, followUps, salesOrders] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { currency: true, timezone: true } }),
    prisma.payment.findMany({ where: { businessId, paidAt: { gte: start, lte: end } }, select: { amount: true, currency: true, paidAt: true } }),
    prisma.order.groupBy({ by: ["status"], where: { businessId, deletedAt: null, createdAt: { gte: start, lte: end } }, _count: { _all: true }, _sum: { total: true } }),
    prisma.lead.findMany({ where: { businessId, deletedAt: null, createdAt: { gte: start, lte: end } }, select: { stage: { select: { name: true, color: true, isWon: true, isLost: true } } } }),
    prisma.customer.count({ where: { businessId, deletedAt: null, createdAt: { gte: start, lte: end } } }),
    prisma.customer.count({ where: { businessId, deletedAt: null, totalOrders: { gte: 2 }, orders: { some: { deletedAt: null, createdAt: { gte: start, lte: end }, status: { notIn: ["CANCELLED", "RETURNED"] } } } } }),
    prisma.campaign.aggregate({ where: { businessId, createdAt: { gte: start, lte: end } }, _sum: { totalRecipients: true, sentCount: true, deliveredCount: true, readCount: true, replyCount: true, failedCount: true }, _count: { _all: true } }),
    prisma.followUp.groupBy({ by: ["status"], where: { businessId, deletedAt: null, dueAt: { gte: start, lte: end } }, _count: { _all: true } }),
    prisma.order.findMany({ where: { businessId, deletedAt: null, status: "DELIVERED", createdAt: { gte: start, lte: end } }, select: { total: true, currency: true, assignedUser: { select: { id: true, firstName: true, lastName: true } } } })
  ]);

  const revenueMonths = new Map<string, number>();
  for (const payment of payments) { if (payment.currency !== business.currency) continue; const key = payment.paidAt.toISOString().slice(0, 7); revenueMonths.set(key, (revenueMonths.get(key) ?? 0) + money(payment.amount)); }
  const leadsByStage = new Map<string, { name: string; color: string; value: number; isWon: boolean; isLost: boolean }>();
  for (const lead of leads) { const current = leadsByStage.get(lead.stage.name); leadsByStage.set(lead.stage.name, { ...lead.stage, value: (current?.value ?? 0) + 1 }); }
  const sales = new Map<string, { userId: string | null; name: string; orders: number; revenue: number }>();
  for (const order of salesOrders) { if (order.currency !== business.currency) continue; const key = order.assignedUser?.id ?? "unassigned"; const current = sales.get(key); sales.set(key, { userId: order.assignedUser?.id ?? null, name: order.assignedUser ? `${order.assignedUser.firstName} ${order.assignedUser.lastName}` : "Unassigned", orders: (current?.orders ?? 0) + 1, revenue: (current?.revenue ?? 0) + money(order.total) }); }
  const stageRows = [...leadsByStage.values()]; const won = stageRows.filter((row) => row.isWon).reduce((sum, row) => sum + row.value, 0); const lost = stageRows.filter((row) => row.isLost).reduce((sum, row) => sum + row.value, 0);
  const followUpTotal = followUps.reduce((sum, row) => sum + row._count._all, 0); const followUpCompleted = followUps.find((row) => row.status === "COMPLETED")?._count._all ?? 0;
  const sent = campaigns._sum.sentCount ?? 0;
  return {
    range: { start, end }, currency: business.currency,
    summary: { revenue: payments.filter((item) => item.currency === business.currency).reduce((sum, item) => sum + money(item.amount), 0), orders: ordersByStatus.reduce((sum, row) => sum + row._count._all, 0), newCustomers, returningCustomers, conversionRate: percent(won, won + lost), followUpCompletionRate: percent(followUpCompleted, followUpTotal) },
    revenueByMonth: [...revenueMonths].sort(([a], [b]) => a.localeCompare(b)).map(([month, revenue]) => ({ month, revenue: Math.round(revenue * 100) / 100 })),
    ordersByStatus: ordersByStatus.map((row) => ({ status: row.status, count: row._count._all, total: money(row._sum.total) })), leadsByStage: stageRows,
    salesByEmployee: [...sales.values()].sort((a, b) => b.revenue - a.revenue),
    campaigns: { campaigns: campaigns._count._all, recipients: campaigns._sum.totalRecipients ?? 0, sent, deliveryRate: percent(campaigns._sum.deliveredCount ?? 0, sent), readRate: percent(campaigns._sum.readCount ?? 0, sent), replyRate: percent(campaigns._sum.replyCount ?? 0, sent), failed: campaigns._sum.failedCount ?? 0 },
    followUps: { total: followUpTotal, completed: followUpCompleted, completionRate: percent(followUpCompleted, followUpTotal), byStatus: followUps.map((row) => ({ status: row.status, count: row._count._all })) }
  };
}

export function toCsv(report: Awaited<ReturnType<typeof buildReport>>) {
  const escape = (value: string | number) => { const raw = String(value); const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw; return `"${safe.replaceAll('"', '""')}"`; };
  const rows: (string | number)[][] = [["Section", "Label", "Value", "Secondary value"]];
  rows.push(["Summary", "Revenue", report.summary.revenue, report.currency], ["Summary", "Orders", report.summary.orders, ""], ["Summary", "New customers", report.summary.newCustomers, ""], ["Summary", "Returning customers", report.summary.returningCustomers, ""], ["Summary", "Conversion rate", report.summary.conversionRate, "%"], ["Summary", "Follow-up completion", report.summary.followUpCompletionRate, "%"]);
  report.revenueByMonth.forEach((row) => rows.push(["Revenue by month", row.month, row.revenue, report.currency]));
  report.ordersByStatus.forEach((row) => rows.push(["Orders by status", row.status, row.count, row.total]));
  report.leadsByStage.forEach((row) => rows.push(["Leads by stage", row.name, row.value, ""]));
  report.salesByEmployee.forEach((row) => rows.push(["Sales by employee", row.name, row.orders, row.revenue]));
  return `\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}`;
}
