import { z } from "zod";
import { mmPhoneSchema, idSchema } from "@/lib/validators";

export const onlineOrderItemSchema = z.object({
  menuItemId: idSchema,
  qty: z.number().int().min(1).max(20),
});

export const placeOnlineOrderSchema = z.object({
  name: z.string().min(1, "Required").max(100),
  phone: mmPhoneSchema,
  address: z.string().min(1, "Required").max(500),
  notes: z.string().max(500).optional().or(z.literal("")),
  paymentMethod: z.enum(["cash", "kbzpay", "wavepay"]),
  items: z.array(onlineOrderItemSchema).min(1, "Cart is empty").max(50),
});

export type PlaceOnlineOrderInput = z.infer<typeof placeOnlineOrderSchema>;
