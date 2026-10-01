"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { ok, fail, zodFail, type ActionResult } from "@/lib/action-result";
import { reportRangeSchema, dailyCloseSchema } from "@/lib/validations/reports";
import { yangonDayStart, yangonDateKey } from "@/lib/format";

function rangeOf(from: string, to: string) {
  return {
    gte: yangonDayStart(from),
    lt: new Date(yangonDayStart(to).getTime() + 24 * 3600 * 1000),
  };
}

const completedWhere = (branchId: string, from: string, to: string) => ({
  branchId,
  status: "completed",
  completedAt: rangeOf(from, to),
});

// ── Sales summary ───────────────────────────────────────────────

export type SalesSummary = {
  grossKs: number;
  discountKs: number;
  taxKs: number;
  netKs: number;
  tipsKs: number;
  refundsKs: number;
  orderCount: number;
  avgOrderKs: number;
  byPaymentMethod: Array<{ method: string; totalKs: number; count: number }>;
  byOrderType: Array<{ type: string; totalKs: number; count: number }>;
};

export async function salesSummary(input: unknown): Promise<ActionResult<SalesSummary>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = reportRangeSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { from, to } = parsed.data;

  const orders = await prisma.order.findMany({
    where: completedWhere(branchId, from, to),
    select: { id: true, type: true, subtotalKs: true, discountKs: true, taxKs: true, totalKs: true },
  });
  const orderIds = orders.map((o) => o.id);
  const [tips, refunds, payments] = await Promise.all([
    orderIds.length
      ? prisma.tip.aggregate({ where: { orderId: { in: orderIds } }, _sum: { amountKs: true } })
      : { _sum: { amountKs: 0 } },
    orderIds.length
      ? prisma.refund.aggregate({ where: { orderId: { in: orderIds } }, _sum: { amountKs: true } })
      : { _sum: { amountKs: 0 } },
    orderIds.length
      ? prisma.payment.findMany({
          where: { orderId: { in: orderIds }, status: "confirmed" },
          select: { method: true, amountKs: true },
        })
      : [],
  ]);

  const byMethod = new Map<string, { totalKs: number; count: number }>();
  for (const p of payments) {
    const e = byMethod.get(p.method) ?? { totalKs: 0, count: 0 };
    e.totalKs += p.amountKs;
    e.count += 1;
    byMethod.set(p.method, e);
  }
  const byType = new Map<string, { totalKs: number; count: number }>();
  for (const o of orders) {
    const e = byType.get(o.type) ?? { totalKs: 0, count: 0 };
    e.totalKs += o.totalKs;
    e.count += 1;
    byType.set(o.type, e);
  }
  const sum = (f: (o: (typeof orders)[number]) => number) => orders.reduce((s, o) => s + f(o), 0);
  const net = sum((o) => o.totalKs);
  return ok({
    grossKs: sum((o) => o.subtotalKs),
    discountKs: sum((o) => o.discountKs),
    taxKs: sum((o) => o.taxKs),
    netKs: net,
    tipsKs: tips._sum.amountKs ?? 0,
    refundsKs: refunds._sum.amountKs ?? 0,
    orderCount: orders.length,
    avgOrderKs: orders.length ? Math.round(net / orders.length) : 0,
    byPaymentMethod: [...byMethod.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.totalKs - a.totalKs),
    byOrderType: [...byType.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.totalKs - a.totalKs),
  });
}

// ── Item / category / hour breakdowns ────────────────────────────

export async function salesByItem(input: unknown): Promise<
  ActionResult<Array<{ menuItemId: string | null; name: string; nameMy: string | null; qty: number; revenueKs: number }>>
> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = reportRangeSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { from, to } = parsed.data;
  const rows = await prisma.orderItem.findMany({
    where: { order: completedWhere(branchId, from, to) },
    select: { menuItemId: true, name: true, nameMy: true, quantity: true, lineTotalKs: true },
  });
  const map = new Map<string, { menuItemId: string | null; name: string; nameMy: string | null; qty: number; revenueKs: number }>();
  for (const r of rows) {
    const key = r.menuItemId ?? `name:${r.name}`;
    const e = map.get(key) ?? { menuItemId: r.menuItemId, name: r.name, nameMy: r.nameMy, qty: 0, revenueKs: 0 };
    e.qty += r.quantity;
    e.revenueKs += r.lineTotalKs;
    map.set(key, e);
  }
  return ok([...map.values()].sort((a, b) => b.revenueKs - a.revenueKs));
}

