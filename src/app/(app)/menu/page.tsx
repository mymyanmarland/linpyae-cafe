"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { formatKs } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea, Label, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listMenuItems,
  getMenuItem,
  createMenuItem,
  updateMenuItem,
  toggleItemActive,
  listModifierGroups,
  createModifierGroup,
  updateModifierGroup,
  listIngredientsForRecipe,
  type CategoryDTO,
  type MenuItemListDTO,
  type ModifierGroupDTO,
} from "@/app/actions/menu";
import {
  createCategorySchema,
  createMenuItemSchema,
  createModifierGroupSchema,
} from "@/lib/validations/menu";

const itemFormSchema = createMenuItemSchema;
type ItemFormValues = z.input<typeof itemFormSchema>;

const groupFormSchema = createModifierGroupSchema;
type GroupFormValues = z.input<typeof groupFormSchema>;

// ── Item editor ───────────────────────────────────────────────────
function ItemEditor({
  itemId,
  categories,
  groups,
  onDone,
}: {
  itemId?: string;
  categories: CategoryDTO[];
  groups: ModifierGroupDTO[];
  onDone: () => void;
}) {
  const { t } = useLang();
  const dn = useDisplayName();
  const [serverError, setServerError] = useState("");
  const [ingredients, setIngredients] = useState<Array<{ id: string; name: string; nameMy: string | null; baseUnit: string }>>([]);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: {
      name: "",
      nameMy: "",
      description: "",
      descriptionMy: "",
      priceKs: 0,
      costKs: 0,
      categoryId: null,
      imageUrl: "",
      barcode: "",
      station: "barista",
      sortOrder: 0,
      modifierGroupIds: [],
      recipe: [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "recipe" });

  useEffect(() => {
    listIngredientsForRecipe().then((r) => {
      if (r.ok) setIngredients(r.data);
    });
    if (itemId) {
      getMenuItem({ id: itemId }).then((r) => {
        if (r.ok) {
          const d = r.data;
          reset({
            name: d.name,
            nameMy: d.nameMy ?? "",
            description: d.description ?? "",
            descriptionMy: d.descriptionMy ?? "",
            priceKs: d.priceKs,
            costKs: d.costKs,
            categoryId: d.categoryId,
            imageUrl: d.imageUrl ?? "",
            barcode: d.barcode ?? "",
            station: d.station as "barista" | "kitchen",
            sortOrder: d.sortOrder,
            modifierGroupIds: d.modifierGroupIds,
            recipe: d.recipe.map((x) => ({ ingredientId: x.ingredientId, quantity: x.quantity })),
          });
        }
      });
    }
  }, [itemId, reset]);

  const onSubmit = async (values: ItemFormValues) => {
    setServerError("");
    const r = itemId ? await updateMenuItem({ id: itemId, ...values }) : await createMenuItem(values);
    if (!r.ok) {
      setServerError(r.error);
      return;
    }
    mutate("menu-items");
    onDone();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>{t("common.nameEn")} *</Label>
          <Input {...register("name")} />
          {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>}
        </div>
        <div>
          <Label>{t("common.nameMy")}</Label>
          <Input {...register("nameMy")} className="my-text" />
        </div>
        <div>
          <Label>{t("menu.price")} (Ks) *</Label>
          <Input type="number" min={0} {...register("priceKs", { valueAsNumber: true })} />
          {errors.priceKs && <p className="mt-1 text-sm text-destructive">{errors.priceKs.message}</p>}
        </div>
        <div>
          <Label>{t("menu.cost")} (Ks)</Label>
          <Input type="number" min={0} {...register("costKs", { valueAsNumber: true })} />
        </div>
        <div>
          <Label>{t("menu.category")}</Label>
          <Select {...register("categoryId", { setValueAs: (v) => (v === "" ? null : v) })}>
            <option value="">{t("menu.noCategory")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {dn(c.name, c.nameMy)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("menu.station")}</Label>
          <Select {...register("station")}>
            <option value="barista">{t("menu.station.barista")}</option>
            <option value="kitchen">{t("menu.station.kitchen")}</option>
          </Select>
        </div>
        <div>
          <Label>{t("menu.barcode")}</Label>
          <Input {...register("barcode")} />
        </div>
        <div>
          <Label>{t("menu.sortOrder")}</Label>
          <Input type="number" min={0} {...register("sortOrder", { valueAsNumber: true })} />
        </div>
      </div>
      <div>
        <Label>{t("menu.description")}</Label>
        <Textarea {...register("description")} rows={2} />
      </div>

      <div>
        <Label>{t("menu.selectGroups")}</Label>
        <div className="mt-1 flex flex-wrap gap-2">
          {groups.map((g) => (
            <label
              key={g.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <input type="checkbox" value={g.id} {...register("modifierGroupIds")} className="h-4 w-4" />
              {dn(g.name, g.nameMy)}
            </label>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted-foreground">{t("common.noData")}</p>}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>{t("menu.recipe")}</Label>
          <Button type="button" size="sm" variant="outline" onClick={() => append({ ingredientId: "", quantity: 1 })}>
            {t("menu.addIngredient")}
          </Button>
        </div>
        {fields.length === 0 && <p className="text-sm text-muted-foreground">{t("menu.noRecipe")}</p>}
        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Select {...register(`recipe.${i}.ingredientId`)} className="flex-1">
                <option value="">{t("menu.ingredient")}</option>
                {ingredients.map((ing) => (
                  <option key={ing.id} value={ing.id}>
                    {dn(ing.name, ing.nameMy)} ({ing.baseUnit})
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min={0}
                step="any"
                placeholder={t("menu.quantity")}
                {...register(`recipe.${i}.quantity`, { valueAsNumber: true })}
                className="w-28"
              />
              <Button type="button" size="sm" variant="destructive" onClick={() => remove(i)}>
                ×
              </Button>
            </div>
          ))}
        </div>
        {errors.recipe && <p className="mt-1 text-sm text-destructive">{t("common.error") ?? "Error"}</p>}
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

// ── Modifier group editor ─────────────────────────────────────────
function GroupEditor({ groupId, onDone }: { groupId?: string; onDone: () => void }) {
  const { t } = useLang();
  const [serverError, setServerError] = useState("");
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: { name: "", nameMy: "", kind: "extra", required: false, multiSelect: false, sortOrder: 0, options: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "options" });

  useEffect(() => {
    if (!groupId) return;
    listModifierGroups().then((r) => {
      if (r.ok) {
        const g = r.data.find((x) => x.id === groupId);
        if (g) {
          reset({
            name: g.name,
            nameMy: g.nameMy ?? "",
            kind: g.kind as GroupFormValues["kind"],
            required: g.required,
            multiSelect: g.multiSelect,
            sortOrder: g.sortOrder,
            options: g.options.map((o) => ({ name: o.name, nameMy: o.nameMy ?? "", priceDeltaKs: o.priceDeltaKs, sortOrder: o.sortOrder })),
          });
        }
      }
    });
  }, [groupId, reset]);

  const onSubmit = async (values: GroupFormValues) => {
    setServerError("");
    const r = groupId ? await updateModifierGroup({ id: groupId, ...values }) : await createModifierGroup(values);
    if (!r.ok) {
      setServerError(r.error);
      return;
    }
    mutate("modifier-groups");
    onDone();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>{t("common.nameEn")} *</Label>
          <Input {...register("name")} />
          {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>}
        </div>
        <div>
          <Label>{t("common.nameMy")}</Label>
          <Input {...register("nameMy")} className="my-text" />
        </div>
        <div>
          <Label>{t("menu.kind")}</Label>
          <Select {...register("kind")}>
            {(["size", "sugar", "milk", "ice", "extra"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`menu.kind.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("menu.sortOrder")}</Label>
          <Input type="number" min={0} {...register("sortOrder", { valueAsNumber: true })} />
        </div>
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("required")} className="h-4 w-4" />
          {t("menu.required")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("multiSelect")} className="h-4 w-4" />
          {t("menu.multiSelect")}
        </label>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>{t("menu.options")}</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => append({ name: "", nameMy: "", priceDeltaKs: 0, sortOrder: fields.length })}
          >
            {t("menu.addOption")}
          </Button>
        </div>
        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input placeholder={t("menu.optionName")} {...register(`options.${i}.name`)} className="flex-1" />
              <Input
                type="number"
                placeholder={t("menu.priceDelta")}
                {...register(`options.${i}.priceDeltaKs`, { valueAsNumber: true })}
                className="w-32"
              />
              <Button type="button" size="sm" variant="destructive" onClick={() => remove(i)}>
                ×
              </Button>
            </div>
          ))}
        </div>
      </div>
      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

// ── Category form ─────────────────────────────────────────────────
function CategoryForm({ initial, onDone }: { initial?: CategoryDTO; onDone: () => void }) {
  const { t } = useLang();
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createCategorySchema),
    defaultValues: { name: initial?.name ?? "", nameMy: initial?.nameMy ?? "", sortOrder: initial?.sortOrder ?? 0 },
  });
  const onSubmit = async (values: z.infer<typeof createCategorySchema>) => {
    setServerError("");
    const r = initial ? await updateCategory({ id: initial.id, ...values }) : await createCategory(values);
    if (!r.ok) {
      setServerError(r.error);
      return;
    }
    mutate("menu-categories");
    onDone();
  };
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label>{t("common.nameEn")} *</Label>
        <Input {...register("name")} />
        {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>}
      </div>
      <div>
        <Label>{t("common.nameMy")}</Label>
        <Input {...register("nameMy")} className="my-text" />
      </div>
      <div>
        <Label>{t("menu.sortOrder")}</Label>
        <Input type="number" min={0} {...register("sortOrder", { valueAsNumber: true })} />
      </div>
      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────
type Tab = "items" | "categories" | "modifiers";

export default function MenuPage() {
  const { t } = useLang();
  const dn = useDisplayName();
  const [tab, setTab] = useState<Tab>("items");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [itemEditorOpen, setItemEditorOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | undefined>();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDTO | undefined>();
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | undefined>();
  const [toast, setToast] = useState("");
  const [confirmDeleteCat, setConfirmDeleteCat] = useState<CategoryDTO | undefined>();

  const { data: categories } = useSWR("menu-categories", async () => {
    const r = await listCategories();
    if (!r.ok) throw new Error(r.error);
    return r.data;
  });
  const { data: groups } = useSWR("modifier-groups", async () => {
    const r = await listModifierGroups();
    if (!r.ok) throw new Error(r.error);
    return r.data;
  });

  const itemsKey = useMemo(
    () => `menu-items:${page}:${search}:${categoryId}:${activeFilter}`,
    [page, search, categoryId, activeFilter]
  );
  const { data: itemsPage, isLoading: itemsLoading } = useSWR(itemsKey, async () => {
    const r = await listMenuItems({ page, pageSize: 20, search, categoryId, active: activeFilter });
    if (!r.ok) throw new Error(r.error);
    return r.data;
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const doToggle = async (item: MenuItemListDTO) => {
    const r = await toggleItemActive({ id: item.id, active: !item.active });
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    mutate(itemsKey);
  };

  const doDeleteCategory = async () => {
    if (!confirmDeleteCat) return;
    const r = await deleteCategory({ id: confirmDeleteCat.id });
    setConfirmDeleteCat(undefined);
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    mutate("menu-categories");
    showToast(t("menu.deleted"));
  };

  const totalPages = itemsPage ? Math.max(1, Math.ceil(itemsPage.total / itemsPage.pageSize)) : 1;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("menu.title")}</h1>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex gap-2 border-b">
        {(["items", "categories", "modifiers"] as Tab[]).map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={cn(
              "min-h-12 px-4 text-sm font-medium border-b-2 -mb-px",
              tab === x ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            )}
          >
            {t(`menu.${x}`)}
          </button>
        ))}
      </div>

      {tab === "items" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("menu.search")}
              className="max-w-xs"
            />
            <Select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("menu.allCategories")}</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {dn(c.name, c.nameMy)}
                </option>
              ))}
            </Select>
            <Select
              value={activeFilter}
              onChange={(e) => {
                setActiveFilter(e.target.value as typeof activeFilter);
                setPage(1);
              }}
            >
              <option value="all">{t("common.all")}</option>
              <option value="active">{t("menu.active")}</option>
              <option value="inactive">{t("menu.inactive")}</option>
            </Select>
            <div className="ml-auto">
              <Button
                onClick={() => {
                  setEditingItemId(undefined);
                  setItemEditorOpen(true);
                }}
              >
                {t("menu.addItem")}
              </Button>
            </div>
          </div>

          {itemsLoading && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          )}

          {!itemsLoading && (!itemsPage || itemsPage.items.length === 0) && (
            <p className="text-muted-foreground">{t("common.noData")}</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(itemsPage?.items ?? []).map((item) => (
              <Card key={item.id} className={cn(!item.active && "opacity-60")}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate my-text">{dn(item.name, item.nameMy)}</div>
                      <div className="text-sm text-muted-foreground">{item.categoryName ?? t("menu.noCategory")}</div>
                    </div>
                    <Badge tone={item.active ? "success" : "default"}>
                      {t(item.active ? "menu.active" : "menu.inactive")}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-lg font-bold">{formatKs(item.priceKs)}</span>
                    <span className="text-xs text-muted-foreground">{t(`menu.station.${item.station}`)}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingItemId(item.id);
                        setItemEditorOpen(true);
                      }}
                    >
                      {t("common.edit")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => doToggle(item)}>
                      {t("menu.toggleActive")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ←
              </Button>
              <span className="text-sm">
                {page} / {totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                →
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === "categories" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setEditingCategory(undefined);
                setCategoryOpen(true);
              }}
            >
              {t("menu.addCategory")}
            </Button>
          </div>
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH>{t("common.name")}</TH>
                  <TH>{t("menu.sortOrder")}</TH>
                  <TH>{t("menu.itemCount")}</TH>
                  <TH>{t("common.status")}</TH>
                  <TH>{t("common.actions")}</TH>
                </TR>
              </THead>
              <TBody>
                {(categories ?? []).map((c) => (
                  <TR key={c.id}>
                    <TD className="my-text font-medium">{dn(c.name, c.nameMy)}</TD>
                    <TD>{c.sortOrder}</TD>
                    <TD>{c.itemCount}</TD>
                    <TD>
                      <Badge tone={c.active ? "success" : "default"}>
                        {t(c.active ? "common.active" : "common.inactive")}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingCategory(c);
                            setCategoryOpen(true);
                          }}
                        >
                          {t("common.edit")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setConfirmDeleteCat(c)}>
                          {t("common.delete")}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          {(!categories || categories.length === 0) && <p className="text-muted-foreground">{t("common.noData")}</p>}
        </div>
      )}

      {tab === "modifiers" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setEditingGroupId(undefined);
                setGroupOpen(true);
              }}
            >
              {t("menu.addGroup")}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(groups ?? []).map((g) => (
              <Card key={g.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="my-text">{dn(g.name, g.nameMy)}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingGroupId(g.id);
                        setGroupOpen(true);
                      }}
                    >
                      {t("common.edit")}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-2 flex gap-2 text-xs text-muted-foreground">
                    <span>{t(`menu.kind.${g.kind}`)}</span>
                    {g.required && <Badge tone="warning">{t("menu.required")}</Badge>}
                    {g.multiSelect && <Badge tone="info">{t("menu.multiSelect")}</Badge>}
                  </div>
                  <ul className="space-y-1">
                    {g.options.map((o) => (
                      <li key={o.id} className="flex justify-between text-sm">
                        <span className="my-text">{dn(o.name, o.nameMy)}</span>
                        <span className={cn(o.priceDeltaKs !== 0 && "font-medium")}>
                          {o.priceDeltaKs === 0 ? "—" : `${o.priceDeltaKs > 0 ? "+" : ""}${formatKs(o.priceDeltaKs)}`}
                        </span>
                      </li>
                    ))}
                    {g.options.length === 0 && (
                      <li className="text-sm text-muted-foreground">{t("common.noData")}</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          {(!groups || groups.length === 0) && <p className="text-muted-foreground">{t("common.noData")}</p>}
        </div>
      )}

      <Dialog
        open={itemEditorOpen}
        onClose={() => setItemEditorOpen(false)}
        title={t(editingItemId ? "menu.editItem" : "menu.addItem")}
        wide
      >
        <ItemEditor
          itemId={editingItemId}
          categories={categories ?? []}
          groups={groups ?? []}
          onDone={() => setItemEditorOpen(false)}
        />
      </Dialog>

      <Dialog
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        title={t(editingCategory ? "menu.editCategory" : "menu.addCategory")}
      >
        <CategoryForm initial={editingCategory} onDone={() => setCategoryOpen(false)} />
      </Dialog>

      <Dialog open={groupOpen} onClose={() => setGroupOpen(false)} title={t(editingGroupId ? "menu.editGroup" : "menu.addGroup")} wide>
        <GroupEditor groupId={editingGroupId} onDone={() => setGroupOpen(false)} />
      </Dialog>

      <Dialog open={!!confirmDeleteCat} onClose={() => setConfirmDeleteCat(undefined)} title={t("menu.deleteConfirm")}>
        <p className="mb-4 text-sm my-text">{confirmDeleteCat && dn(confirmDeleteCat.name, confirmDeleteCat.nameMy)}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDeleteCat(undefined)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={doDeleteCategory}>
            {t("common.delete")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
