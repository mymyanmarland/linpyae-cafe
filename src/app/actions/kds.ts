"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, fail, zodFail, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { getBranchSettings } from "@/lib/settings";
import {
  getKdsQueueSchema,
  updateItemKdsStatusSchema,
  bumpOrderSchema,
  recallItemSchema,
} from "@/lib/validations/kds";

export type KdsTicketItem = {
  id: string;
  name: string;
  nameMy: string | null;
  quantity: number;
  modifiers: Array<{ group: string; option: string; delta: number }>;
  notes: string | null;
  station: string;
  kdsStatus: string;
  firedAt: string | null;
  createdAt: string;
};

export type KdsTicket = {
  orderId: string;
  orderNumber: string;
  queueNumber: number | null;
  type: string;
  tableLabel: string | null;
  customerName: string | null;
  orderStatus: string;
  createdAt: string;
  items: KdsTicketItem[];
};

/** Open orders — plus completed orders whose items still need kitchen attention
 *  (e.g. paid-at-POS orders that were auto-fired on payment). */
export async function getKdsQueue(input: unknown): Promise<ActionResult<{ tickets: KdsTicket[]; overdueMinutes: number }>> {
  const user = await requireRole("barista");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = getKdsQueueSchema.safeParse(input ?? {});
  if (!parsed.success) return zodFail(parsed.error);
  const station = parsed.data.station;

  const orders = await prisma.order.findMany({
    where: {
      branchId: user.branchId,
      status: { in: ["open", "held", "fired", "preparing", "ready", "completed"] },
      items: {
        some: {
          kdsStatus: { in: ["queued", "fired", "preparing", "ready", "recalled"] },
          ...(station === "all" ? {} : { station }),
        },
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, orderNumber: true, queueNumber: true, type: true, status: true,
      customerName: true, createdAt: true,
      table: { select: { label: true } },
      items: {
        where: {
          kdsStatus: { in: ["queued", "fired", "preparing", "ready", "recalled"] },
          ...(station === "all" ? {} : { station }),
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, name: true, nameMy: true, quantity: true, modifiersJson: true,
          notes: true, station: true, kdsStatus: true, firedAt: true, createdAt: true,
        },
      },
    },
  });

  return ok({
    tickets: orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      queueNumber: o.queueNumber,
      type: o.type,
      tableLabel: o.table?.label ?? null,
      customerName: o.customerName,
      orderStatus: o.status,
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((i) => ({
        id: i.id,
        name: i.name,
        nameMy: i.nameMy,
        quantity: i.quantity,
        modifiers: safeParseModifiers(i.modifiersJson),
        notes: i.notes,
        station: i.station,
        kdsStatus: i.kdsStatus,
        firedAt: i.firedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
    })),
    overdueMinutes: (await getBranchSettings(user.branchId)).kdsOverdueMinutes,
  });
}

const FLOW: Record<string, string | null> = {
  queued: "fired",
  fired: "preparing",
  preparing: "ready",
  ready: "bumped",
  recalled: "preparing",
  bumped: null,
};

/** Advance (or set) an item's KDS status. Barista+ may work the board. */
export async function updateItemKdsStatus(
  input: unknown
): Promise<ActionResult<{ itemId: string; kdsStatus: string; orderStatus: string }>> {
  const user = await requireRole("barista");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = updateItemKdsStatusSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const { orderItemId, status } = parsed.data;

  const item = await prisma.orderItem.findFirst({
    where: { id: orderItemId, order: { branchId: user.branchId } },
    include: { order: { select: { id: true, status: true } } },
  });
  if (!item) return fail("Item not found");
  // Voided orders are closed; completed orders stay workable so the kitchen can
  // still bump items that were auto-fired on payment.
  if (item.order.status === "voided") return fail("Order is voided");

  // Enforce forward-only flow, except explicit recall
  const expected = FLOW[item.kdsStatus];
  const isRecall = status === "recalled";
  const isExplicitSet = status === expected || (isRecall && ["fired", "preparing", "ready"].includes(item.kdsStatus));
  if (!isExplicitSet && status !== "bumped") {
    return fail(`Cannot move item from ${item.kdsStatus} to ${status}`);
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.orderItem.update({
      where: { id: orderItemId },
      data: {
        kdsStatus: status,
        ...(status === "ready" ? { readyAt: now } : {}),
      },
      select: { kdsStatus: true },
    });
    // Roll the order status forward based on its items
    const items = await tx.orderItem.findMany({
      where: { orderId: item.order.id },
      select: { kdsStatus: true },
    });
    const statuses = new Set(items.map((i) => i.kdsStatus));
    let orderStatus = item.order.status;
    if (statuses.size > 0 && [...statuses].every((s) => s === "bumped")) {
      orderStatus = "ready";
    } else if (statuses.has("ready") || statuses.has("preparing")) {
      orderStatus = orderStatus === "fired" || orderStatus === "preparing" || orderStatus === "ready" ? orderStatus : "preparing";
      if (statuses.has("ready") && ![...statuses].some((s) => ["queued", "fired"].includes(s))) {
        orderStatus = [...statuses].every((s) => s === "ready" || s === "bumped") ? "ready" : "preparing";
      }
    } else if (statuses.has("fired")) {
      orderStatus = "fired";
    }
    let effectiveStatus = item.order.status;
    if (orderStatus !== item.order.status && ["fired", "preparing", "ready"].includes(orderStatus)) {
      // Never roll a closed (completed/voided) order back to a kitchen status.
      if (!["completed", "voided"].includes(item.order.status)) {
        await tx.order.update({ where: { id: item.order.id }, data: { status: orderStatus } });
        effectiveStatus = orderStatus;
      }
    }
    return { kdsStatus: updated.kdsStatus, orderStatus: effectiveStatus };
  });

  await logAudit({
    userId: user.id, branchId: user.branchId, action: "kds.item_status",
    entityType: "OrderItem", entityId: orderItemId,
    before: { kdsStatus: item.kdsStatus }, after: { kdsStatus: status },
  });
  return ok({ itemId: orderItemId, ...result });
}