export async function salesByCategory(input: unknown): Promise<
  ActionResult<Array<{ categoryId: string | null; name: string; nameMy: string | null; qty: number; revenueKs: number }>>
> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = reportRangeSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { from, to } = parsed.data;
  const rows = await prisma.orderItem.findMany({
    where: { order: completedWhere(branchId, from, to) },
    select: {
      quantity: true, lineTotalKs: true,
      menuItem: { select: { categoryId: true, category: { select: { name: true, nameMy: true } } } },
    },
  });
  const map = new Map<string, { categoryId: string | null; name: string; nameMy: string | null; qty: number; revenueKs: number }>();
  for (const r of rows) {
    const key = r.menuItem?.categoryId ?? "uncategorized";
    const e = map.get(key) ?? {
      categoryId: r.menuItem?.categoryId ?? null,
      name: r.menuItem?.category?.name ?? "Uncategorized",
      nameMy: r.menuItem?.category?.nameMy ?? null,
      qty: 0, revenueKs: 0,
    };
    e.qty += r.quantity;
    e.revenueKs += r.lineTotalKs;
    map.set(key, e);
  }
  return ok([...map.values()].sort((a, b) => b.revenueKs - a.revenueKs));
}

export async function salesByHour(input: unknown): Promise<ActionResult<Array<{ hour: number; totalKs: number; count: number }>>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = reportRangeSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { from, to } = parsed.data;
  const orders = await prisma.order.findMany({
    where: completedWhere(branchId, from, to),
    select: { completedAt: true, totalKs: true },
  });
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, totalKs: 0, count: 0 }));
  for (const o of orders) {
    if (!o.completedAt) continue;
    // Yangon hour of completedAt
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Yangon", hour: "numeric", hour12: false }).format(o.completedAt)
    ) % 24;
    buckets[hour].totalKs += o.totalKs;
    buckets[hour].count += 1;
  }
  return ok(buckets);
}

export async function staffPerformance(input: unknown): Promise<
  ActionResult<Array<{ userId: string; name: string; nameMy: string | null; orders: number; netKs: number }>>
> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = reportRangeSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { from, to } = parsed.data;
  const orders = await prisma.order.findMany({
    where: { ...completedWhere(branchId, from, to), createdById: { not: null } },
    select: { createdById: true, totalKs: true, createdBy: { select: { name: true, nameMy: true } } },
  });
  const map = new Map<string, { userId: string; name: string; nameMy: string | null; orders: number; netKs: number }>();
  for (const o of orders) {
    const id = o.createdById!;
    const e = map.get(id) ?? { userId: id, name: o.createdBy?.name ?? "?", nameMy: o.createdBy?.nameMy ?? null, orders: 0, netKs: 0 };
    e.orders += 1;
    e.netKs += o.totalKs;
    map.set(id, e);
  }
  return ok([...map.values()].sort((a, b) => b.netKs - a.netKs));
}

// ── Inventory reports ────────────────────────────────────────────

export async function inventoryValuation(): Promise<
  ActionResult<{ items: Array<{ id: string; name: string; nameMy: string | null; stockDisplay: number; unit: string; valueKs: number }>; totalKs: number }>
> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const ings = await prisma.ingredient.findMany({
    where: { branchId: branchId, active: true },
    orderBy: { name: "asc" },
  });
  const items = ings.map((i) => ({
    id: i.id,
    name: i.name,
    nameMy: i.nameMy,
    stockDisplay: i.currentStock / (i.toBaseFactor || 1),
    unit: i.unit,
    valueKs: Math.round(i.currentStock * i.costPerBaseUnit),
  }));
  return ok({ items, totalKs: items.reduce((s, i) => s + i.valueKs, 0) });
}

export async function lowStockReport(): Promise<
  ActionResult<Array<{ id: string; name: string; nameMy: string | null; stockDisplay: number; thresholdDisplay: number; unit: string }>>
> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const ings = await prisma.ingredient.findMany({ where: { branchId: branchId, active: true }, orderBy: { name: "asc" } });
  return ok(
    ings
      .filter((i) => i.currentStock <= i.lowStockThreshold)
      .map((i) => ({
        id: i.id, name: i.name, nameMy: i.nameMy,
        stockDisplay: i.currentStock / (i.toBaseFactor || 1),
        thresholdDisplay: i.lowStockThreshold / (i.toBaseFactor || 1),
        unit: i.unit,
      }))
  );
}

// ── Daily close ──────────────────────────────────────────────────

export type DailyCloseDTO = {
  id: string;
  date: string;
  grossKs: number;
  discountKs: number;
  netKs: number;
  taxKs: number;
  cashKs: number;
  mobileKs: number;
  refundsKs: number;
  orderCount: number;
  countedCashKs: number | null;
  varianceKs: number | null;
  createdAt: string;
};

export async function getDailyClose(input: unknown): Promise<ActionResult<DailyCloseDTO | null>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const date = typeof input === "string" ? input : (input as { date?: string } | null)?.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Invalid date");
  const row = await prisma.dailyClose.findUnique({
    where: { branchId_date: { branchId: branchId, date: yangonDayStart(date) } },
  });
  if (!row) return ok(null);
  const payload = (row.payloadJson ? JSON.parse(row.payloadJson) : {}) as { countedCashKs?: number; varianceKs?: number };
  return ok({
    id: row.id, date: yangonDateKey(row.date),
    grossKs: row.grossKs, discountKs: row.discountKs, netKs: row.netKs, taxKs: row.taxKs,
    cashKs: row.cashKs, mobileKs: row.mobileKs, refundsKs: row.refundsKs, orderCount: row.orderCount,
    countedCashKs: payload.countedCashKs ?? null, varianceKs: payload.varianceKs ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

export async function dailyClose(input: unknown): Promise<ActionResult<DailyCloseDTO>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = dailyCloseSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { date, countedCashKs, notes } = parsed.data;
  const dayStart = yangonDayStart(date);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const orders = await prisma.order.findMany({
    where: { branchId, status: "completed", completedAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true, subtotalKs: true, discountKs: true, taxKs: true, totalKs: true },
  });
  const orderIds = orders.map((o) => o.id);
  const [payments, refunds] = await Promise.all([
    orderIds.length
      ? prisma.payment.findMany({ where: { orderId: { in: orderIds }, status: "confirmed" }, select: { method: true, amountKs: true } })
      : [],
    orderIds.length
      ? prisma.refund.aggregate({ where: { orderId: { in: orderIds } }, _sum: { amountKs: true } })
      : { _sum: { amountKs: 0 } },
  ]);
  const sum = (f: (o: (typeof orders)[number]) => number) => orders.reduce((s, o) => s + f(o), 0);
  const cashKs = payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amountKs, 0);
  const mobileKs = payments.filter((p) => p.method !== "cash").reduce((s, p) => s + p.amountKs, 0);
  const data = {
    grossKs: sum((o) => o.subtotalKs),
    discountKs: sum((o) => o.discountKs),
    netKs: sum((o) => o.totalKs),
    taxKs: sum((o) => o.taxKs),
    cashKs, mobileKs,
    refundsKs: refunds._sum.amountKs ?? 0,
    orderCount: orders.length,
  };
  const varianceKs = countedCashKs - cashKs;
  const row = await prisma.dailyClose.upsert({
    where: { branchId_date: { branchId, date: dayStart } },
    update: {
      ...data,
      payloadJson: JSON.stringify({ countedCashKs, varianceKs, notes: notes || undefined, closedBy: u.id }),
    },
    create: {
      branchId, date: dayStart, openedBy: u.id, ...data,
      payloadJson: JSON.stringify({ countedCashKs, varianceKs, notes: notes || undefined, closedBy: u.id }),
    },
  });
  await logAudit({ userId: u.id, branchId, action: "daily_close", entityType: "DailyClose", entityId: row.id, after: { date, ...data, countedCashKs, varianceKs } });
  return ok({
    id: row.id, date,
    ...data, countedCashKs, varianceKs,
    createdAt: row.createdAt.toISOString(),
  });
}
