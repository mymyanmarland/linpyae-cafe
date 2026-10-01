"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { checkLowStock } from "@/lib/orders";
import { ok, fail, zodFail, type ActionResult } from "@/lib/action-result";
import {
  ingredientSchema,
  updateIngredientSchema,
  stockMovementSchema,
  movementListSchema,
  purchaseOrderSchema,
  ingredientListSchema,
  poListSchema,
} from "@/lib/validations/inventory";
import { idSchema } from "@/lib/validators";
import { yangonDayStart } from "@/lib/format";

export type IngredientDTO = {
  id: string;
  name: string;
  nameMy: string | null;
  unit: string;
  baseUnit: string;
  toBaseFactor: number;
  currentStock: number;
  lowStockThreshold: number;
  costPerBaseUnit: number;
  expiryTracking: boolean;
  active: boolean;
  stockDisplay: number;
  thresholdDisplay: number;
  lowStock: boolean;
  stockValueKs: number;
};

function toDTO(i: {
  id: string; name: string; nameMy: string | null; unit: string; baseUnit: string;
  toBaseFactor: number; currentStock: number; lowStockThreshold: number;
  costPerBaseUnit: number; expiryTracking: boolean; active: boolean;
}): IngredientDTO {
  const factor = i.toBaseFactor || 1;
  return {
    ...i,
    stockDisplay: i.currentStock / factor,
    thresholdDisplay: i.lowStockThreshold / factor,
    lowStock: i.currentStock <= i.lowStockThreshold,
    stockValueKs: Math.round(i.currentStock * i.costPerBaseUnit),
  };
}

// ── Ingredients ─────────────────────────────────────────────────

export async function listIngredients(input: unknown): Promise<
  ActionResult<{ items: IngredientDTO[]; total: number; page: number; pageSize: number }>
> {
  const u = await requireRole("cashier");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = ingredientListSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { page, pageSize, search, lowStockOnly, activeOnly } = parsed.data;
  const where: Record<string, unknown> = { branchId: branchId };
  if (activeOnly) where.active = true;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { nameMy: { contains: search } },
    ];
  }
  let items = await prisma.ingredient.findMany({
    where,
    orderBy: { name: "asc" },
    take: lowStockOnly ? 1000 : pageSize,
    skip: lowStockOnly ? 0 : (page - 1) * pageSize,
  });
  let dtos = items.map(toDTO);
  if (lowStockOnly) {
    dtos = dtos.filter((d) => d.lowStock);
    const total = dtos.length;
    return ok({ items: dtos.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize });
  }
  const total = await prisma.ingredient.count({ where });
  return ok({ items: dtos, total, page, pageSize });
}

export async function createIngredient(input: unknown): Promise<ActionResult<IngredientDTO>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = ingredientSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const d = parsed.data;
  const created = await prisma.ingredient.create({
    data: {
      branchId: branchId,
      name: d.name,
      nameMy: d.nameMy || null,
      unit: d.unit,
      baseUnit: d.baseUnit,
      toBaseFactor: d.toBaseFactor,
      lowStockThreshold: d.lowStockThreshold * d.toBaseFactor,
      costPerBaseUnit: d.costPerBaseUnit,
      expiryTracking: d.expiryTracking,
      active: d.active,
    },
  });
  await logAudit({ userId: u.id, branchId: branchId, action: "ingredient_create", entityType: "Ingredient", entityId: created.id, after: { name: d.name } });
  return ok(toDTO(created));
}

export async function updateIngredient(input: unknown): Promise<ActionResult<IngredientDTO>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = updateIngredientSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { id, ...d } = parsed.data;
  const before = await prisma.ingredient.findFirst({ where: { id, branchId: branchId } });
  if (!before) return fail("Ingredient not found");
  const factor = d.toBaseFactor ?? before.toBaseFactor;
  const updated = await prisma.ingredient.update({
    where: { id },
    data: {
      name: d.name,
      nameMy: d.nameMy === "" ? null : d.nameMy,
      unit: d.unit,
      baseUnit: d.baseUnit,
      toBaseFactor: d.toBaseFactor,
      lowStockThreshold: d.lowStockThreshold !== undefined ? d.lowStockThreshold * factor : undefined,
      costPerBaseUnit: d.costPerBaseUnit,
      expiryTracking: d.expiryTracking,
      active: d.active,
    },
  });
  await logAudit({ userId: u.id, branchId: branchId, action: "ingredient_update", entityType: "Ingredient", entityId: id, before: { name: before.name }, after: { name: updated.name } });
  return ok(toDTO(updated));
}

