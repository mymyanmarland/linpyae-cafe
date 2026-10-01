"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { ok, okVoid, fail, zodFail, type ActionResult } from "@/lib/action-result";
import { idSchema } from "@/lib/validators";
import {
  createCategorySchema,
  updateCategorySchema,
  createModifierGroupSchema,
  updateModifierGroupSchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  menuItemFilterSchema,
} from "@/lib/validations/menu";

// ── Categories ────────────────────────────────────────────────────
export type CategoryDTO = { id: string; name: string; nameMy: string | null; sortOrder: number; active: boolean; itemCount: number };

/** Cashier+ can read (POS needs the menu); mutations are manager+. */
export async function listCategories(): Promise<ActionResult<CategoryDTO[]>> {
  const user = await requireRole("cashier", "manager", "owner");
  if (!user.branchId) return fail("No branch assigned");
  const cats = await prisma.category.findMany({
    where: { branchId: user.branchId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });
  return ok(
    cats.map((c) => ({
      id: c.id,
      name: c.name,
      nameMy: c.nameMy,
      sortOrder: c.sortOrder,
      active: c.active,
      itemCount: c._count.items,
    }))
  );
}

export async function createCategory(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("manager", "owner");
  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const cat = await prisma.category.create({ data: { branchId: user.branchId, ...parsed.data } });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "category.create", entityType: "category", entityId: cat.id, after: parsed.data });
  return ok({ id: cat.id });
}

export async function updateCategory(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("manager", "owner");
  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { id, ...d } = parsed.data;
  const existing = await prisma.category.findFirst({ where: { id, branchId: user.branchId } });
  if (!existing) return fail("Category not found");
  await prisma.category.update({ where: { id }, data: d });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "category.update", entityType: "category", entityId: id, after: d });
  return ok({ id });
}

export async function deleteCategory(input: unknown): Promise<ActionResult<void>> {
  const user = await requireRole("manager", "owner");
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const existing = await prisma.category.findFirst({
    where: { id: parsed.data.id, branchId: user.branchId },
    include: { _count: { select: { items: true } } },
  });
  if (!existing) return fail("Category not found");
  if (existing._count.items > 0) return fail("Cannot delete — category still has items");
  await prisma.category.delete({ where: { id: existing.id } });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "category.delete", entityType: "category", entityId: existing.id, before: { name: existing.name } });
  return okVoid();
}

// ── Menu items ────────────────────────────────────────────────────
export type MenuItemListDTO = {
  id: string;
  name: string;
  nameMy: string | null;
  priceKs: number;
  categoryId: string | null;
  categoryName: string | null;
  station: string;
  active: boolean;
  sortOrder: number;
};

export type MenuItemPage = { items: MenuItemListDTO[]; total: number; page: number; pageSize: number };

export async function listMenuItems(input: unknown): Promise<ActionResult<MenuItemPage>> {
  const user = await requireRole("cashier", "manager", "owner");
  const parsed = menuItemFilterSchema.safeParse(input ?? {});
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { page, pageSize, search, categoryId, active } = parsed.data;
  const where = {
    branchId: user.branchId,
    ...(categoryId ? { categoryId } : {}),
    ...(active === "active" ? { active: true } : active === "inactive" ? { active: false } : {}),
    ...(search
      ? { OR: [{ name: { contains: search } }, { nameMy: { contains: search } }, { barcode: { contains: search } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.menuItem.count({ where }),
    prisma.menuItem.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { category: { select: { name: true, nameMy: true } } },
    }),
  ]);
  return ok({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      nameMy: r.nameMy,
      priceKs: r.priceKs,
      categoryId: r.categoryId,
      categoryName: r.category?.name ?? null,
      station: r.station,
      active: r.active,
      sortOrder: r.sortOrder,
    })),
    total,
    page,
    pageSize,
  });
}

export type MenuItemDetailDTO = {
  id: string;
  name: string;
  nameMy: string | null;
  description: string | null;
  descriptionMy: string | null;
  priceKs: number;
  costKs: number;
  categoryId: string | null;
  imageUrl: string | null;
  barcode: string | null;
  station: string;
  sortOrder: number;
  active: boolean;
  modifierGroupIds: string[];
  recipe: Array<{ ingredientId: string; ingredientName: string; baseUnit: string; quantity: number }>;
};

