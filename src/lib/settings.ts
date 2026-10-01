import { prisma } from "./db";

/** Read a branch setting, JSON-decoded, with fallback. */
export async function getSetting<T>(branchId: string, key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { branchId_key: { branchId, key } } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(branchId: string, key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { branchId_key: { branchId, key } },
    update: { value: JSON.stringify(value) },
    create: { branchId, key, value: JSON.stringify(value) },
  });
}

export type BranchSettings = {
  taxRate: number;
  taxInclusive: boolean;
  taxId: string;
  receiptHeader: string[];
  receiptFooter: string[];
  stampsToFree: number;
  pointsPerKs: number;
  kdsOverdueMinutes: number;
  paymentsEnabled: string[];
};

export async function getBranchSettings(branchId: string): Promise<BranchSettings> {
  const [taxRate, taxInclusive, taxId, header, footer, stampsToFree, pointsPerKs, overdue, payments] =
    await Promise.all([
      getSetting(branchId, "tax.rate", 5),
      getSetting(branchId, "tax.inclusive", true),
      getSetting(branchId, "tax.id", ""),
      getSetting(branchId, "receipt.header", { lines: [] as string[] }),
      getSetting(branchId, "receipt.footer", { lines: [] as string[] }),
      getSetting(branchId, "loyalty.stampsToFree", 10),
      getSetting(branchId, "loyalty.pointsPerKs", 100),
      getSetting(branchId, "kds.overdueMinutes", 10),
      getSetting(branchId, "payments.enabled", ["cash"]),
    ]);
  return {
    taxRate,
    taxInclusive,
    taxId,
    receiptHeader: (header as { lines: string[] }).lines ?? [],
    receiptFooter: (footer as { lines: string[] }).lines ?? [],
    stampsToFree,
    pointsPerKs,
    kdsOverdueMinutes: overdue,
    paymentsEnabled: payments,
  };
}
