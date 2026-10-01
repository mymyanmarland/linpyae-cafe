"use server";

import { prisma } from "@/lib/db";
import { requireRole, requireUser, roleRank, verifyPin } from "@/lib/session";
import { ok, fail, zodFail, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import {
  computeTotals,
  lineTotalFor,
  nextOrderNumber,
  nextQueueNumber,
  deductInventory,
  checkLowStock,
} from "@/lib/orders";
import { getBranchSettings } from "@/lib/settings";
import {
  posCreateOrderSchema,
  holdOrderSchema,
  fireOrderSchema,
  addPaymentSchema,
  applyDiscountSchema,
  voidOrderSchema,
  createRefundSchema,
  verifyManagerPinSchema,
  attachCustomerSchema,
  lookupCustomerSchema,
  normalizeOrderType,
  normalizeDiscountType,
} from "@/lib/validations/pos";
import { getOrderSchema } from "@/lib/validations/orders";

// ── Types returned to the client (plain JSON, no Prisma models) ──
export type PosMenuData = {
  categories: Array<{ id: string; name: string; nameMy: string | null; sortOrder: number }>;
  items: Array<{
    id: string;
    categoryId: string | null;
    name: string;
    nameMy: string | null;
    priceKs: number;
    station: string;
    sortOrder: number;
  }>;
  modifierGroups: Array<{
    id: string;
    name: string;
    nameMy: string | null;
    kind: string;
    required: boolean;
    multiSelect: boolean;
    sortOrder: number;
    itemIds: string[];
    options: Array<{ id: string; name: string; nameMy: string | null; priceDeltaKs: number }>;
  }>;
  tables: Array<{ id: string; label: string; zone: string; seats: number; status: string }>;
  settings: { taxRate: number; taxInclusive: boolean; paymentsEnabled: string[] };
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  queueNumber: number | null;
  type: string;
  status: string;
  totalKs: number;
  paidKs: number;
  changeKs: number;
  tableLabel: string | null;
};

/** Menu + tables + settings for the POS screen. */
export async function getPosData(): Promise<ActionResult<PosMenuData>> {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const branchId = user.branchId;
  const [categories, items, groups, links, tables, settings] = await Promise.all([
    prisma.category.findMany({
      where: { branchId, active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, nameMy: true, sortOrder: true },
    }),
    prisma.menuItem.findMany({
      where: { branchId, active: true },
      orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
      select: {
        id: true, categoryId: true, name: true, nameMy: true,
        priceKs: true, station: true, sortOrder: true,
      },
    }),
    prisma.modifierGroup.findMany({
      where: { branchId },
      orderBy: { sortOrder: "asc" },
      include: {
        options: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true, nameMy: true, priceDeltaKs: true },
        },
      },
    }),
    prisma.menuItemModifier.findMany({
      where: { menuItem: { branchId } },
      select: { menuItemId: true, groupId: true },
    }),
    prisma.cafeTable.findMany({
      where: { branchId, active: true },
      orderBy: [{ zone: "asc" }, { label: "asc" }],
      select: { id: true, label: true, zone: true, seats: true, status: true },
    }),
    getBranchSettings(branchId),
  ]);
  const itemIdsByGroup = new Map<string, string[]>();
  for (const l of links) {
    const arr = itemIdsByGroup.get(l.groupId) ?? [];
    arr.push(l.menuItemId);
    itemIdsByGroup.set(l.groupId, arr);
  }
  return ok({
    categories,
    items,
    modifierGroups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      nameMy: g.nameMy,
      kind: g.kind,
      required: g.required,
      multiSelect: g.multiSelect,
      sortOrder: g.sortOrder,
      itemIds: itemIdsByGroup.get(g.id) ?? [],
      options: g.options,
    })),
    tables,
    settings: {
      taxRate: settings.taxRate,
      taxInclusive: settings.taxInclusive,
      paymentsEnabled: settings.paymentsEnabled,
    },
  });
}

type ParsedModifier = { group: string; option: string; delta: number };