export async function getMenuItem(input: unknown): Promise<ActionResult<MenuItemDetailDTO>> {
  const user = await requireRole("cashier", "manager", "owner");
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const item = await prisma.menuItem.findFirst({
    where: { id: parsed.data.id, branchId: user.branchId },
    include: {
      modifierLinks: { select: { groupId: true } },
      recipes: { include: { ingredient: { select: { name: true, nameMy: true, baseUnit: true } } } },
    },
  });
  if (!item) return fail("Menu item not found");
  return ok({
    id: item.id,
    name: item.name,
    nameMy: item.nameMy,
    description: item.description,
    descriptionMy: item.descriptionMy,
    priceKs: item.priceKs,
    costKs: item.costKs,
    categoryId: item.categoryId,
    imageUrl: item.imageUrl,
    barcode: item.barcode,
    station: item.station,
    sortOrder: item.sortOrder,
    active: item.active,
    modifierGroupIds: item.modifierLinks.map((l) => l.groupId),
    recipe: item.recipes.map((r) => ({
      ingredientId: r.ingredientId,
      ingredientName: r.ingredient.nameMy || r.ingredient.name,
      baseUnit: r.ingredient.baseUnit,
      quantity: r.quantity,
    })),
  });
}

async function assertMenuRefs(branchId: string, d: { categoryId?: string | null; modifierGroupIds?: string[]; recipe?: Array<{ ingredientId: string }> }) {
  if (d.categoryId) {
    const c = await prisma.category.findFirst({ where: { id: d.categoryId, branchId } });
    if (!c) throw new Error("Category not found");
  }
  for (const gid of d.modifierGroupIds ?? []) {
    const g = await prisma.modifierGroup.findFirst({ where: { id: gid, branchId } });
    if (!g) throw new Error("Modifier group not found");
  }
  for (const r of d.recipe ?? []) {
    const ing = await prisma.ingredient.findFirst({ where: { id: r.ingredientId, branchId } });
    if (!ing) throw new Error("Ingredient not found");
  }
}

function nullify<T extends Record<string, unknown>>(d: T): T {
  // convert "" optionals to null for nullable DB columns
  const out = { ...d } as Record<string, unknown>;
  for (const k of ["nameMy", "description", "descriptionMy", "imageUrl", "barcode"]) {
    if (out[k] === "") out[k] = null;
  }
  return out as T;
}

export async function createMenuItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("manager", "owner");
  const parsed = createMenuItemSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const d = parsed.data;
  try {
    await assertMenuRefs(user.branchId, d);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid reference");
  }
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.menuItem.create({
      data: {
        branchId: user.branchId!,
        ...nullify({
          name: d.name, nameMy: d.nameMy, description: d.description, descriptionMy: d.descriptionMy,
          priceKs: d.priceKs, costKs: d.costKs, categoryId: d.categoryId ?? null,
          imageUrl: d.imageUrl, barcode: d.barcode, station: d.station, sortOrder: d.sortOrder,
        }),
      },
    });
    if (d.modifierGroupIds.length) {
      await tx.menuItemModifier.createMany({
        data: d.modifierGroupIds.map((groupId) => ({ menuItemId: created.id, groupId })),
      });
    }
    if (d.recipe.length) {
      await tx.recipe.createMany({
        data: d.recipe.map((r) => ({ menuItemId: created.id, ingredientId: r.ingredientId, quantity: r.quantity })),
      });
    }
    return created;
  });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "menuitem.create", entityType: "menuitem", entityId: item.id, after: { name: d.name, priceKs: d.priceKs } });
  return ok({ id: item.id });
}

export async function updateMenuItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("manager", "owner");
  const parsed = updateMenuItemSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { id, modifierGroupIds, recipe, active, ...rest } = parsed.data;
  const existing = await prisma.menuItem.findFirst({ where: { id, branchId: user.branchId } });
  if (!existing) return fail("Menu item not found");
  try {
    await assertMenuRefs(user.branchId, { categoryId: rest.categoryId, modifierGroupIds, recipe });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid reference");
  }
  await prisma.$transaction(async (tx) => {
    const data = nullify({ ...rest });
    if (active !== undefined) (data as Record<string, unknown>).active = active;
    await tx.menuItem.update({ where: { id }, data });
    if (modifierGroupIds !== undefined) {
      await tx.menuItemModifier.deleteMany({ where: { menuItemId: id } });
      if (modifierGroupIds.length) {
        await tx.menuItemModifier.createMany({
          data: modifierGroupIds.map((groupId) => ({ menuItemId: id, groupId })),
        });
      }
    }
    if (recipe !== undefined) {
      await tx.recipe.deleteMany({ where: { menuItemId: id } });
      if (recipe.length) {
        await tx.recipe.createMany({
          data: recipe.map((r) => ({ menuItemId: id, ingredientId: r.ingredientId, quantity: r.quantity })),
        });
      }
    }
  });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "menuitem.update", entityType: "menuitem", entityId: id, after: { name: rest.name ?? existing.name } });
  return ok({ id });
}

