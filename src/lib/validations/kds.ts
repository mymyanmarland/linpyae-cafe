import { z } from "zod";
import { idSchema } from "@/lib/validators";

/** KDS module schemas. */

export const kdsStatusSchema = z.enum([
  "queued",
  "fired",
  "preparing",
  "ready",
  "bumped",
  "recalled",
]);

export const getKdsQueueSchema = z.object({
  /** station filter: barista | kitchen | all */
  station: z.enum(["barista", "kitchen", "all"]).default("all"),
});

export const updateItemKdsStatusSchema = z.object({
  orderItemId: idSchema,
  status: kdsStatusSchema,
});

export const bumpOrderSchema = z.object({ orderId: idSchema });

export const recallItemSchema = z.object({ orderItemId: idSchema });

export type KdsStatus = z.infer<typeof kdsStatusSchema>;