function parseModifiers(json: string): ParsedModifier[] {
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (m): m is ParsedModifier =>
          !!m && typeof m === "object" && typeof (m as ParsedModifier).delta === "number"
      )
      .map((m) => ({
        group: String((m as ParsedModifier).group ?? ""),
        option: String((m as ParsedModifier).option ?? ""),
        delta: Math.max(0, Math.round((m as ParsedModifier).delta)),
      }));
  } catch {
    return [];
  }
}

function toSummary(o: {
  id: string; orderNumber: string; queueNumber: number | null; type: string;
  status: string; totalKs: number; paidKs: number; changeKs: number;
  table: { label: string } | null;
}): OrderSummary {
  return {
    id: o.id, orderNumber: o.orderNumber, queueNumber: o.queueNumber, type: o.type,
    status: o.status, totalKs: o.totalKs, paidKs: o.paidKs, changeKs: o.changeKs,
    tableLabel: o.table?.label ?? null,
  };
}

/** Create an order from the POS cart. Optionally takes payment in the same call. */
export async function createOrder(input: unknown): Promise<ActionResult<OrderSummary>> {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = posCreateOrderSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const data = parsed.data;
  const branchId = user.branchId;
  const type = normalizeOrderType(data.type);

  if (type === "dinein" && !data.tableId) return fail("pos.requiresTable");

  // Load + validate menu items (server-side pricing — never trust client totals)
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: data.items.map((i) => i.menuItemId) }, branchId, active: true },
  });
  if (menuItems.length !== data.items.length) return fail("Some menu items are unavailable");
  const byId = new Map(menuItems.map((m) => [m.id, m]));

  const lines = data.items.map((it) => {
    const m = byId.get(it.menuItemId)!;
    const modifiers = parseModifiers(it.modifiersJson);
    return {
      menuItemId: m.id,
      name: m.name,
      nameMy: m.nameMy,
      station: m.station,
      quantity: it.qty,
      unitPriceKs: m.priceKs,
      modifiers,
      modifiersTotalKs: modifiers.reduce((s, x) => s + x.delta, 0),
      notes: it.notes,
    };
  });
  const settings = await getBranchSettings(branchId);
  const discountTypeDb = normalizeDiscountType(data.discountType);
  const totals = computeTotals(lines.map((l) => ({ lineTotalKs: lineTotalFor({
    menuItemId: l.menuItemId, quantity: l.quantity, unitPriceKs: l.unitPriceKs,
    modifiers: l.modifiers, notes: l.notes,
  }) })), {
    discountType: discountTypeDb ?? undefined,
    discountValue: data.discountValue,
    taxRate: settings.taxRate,
    taxInclusive: settings.taxInclusive,
  });

  // Discount approval check (percent > 20 or fixed > 10,000 Ks)
  let discountApprovedBy: string | null = null;
  const needsApproval =
    (data.discountType === "percent" && data.discountValue > 20) ||
    (data.discountType === "amount" && data.discountValue > 10000);
  if (needsApproval) {
    if (!data.approverPin) return fail("pos.approvalNeeded");
    const approver = await verifyManagerPinInternal(data.approverPin, branchId);
    if (!approver) return fail("pos.invalidPin");
    discountApprovedBy = approver.id;
  }

  // Table check for dine-in
  let tableLabel: string | null = null;
  if (type === "dinein" && data.tableId) {
    const table = await prisma.cafeTable.findFirst({
      where: { id: data.tableId, branchId, active: true },
    });
    if (!table) return fail("Table not found");
    if (table.status !== "free") return fail("pos.tableOccupied");
    tableLabel = table.label;
  }

  const orderNumber = await nextOrderNumber(branchId);
  const queueNumber = type === "takeaway" ? await nextQueueNumber(branchId) : null;

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        branchId,
        orderNumber,
        type,
        status: "open",
        tableId: type === "dinein" ? data.tableId : null,
        customerId: data.customerId ?? null,
        customerName: data.customerName || null,
        customerPhone: data.customerPhone || null,
        queueNumber,
        subtotalKs: totals.subtotalKs,
        discountType: discountTypeDb,
        discountValue: Math.round(data.discountValue),
        discountKs: totals.discountKs,
        discountApprovedBy,
        taxKs: totals.taxKs,
        totalKs: totals.totalKs,
        notes: data.notes || null,
        createdById: user.id,
        items: {
          create: lines.map((l) => ({
            menuItemId: l.menuItemId,
            name: l.name,
            nameMy: l.nameMy,
            quantity: l.quantity,
            unitPriceKs: l.unitPriceKs,
            modifiersJson: JSON.stringify(l.modifiers),
            modifiersTotalKs: l.modifiersTotalKs,
            lineTotalKs: lineTotalFor({
              menuItemId: l.menuItemId, quantity: l.quantity, unitPriceKs: l.unitPriceKs,
              modifiers: l.modifiers, notes: l.notes,
            }),
            station: l.station,
            kdsStatus: "queued",
            notes: l.notes || null,
          })),
        },
      },
      include: { table: { select: { label: true } } },
    });
    if (type === "dinein" && data.tableId) {
      await tx.cafeTable.update({ where: { id: data.tableId }, data: { status: "occupied" } });
    }
    return created;
  });

  await logAudit({
    userId: user.id, branchId, action: "order.create", entityType: "Order", entityId: order.id,
    after: { orderNumber, type, totalKs: totals.totalKs, tableLabel },
  });

  // Optional immediate payment (pay-now flow)
  let summary = toSummary(order);
  if (data.paidNow) {
    const payRes = await addPaymentInternal(user, {
      orderId: order.id,
      method: data.paidNow.method,
      amount: data.paidNow.amount,
      reference: data.paidNow.reference,
      tipAmount: data.paidNow.tipAmount,
    });
    if (!payRes.ok) return fail(payRes.error);
    summary = payRes.data.summary;
  }
  return ok(summary);
}

