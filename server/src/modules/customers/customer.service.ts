import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

export const normalizePhone = (value?: string | null) => {
  if (!value) return null;
  const phone = parsePhoneNumberFromString(value, "LB");
  if (!phone?.isValid()) throw new AppError(400, "INVALID_PHONE", "Enter a valid phone number");
  return phone.number;
};
export const normalizeEmail = (value?: string | null) => value?.trim().toLowerCase() || null;

export async function assertCustomerOwnership(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId, deletedAt: null } });
  if (!customer) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer was not found");
  return customer;
}

export const customerInclude = {
  assignedUser: { select: { id: true, firstName: true, lastName: true } },
  tags: { include: { tag: true } }
} satisfies Prisma.CustomerInclude;