export async function getLowStock(): Promise<ActionResult<IngredientDTO[]>> {
  const u = await requireRole("cashier");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const items = await prisma.ingredient.findMany({
    where: { branchId: branchId, active: true },
    orderBy: { name: "asc" },
  });
  return ok(items.map(toDTO).filter((d) => d.lowStock));
}

// ── Stock movements ─────────────────────────────────────────────

export async function recordStockMovement(input: unknown): Promise<ActionResult<{ newStock: number }>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = stockMovementSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const d = parsed.data;
  const ing = await prisma.ingredient.findFirst({ where: { id: d.ingredientId, branchId: branchId } });
  if (!ing) return fail("Ingredient not found");
  const baseQty = d.quantity * ing.toBaseFactor;
  const signed = d.type === "in" ? Math.abs(baseQty) : d.type === "adjustment" ? baseQty : -Math.abs(baseQty);
  const unitCostBase = Math.round(d.unitCostKs / ing.toBaseFactor);
  await prisma.stockMovement.create({
    data: {
      branchId: branchId,
      ingredientId: ing.id,
      type: d.type,
      quantity: signed,
      unitCostKs: unitCostBase,
      totalCostKs: d.type === "in" ? Math.round(Math.abs(baseQty) * unitCostBase) : 0,
      supplier: d.supplier || null,
      reason: d.reason || null,
      reference: d.reference || null,
      userId: u.id,
    },
  });
  const updated = await prisma.ingredient.update({
    where: { id: ing.id },
    data: { currentStock: { increment: signed } },
  });
  await checkLowStock(branchId, ing.id);
  await logAudit({
    userId: u.id, branchId: branchId, action: `stock_${d.type}`,
    entityType: "Ingredient", entityId: ing.id,
    before: { stock: ing.currentStock }, after: { stock: updated.currentStock, delta: signed },
  });
  return ok({ newStock: updated.currentStock });
}

export async function listStockMovements(input: unknown): Promise<
  ActionResult<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }>
> {
  const u = await requireRole("cashier");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = movementListSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { page, pageSize, ingredientId, type, from, to } = parsed.data;
  const where: Record<string, unknown> = { branchId: branchId };
  if (ingredientId) where.ingredientId = ingredientId;
  if (type) where.type = type;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: yangonDayStart(from) } : {}),
      ...(to ? { lt: new Date(yangonDayStart(to).getTime() + 24 * 3600 * 1000) } : {}),
    };
  }
  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: { ingredient: { select: { name: true, nameMy: true, baseUnit: true } } },
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.stockMovement.count({ where }),
  ]);
  return ok({
    items: rows.map((m) => ({
      id: m.id, type: m.type, quantity: m.quantity,
      unitCostKs: m.unitCostKs, totalCostKs: m.totalCostKs,
      supplier: m.supplier, reason: m.reason, reference: m.reference,
      createdAt: m.createdAt.toISOString(),
      ingredientName: m.ingredient.name, ingredientNameMy: m.ingredient.nameMy,
      baseUnit: m.ingredient.baseUnit,
    })),
    total, page, pageSize,
  });
}

// ── Purchase orders ─────────────────────────────────────────────

async function nextPoNumber(branchId: string): Promise<string> {
  const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `PO-${dateKey}-`;
  const last = await prisma.purchaseOrder.findFirst({
    where: { branchId, poNumber: { startsWith: prefix } },
    orderBy: { poNumber: "desc" },
  });
  const seq = last ? parseInt(last.poNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export async function listPurchaseOrders(input: unknown): Promise<
  ActionResult<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }>
> {
  const u = await requireRole("cashier");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = poListSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { page, pageSize, status } = parsed.data;
  const where: Record<string, unknown> = { branchId: branchId };
  if (status) where.status = status;
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: { lines: { include: { ingredient: { select: { name: true, nameMy: true, unit: true } } } } },
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return ok({
    items: rows.map((po) => ({
      id: po.id, poNumber: po.poNumber, supplier: po.supplier, status: po.status,
      expectedAt: po.expectedAt?.toISOString() ?? null,
      receivedAt: po.receivedAt?.toISOString() ?? null,
      notes: po.notes, createdAt: po.createdAt.toISOString(),
      totalKs: po.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitCostKs), 0),
      lines: po.lines.map((l) => ({
        id: l.id, ingredientId: l.ingredientId,
        ingredientName: l.ingredient.name, ingredientNameMy: l.ingredient.nameMy,
        quantity: l.quantity, unit: l.unit, unitCostKs: l.unitCostKs,
      })),
    })),
    total, page, pageSize,
  });
}

