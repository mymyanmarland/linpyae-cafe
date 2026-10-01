"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { ok, fail, zodFail, type ActionResult } from "@/lib/action-result";
import { idSchema, paginationSchema } from "@/lib/validators";
import { normalizeMmPhone } from "@/lib/format";
import {
  createCustomerSchema,
  updateCustomerSchema,
  adjustPointsSchema,
} from "@/lib/validations/customers";

export type CustomerListDTO = {
  id: string;
  name: string;
  nameMy: string | null;
  phone: string;
  tier: string;
  points: number;
  stamps: number;
  visitCount: number;
  totalSpendKs: number;
};

export type CustomerPage = { customers: CustomerListDTO[]; total: number; page: number; pageSize: number };

/** Cashier+ can read/search customers (POS lookup). */
export async function listCustomers(input: unknown): Promise<ActionResult<CustomerPage>> {
  const user = await requireRole("cashier", "manager", "owner");
  const parsed = paginationSchema.safeParse(input ?? {});
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { page, pageSize, search } = parsed.data;
  const where = {
    branchId: user.branchId,
    ...(search
      ? { OR: [{ name: { contains: search } }, { nameMy: { contains: search } }, { phone: { contains: search } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, name: true, nameMy: true, phone: true, tier: true,
        points: true, stamps: true, visitCount: true, totalSpendKs: true,
      },
    }),
  ]);
  return ok({ customers: rows, total, page, pageSize });
}

export type CustomerDetailDTO = CustomerListDTO & {
  email: string | null;
  birthday: string | null;
  notes: string | null;
  createdAt: Date;
  recentOrders: Array<{ id: string; orderNumber: string; totalKs: number; status: string; createdAt: Date }>;
};

export async function getCustomer(input: unknown): Promise<ActionResult<CustomerDetailDTO>> {
  const user = await requireRole("cashier", "manager", "owner");
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const c = await prisma.customer.findFirst({
    where: { id: parsed.data.id, branchId: user.branchId },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, orderNumber: true, totalKs: true, status: true, createdAt: true },
      },
    },
  });
  if (!c) return fail("Customer not found");
  return ok({
    id: c.id,
    name: c.name,
    nameMy: c.nameMy,
    phone: c.phone,
    tier: c.tier,
    points: c.points,
    stamps: c.stamps,
    visitCount: c.visitCount,
    totalSpendKs: c.totalSpendKs,
    email: c.email,
    birthday: c.birthday ? c.birthday.toISOString().slice(0, 10) : null,
    notes: c.notes,
    createdAt: c.createdAt,
    recentOrders: c.orders,
  });
}

function nullify<T extends Record<string, unknown>>(d: T): T {
  const out = { ...d } as Record<string, unknown>;
  for (const k of ["nameMy", "email", "birthday", "notes"]) {
    if (out[k] === "") out[k] = null;
  }
  return out as T;
}

export async function createCustomer(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("cashier", "manager", "owner");
  const parsed = createCustomerSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const phone = normalizeMmPhone(parsed.data.phone);
  if (!phone) return fail("Invalid phone number");
  const dup = await prisma.customer.findUnique({
    where: { branchId_phone: { branchId: user.branchId, phone } },
  });
  if (dup) return fail("A customer with this phone already exists");
  const d = parsed.data;
  const customer = await prisma.customer.create({
    data: {
      branchId: user.branchId,
      ...nullify({ name: d.name, nameMy: d.nameMy, email: d.email, notes: d.notes }),
      phone,
      tier: d.tier,
      birthday: d.birthday ? new Date(`${d.birthday}T00:00:00+06:30`) : null,
    },
  });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "customer.create", entityType: "customer", entityId: customer.id, after: { name: d.name, phone } });
  return ok({ id: customer.id });
}

export async function updateCustomer(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("cashier", "manager", "owner");
  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { id, phone: rawPhone, ...d } = parsed.data;
  const existing = await prisma.customer.findFirst({ where: { id, branchId: user.branchId } });
  if (!existing) return fail("Customer not found");
  let phone: string | undefined;
  if (rawPhone !== undefined) {
    const p = normalizeMmPhone(rawPhone);
    if (!p) return fail("Invalid phone number");
    phone = p;
    if (phone !== existing.phone) {
      const dup = await prisma.customer.findUnique({
        where: { branchId_phone: { branchId: user.branchId, phone } },
      });
      if (dup) return fail("A customer with this phone already exists");
    }
  }
  const data: Record<string, unknown> = nullify({ ...d });
  if (phone !== undefined) data.phone = phone;
  if (d.birthday !== undefined) data.birthday = d.birthday ? new Date(`${d.birthday}T00:00:00+06:30`) : null;
  await prisma.customer.update({ where: { id }, data });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "customer.update", entityType: "customer", entityId: id, after: data });
  return ok({ id });
}

/** Manual loyalty points adjustment. Manager+, audited. Points never go below zero. */
export async function adjustPoints(input: unknown): Promise<ActionResult<{ id: string; points: number }>> {
  const user = await requireRole("manager", "owner");
  const parsed = adjustPointsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { id, delta, reason } = parsed.data;
  const existing = await prisma.customer.findFirst({ where: { id, branchId: user.branchId } });
  if (!existing) return fail("Customer not found");
  const points = Math.max(0, existing.points + delta);
  await prisma.customer.update({ where: { id }, data: { points } });
  await logAudit({
    userId: user.id,
    branchId: user.branchId,
    action: "customer.adjust_points",
    entityType: "customer",
    entityId: id,
    before: { points: existing.points },
    after: { points, delta, reason },
  });
  return ok({ id, points });
}