/** Bump every active item on an order (whole ticket done). */
export async function bumpOrder(input: unknown): Promise<ActionResult<{ orderId: string }>> {
  const user = await requireRole("barista");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = bumpOrderSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const order = await prisma.order.findFirst({
    where: { id: parsed.data.orderId, branchId: user.branchId },
    select: { id: true, status: true },
  });
  if (!order) return fail("Order not found");
  if (order.status === "voided") return fail("Order is voided");
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.updateMany({
      where: { orderId: order.id, kdsStatus: { in: ["queued", "fired", "preparing", "ready", "recalled"] } },
      data: { kdsStatus: "bumped", readyAt: new Date() },
    });
    await tx.order.update({ where: { id: order.id }, data: { status: "ready" } });
  });
  await logAudit({
    userId: user.id, branchId: user.branchId, action: "kds.bump_order",
    entityType: "Order", entityId: order.id,
  });
  return ok({ orderId: order.id });
}

/** Send a bumped/ready item back to preparing (remake). */
export async function recallItem(input: unknown): Promise<ActionResult<{ itemId: string }>> {
  const user = await requireRole("barista");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = recallItemSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const item = await prisma.orderItem.findFirst({
    where: { id: parsed.data.orderItemId, order: { branchId: user.branchId } },
    include: { order: { select: { id: true, status: true } } },
  });
  if (!item) return fail("Item not found");
  if (!["ready", "bumped"].includes(item.kdsStatus)) return fail("Only ready/bumped items can be recalled");
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.update({
      where: { id: item.id }, data: { kdsStatus: "recalled", readyAt: null },
    });
    // Only roll a "ready" order back to preparing — never reopen a completed order.
    if (item.order.status === "ready") {
      await tx.order.update({ where: { id: item.order.id }, data: { status: "preparing" } });
    }
  });
  await logAudit({
    userId: user.id, branchId: user.branchId, action: "kds.recall",
    entityType: "OrderItem", entityId: item.id, before: { kdsStatus: item.kdsStatus },
  });
  return ok({ itemId: item.id });
}

function safeParseModifiers(json: string): Array<{ group: string; option: string; delta: number }> {
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? (arr as Array<{ group: string; option: string; delta: number }>) : [];
  } catch {
    return [];
  }
}
