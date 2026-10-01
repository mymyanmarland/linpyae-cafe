import { z } from "zod";
import { idSchema, pinSchema, mmPhoneSchema, roleSchema } from "@/lib/validators";

export const createStaffSchema = z.object({
  name: z.string().min(1, "Name required").max(100),
  nameMy: z.string().max(100).optional().or(z.literal("")),
  email: z.string().email("Invalid email").max(255),
  role: roleSchema,
  pin: pinSchema,
  phone: mmPhoneSchema,
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(100).optional(),
  nameMy: z.string().max(100).optional().or(z.literal("")),
  role: roleSchema.optional(),
  phone: mmPhoneSchema,
  active: z.boolean().optional(),
});
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const resetPinSchema = z.object({
  id: idSchema,
  pin: pinSchema,
});
export type ResetPinInput = z.infer<typeof resetPinSchema>;

export const staffListSchema = z.object({
  role: z.string().max(20).default(""),
  activeOnly: z.boolean().default(false),
});

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
export const rosterEntrySchema = z.object({
  userId: idSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  shiftName: z.string().min(1, "Shift name required").max(50),
  startTime: z.string().regex(timeRe, "Use HH:MM"),
  endTime: z.string().regex(timeRe, "Use HH:MM"),
});
export type RosterEntryInput = z.infer<typeof rosterEntrySchema>;

export const saveRosterSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid week start"),
  entries: z.array(rosterEntrySchema).max(500),
});
export type SaveRosterInput = z.infer<typeof saveRosterSchema>;

export const attendanceListSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  userId: z.string().max(50).default(""),
});