export async function holdOrder(input: unknown): Promise<ActionResult<OrderSummary>> {
  const user = await requireRole("cashier");
  const parsed = holdOrderSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const order = await getBranchOrder(user, parsed.data.orderId);
  if (!order) return fail("Order not found");
  if (order.status !== "open") return fail("Only open orders can be held");
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "held", heldAt: new Date() },
    include: { table: { select: { label: true } } },
  });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "order.hold", entityType: "Order", entityId: order.id });
  return ok(toSummary(updated));
}

export async function fireOrder(input: unknown): Promise<ActionResult<OrderSummary>> {
  const user = await requireRole("cashier");
  const parsed = fireOrderSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const order = await getBranchOrder(user, parsed.data.orderId);
  if (!order) return fail("Order not found");
  if (!["open", "held"].includes(order.status)) return fail("Order cannot be fired");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: "fired", firedAt: now } });
    await tx.orderItem.updateMany({
      where: { orderId: order.id, kdsStatus: "queued" },
      data: { kdsStatus: "fired", firedAt: now },
    });
  });
  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: order.id }, include: { table: { select: { label: true } } },
  });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "order.fire", entityType: "Order", entityId: order.id });
  return ok(toSummary(updated));
}

// ── Payments ──────────────────────────────────────────────────────

