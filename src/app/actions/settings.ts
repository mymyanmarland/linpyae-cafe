"use server";

import { prisma } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/session";
import { ok, fail, zodFail, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { getSetting, setSetting, getBranchSettings } from "@/lib/settings";
import {
  generalSettingsSchema,
  receiptSettingsSchema,
  loyaltySettingsSchema,
  notificationSettingsSchema,
  paymentSettingsSchema,
  auditLogQuerySchema,
  type GeneralSettingsInput,
  type ReceiptSettingsInput,
  type LoyaltySettingsInput,
  type NotificationSettingsInput,
  type PaymentSettingsInput,
  type AuditLogQueryInput,
} from "@/lib/validations/settings";

export type SettingsBundle = {
  branch: {
    name: string;
    nameMy: string;
    address: string;
    addressMy: string;
    phone: string;
    taxId: string;
    managerName: string;
    openingHours: string;
  };
  taxRate: number;
  taxInclusive: boolean;
  serviceChargeEnabled: boolean;
  serviceChargePercent: number;
  kdsOverdueMinutes: number;
  receiptHeader: string[];
  receiptFooter: string[];
  stampsToFree: number;
  pointsPerKs: number;
  freeItemCategory: string;
  paymentsEnabled: string[];
  kbzpayMode: string;
  wavepayMode: string;
  notifications: { lowStock: boolean; eodSummary: boolean };
  sms: { provider: string; endpoint: string; hasApiKey: boolean };
};

/** Current user's role, for gating settings UI (read-only vs editable). */
export async function getMyRole(): Promise<ActionResult<{ role: string }>> {
  const user = await requireUser();
  return ok({ role: user.role });
}

/** Full settings bundle for the user's branch. Any authenticated user may read. */
export async function getSettings(): Promise<ActionResult<SettingsBundle>> {
  const user = await requireUser();
  if (!user.branchId) return fail("No branch assigned");
  const branchId = user.branchId;

  const [branch, bs, freeCat, scEnabled, scPercent, notif, sms] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId } }),
    getBranchSettings(branchId),
    getSetting(branchId, "loyalty.freeItemCategory", ""),
    getSetting(branchId, "service.enabled", false),
    getSetting(branchId, "service.percent", 0),
    getSetting(branchId, "notifications.lowStock", true).then(async (lowStock) => ({
      lowStock,
      eodSummary: await getSetting(branchId, "notifications.eodSummary", true),
    })),
    getSetting(branchId, "sms.provider", "none").then(async (provider) => ({
      provider,
      endpoint: await getSetting(branchId, "sms.http.endpoint", ""),
      hasApiKey: (await getSetting(branchId, "sms.http.apiKey", "")) !== "",
    })),
  ]);
  if (!branch) return fail("Branch not found");

  return ok({
    branch: {
      name: branch.name,
      nameMy: branch.nameMy ?? "",
      address: branch.address ?? "",
      addressMy: branch.addressMy ?? "",
      phone: branch.phone ?? "",
      taxId: branch.taxId ?? "",
      managerName: branch.managerName ?? "",
      openingHours: branch.openingHours ?? "",
    },
    taxRate: bs.taxRate,
    taxInclusive: bs.taxInclusive,
    serviceChargeEnabled: scEnabled,
    serviceChargePercent: scPercent,
    kdsOverdueMinutes: bs.kdsOverdueMinutes,
    receiptHeader: bs.receiptHeader,
    receiptFooter: bs.receiptFooter,
    stampsToFree: bs.stampsToFree,
    pointsPerKs: bs.pointsPerKs,
    freeItemCategory: freeCat,
    paymentsEnabled: bs.paymentsEnabled,
    kbzpayMode: await getSetting(branchId, "payments.kbzpay.mode", "sandbox"),
    wavepayMode: await getSetting(branchId, "payments.wavepay.mode", "sandbox"),
    notifications: notif,
    sms,
  });
}

/** Update general branch + tax settings. Manager+. */
export async function updateGeneralSettings(input: GeneralSettingsInput): Promise<ActionResult<void>> {
  const user = await requireRole("manager", "owner");
  const parsed = generalSettingsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const branchId = user.branchId;
  const v = parsed.data;

  const before = await getBranchSettings(branchId);
  await prisma.branch.update({
    where: { id: branchId },
    data: {
      name: v.name,
      nameMy: v.nameMy || null,
      address: v.address || null,
      addressMy: v.addressMy || null,
      phone: v.phone || null,
      taxId: v.taxId || null,
      managerName: v.managerName || null,
      openingHours: v.openingHours || null,
    },
  });
  await Promise.all([
    setSetting(branchId, "tax.rate", v.taxRate),
    setSetting(branchId, "tax.inclusive", v.taxInclusive),
    setSetting(branchId, "service.enabled", v.serviceChargeEnabled),
    setSetting(branchId, "service.percent", v.serviceChargePercent),
    setSetting(branchId, "kds.overdueMinutes", v.kdsOverdueMinutes),
  ]);
  await logAudit({
    userId: user.id,
    branchId,
    action: "settings_change",
    entityType: "Branch",
    entityId: branchId,
    before,
    after: v,
  });
  return ok(undefined);
}