export async function createPurchaseOrder(input: unknown): Promise<ActionResult<{ id: string; poNumber: string }>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = purchaseOrderSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const d = parsed.data;
  // validate all ingredients belong to this branch
  const ingIds = [...new Set(d.lines.map((l) => l.ingredientId))];
  const ings = await prisma.ingredient.findMany({ where: { id: { in: ingIds }, branchId: branchId } });
  if (ings.length !== ingIds.length) return fail("One or more ingredients not found");
  const byId = new Map(ings.map((i) => [i.id, i]));
  const poNumber = await nextPoNumber(branchId);
  const po = await prisma.purchaseOrder.create({
    data: {
      branchId: branchId,
      poNumber,
      supplier: d.supplier,
      status: "ordered",
      expectedAt: d.expectedAt ? new Date(`${d.expectedAt}T00:00:00+06:30`) : null,
      notes: d.notes || null,
      userId: u.id,
      lines: {
        create: d.lines.map((l) => ({
          ingredientId: l.ingredientId,
          quantity: l.quantity,
          unit: byId.get(l.ingredientId)!.unit,
          unitCostKs: l.unitCostKs,
        })),
      },
    },
  });
  await logAudit({ userId: u.id, branchId: branchId, action: "po_create", entityType: "PurchaseOrder", entityId: po.id, after: { poNumber, supplier: d.supplier, lines: d.lines.length } });
  return ok({ id: po.id, poNumber });
}

export async function receivePurchaseOrder(input: unknown): Promise<ActionResult<{ received: number }>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid id");
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: parsed.data, branchId: branchId },
    include: { lines: { include: { ingredient: true } } },
  });
  if (!po) return fail("Purchase order not found");
  if (po.status === "received") return fail("PO already received");
  if (po.status === "cancelled") return fail("PO is cancelled");
  await prisma.$transaction(async (tx) => {
    for (const line of po.lines) {
      const baseQty = line.quantity * line.ingredient.toBaseFactor;
      const unitCostBase = Math.round(line.unitCostKs / line.ingredient.toBaseFactor);
      await tx.stockMovement.create({
        data: {
          branchId: branchId,
          ingredientId: line.ingredientId,
          type: "in",
          quantity: baseQty,
          unitCostKs: unitCostBase,
          totalCostKs: Math.round(baseQty * unitCostBase),
          supplier: po.supplier,
          reference: po.poNumber,
          userId: u.id,
        },
      });
      await tx.ingredient.update({
        where: { id: line.ingredientId },
        data: { currentStock: { increment: baseQty } },
      });
    }
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "received", receivedAt: new Date() },
    });
  });
  for (const line of po.lines) await checkLowStock(branchId, line.ingredientId);
  await logAudit({ userId: u.id, branchId: branchId, action: "po_receive", entityType: "PurchaseOrder", entityId: po.id, after: { poNumber: po.poNumber } });
  return ok({ received: po.lines.length });
}

export async function cancelPurchaseOrder(input: unknown): Promise<ActionResult<void>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid id");
  const po = await prisma.purchaseOrder.findFirst({ where: { id: parsed.data, branchId: branchId } });
  if (!po) return fail("Purchase order not found");
  if (po.status === "received") return fail("Cannot cancel a received PO");
  if (po.status === "cancelled") return fail("PO already cancelled");
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: "cancelled" } });
  await logAudit({ userId: u.id, branchId: branchId, action: "po_cancel", entityType: "PurchaseOrder", entityId: po.id, before: { status: po.status }, after: { status: "cancelled" } });
  return ok(undefined as void);
}