async function addPaymentInternal(
  user: { id: string; branchId: string | null },
  data: { orderId: string; method: string; amount: number; reference: string; tipAmount: number; tenderedKs?: number }
): Promise<ActionResult<{ summary: OrderSummary; changeKs: number }>> {
  const branchId = user.branchId!;
  const order = await getBranchOrder(user, data.orderId);
  if (!order) return fail("Order not found");
  if (["voided", "completed"].includes(order.status)) return fail("Order is already closed");
  if (data.amount <= 0) return fail("Payment amount must be positive");

  const changeKs = Math.max(0, (data.tenderedKs ?? data.amount) - data.amount);
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: order.id,
        method: data.method,
        amountKs: data.amount,
        reference: data.reference || null,
        status: "confirmed",
        confirmedAt: now,
      },
    });
    if (data.tipAmount > 0) {
      await tx.tip.create({ data: { orderId: order.id, amountKs: data.tipAmount, userId: user.id } });
    }
    const paidKs = order.paidKs + data.amount;
    return tx.order.update({
      where: { id: order.id },
      data: { paidKs, changeKs: Math.max(0, paidKs - order.totalKs) },
      include: { table: { select: { label: true } } },
    });
  });

  await logAudit({
    userId: user.id, branchId, action: "order.payment", entityType: "Order", entityId: order.id,
    after: { method: data.method, amountKs: data.amount, tipKs: data.tipAmount },
  });

  // Fully paid → push to kitchen, then complete + settle (inventory, loyalty, table)
  let summary = toSummary(updated);
  if (updated.paidKs >= updated.totalKs) {
    if (["open", "held"].includes(order.status)) {
      // Paid before the kitchen ever saw it (POS pay-now): auto-fire the items
      // onto the KDS board so paid orders don't bypass the kitchen.
      const fireAt = new Date();
      await prisma.orderItem.updateMany({
        where: { orderId: order.id, kdsStatus: "queued" },
        data: { kdsStatus: "fired", firedAt: fireAt },
      });
      await prisma.order.update({ where: { id: order.id }, data: { firedAt: fireAt } });
      await logAudit({
        userId: user.id, branchId, action: "order.autofire",
        entityType: "Order", entityId: order.id,
      });
    }
    const completed = await completeOrderAndSettle(order.id, user.id);
    if (completed) summary = toSummary(completed);
  }
  return ok({ summary, changeKs });
}

export async function addPayment(input: unknown): Promise<ActionResult<{ summary: OrderSummary; changeKs: number }>> {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = addPaymentSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  return addPaymentInternal(user, parsed.data);
}

// ── Discounts / voids / refunds ───────────────────────────────────

/** Internal: check PIN against active manager/owner accounts in the branch. */
async function verifyManagerPinInternal(
  pin: string, branchId: string
): Promise<{ id: string; name: string } | null> {
  const managers = await prisma.user.findMany({
    where: { branchId, active: true, role: { in: ["manager", "owner"] }, pinHash: { not: null } },
    select: { id: true, name: true, pinHash: true },
  });
  for (const m of managers) {
    if (m.pinHash && verifyPin(pin, m.pinHash)) return { id: m.id, name: m.name };
  }
  return null;
}

export async function verifyManagerPin(input: unknown): Promise<ActionResult<{ userId: string; name: string }>> {
  const user = await requireUser();
  if (!user.branchId) return fail("No branch assigned");
  const parsed = verifyManagerPinSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const match = await verifyManagerPinInternal(parsed.data.pin, user.branchId);
  if (!match) {
    await logAudit({ userId: user.id, branchId: user.branchId, action: "auth.manager_pin_failed", entityType: "User", entityId: user.id });
    return fail("pos.invalidPin");
  }
  await logAudit({ userId: user.id, branchId: user.branchId, action: "auth.manager_pin_ok", entityType: "User", entityId: match.id });
  return ok({ userId: match.id, name: match.name });
}

export async function applyDiscount(input: unknown): Promise<ActionResult<OrderSummary>> {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = applyDiscountSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const data = parsed.data;
  const order = await getBranchOrder(user, data.orderId);
  if (!order) return fail("Order not found");
  if (["voided", "completed"].includes(order.status)) return fail("Order is already closed");
  const paid = await prisma.payment.count({ where: { orderId: order.id, status: "confirmed" } });
  if (paid > 0) return fail("Discount cannot change after payment");

  const needsApproval = (data.discountType === "percent" && data.discountValue > 20) || (data.discountType === "amount" && data.discountValue > 10000);
  let discountApprovedBy: string | null = null;
  if (needsApproval) {
    if (!data.approverPin) return fail("pos.approvalNeeded");
    const approver = await verifyManagerPinInternal(data.approverPin, user.branchId);
    if (!approver) return fail("pos.invalidPin");
    discountApprovedBy = approver.id;
  }
  if (data.discountType === "percent" && data.discountValue > 100) return fail("Discount percent cannot exceed 100");

  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  const settings = await getBranchSettings(user.branchId);
  const discountTypeDb = normalizeDiscountType(data.discountType);
  const totals = computeTotals(items.map((i) => ({ lineTotalKs: i.lineTotalKs })), {
    discountType: discountTypeDb ?? undefined, discountValue: data.discountValue,
    taxRate: settings.taxRate, taxInclusive: settings.taxInclusive,
  });
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      discountType: discountTypeDb, discountValue: Math.round(data.discountValue),
      discountKs: totals.discountKs, discountApprovedBy, taxKs: totals.taxKs, totalKs: totals.totalKs,
    },
    include: { table: { select: { label: true } } },
  });
  await logAudit({
    userId: user.id, branchId: user.branchId, action: "order.discount", entityType: "Order", entityId: order.id,
    after: { discountType: data.discountType, discountValue: data.discountValue, approvedBy: discountApprovedBy },
  });
  return ok(toSummary(updated));
}

