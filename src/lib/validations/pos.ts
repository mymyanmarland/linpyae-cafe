import { z } from "zod";
import {
  idSchema,
  mmkSchema,
  pinSchema,
  createOrderSchema,
  paymentSchema,
} from "@/lib/validators";

/** POS-specific schemas. Reuses shared primitives from @/lib/validators. */

export const posCreateOrderSchema = createOrderSchema.extend({
  // allow the shared "dine_in"/"online" spellings; action normalizes to schema values
  type: z.enum(["dine_in", "dinein", "takeaway", "delivery", "online"]),
  customerPhone: z.string().max(20).default(""),
  /** manager/owner PIN, required when the discount needs approval */
  approverPin: z.string().max(8).optional(),
  paidNow: z
    .object({
      method: paymentSchema.shape.method,
      amount: mmkSchema,
      reference: z.string().max(100).default(""),
      tipAmount: mmkSchema.default(0),
    })
    .optional(),
});

export const holdOrderSchema = z.object({ orderId: idSchema });

export const fireOrderSchema = z.object({ orderId: idSchema });

/** Order type as stored in the DB (schema: dinein | takeaway | delivery). */
export function normalizeOrderType(t: string): string {
  if (t === "dine_in") return "dinein";
  if (t === "online") return "delivery";
  return t;
}

/** Discount type as stored in the DB (schema: percent | fixed). Input also accepts "amount". */
export function normalizeDiscountType(t: string | null | undefined): string | null {
  if (!t || t === "none") return null;
  if (t === "amount") return "fixed";
  return t;
}

export const addPaymentSchema = paymentSchema.extend({
  /** cash tendered; when omitted for cash, amount = amount */
  tenderedKs: mmkSchema.optional(),
});

export const applyDiscountSchema = z.object({
  orderId: idSchema,
  discountType: z.enum(["percent", "amount"]),
  discountValue: z.number().min(0).max(1000000),
  /** manager/owner PIN, required when percent > 20 or fixed > 10,000 Ks */
  approverPin: z.string().max(8).optional(),
});

export const voidOrderSchema = z.object({
  orderId: idSchema,
  reason: z.string().min(1, "Reason required").max(500),
  /** manager/owner PIN, required when order total > 20,000 Ks */
  approverPin: z.string().max(8).optional(),
});

export const createRefundSchema = z.object({
  orderId: idSchema,
  paymentId: idSchema.optional().nullable(),
  amountKs: mmkSchema.refine((n) => n > 0, "Refund amount must be positive"),
  reason: z.string().min(1, "Reason required").max(500),
  method: z.enum(["cash", "kbzpay", "wavepay", "ayapay", "onepay", "card", "bank_transfer"]).default("cash"),
  /** manager/owner PIN, required when amount > 20,000 Ks */
  approverPin: z.string().max(8).optional(),
});

export const verifyManagerPinSchema = z.object({
  pin: pinSchema,
});

export const attachCustomerSchema = z.object({
  orderId: idSchema,
  customerId: idSchema.nullable(),
});

export const lookupCustomerSchema = z.object({
  query: z.string().min(1).max(50),
});

export type PosCreateOrderInput = z.infer<typeof posCreateOrderSchema>;
