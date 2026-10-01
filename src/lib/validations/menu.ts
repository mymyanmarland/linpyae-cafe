import { z } from "zod";
import { idSchema, mmkSchema } from "@/lib/validators";

export const stationSchema = z.enum(["barista", "kitchen"]);

// ── Categories ────────────────────────────────────────────────────
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  nameMy: z.string().trim().max(100).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial().extend({
  id: idSchema,
  active: z.boolean().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ── Modifier groups ───────────────────────────────────────────────
export const modifierKindSchema = z.enum(["size", "sugar", "milk", "ice", "extra"]);

export const modifierOptionSchema = z.object({
  name: z.string().trim().min(1, "Option name is required").max(100),
  nameMy: z.string().trim().max(100).optional().or(z.literal("")),
  priceDeltaKs: z.number().int().min(-100_000_000).max(100_000_000).default(0),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});
export type ModifierOptionInput = z.infer<typeof modifierOptionSchema>;

export const createModifierGroupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  nameMy: z.string().trim().max(100).optional().or(z.literal("")),
  kind: modifierKindSchema.default("extra"),
  required: z.boolean().default(false),
  multiSelect: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  options: z.array(modifierOptionSchema).max(50).default([]),
});
export type CreateModifierGroupInput = z.infer<typeof createModifierGroupSchema>;

export const updateModifierGroupSchema = createModifierGroupSchema.partial().extend({
  id: idSchema,
});
export type UpdateModifierGroupInput = z.infer<typeof updateModifierGroupSchema>;

// ── Menu items ────────────────────────────────────────────────────
export const recipeLineSchema = z.object({
  ingredientId: idSchema,
  quantity: z.coerce.number().positive("Quantity must be positive").max(1_000_000),
});
export type RecipeLineInput = z.infer<typeof recipeLineSchema>;

export const createMenuItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  nameMy: z.string().trim().max(150).optional().or(z.literal("")),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  descriptionMy: z.string().trim().max(1000).optional().or(z.literal("")),
  priceKs: mmkSchema,
  costKs: mmkSchema.default(0),
  categoryId: idSchema.optional().nullable(),
  imageUrl: z.string().trim().max(500).optional().or(z.literal("")),
  barcode: z.string().trim().max(50).optional().or(z.literal("")),
  station: stationSchema.default("barista"),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  modifierGroupIds: z.array(idSchema).max(20).default([]),
  recipe: z.array(recipeLineSchema).max(50).default([]),
});
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;

export const updateMenuItemSchema = createMenuItemSchema.partial().extend({
  id: idSchema,
  active: z.boolean().optional(),
});
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;

export const menuItemFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).default(""),
  categoryId: z.string().max(50).default(""),
  active: z.enum(["all", "active", "inactive"]).default("all"),
});
export type MenuItemFilterInput = z.infer<typeof menuItemFilterSchema>;