export async function voidOrder(input: unknown): Promise<ActionResult<OrderSummary>> {
  // Any cashier+ may initiate a void; non-managers must supply a manager PIN
  // (the UI turns pos.approvalNeeded into a PIN prompt instead of a redirect).
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = voidOrderSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const data = parsed.data;
  const order = await getBranchOrder(user, data.orderId);
  if (!order) return fail("Order not found");
  if (order.status === "voided") return fail("Order already voided");
  if (order.status === "completed") return fail("Completed orders cannot be voided — issue a refund");
  if (order.paidKs > 0) return fail("orders.cannotVoidPaid");

  // Manager approval: managers/owners void directly; everyone else needs a manager PIN.
  const isManager = roleRank(user.role) >= roleRank("manager");
  let approvedBy: string | null = isManager ? user.id : null;
  if (!isManager || order.totalKs > 20000) {
    if (!data.approverPin) return fail("pos.approvalNeeded");
    const approver = await verifyManagerPinInternal(data.approverPin, user.branchId);
    if (!approver) return fail("pos.invalidPin");
    approvedBy = approver.id;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const v = await tx.order.update({
      where: { id: order.id },
      data: { status: "voided", notes: order.notes ? `${order.notes}\n[VOID] ${data.reason}` : `[VOID] ${data.reason}` },
      include: { table: { select: { label: true } } },
    });
    await freeTableIfEmpty(tx, order.tableId, order.id);
    return v;
  });
  await logAudit({
    userId: user.id, branchId: user.branchId, action: "order.void", entityType: "Order", entityId: order.id,
    before: { status: order.status, totalKs: order.totalKs }, after: { reason: data.reason, approvedBy },
  });
  return ok(toSummary(updated));
}

export async function createRefund(input: unknown): Promise<ActionResult<{ refundId: string; summary: OrderSummary }>> {
  // Any cashier+ may initiate a refund; non-managers must supply a manager PIN
  // (the UI turns pos.approvalNeeded into a PIN prompt instead of a redirect).
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = createRefundSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const data = parsed.data;
  const order = await getBranchOrder(user, data.orderId);
  if (!order) return fail("Order not found");
  if (order.status === "voided") return fail("Order is voided");

  const refundedSoFar = await prisma.refund.aggregate({
    where: { orderId: order.id }, _sum: { amountKs: true },
  });
  const alreadyRefunded = refundedSoFar._sum.amountKs ?? 0;
  if (data.amountKs > order.paidKs - alreadyRefunded) return fail("Refund exceeds paid amount");

  // Manager approval: managers/owners refund directly; everyone else needs a manager PIN.
  const isManager = roleRank(user.role) >= roleRank("manager");
  let approvedById: string | null = isManager ? user.id : null;
  if (!isManager || data.amountKs > 20000) {
    if (!data.approverPin) return fail("pos.approvalNeeded");
    const approver = await verifyManagerPinInternal(data.approverPin, user.branchId);
    if (!approver) return fail("pos.invalidPin");
    approvedById = approver.id;
  }

  let paymentId: string | null = data.paymentId ?? null;
  if (paymentId) {
    const p = await prisma.payment.findFirst({ where: { id: paymentId, orderId: order.id } });
    if (!p) return fail("Payment not found");
  }

  const refund = await prisma.$transaction(async (tx) => {
    const r = await tx.refund.create({
      data: {
        orderId: order.id, paymentId, amountKs: data.amountKs, reason: data.reason,
        method: data.method, userId: user.id, approvedById,
      },
    });
    await tx.order.update({ where: { id: order.id }, data: { paidKs: { decrement: data.amountKs } } });
    return r;
  });
  // Refunds do NOT restock inventory (contract).
  await logAudit({
    userId: user.id, branchId: user.branchId, action: "order.refund", entityType: "Refund", entityId: refund.id,
    after: { orderId: order.id, amountKs: data.amountKs, reason: data.reason, approvedById },
  });
  const summary = toSummary(await prisma.order.findUniqueOrThrow({
    where: { id: order.id }, include: { table: { select: { label: true } } },
  }));
  return ok({ refundId: refund.id, summary });
}

