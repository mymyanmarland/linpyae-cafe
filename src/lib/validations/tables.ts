import { z } from "zod";
import { idSchema } from "@/lib/validators";

export const tableStatusSchema = z.enum(["free", "occupied", "reserved", "cleaning"]);
export type TableStatus = z.infer<typeof tableStatusSchema>;

export const createTableSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(20),
  seats: z.coerce.number().int().min(1).max(50).default(4),
  zone: z.string().trim().max(50).default("Main"),
  posX: z.coerce.number().int().min(0).max(2000).default(0),
  posY: z.coerce.number().int().min(0).max(2000).default(0),
});
export type CreateTableInput = z.infer<typeof createTableSchema>;

export const updateTableSchema = createTableSchema.partial().extend({
  id: idSchema,
});
export type UpdateTableInput = z.infer<typeof updateTableSchema>;

export const setTableStatusSchema = z.object({
  id: idSchema,
  status: tableStatusSchema,
});
export type SetTableStatusInput = z.infer<typeof setTableStatusSchema>;
