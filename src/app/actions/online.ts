"use server";

import { prisma } from "@/lib/db";
import { ok, fail, zodFail, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { getSetting, getBranchSettings } from "@/lib/settings";
import { computeTotals, nextOrderNumber, nextQueueNumber } from "@/lib/orders";
import { normalizeMmPhone } from "@/lib/format";
import {
  placeOnlineOrderSchema,
  type PlaceOnlineOrderInput,
} from "@/lib/validations/online";

export type OnlineMenuItem = {
  id: string;
  name: string;
  nameMy: string | null;
  description: string | null;
  descriptionMy: string | null;
  priceKs: number;
  imageUrl: string | null;
};

export type OnlineMenuCategory = {
  id: string;
  name: string;
  nameMy: string | null;
  items: OnlineMenuItem[];
};

export type OnlineMenu = {
  branch: { id: string; name: string; nameMy: string | null; phone: string | null; openingHours: string | null };
  categories: OnlineMenuCategory[];
  paymentsEnabled: string[];
  deliveryFeeKs: number;
  demoPayments: boolean;
};

/** Public menu for the online ordering page. Resolves the first active branch. */
export async function getOnlineMenu(): Promise<ActionResult<OnlineMenu>> {
  const branch = await prisma.branch.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
  if (!branch) return fail("Shop is not available right now");

  const [categories, bs, deliveryFee, kbzMode, waveMode] = await Promise.all([
    prisma.category.findMany({
      where: { branchId: branch.id, active: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        nameMy: true,
        items: {
          where: { active: true },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true, nameMy: true, description: true, descriptionMy: true, priceKs: true, imageUrl: true },
        },
      },
    }),
    getBranchSettings(branch.id),
    getSetting(branch.id, "delivery.fee", 0),
    getSetting(branch.id, "payments.kbzpay.mode", "sandbox"),
    getSetting(branch.id, "payments.wavepay.mode", "sandbox"),
  ]);

  const paymentsEnabled = bs.paymentsEnabled.filter((m) => ["cash", "kbzpay", "wavepay"].includes(m));
  return ok({
    branch: { id: branch.id, name: branch.name, nameMy: branch.nameMy, phone: branch.phone, openingHours: branch.openingHours },
    categories: categories.filter((c) => c.items.length > 0),
    paymentsEnabled: paymentsEnabled.length ? paymentsEnabled : ["cash"],
    deliveryFeeKs: deliveryFee,
    demoPayments: kbzMode === "sandbox" || waveMode === "sandbox",
  });
}

export type PlacedOrder = {
  orderId: string;
  orderNumber: string;
  queueNumber: number | null;
  totalKs: number;
  paymentMethod: string;
};

/**
 * Place an online order. PUBLIC — no session required.
 * Prices are always read server-side; client-submitted prices are ignored.
 */
export async function placeOnlineOrder(input: PlaceOnlineOrderInput): Promise<ActionResult<PlacedOrder>> {
  const parsed = placeOnlineOrderSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const v = parsed.data;

  const phone = normalizeMmPhone(v.phone ?? "");
  if (!phone) return fail("Invalid phone number");

  const branch = await prisma.branch.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
  if (!branch) return fail("Shop is not available right now");
  const branchId = branch.id;

  const bs = await getBranchSettings(branchId);
  if (!bs.paymentsEnabled.includes(v.paymentMethod)) return fail("Payment method not accepted");

  // Server-side pricing
  const menuItems = await prisma.menuItem.findMany({
    where: { branchId, active: true, id: { in: v.items.map((i) => i.menuItemId) } },
    select: { id: true, name: true, nameMy: true, priceKs: true, station: true },
  });
  if (menuItems.length !== v.items.length) return fail("Some items are no longer available");
  const priceOf = new Map(menuItems.map((m) => [m.id, m]));

  const lines = v.items.map((i) => {
    const m = priceOf.get(i.menuItemId)!;
    return {
      lineTotalKs: m.priceKs * i.qty,
      menuItemId: m.id,
      name: m.name,
      nameMy: m.nameMy,
      qty: i.qty,
      unitPriceKs: m.priceKs,
      station: m.station,
    };
  });

  const deliveryFee = await getSetting(branchId, "delivery.fee", 0);
  const totals = computeTotals(lines, {
    taxRate: bs.taxRate,
    taxInclusive: bs.taxInclusive,
    deliveryFeeKs: deliveryFee,
  });

  const [orderNumber, queueNumber] = await Promise.all([nextOrderNumber(branchId), nextQueueNumber(branchId)]);

  const order = await prisma.order.create({
    data: {
      branchId,
      orderNumber,
      queueNumber,
      type: "online",
      status: "open",
      customerName: v.name,
      customerPhone: phone,
      deliveryAddress: v.address,
      notes: v.notes || null,
      subtotalKs: totals.subtotalKs,
      discountType: "none",
      discountValue: 0,
      discountKs: totals.discountKs,
      taxKs: totals.taxKs,
      serviceKs: totals.serviceKs,
      deliveryFeeKs: totals.deliveryFeeKs,
      totalKs: totals.totalKs,
      items: {
        create: lines.map((l) => ({
          menuItemId: l.menuItemId,
          name: l.name,
          nameMy: l.nameMy,
          quantity: l.qty,
          unitPriceKs: l.unitPriceKs,
          lineTotalKs: l.lineTotalKs,
          station: l.station,
          kdsStatus: "queued",
        })),
      },
    },
  });

  // E-wallet orders start as pending — the provider webhook confirms them (sandbox for now).
  if (v.paymentMethod !== "cash") {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        method: v.paymentMethod,
        amountKs: totals.totalKs,
        reference: orderNumber,
        status: "pending",
        payloadJson: JSON.stringify({ source: "online", demo: true }),
      },
    });
  }

  await logAudit({
    branchId,
    action: "online_order",
    entityType: "Order",
    entityId: order.id,
    after: { orderNumber, totalKs: totals.totalKs, paymentMethod: v.paymentMethod, phone },
  });

  return ok({
    orderId: order.id,
    orderNumber,
    queueNumber,
    totalKs: totals.totalKs,
    paymentMethod: v.paymentMethod,
  });
}