/**
 * Void a completed (paid) order: issues a full refund of the remaining paid
 * balance and marks the order voided. Always needs manager approval —
 * managers/owners directly, other roles via a manager PIN (pos.approvalNeeded).
 * Inventory is NOT restocked (same contract as refunds).
 */
export async function voidCompletedOrder(input: unknown): Promise<ActionResult<OrderSummary>> {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = voidOrderSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const data = parsed.data;
  const order = await getBranchOrder(user, data.orderId);
  if (!order) return fail("Order not found");
  if (order.status !== "completed") return fail("Only completed orders can be voided this way");

  const isManager = roleRank(user.role) >= roleRank("manager");
  let approvedById: string | null = isManager ? user.id : null;
  if (!isManager) {
    if (!data.approverPin) return fail("pos.approvalNeeded");
    const approver = await verifyManagerPinInternal(data.approverPin, user.branchId);
    if (!approver) return fail("pos.invalidPin");
    approvedById = approver.id;
  }

  const refundedSoFar = await prisma.refund.aggregate({
    where: { orderId: order.id }, _sum: { amountKs: true },
  });
  const refundable = order.paidKs - (refundedSoFar._sum.amountKs ?? 0);
  const firstPayment = await prisma.payment.findFirst({
    where: { orderId: order.id, status: "confirmed" },
    orderBy: { createdAt: "asc" },
    select: { method: true },
  });

  const updated = await prisma.$transaction(async (tx) => {
    if (refundable > 0) {
      await tx.refund.create({
        data: {
          orderId: order.id,
          amountKs: refundable,
          reason: data.reason,
          method: firstPayment?.method ?? "cash",
          userId: user.id,
          approvedById,
        },
      });
    }
    const v = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "voided",
        paidKs: { decrement: refundable },
        notes: order.notes ? `${order.notes}\n[VOID] ${data.reason}` : `[VOID] ${data.reason}`,
      },
      include: { table: { select: { label: true } } },
    });
    await freeTableIfEmpty(tx, order.tableId, order.id);
    return v;
  });
  await logAudit({
    userId: user.id, branchId: user.branchId, action: "order.void_completed",
    entityType: "Order", entityId: order.id,
    before: { status: "completed", paidKs: order.paidKs },
    after: { status: "voided", refundedKs: refundable, reason: data.reason, approvedById },
  });
  return ok(toSummary(updated));
}

// ── Customer attach / lookup (order-scoped) ───────────────────────

export async function attachCustomer(input: unknown): Promise<ActionResult<OrderSummary>> {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = attachCustomerSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const order = await getBranchOrder(user, parsed.data.orderId);
  if (!order) return fail("Order not found");
  if (["voided", "completed"].includes(order.status)) return fail("Order is already closed");
  let customer: { id: string; name: string; phone: string } | null = null;
  if (parsed.data.customerId) {
    customer = await prisma.customer.findFirst({
      where: { id: parsed.data.customerId, branchId: user.branchId },
      select: { id: true, name: true, phone: true },
    });
    if (!customer) return fail("Customer not found");
  }
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? order.customerName,
      customerPhone: customer?.phone ?? order.customerPhone,
    },
    include: { table: { select: { label: true } } },
  });
  return ok(toSummary(updated));
}

