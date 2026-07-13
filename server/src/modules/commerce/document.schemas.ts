import { z } from "zod";

export const lineItemSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitPrice: z.coerce.number().nonnegative().max(1_000_000_000),
  discount: z.coerce.number().nonnegative().max(1_000_000_000).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0)
});

export const documentBaseSchema = z.object({
  customerId: z.string().uuid(),
  currency: z.enum(["USD", "LBP"]),
  discount: z.coerce.number().nonnegative().max(1_000_000_000).default(0),
  notes: z.string().trim().max(5000).nullable().optional(),
  terms: z.string().trim().max(5000).nullable().optional(),
  items: z.array(lineItemSchema).min(1).max(100)
});

export const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  method: z.enum(["CASH_ON_DELIVERY", "CASH", "CARD", "BANK_TRANSFER", "WHISH", "OMT", "OTHER"]),
  reference: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  paidAt: z.coerce.date().default(() => new Date())
});

export type LineItemInput = z.infer<typeof lineItemSchema>;
