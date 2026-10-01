import { z } from "zod";
import { idSchema, mmkSchema, paginationSchema } from "@/lib/validators";

export const ingredientSchema = z.object({
  name: z.string().min(1, "Name required").max(100),
  nameMy: z.string().max(100).optional().or(z.literal("")),
  unit: z.string().min(1, "Display unit required").max(20), // kg, L, pack, pcs
  baseUnit: z.string().min(1, "Base unit required").max(20), // g, ml, pcs
  toBaseFactor: z.coerce.number().positive("Factor must be positive").max(1_000_000),
  lowStockThreshold: z.coerce.number().min(0, "Threshold cannot be negative"),
  costPerBaseUnit: z.coerce.number().int().min(0).max(10_000_000),
  expiryTracking: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type IngredientInput = z.infer<typeof ingredientSchema>;

export const updateIngredientSchema = ingredientSchema.partial().extend({ id: idSchema });
export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>;

export const stockMovementSchema = z.object({
  ingredientId: idSchema,
  type: z.enum(["in", "out", "adjustment", "waste"]),
  // display units; may be negative only for "adjustment" (delta)
  quantity: z.coerce.number().refine((n) => n !== 0, "Quantity cannot be zero"),
  unitCostKs: z.coerce.number().int().min(0).max(10_000_000).default(0), // per display unit
  supplier: z.string().max(100).optional().or(z.literal("")),
  reason: z.string().max(500).optional().or(z.literal("")),
  reference: z.string().max(100).optional().or(z.literal("")),
}).refine((d) => d.type === "adjustment" || d.quantity > 0, {
  message: "Quantity must be positive for in/out/waste",
  path: ["quantity"],
});
export type StockMovementInput = z.infer<typeof stockMovementSchema>;

export const movementListSchema = paginationSchema.extend({
  ingredientId: z.string().max(50).default(""),
  type: z.string().max(20).default(""),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

export const poLineSchema = z.object({
  ingredientId: idSchema,
  quantity: z.coerce.number().positive("Quantity must be positive").max(1_000_000),
  unitCostKs: z.coerce.number().int().min(0).max(10_000_000),
});
export type PoLineInput = z.infer<typeof poLineSchema>;

export const purchaseOrderSchema = z.object({
  supplier: z.string().min(1, "Supplier required").max(200),
  expectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  notes: z.string().max(1000).optional().or(z.literal("")),
  lines: z.array(poLineSchema).min(1, "Add at least one line").max(100),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const ingredientListSchema = paginationSchema.extend({
  lowStockOnly: z.boolean().default(false),
  activeOnly: z.boolean().default(true),
});

export const poListSchema = paginationSchema.extend({
  status: z.string().max(20).default(""),
});

export { mmkSchema };
