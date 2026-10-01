"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { ok, okVoid, fail, zodFail, type ActionResult } from "@/lib/action-result";
import { idSchema } from "@/lib/validators";
import {
  createTableSchema,
  updateTableSchema,
  setTableStatusSchema,
} from "@/lib/validations/tables";

const OPEN_ORDER_STATUSES = ["open", "held", "fired", "preparing", "ready"];

export type TableWithOrders = {
  id: string;
  label: string;
  seats: number;
  zone: string;
  status: string;
  posX: number;
  posY: number;
  activeOrderCount: number;
  activeOrders: Array<{ id: string; orderNumber: string; totalKs: number; createdAt: Date }>;
};

/** All tables for the branch with their active orders. Cashier+ can view. */
export async function listTables(): Promise<ActionResult<TableWithOrders[]>> {
  const user = await requireUser();
  if (!user.branchId) return fail("No branch assigned");
  const tables = await prisma.cafeTable.findMany({
    where: { branchId: user.branchId, active: true },
    orderBy: [{ zone: "asc" }, { label: "asc" }],
    include: {
      orders: {
        where: { status: { in: OPEN_ORDER_STATUSES } },
        select: { id: true, orderNumber: true, totalKs: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return ok(
    tables.map((t) => ({
      id: t.id,
      label: t.label,
      seats: t.seats,
      zone: t.zone,
      status: t.status,
      posX: t.posX,
      posY: t.posY,
      activeOrderCount: t.orders.length,
      activeOrders: t.orders,
    }))
  );
}

/** Create a table. Manager+. */
export async function createTable(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("manager", "owner");
  const parsed = createTableSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const d = parsed.data;
  const dup = await prisma.cafeTable.findUnique({
    where: { branchId_label: { branchId: user.branchId, label: d.label } },
  });
  if (dup) return fail("Table label already exists");
  const table = await prisma.cafeTable.create({
    data: { branchId: user.branchId, ...d },
  });
  await logAudit({
    userId: user.id,
    branchId: user.branchId,
    action: "table.create",
    entityType: "table",
    entityId: table.id,
    after: d,
  });
  return ok({ id: table.id });
}

/** Update a table. Manager+. */
export async function updateTable(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("manager", "owner");
  const parsed = updateTableSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { id, ...d } = parsed.data;
  const existing = await prisma.cafeTable.findFirst({ where: { id, branchId: user.branchId } });
  if (!existing) return fail("Table not found");
  if (d.label && d.label !== existing.label) {
    const dup = await prisma.cafeTable.findUnique({
      where: { branchId_label: { branchId: user.branchId, label: d.label } },
    });
    if (dup) return fail("Table label already exists");
  }
  await prisma.cafeTable.update({ where: { id }, data: d });
  await logAudit({
    userId: user.id,
    branchId: user.branchId,
    action: "table.update",
    entityType: "table",
    entityId: id,
    before: { label: existing.label, seats: existing.seats, zone: existing.zone },
    after: d,
  });
  return ok({ id });
}

/**
 * Set table status. Cashier+ for free/reserved/cleaning.
 * "occupied" is normally auto-managed by the orders lifecycle (Team A),
 * but manager+ can override it manually here.
 */
export async function setTableStatus(input: unknown): Promise<ActionResult<{ id: string; status: string }>> {
  const parsed = setTableStatusSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const { id, status } = parsed.data;
  const user =
    status === "occupied" ? await requireRole("manager", "owner") : await requireRole("cashier", "manager", "owner");
  if (!user.branchId) return fail("No branch assigned");
  const existing = await prisma.cafeTable.findFirst({ where: { id, branchId: user.branchId } });
  if (!existing) return fail("Table not found");
  if (status === "free") {
    const openCount = await prisma.order.count({
      where: { tableId: id, status: { in: OPEN_ORDER_STATUSES } },
    });
    if (openCount > 0) return fail("Table still has active orders");
  }
  await prisma.cafeTable.update({ where: { id }, data: { status } });
  await logAudit({
    userId: user.id,
    branchId: user.branchId,
    action: "table.status",
    entityType: "table",
    entityId: id,
    before: { status: existing.status },
    after: { status },
  });
  return ok({ id, status });
}

/** Soft-delete a table. Manager+. Blocked while active orders exist. */
export async function deleteTable(input: unknown): Promise<ActionResult<void>> {
  const user = await requireRole("manager", "owner");
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const existing = await prisma.cafeTable.findFirst({
    where: { id: parsed.data.id, branchId: user.branchId },
  });
  if (!existing) return fail("Table not found");
  const openCount = await prisma.order.count({
    where: { tableId: existing.id, status: { in: OPEN_ORDER_STATUSES } },
  });
  if (openCount > 0) return fail("Cannot delete — table has active orders");
  await prisma.cafeTable.update({ where: { id: existing.id }, data: { active: false } });
  await logAudit({
    userId: user.id,
    branchId: user.branchId,
    action: "table.delete",
    entityType: "table",
    entityId: existing.id,
    before: { label: existing.label },
  });
  return okVoid();
}