export async function toggleItemActive(input: unknown): Promise<ActionResult<{ id: string; active: boolean }>> {
  const user = await requireRole("manager", "owner");
  const parsed = z.object({ id: idSchema, active: z.boolean() }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const existing = await prisma.menuItem.findFirst({ where: { id: parsed.data.id, branchId: user.branchId } });
  if (!existing) return fail("Menu item not found");
  await prisma.menuItem.update({ where: { id: existing.id }, data: { active: parsed.data.active } });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "menuitem.toggle", entityType: "menuitem", entityId: existing.id, after: { active: parsed.data.active } });
  return ok({ id: existing.id, active: parsed.data.active });
}

// ── Modifier groups ───────────────────────────────────────────────
export type ModifierGroupDTO = {
  id: string;
  name: string;
  nameMy: string | null;
  kind: string;
  required: boolean;
  multiSelect: boolean;
  sortOrder: number;
  options: Array<{ id: string; name: string; nameMy: string | null; priceDeltaKs: number; sortOrder: number }>;
};

export async function listModifierGroups(): Promise<ActionResult<ModifierGroupDTO[]>> {
  const user = await requireRole("cashier", "manager", "owner");
  if (!user.branchId) return fail("No branch assigned");
  const groups = await prisma.modifierGroup.findMany({
    where: { branchId: user.branchId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { options: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  return ok(
    groups.map((g) => ({
      id: g.id,
      name: g.name,
      nameMy: g.nameMy,
      kind: g.kind,
      required: g.required,
      multiSelect: g.multiSelect,
      sortOrder: g.sortOrder,
      options: g.options.map((o) => ({ id: o.id, name: o.name, nameMy: o.nameMy, priceDeltaKs: o.priceDeltaKs, sortOrder: o.sortOrder })),
    }))
  );
}

export async function createModifierGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("manager", "owner");
  const parsed = createModifierGroupSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { options, ...d } = parsed.data;
  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.modifierGroup.create({
      data: { branchId: user.branchId!, ...nullify({ ...d }) },
    });
    if (options.length) {
      await tx.modifierOption.createMany({
        data: options.map((o) => ({ groupId: created.id, ...nullify({ ...o }) })),
      });
    }
    return created;
  });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "modifiergroup.create", entityType: "modifiergroup", entityId: group.id, after: { name: d.name } });
  return ok({ id: group.id });
}

export async function updateModifierGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireRole("manager", "owner");
  const parsed = updateModifierGroupSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!user.branchId) return fail("No branch assigned");
  const { id, options, ...d } = parsed.data;
  const existing = await prisma.modifierGroup.findFirst({ where: { id, branchId: user.branchId } });
  if (!existing) return fail("Modifier group not found");
  await prisma.$transaction(async (tx) => {
    await tx.modifierGroup.update({ where: { id }, data: nullify({ ...d }) });
    if (options !== undefined) {
      await tx.modifierOption.deleteMany({ where: { groupId: id } });
      if (options.length) {
        await tx.modifierOption.createMany({
          data: options.map((o) => ({ groupId: id, ...nullify({ ...o }) })),
        });
      }
    }
  });
  await logAudit({ userId: user.id, branchId: user.branchId, action: "modifiergroup.update", entityType: "modifiergroup", entityId: id, after: { name: d.name ?? existing.name } });
  return ok({ id });
}

/** Ingredient picker for the recipe (BOM) editor. Manager+. */
export async function listIngredientsForRecipe(): Promise<ActionResult<Array<{ id: string; name: string; nameMy: string | null; baseUnit: string }>>> {
  const user = await requireRole("manager", "owner");
  if (!user.branchId) return fail("No branch assigned");
  const rows = await prisma.ingredient.findMany({
    where: { branchId: user.branchId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, nameMy: true, baseUnit: true },
  });
  return ok(rows);
}
