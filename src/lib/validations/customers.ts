import { z } from "zod";
import { idSchema } from "@/lib/validators";

export const customerTierSchema = z.enum(["none", "bronze", "silver", "gold"]);

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  nameMy: z.string().trim().max(150).optional().or(z.literal("")),
  phone: z.string().trim().min(1, "Phone is required").max(20),
  email: z.string().email("Invalid email").max(255).optional().or(z.literal("")),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").optional().or(z.literal("")),
  tier: customerTierSchema.default("none"),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  id: idSchema,
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const adjustPointsSchema = z.object({
  id: idSchema,
  delta: z.coerce.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "Delta cannot be zero"),
  reason: z.string().trim().min(1, "Reason is required").max(200),
});
export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>;
