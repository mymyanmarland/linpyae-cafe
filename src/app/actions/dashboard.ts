"use server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import { yangonDayStart, yangonDateKey } from "@/lib/format";

export type DashboardStats = {
  today: { revenueKs: number; orderCount: number; avgTicketKs: number };
  activeTables: number;
  totalTables: number;
  openOrders: number;
  lowStockCount: number;
  lowStockItems: Array<{ id: string; name: string; nameMy: string | null; currentStock: number; unit: string }>;
  weekRevenue: Array<{ date: string; revenueKs: number; orderCount: number }>;
  topItems: Array<{ id: string; name: string; nameMy: string | null; qty: number; revenueKs: number }>;
  tableStatus: Record<string, number>;
  onShift: Array<{ id: string; name: string; nameMy: string | null; role: string }>;
};

const OPEN_STATUSES = ["open", "held", "fired", "preparing", "ready"];

/** Dashboard stats for the user's branch. Any authenticated staff member. */
export async function getDashboardStats(): Promise<ActionResult<DashboardStats>> {
  const user = await requireUser();
  if (!user.branchId) return fail("No branch assigned");
  const branchId = user.branchId;

  const todayStart = yangonDayStart();
  const weekStart = yangonDayStart(
    yangonDateKey(new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000))
  );

  const [todayOrders, weekOrders, tables, openOrders, lowStock, shifts] = await Promise.all([
    prisma.order.findMany({
      where: { branchId, status: "completed", completedAt: { gte: todayStart } },
      select: { totalKs: true },
    }),
    prisma.order.findMany({
      where: { branchId, status: "completed", completedAt: { gte: weekStart } },
      select: {
        totalKs: true,
        completedAt: true,
        items: { select: { quantity: true, unitPriceKs: true, menuItem: { select: { id: true, name: true, nameMy: true } } } },
      },
    }),
    prisma.cafeTable.findMany({ where: { branchId, active: true }, select: { status: true } }),
    prisma.order.count({ where: { branchId, status: { in: OPEN_STATUSES } } }),
    prisma.ingredient.findMany({
      where: { branchId, active: true },
      select: { id: true, name: true, nameMy: true, currentStock: true, lowStockThreshold: true, baseUnit: true },
    }),
    prisma.shift.findMany({
      where: { branchId, status: "open" },
      select: { id: true, user: { select: { name: true, nameMy: true, role: true } } },
    }),
  ]);

  const revenueKs = todayOrders.reduce((s, o) => s + o.totalKs, 0);
  const orderCount = todayOrders.length;

  // Week revenue grouped by Yangon date
  const weekMap = new Map<string, { revenueKs: number; orderCount: number }>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
    weekMap.set(yangonDateKey(d), { revenueKs: 0, orderCount: 0 });
  }
  for (const o of weekOrders) {
    const key = yangonDateKey(o.completedAt ?? new Date());
    const e = weekMap.get(key);
    if (e) {
      e.revenueKs += o.totalKs;
      e.orderCount += 1;
    }
  }
  const weekRevenue = [...weekMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, ...v }));

  // Top items this week by qty
  const itemMap = new Map<string, { name: string; nameMy: string | null; qty: number; revenueKs: number }>();
  for (const o of weekOrders) {
    for (const it of o.items) {
      if (!it.menuItem) continue;
      const id = it.menuItem.id;
      const e = itemMap.get(id) ?? { name: it.menuItem.name, nameMy: it.menuItem.nameMy, qty: 0, revenueKs: 0 };
      e.qty += it.quantity;
      e.revenueKs += it.quantity * it.unitPriceKs;
      itemMap.set(id, e);
    }
  }
  const topItems = [...itemMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const lowStockItems = lowStock
    .filter((i) => i.currentStock <= i.lowStockThreshold)
    .map((i) => ({
      id: i.id,
      name: i.name,
      nameMy: i.nameMy,
      currentStock: i.currentStock,
      unit: i.baseUnit,
    }));

  const tableStatus: Record<string, number> = { free: 0, occupied: 0, reserved: 0, cleaning: 0 };
  for (const t of tables) {
    if (t.status in tableStatus) tableStatus[t.status] += 1;
  }

  return ok({
    today: {
      revenueKs,
      orderCount,
      avgTicketKs: orderCount ? Math.round(revenueKs / orderCount) : 0,
    },
    activeTables: tableStatus.occupied + tableStatus.reserved,
    totalTables: tables.length,
    openOrders,
    lowStockCount: lowStockItems.length,
    lowStockItems: lowStockItems.slice(0, 8),
    weekRevenue,
    topItems,
    tableStatus,
    onShift: shifts.map((s) => ({ id: s.id, name: s.user.name, nameMy: s.user.nameMy, role: s.user.role })),
  });
}
