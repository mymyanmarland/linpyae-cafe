import { z } from "zod";
import { mmPhoneSchema, paginationSchema } from "@/lib/validators";

/** General branch + tax settings (manager+). */
export const generalSettingsSchema = z.object({
  name: z.string().min(1, "Required").max(100),
  nameMy: z.string().max(100).optional().or(z.literal("")),
  address: z.string().max(255).optional().or(z.literal("")),
  addressMy: z.string().max(255).optional().or(z.literal("")),
  phone: mmPhoneSchema,
  taxId: z.string().max(20).optional().or(z.literal("")),
  managerName: z.string().max(100).optional().or(z.literal("")),
  openingHours: z.string().max(50).optional().or(z.literal("")),
  taxRate: z.number().min(0).max(100),
  taxInclusive: z.boolean(),
  serviceChargeEnabled: z.boolean(),
  serviceChargePercent: z.number().min(0).max(50),
  kdsOverdueMinutes: z.number().int().min(1).max(120),
});

/** Receipt header/footer lines. */
export const receiptSettingsSchema = z.object({
  headerLines: z.array(z.string().max(120)).max(8),
  footerLines: z.array(z.string().max(120)).max(8),
});

/** Loyalty program settings. */
export const loyaltySettingsSchema = z.object({
  stampsToFree: z.number().int().min(1).max(100),
  pointsPerKs: z.number().int().min(1).max(100000),
  freeItemCategory: z.string().max(100).optional().or(z.literal("")),
});

/** Notification toggles + SMS provider. */
export const notificationSettingsSchema = z.object({
  lowStock: z.boolean(),
  eodSummary: z.boolean(),
  smsProvider: z.enum(["none", "stub", "http"]),
  smsHttpEndpoint: z.string().url("Invalid URL").optional().or(z.literal("")),
  smsHttpApiKey: z.string().max(255).optional().or(z.literal("")),
});

/** Payment providers: which methods are accepted, and demo/live mode per provider. */
export const paymentSettingsSchema = z.object({
  enabled: z.array(z.enum(["cash", "kbzpay", "wavepay", "ayapay", "onepay", "card", "bank_transfer"])).min(1),
  kbzpayMode: z.enum(["sandbox", "live"]),
  wavepayMode: z.enum(["sandbox", "live"]),
});

export const auditLogQuerySchema = paginationSchema.extend({
  action: z.string().max(50).optional(),
});

export type GeneralSettingsInput = z.infer<typeof generalSettingsSchema>;
export type ReceiptSettingsInput = z.infer<typeof receiptSettingsSchema>;
export type LoyaltySettingsInput = z.infer<typeof loyaltySettingsSchema>;
export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;
export type PaymentSettingsInput = z.infer<typeof paymentSettingsSchema>;
export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;
