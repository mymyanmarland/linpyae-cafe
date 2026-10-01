import { z } from "zod";

/** Shared Zod schemas for Server Actions and forms. Import from "@/lib/validators". */

// ── Primitives ────────────────────────────────────────────────────
export const idSchema = z.string().min(1, "Invalid id");

/** MMK amounts: whole kyat, no decimals, non-negative, sane upper bound. */
export const mmkSchema = z
  .number({ error: "Amount must be a number" })
  .int("Amount must be whole kyat")
  .min(0, "Amount cannot be negative")
  .max(100_000_000, "Amount too large");

/** Staff PIN: 4–8 digits. */
export const pinSchema = z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits");

/** Myanmar phone: normalized to 09xxxxxxxxx by normalizeMmPhone before validation. */
export const mmPhoneSchema = z
  .string()
  .regex(/^09\d{7,9}$/, "Invalid Myanmar phone number")
  .optional()
  .or(z.literal(""));

export const emailSchema = z.string().email("Invalid email").max(255).optional().or(z.literal(""));

export const roleSchema = z.enum(["owner", "manager", "cashier", "barista"]);

// ── Pagination (SWR tables) ───────────────────────────────────────
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).default(""),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

// ── Date ranges (reports) ─────────────────────────────────────────
export const dateRangeSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  })
  .refine((d) => d.from <= d.to, { message: "From date must be before to date" });

// ── Order items (POS) ─────────────────────────────────────────────
export const orderItemSchema = z.object({
  menuItemId: idSchema,
  qty: z.number().int().min(1).max(99),
  unitPrice: mmkSchema,
  modifiersJson: z.string().max(4000).default("[]"),
  notes: z.string().max(500).default(""),
});

export const createOrderSchema = z.object({
  type: z.enum(["dine_in", "takeaway", "delivery", "online"]),
  tableId: idSchema.optional().nullable(),
  customerId: idSchema.optional().nullable(),
  customerName: z.string().max(100).default(""),
  items: z.array(orderItemSchema).min(1, "Order needs at least one item").max(100),
  discountType: z.enum(["none", "percent", "amount"]).default("none"),
  discountValue: z.number().min(0).default(0),
  notes: z.string().max(1000).default(""),
});

export const paymentSchema = z.object({
  orderId: idSchema,
  method: z.enum(["cash", "kbzpay", "wavepay", "ayapay", "onepay", "card", "bank_transfer"]),
  amount: mmkSchema,
  reference: z.string().max(100).default(""),
  tipAmount: mmkSchema.default(0),
});
