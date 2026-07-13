import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import type { LineItemInput } from "./document.schemas.js";

const money = (value: string | number | Prisma.Decimal) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export function calculateDocument(items: LineItemInput[], documentDiscount = 0, deliveryFee = 0) {
  let subtotal = money(0); let tax = money(0);
  const calculatedItems = items.map((item) => {
    const gross = money(new Prisma.Decimal(item.quantity).mul(item.unitPrice)); const discount = money(item.discount);
    if (discount.greaterThan(gross)) throw new AppError(400, "INVALID_LINE_DISCOUNT", `Discount exceeds the value of ${item.name}`);
    const taxable = money(gross.minus(discount)); const itemTax = money(taxable.mul(item.taxRate).div(100)); const lineTotal = money(taxable.plus(itemTax));
    subtotal = money(subtotal.plus(taxable)); tax = money(tax.plus(itemTax));
    return { ...item, quantity: new Prisma.Decimal(item.quantity), unitPrice: money(item.unitPrice), discount, taxRate: new Prisma.Decimal(item.taxRate), lineTotal };
  });
  const discount = money(documentDiscount); const delivery = money(deliveryFee);
  if (discount.greaterThan(subtotal.plus(tax))) throw new AppError(400, "INVALID_DOCUMENT_DISCOUNT", "Document discount exceeds the document value");
  const total = money(subtotal.plus(tax).minus(discount).plus(delivery));
  return { items: calculatedItems, subtotal, discount, tax, deliveryFee: delivery, total };
}

export async function assertCommerceReferences(businessId: string, customerId: string, items: LineItemInput[], assignedUserId?: string | null) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId, deletedAt: null } });
  if (!customer) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer was not found");
  const productIds = [...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  if (productIds.length) { const count = await prisma.product.count({ where: { businessId, id: { in: productIds }, deletedAt: null, isActive: true } }); if (count !== productIds.length) throw new AppError(400, "INVALID_PRODUCTS", "One or more products are unavailable"); }
  if (assignedUserId) { const member = await prisma.businessMember.findFirst({ where: { businessId, userId: assignedUserId, status: "ACTIVE" } }); if (!member) throw new AppError(400, "INVALID_ASSIGNEE", "Assigned employee is not active in this workspace"); }
  return customer;
}

export async function nextDocumentNumber(tx: Prisma.TransactionClient, businessId: string, key: "quotation"|"invoice"|"order") {
  const sequence = await tx.documentSequence.upsert({ where: { businessId_key: { businessId, key } }, update: { value: { increment: 1 } }, create: { businessId, key, value: 1 } });
  const prefix = key === "quotation" ? "QUO" : key === "invoice" ? "INV" : "ORD";
  return `${prefix}-${new Date().getUTCFullYear()}-${String(sequence.value).padStart(5, "0")}`;
}

export function itemCreateData(businessId: string, item: ReturnType<typeof calculateDocument>["items"][number]) {
  return { businessId, productId: item.productId ?? null, name: item.name, description: item.description ?? null, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, taxRate: item.taxRate, lineTotal: item.lineTotal };
}

export async function updateCustomerCommerceTotals(tx: Prisma.TransactionClient, businessId: string, customerId: string) {
  const orders = await tx.order.aggregate({ where: { businessId, customerId, deletedAt: null, status: { notIn: ["CANCELLED", "RETURNED"] } }, _count: { id: true }, _sum: { total: true } });
  await tx.customer.update({ where: { id: customerId }, data: { totalOrders: orders._count.id, totalSpent: orders._sum.total ?? 0 } });
}
