import { z } from "zod";
import { dateRangeSchema } from "@/lib/validators";

/** Dashboard queries are read-only; the range defaults to the last 7 Yangon days. */
export const dashboardRangeSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .optional(),
});

export const weekStatsSchema = dateRangeSchema;

export type DashboardRangeInput = z.infer<typeof dashboardRangeSchema>;
