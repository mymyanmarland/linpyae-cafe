"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, fail, zodFail, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { yangonDayStart } from "@/lib/format";
import {
  listOrdersSchema,
  getOrderSchema,
  updateOrderStatusSchema,
  type ListOrdersInput,
} from "@/lib/validations/orders";
import { completeOrderAndSettle } from "./pos";
import type { OrderSummary } from "./pos";

export type OrderListItem = {
  id: string;
  orderNumber: string;
  queueNumber: number | null;
  type: string;
  status: string;
  totalKs: number;
  paidKs: number;
  tableLabel: string | null;
  customerName: string | null;
  itemCount: number;
  createdAt: string;
  createdByName: string | null;
};

export type OrderListResult = {
  orders: OrderListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const ACTIVE_STATUSES = ["open", "held", "fired", "preparing", "ready"];

/** Paginated, filterable order list for SWR tables. */
export async function listOrders(input: unknown): Promise<ActionResult<OrderListResult>> {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = listOrdersSchema.safeParse(input ?? {});
  if (!parsed.success) return zodFail(parsed.error);
  const q: ListOrdersInput = parsed.data;
  const branchId = user.branchId;

  const where: Record<string, unknown> = { branchId };
  if (q.status === "active") where.status = { in: ACTIVE_STATUSES };
  else if (q.status) where.status = q.status;
  if (q.type) where.type = q.type;
  if (q.date) {
    const start = yangonDayStart(q.date);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    where.createdAt = { gte: start, lt: end };
  }
  if (q.search) {
    where.OR = [
      { orderNumber: { contains: q.search } },
      { customerName: { contains: q.search } },
      { customerPhone: { contains: q.search } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.order.count({ where: where as never }),
    prisma.order.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true, orderNumber: true, queueNumber: true, type: true, status: true,
        totalKs: true, paidKs: true, customerName: true, createdAt: true,
        table: { select: { label: true } },
        createdBy: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  return ok({
    orders: rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      queueNumber: o.queueNumber,
      type: o.type,
      status: o.status,
      totalKs: o.totalKs,
      paidKs: o.paidKs,
      tableLabel: o.table?.label ?? null,
      customerName: o.customerName,
      itemCount: o._count.items,
      createdAt: o.createdAt.toISOString(),
      createdByName: o.createdBy?.name ?? null,
    })),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  });
}

/** Full order detail (items, payments, refunds, tips). Re-export of the POS detail reader. */
export async function getOrder(input: unknown) {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = getOrderSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const order = await prisma.order.findFirst({
    where: { id: parsed.data.orderId, branchId: user.branchId },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      refunds: { orderBy: { createdAt: "asc" } },
      tips: true,
      table: { select: { label: true, zone: true } },
      customer: { select: { id: true, name: true, nameMy: true, phone: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!order) return fail("Order not found");
  return ok(order);
}

/**
 * Manual status moves from the orders list.
 * "completed" runs the full settlement (inventory once, loyalty, table free).
 * "voided" is manager-only and blocked when money changed hands.
 */
export async function updateOrderStatus(input: unknown): Promise<ActionResult<OrderSummary>> {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = updateOrderStatusSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const { orderId, status, reason } = parsed.data;

  if (status === "voided") {
    // Voids are manager+ only
    await requireRole("manager");
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, branchId: user.branchId },
    include: { table: { select: { label: true } } },
  });
  if (!order) return fail("Order not found");
  if (order.status === "completed" || order.status === "voided") return fail("Order is already closed");

  if (status === "completed") {
    if (order.paidKs < order.totalKs) return fail("Order is not fully paid");
    const settled = await completeOrderAndSettle(orderId, user.id);
    if (!settled) return fail("Order is already closed");
    return ok({
      id: settled.id, orderNumber: settled.orderNumber, queueNumber: settled.queueNumber,
      type: settled.type, status: settled.status, totalKs: settled.totalKs,
      paidKs: settled.paidKs, changeKs: settled.changeKs,
      tableLabel: settled.table?.label ?? null,
    });
  }

  if (status === "voided" && order.paidKs > 0) {
    return fail("orders.cannotVoidPaid");
  }

  const data: Record<string, unknown> = { status };
  if (status === "fired") data.firedAt = new Date();
  if (status === "voided" && reason) {
    data.notes = order.notes ? `${order.notes}\n[VOID] ${reason}` : `[VOID] ${reason}`;
  }
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.order.update({
      where: { id: orderId }, data: data as never,
      include: { table: { select: { label: true } } },
    });
    if (status === "voided" && order.tableId) {
      const otherOpen = await tx.order.count({
        where: { tableId: order.tableId, id: { not: orderId }, status: { notIn: ["completed", "voided"] } },
      });
      if (otherOpen === 0) {
        await tx.cafeTable.update({ where: { id: order.tableId }, data: { status: "free" } });
      }
    }
    return u;
  });
  await logAudit({
    userId: user.id, branchId: user.branchId, action: "order.status",
    entityType: "Order", entityId: orderId,
    before: { status: order.status }, after: { status, reason: reason || undefined },
  });
  return ok({
    id: updated.id, orderNumber: updated.orderNumber, queueNumber: updated.queueNumber,
    type: updated.type, status: updated.status, totalKs: updated.totalKs,
    paidKs: updated.paidKs, changeKs: updated.changeKs,
    tableLabel: updated.table?.label ?? null,
  });
}