export async function lookupCustomer(input: unknown) {
  const user = await requireRole("cashier");
  if (!user.branchId) return fail("No branch assigned");
  const parsed = lookupCustomerSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const q = parsed.data.query.trim();
  const customers = await prisma.customer.findMany({
    where: {
      branchId: user.branchId,
      OR: [
        { phone: { contains: q } },
        { name: { contains: q } },
        { nameMy: { contains: q } },
      ],
    },
    take: 8,
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, nameMy: true, phone: true, points: true, stamps: true },
  });
  return ok(customers);
}

// ── Shared completion / settlement (also used by orders.ts) ──────
// NOTE: "use server" modules may only export async functions.

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function freeTableIfEmpty(tx: Tx, tableId: string | null, excludeOrderId: string) {
  if (!tableId) return;
  const otherOpen = await tx.order.count({
    where: { tableId, id: { not: excludeOrderId }, status: { notIn: ["completed", "voided"] } },
  });
  if (otherOpen === 0) {
    await tx.cafeTable.update({ where: { id: tableId }, data: { status: "free" } });
  }
}

/**
 * Mark an order completed and settle it: deduct inventory exactly once
 * (guarded by StockMovement reference), apply loyalty, free the table.
 * Returns the updated order, or null if it was already completed.
 */
export async function completeOrderAndSettle(orderId: string, actorUserId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { menuItemId: true, quantity: true } },
      table: { select: { label: true } },
    },
  });
  if (!order || order.status === "completed" || order.status === "voided") return null;

  const settled = await prisma.$transaction(async (tx) => {
    // Idempotency guard: inventory deducted exactly once per order
    const already = await tx.stockMovement.findFirst({
      where: { reference: `order:${orderId}`, type: "out" },
      select: { id: true },
    });
    if (!already) {
      await deductInventory(tx, orderId, order.items, actorUserId);
    }
    // Loyalty
    if (order.customerId) {
      const settings = await getBranchSettings(order.branchId);
      const perKs = settings.pointsPerKs > 0 ? settings.pointsPerKs : 100;
      await tx.customer.update({
        where: { id: order.customerId },
        data: {
          stamps: { increment: 1 },
          points: { increment: Math.floor(order.totalKs / perKs) },
          visitCount: { increment: 1 },
          totalSpendKs: { increment: order.totalKs },
        },
      });
    }
    const updated = await tx.order.update({
      where: { id: orderId },
      data: { status: "completed", completedAt: new Date() },
      include: { table: { select: { label: true } } },
    });
    await freeTableIfEmpty(tx, order.tableId, orderId);
    return updated;
  });

  // Low-stock alerts (outside tx)
  const recipes = await prisma.recipe.findMany({
    where: { menuItemId: { in: order.items.map((i) => i.menuItemId).filter(Boolean) as string[] } },
    select: { ingredientId: true },
  });
  for (const r of new Set(recipes.map((x) => x.ingredientId))) {
    await checkLowStock(order.branchId, r);
  }
  await logAudit({
    userId: actorUserId, branchId: order.branchId, action: "order.complete",
    entityType: "Order", entityId: orderId, after: { totalKs: order.totalKs },
  });
  return settled;
}

// ── Internal helpers ──────────────────────────────────────────────

async function getBranchOrder(
  user: { branchId: string | null },
  orderId: string
) {
  if (!user.branchId) return null;
  return prisma.order.findFirst({ where: { id: orderId, branchId: user.branchId } });
}

/** Full order detail for receipts / dialogs. */
export async function getOrderDetail(input: unknown) {
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
  const branch = await prisma.branch.findUnique({
    where: { id: user.branchId },
    select: { name: true, nameMy: true, address: true, addressMy: true, phone: true },
  });
  const settings = await getBranchSettings(user.branchId);
  return ok({ order, branch, settings });
}