/** Update receipt header/footer lines. Manager+. */
export async function updateReceiptSettings(input: ReceiptSettingsInput): Promise<ActionResult<void>> {
  const user = await requireRole("manager", "owner");
  const parsed = receiptSettingsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const branchId = user.branchId;
  await Promise.all([
    setSetting(branchId, "receipt.header", { lines: parsed.data.headerLines }),
    setSetting(branchId, "receipt.footer", { lines: parsed.data.footerLines }),
  ]);
  await logAudit({ userId: user.id, branchId, action: "settings_change", entityType: "Setting", entityId: "receipt", after: parsed.data });
  return ok(undefined);
}

/** Update loyalty settings. Manager+. */
export async function updateLoyaltySettings(input: LoyaltySettingsInput): Promise<ActionResult<void>> {
  const user = await requireRole("manager", "owner");
  const parsed = loyaltySettingsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const branchId = user.branchId;
  const v = parsed.data;
  await Promise.all([
    setSetting(branchId, "loyalty.stampsToFree", v.stampsToFree),
    setSetting(branchId, "loyalty.pointsPerKs", v.pointsPerKs),
    setSetting(branchId, "loyalty.freeItemCategory", v.freeItemCategory),
  ]);
  await logAudit({ userId: user.id, branchId, action: "settings_change", entityType: "Setting", entityId: "loyalty", after: v });
  return ok(undefined);
}

/** Update accepted payment methods + provider modes. Manager+. */
export async function updatePaymentSettings(input: PaymentSettingsInput): Promise<ActionResult<void>> {
  const user = await requireRole("manager", "owner");
  const parsed = paymentSettingsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const branchId = user.branchId;
  const v = parsed.data;
  await Promise.all([
    setSetting(branchId, "payments.enabled", v.enabled),
    setSetting(branchId, "payments.kbzpay.mode", v.kbzpayMode),
    setSetting(branchId, "payments.wavepay.mode", v.wavepayMode),
  ]);
  await logAudit({ userId: user.id, branchId, action: "settings_change", entityType: "Setting", entityId: "payments", after: v });
  return ok(undefined);
}

/** Update notification toggles + SMS provider. Manager+. */
export async function updateNotificationSettings(
  input: NotificationSettingsInput
): Promise<ActionResult<void>> {
  const user = await requireRole("manager", "owner");
  const parsed = notificationSettingsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const branchId = user.branchId;
  const v = parsed.data;
  await Promise.all([
    setSetting(branchId, "notifications.lowStock", v.lowStock),
    setSetting(branchId, "notifications.eodSummary", v.eodSummary),
    setSetting(branchId, "sms.provider", v.smsProvider),
    setSetting(branchId, "sms.http.endpoint", v.smsHttpEndpoint),
    ...(v.smsHttpApiKey ? [setSetting(branchId, "sms.http.apiKey", v.smsHttpApiKey)] : []),
  ]);
  await logAudit({
    userId: user.id,
    branchId,
    action: "settings_change",
    entityType: "Setting",
    entityId: "notifications",
    after: { ...v, smsHttpApiKey: v.smsHttpApiKey ? "***" : "" },
  });
  return ok(undefined);
}

export type AuditLogRow = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  userName: string | null;
  createdAt: string;
  summary: string;
};

/** Paginated audit log. Owner/manager only. */
export async function listAuditLogs(
  query: AuditLogQueryInput
): Promise<ActionResult<{ rows: AuditLogRow[]; total: number; page: number; pageSize: number }>> {
  const user = await requireRole("manager", "owner");
  const parsed = auditLogQuerySchema.safeParse(query);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { page, pageSize, search, action } = parsed.data;
  const branchId = user.branchId;

  const where = {
    branchId,
    ...(action ? { action } : {}),
    ...(search
      ? { OR: [{ action: { contains: search } }, { entityType: { contains: search } }, { entityId: { contains: search } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true } } },
    }),
  ]);
  return ok({
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      userName: r.user?.name ?? null,
      createdAt: r.createdAt.toISOString(),
      summary: r.afterJson ? r.afterJson.slice(0, 120) : "",
    })),
    total,
    page,
    pageSize,
  });
}
