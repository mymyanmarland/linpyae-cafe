import { z } from "zod";
import { dateRangeSchema, mmkSchema } from "@/lib/validators";

export const reportRangeSchema = dateRangeSchema;
export type ReportRangeInput = z.infer<typeof reportRangeSchema>;

export const dailyCloseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  countedCashKs: mmkSchema,
  notes: z.string().max(1000).optional().or(z.literal("")),
});
export type DailyCloseInput = z.infer<typeof dailyCloseSchema>;
