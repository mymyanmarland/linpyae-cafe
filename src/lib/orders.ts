import { prisma } from "./db";
import { orderNumberFor, yangonDateKey, yangonDayStart } from "./format";

export type CartLine = {
  menuItemId: string;
  quantity: number;
  unitPriceKs: number; // base price
  modifiers: Array<{ group: string; option: string; delta: number }>;
  notes?: string;
};

export type OrderTotals = {
  subtotalKs: number;
  discountKs: number;
  taxKs: number;
  serviceKs: number;
  deliveryFeeKs: number;
  totalKs: number;
};

/**
 * Compute order totals.
 * - discount: {type: 'percent'|'fixed', value} applied on subtotal
 * - tax: Myanmar commercial tax; inclusive → extracted from price, exclusive → added
 */
export function computeTotals(
  lines: Array<{ lineTotalKs: number }>,
  opts: {
    discountType?: string | null;
    discountValue?: number;
    taxRate?: number; // e.g. 5
    taxInclusive?: boolean;
    serviceKs?: number;
    deliveryFeeKs?: number;
  } = {}
): OrderTotals {
  const subtotalKs = lines.reduce((s, l) => s + l.lineTotalKs, 0);
  let discountKs = 0;
  if (opts.discountType === "percent") discountKs = Math.round((subtotalKs * (opts.discountValue ?? 0)) / 100);
  else if (opts.discountType === "fixed") discountKs = Math.min(opts.discountValue ?? 0, subtotalKs);

  const afterDiscount = subtotalKs - discountKs;
  const rate = opts.taxRate ?? 0;
  let taxKs = 0;
  let totalKs = afterDiscount;
  if (rate > 0) {
    if (opts.taxInclusive) {
      taxKs = Math.round(afterDiscount - afterDiscount / (1 + rate / 100));
    } else {
      taxKs = Math.round((afterDiscount * rate) / 100);
      totalKs = afterDiscount + taxKs;
    }
  }
  const serviceKs = opts.serviceKs ?? 0;
  const deliveryFeeKs = opts.deliveryFeeKs ?? 0;
  totalKs += serviceKs + deliveryFeeKs;
  return { subtotalKs, discountKs, taxKs, serviceKs, deliveryFeeKs, totalKs };
}

export function lineTotalFor(line: CartLine): number {
  const mods = line.modifiers.reduce((s, m) => s + m.delta, 0);
  return (line.unitPriceKs + mods) * line.quantity;
}

/** Next order number for the branch today: YYYYMMDD-NNN */
export async function nextOrderNumber(branchId: string): Promise<string> {
  const key = yangonDateKey();
  const start = yangonDayStart(key);
  const count = await prisma.order.count({ where: { branchId, createdAt: { gte: start } } });
  return orderNumberFor(key, count + 1);
}

/** Next queue number for takeaway today */
export async function nextQueueNumber(branchId: string): Promise<number> {
  const start = yangonDayStart();
  const last = await prisma.order.findFirst({
    where: { branchId, type: "takeaway", createdAt: { gte: start }, queueNumber: { not: null } },
    orderBy: { queueNumber: "desc" },
    select: { queueNumber: true },
  });
  return (last?.queueNumber ?? 0) + 1;
}

/**
 * Deduct ingredients per BOM when an order is fired/completed.
 * Runs inside the caller's transaction (pass tx) or standalone.
 */
export async function deductInventory(
  db: Pick<typeof prisma, "recipe" | "stockMovement" | "ingredient">,
  orderId: string,
  items: Array<{ menuItemId: string | null; quantity: number }>,
  userId?: string
): Promise<void> {
  const menuItemIds = [...new Set(items.map((i) => i.menuItemId).filter(Boolean))] as string[];
  if (!menuItemIds.length) return;
  const recipes = await db.recipe.findMany({
    where: { menuItemId: { in: menuItemIds } },
    include: { ingredient: true },
  });
  const byItem = new Map<string, typeof recipes>();
  for (const r of recipes) {
    const arr = byItem.get(r.menuItemId) ?? [];
    arr.push(r);
    byItem.set(r.menuItemId, arr);
  }
  for (const item of items) {
    if (!item.menuItemId) continue;
    const lines = byItem.get(item.menuItemId) ?? [];
    for (const line of lines) {
      const qty = line.quantity * item.quantity;
      await db.stockMovement.create({
        data: {
          branchId: line.ingredient.branchId,
          ingredientId: line.ingredientId,
          type: "out",
          quantity: -qty,
          reference: `order:${orderId}`,
          userId,
        },
      });
      await db.ingredient.update({
        where: { id: line.ingredientId },
        data: { currentStock: { decrement: qty } },
      });
    }
  }
}

/** Create a low-stock notification when an ingredient drops below threshold. */
export async function checkLowStock(branchId: string, ingredientId: string): Promise<void> {
  const ing = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ing || !ing.active) return;
  if (ing.currentStock > ing.lowStockThreshold) return;
  const recent = await prisma.notification.findFirst({
    where: { branchId, type: "low_stock", recipient: ing.id, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
  if (recent) return; // one alert per day per ingredient
  await prisma.notification.create({
    data: {
      branchId,
      type: "low_stock",
      channel: "inapp",
      recipient: ing.id,
      message: `Low stock: ${ing.name} — ${ing.currentStock}${ing.baseUnit} left (threshold ${ing.lowStockThreshold}${ing.baseUnit})`,
      messageMy: `ကုန်ပစ္စည်းနည်းနေပါပြီ: ${ing.nameMy || ing.name} — ${ing.currentStock}${ing.baseUnit} ကျန်`,
      status: "queued",
    },
  });
}
