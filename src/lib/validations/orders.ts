import { z } from "zod";
import { idSchema, paginationSchema } from "@/lib/validators";

/** Orders module schemas. */

export const listOrdersSchema = paginationSchema.extend({
  status: z
    .enum(["open", "held", "fired", "preparing", "ready", "completed", "voided", "active"])
    .optional(),
  type: z.enum(["dinein", "takeaway", "delivery"]).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .optional(),
});

export const getOrderSchema = z.object({ orderId: idSchema });

/** Manual status moves allowed from the orders list (completion goes through payment). */
export const updateOrderStatusSchema = z.object({
  orderId: idSchema,
  status: z.enum(["held", "fired", "preparing", "ready", "completed", "voided"]),
  reason: z.string().max(500).default(""),
});

export type ListOrdersInput = z.infer<typeof listOrdersSchema>;
