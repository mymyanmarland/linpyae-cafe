"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, Select } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, Badge, Skeleton } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { formatKs, formatDateTime } from "@/lib/format";
import {
  listIngredients, createIngredient, updateIngredient, recordStockMovement,
  listStockMovements, listPurchaseOrders, createPurchaseOrder,
  receivePurchaseOrder, cancelPurchaseOrder, type IngredientDTO,
} from "@/app/actions/inventory";
import { ingredientSchema, stockMovementSchema, purchaseOrderSchema } from "@/lib/validations/inventory";

const PAGE_SIZE = 15;

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3">
      <span className="text-sm text-muted-foreground">{page} / {pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>›</Button>
      </div>
    </div>
  );
}

// ── Ingredient dialog ─────────────────────────────────────────────

function IngredientDialog({ open, onClose, initial, onSaved }: {
  open: boolean; onClose: () => void; initial?: IngredientDTO | null; onSaved: () => void;
}) {
  const { t } = useLang();
  const [err, setErr] = useState("");
  const form = useForm<z.input<typeof ingredientSchema>>({
    resolver: zodResolver(ingredientSchema),
    defaultValues: initial ? {
      name: initial.name, nameMy: initial.nameMy ?? "", unit: initial.unit,
      baseUnit: initial.baseUnit, toBaseFactor: initial.toBaseFactor,
      lowStockThreshold: initial.thresholdDisplay,
      costPerBaseUnit: initial.costPerBaseUnit,
      expiryTracking: initial.expiryTracking, active: initial.active,
    } : { unit: "kg", baseUnit: "g", toBaseFactor: 1000, lowStockThreshold: 0, costPerBaseUnit: 0, expiryTracking: false, active: true },
  });
  React.useEffect(() => { if (open) { form.reset(); setErr(""); } }, [open]); // eslint-disable-line

  async function submit(d: z.input<typeof ingredientSchema>) {
    setErr("");
    const res = initial ? await updateIngredient({ ...d, id: initial.id }) : await createIngredient(d);
    if (!res.ok) { setErr(res.error); return; }
    onSaved(); onClose();
  }
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title={t(initial ? "inventory.editIngredient" : "inventory.addIngredient")}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("common.nameEn")} *</Label><Input {...form.register("name")} />{e.name && <p className="text-destructive text-xs mt-1">{e.name.message}</p>}</div>
          <div><Label>{t("common.nameMy")}</Label><Input {...form.register("nameMy")} className="my-text" />{e.nameMy && <p className="text-destructive text-xs mt-1">{e.nameMy.message}</p>}</div>
          <div><Label>{t("inventory.unit")} *</Label><Input {...form.register("unit")} placeholder="kg / L / pack / pcs" />{e.unit && <p className="text-destructive text-xs mt-1">{e.unit.message}</p>}</div>
          <div><Label>{t("inventory.baseUnit")} *</Label><Input {...form.register("baseUnit")} placeholder="g / ml / pcs" />{e.baseUnit && <p className="text-destructive text-xs mt-1">{e.baseUnit.message}</p>}</div>
          <div><Label>{t("inventory.toBaseFactor")} *</Label><Input type="number" step="any" {...form.register("toBaseFactor")} />{e.toBaseFactor && <p className="text-destructive text-xs mt-1">{e.toBaseFactor.message}</p>}</div>
          <div><Label>{t("inventory.threshold")} *</Label><Input type="number" step="any" {...form.register("lowStockThreshold")} />{e.lowStockThreshold && <p className="text-destructive text-xs mt-1">{e.lowStockThreshold.message}</p>}</div>
          <div className="col-span-2"><Label>{t("inventory.costPerBase")} (Ks)</Label><Input type="number" {...form.register("costPerBaseUnit")} />{e.costPerBaseUnit && <p className="text-destructive text-xs mt-1">{e.costPerBaseUnit.message}</p>}</div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("expiryTracking")} className="size-4" />{t("inventory.expiryTracking")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("active")} className="size-4" />{t("inventory.active")}</label>
        </div>
        {err && <p className="text-destructive text-sm">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>{t("common.save")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Movement dialog ───────────────────────────────────────────────

function MovementDialog({ open, onClose, ingredients, presetId, onSaved }: {
  open: boolean; onClose: () => void; ingredients: IngredientDTO[]; presetId?: string; onSaved: () => void;
}) {
  const { t } = useLang();
  const [err, setErr] = useState("");
  const form = useForm<z.input<typeof stockMovementSchema>>({
    resolver: zodResolver(stockMovementSchema),
    defaultValues: { ingredientId: presetId ?? "", type: "in", quantity: undefined as unknown as number, unitCostKs: 0, supplier: "", reason: "", reference: "" },
  });
  React.useEffect(() => { if (open) { form.reset({ ingredientId: presetId ?? "", type: "in", quantity: undefined as unknown as number, unitCostKs: 0, supplier: "", reason: "", reference: "" }); setErr(""); } }, [open, presetId]); // eslint-disable-line
  const type = form.watch("type");

  async function submit(d: z.input<typeof stockMovementSchema>) {
    setErr("");
    const res = await recordStockMovement(d);
    if (!res.ok) { setErr(res.error); return; }
    onSaved(); onClose();
  }
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title={t("inventory.recordMovement")}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <div><Label>{t("inventory.ingredient")} *</Label>
          <Select {...form.register("ingredientId")}>
            <option value="">{t("common.all")}</option>
            {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
          </Select>{e.ingredientId && <p className="text-destructive text-xs mt-1">{e.ingredientId.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("inventory.movementType")} *</Label>
            <Select {...form.register("type")}>
              <option value="in">{t("inventory.typeIn")}</option>
              <option value="out">{t("inventory.typeOut")}</option>
              <option value="adjustment">{t("inventory.typeAdjustment")}</option>
              <option value="waste">{t("inventory.typeWaste")}</option>
            </Select>
          </div>
          <div><Label>{t("inventory.quantity")} *</Label><Input type="number" step="any" {...form.register("quantity")} placeholder={type === "adjustment" ? "+/-" : ""} />{e.quantity && <p className="text-destructive text-xs mt-1">{e.quantity.message}</p>}</div>
        </div>
        <p className="text-xs text-muted-foreground">{t("inventory.quantityHint")}{type === "adjustment" ? " (+/-)" : ""}</p>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("inventory.unitCost")}</Label><Input type="number" {...form.register("unitCostKs")} />{e.unitCostKs && <p className="text-destructive text-xs mt-1">{e.unitCostKs.message}</p>}</div>
          <div><Label>{t("inventory.supplier")}</Label><Input {...form.register("supplier")} /></div>
        </div>
        <div><Label>{t("inventory.reason")}</Label><Textarea {...form.register("reason")} rows={2} /></div>
        {err && <p className="text-destructive text-sm">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>{t("common.save")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Ingredients tab ───────────────────────────────────────────────

function IngredientsTab() {
  const { t } = useLang();
  const dn = useDisplayName();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [dlg, setDlg] = useState<{ open: boolean; initial: IngredientDTO | null }>({ open: false, initial: null });
  const [moveOpen, setMoveOpen] = useState<{ open: boolean; presetId?: string }>({ open: false });

  const { data, isLoading, mutate } = useSWR(
    ["ingredients", page, q, lowOnly],
    () => listIngredients({ page, pageSize: PAGE_SIZE, search: q, lowStockOnly: lowOnly })
  );
  const res = data?.ok ? data.data : null;
  const allForSelect = useSWR(["ingredients-all"], () => listIngredients({ page: 1, pageSize: 500, search: "" }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <form className="flex gap-2 flex-1 min-w-52" onSubmit={(e) => { e.preventDefault(); setQ(search); setPage(1); }}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("common.search")} className="max-w-64" />
          <Button type="submit" variant="outline" size="sm">{t("common.search")}</Button>
        </form>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={lowOnly} onChange={(e) => { setLowOnly(e.target.checked); setPage(1); }} className="size-4" />
          {t("inventory.lowStockOnly")}
        </label>
        <Button size="sm" onClick={() => setDlg({ open: true, initial: null })}>{t("inventory.addIngredient")}</Button>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        {isLoading ? <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        : !res?.items.length ? <p className="p-8 text-center text-muted-foreground">{t("inventory.noIngredients")}</p>
        : <Table>
            <THead><TR>
              <TH>{t("inventory.ingredient")}</TH><TH className="text-right">{t("inventory.stock")}</TH>
              <TH className="text-right">{t("inventory.threshold")}</TH><TH className="text-right">{t("inventory.valuation")}</TH>
              <TH>{t("common.status")}</TH><TH className="text-right">{t("common.actions")}</TH>
            </TR></THead>
            <TBody>{res.items.map((i) => (
              <TR key={i.id}>
                <TD><div className="font-medium my-text">{dn(i.name, i.nameMy)}</div><div className="text-xs text-muted-foreground">{i.baseUnit} · {t("inventory.costPerBase")}: {formatKs(i.costPerBaseUnit)}</div></TD>
                <TD className="text-right font-medium">{fmtQty(i.stockDisplay)} {i.unit}</TD>
                <TD className="text-right text-muted-foreground">{fmtQty(i.thresholdDisplay)} {i.unit}</TD>
                <TD className="text-right">{formatKs(i.stockValueKs)}</TD>
                <TD>{i.lowStock
                  ? <Badge tone="destructive">{t("inventory.lowStock")}</Badge>
                  : i.stockDisplay <= 0 ? <Badge tone="warning">{t("inventory.outOfStock")}</Badge>
                  : <Badge tone="success">{t("inventory.inStock")}</Badge>}</TD>
                <TD className="text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => setMoveOpen({ open: true, presetId: i.id })}>{t("inventory.recordMovement")}</Button>{" "}
                  <Button size="sm" variant="ghost" onClick={() => setDlg({ open: true, initial: i })}>{t("common.edit")}</Button>
                </TD>
              </TR>
            ))}</TBody>
          </Table>}
      </CardContent></Card>
      {res && <Pagination page={res.page} total={res.total} pageSize={res.pageSize} onPage={setPage} />}

      <IngredientDialog open={dlg.open} initial={dlg.initial} onClose={() => setDlg({ open: false, initial: null })} onSaved={() => { mutate(); allForSelect.mutate(); }} />
      <MovementDialog open={moveOpen.open} presetId={moveOpen.presetId} onClose={() => setMoveOpen({ open: false })} ingredients={allForSelect.data?.ok ? allForSelect.data.data.items : []} onSaved={() => mutate()} />
    </div>
  );
}

// ── Movements tab ───────────────────────────────────────────────────

const MOV_TYPES = ["", "in", "out", "adjustment", "waste"] as const;

function MovementsTab() {
  const { t, lang } = useLang();
  const [page, setPage] = useState(1);
  const [ingredientId, setIngredientId] = useState("");
  const [type, setType] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dlg, setDlg] = useState(false);

  const { data, isLoading, mutate } = useSWR(
    ["movements", page, ingredientId, type, from, to],
    () => listStockMovements({ page, pageSize: PAGE_SIZE, search: "", ingredientId, type, from, to })
  );
  const res = data?.ok ? data.data : null;
  const ings = useSWR(["ingredients-all"], () => listIngredients({ page: 1, pageSize: 500, search: "" }));
  const ingList = ings.data?.ok ? ings.data.data.items : [];

  const typeTone = (ty: string) => ty === "in" ? "success" : ty === "out" ? "info" : ty === "waste" ? "destructive" : "warning";
  const typeLabel = (ty: string) => t(`inventory.type${ty[0].toUpperCase()}${ty.slice(1)}` as never) || ty;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div><Label>{t("inventory.ingredient")}</Label>
          <Select value={ingredientId} onChange={(e) => { setIngredientId(e.target.value); setPage(1); }}>
            <option value="">{t("common.all")}</option>
            {ingList.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select></div>
        <div><Label>{t("inventory.movementType")}</Label>
          <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            {MOV_TYPES.map((ty) => <option key={ty} value={ty}>{ty ? typeLabel(ty) : t("common.all")}</option>)}
          </Select></div>
        <div><Label>{t("reports.from")}</Label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></div>
        <div><Label>{t("reports.to")}</Label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></div>
        <Button size="sm" onClick={() => setDlg(true)}>{t("inventory.recordMovement")}</Button>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        {isLoading ? <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        : !res?.items.length ? <p className="p-8 text-center text-muted-foreground">{t("inventory.noMovements")}</p>
        : <Table>
            <THead><TR><TH>{t("inventory.date")}</TH><TH>{t("inventory.ingredient")}</TH><TH>{t("inventory.movementType")}</TH>
              <TH className="text-right">{t("inventory.quantity")}</TH><TH>{t("inventory.reason")}</TH><TH>{t("inventory.reference")}</TH></TR></THead>
            <TBody>{res.items.map((m) => (
              <TR key={m.id as string}>
                <TD className="whitespace-nowrap">{formatDateTime(m.createdAt as string, lang)}</TD>
                <TD className="my-text">{String(m.ingredientNameMy && lang === "my" ? m.ingredientNameMy : m.ingredientName)}</TD>
                <TD><Badge tone={typeTone(m.type as string) as never}>{typeLabel(m.type as string)}</Badge></TD>
                <TD className="text-right font-medium">{(m.quantity as number) > 0 ? "+" : ""}{m.quantity as number} {m.baseUnit as string}</TD>
                <TD className="max-w-48 truncate">{(m.reason as string) || (m.supplier as string) || "—"}</TD>
                <TD className="text-muted-foreground">{(m.reference as string) || "—"}</TD>
              </TR>
            ))}</TBody>
          </Table>}
      </CardContent></Card>
      {res && <Pagination page={res.page} total={res.total} pageSize={res.pageSize} onPage={setPage} />}
      <MovementDialog open={dlg} onClose={() => setDlg(false)} ingredients={ingList} onSaved={() => mutate()} />
    </div>
  );
}

// ── Purchase order dialog ───────────────────────────────────────────

function PODialog({ open, onClose, ingredients, onSaved }: {
  open: boolean; onClose: () => void; ingredients: IngredientDTO[]; onSaved: () => void;
}) {
  const { t } = useLang();
  const [err, setErr] = useState("");
  const form = useForm<z.input<typeof purchaseOrderSchema>>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: { supplier: "", expectedAt: "", notes: "", lines: [{ ingredientId: "", quantity: undefined as unknown as number, unitCostKs: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  React.useEffect(() => { if (open) { form.reset(); setErr(""); } }, [open]); // eslint-disable-line
  const lines = form.watch("lines");
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCostKs) || 0), 0);

  async function submit(d: z.input<typeof purchaseOrderSchema>) {
    setErr("");
    const res = await createPurchaseOrder(d);
    if (!res.ok) { setErr(res.error); return; }
    onSaved(); onClose();
  }
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title={t("inventory.createPO")} wide>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("inventory.supplier")} *</Label><Input {...form.register("supplier")} />{e.supplier && <p className="text-destructive text-xs mt-1">{e.supplier.message}</p>}</div>
          <div><Label>{t("inventory.expectedAt")}</Label><Input type="date" {...form.register("expectedAt")} /></div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>{t("inventory.lines")} *</Label>
            <Button type="button" size="sm" variant="outline" onClick={() => append({ ingredientId: "", quantity: undefined as unknown as number, unitCostKs: 0 })}>{t("inventory.addLine")}</Button>
          </div>
          <div className="space-y-2">
            {fields.map((f, idx) => (
              <div key={f.id} className="grid grid-cols-[1fr_90px_110px_40px] gap-2 items-end">
                <Select {...form.register(`lines.${idx}.ingredientId`)}>
                  <option value="">{t("inventory.ingredient")}</option>
                  {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                </Select>
                <Input type="number" step="any" placeholder={t("inventory.quantity")} {...form.register(`lines.${idx}.quantity`)} />
                <Input type="number" placeholder="Ks" {...form.register(`lines.${idx}.unitCostKs`)} />
                <Button type="button" size="sm" variant="ghost" onClick={() => remove(idx)} disabled={fields.length <= 1}>✕</Button>
              </div>
            ))}
          </div>
          {e.lines && <p className="text-destructive text-xs mt-1">{typeof e.lines.message === "string" ? e.lines.message : t("common.invalid")}</p>}
        </div>
        <div><Label>{t("common.notes")}</Label><Textarea {...form.register("notes")} rows={2} /></div>
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t("inventory.poTotal")}: {formatKs(total)}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>{t("common.save")}</Button>
          </div>
        </div>
        {err && <p className="text-destructive text-sm">{err}</p>}
      </form>
    </Dialog>
  );
}

// ── Purchase orders tab ─────────────────────────────────────────────

const PO_STATUS = ["", "draft", "ordered", "received", "cancelled"] as const;

function PurchaseOrdersTab() {
  const { t, lang } = useLang();
  const dn = useDisplayName();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [dlg, setDlg] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "receive" | "cancel" } | null>(null);

  const { data, isLoading, mutate } = useSWR(
    ["pos", page, status],
    () => listPurchaseOrders({ page, pageSize: PAGE_SIZE, search: "", status })
  );
  const res = data?.ok ? data.data : null;
  const ings = useSWR(["ingredients-all"], () => listIngredients({ page: 1, pageSize: 500, search: "" }));
  const ingList = ings.data?.ok ? ings.data.data.items : [];

  const statusTone = (s: string) => s === "received" ? "success" : s === "cancelled" ? "destructive" : s === "ordered" ? "info" : "default";
  const statusLabel = (s: string) => t(`inventory.status${s[0].toUpperCase()}${s.slice(1)}` as never) || s;

  async function doConfirm() {
    if (!confirm) return;
    const res2 = confirm.kind === "receive" ? await receivePurchaseOrder(confirm.id) : await cancelPurchaseOrder(confirm.id);
    if (!res2.ok) alert(res2.error);
    setConfirm(null);
    mutate();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44">
          {PO_STATUS.map((s) => <option key={s} value={s}>{s ? statusLabel(s) : t("common.all")}</option>)}
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setDlg(true)}>{t("inventory.createPO")}</Button>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        {isLoading ? <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        : !res?.items.length ? <p className="p-8 text-center text-muted-foreground">{t("inventory.noPOs")}</p>
        : <Table>
            <THead><TR><TH>{t("inventory.poNumber")}</TH><TH>{t("inventory.supplier")}</TH>
              <TH className="text-right">{t("inventory.poTotal")}</TH><TH>{t("common.status")}</TH>
              <TH>{t("inventory.expectedAt")}</TH><TH className="text-right">{t("common.actions")}</TH></TR></THead>
            <TBody>{res.items.map((po) => (
              <React.Fragment key={po.id as string}>
                <TR>
                  <TD className="font-medium whitespace-nowrap">{po.poNumber as string}</TD>
                  <TD>{po.supplier as string}</TD>
                  <TD className="text-right">{formatKs(po.totalKs as number)}</TD>
                  <TD><Badge tone={statusTone(po.status as string) as never}>{statusLabel(po.status as string)}</Badge></TD>
                  <TD className="whitespace-nowrap">{po.expectedAt ? formatDateTime(po.expectedAt as string, lang).split(" ").slice(0, 1).join("") : "—"}</TD>
                  <TD className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === po.id ? null : po.id as string)}>{t("common.view")}</Button>
                    {(po.status === "draft" || po.status === "ordered") && (
                      <><Button size="sm" variant="outline" onClick={() => setConfirm({ id: po.id as string, kind: "receive" })}>{t("inventory.receive")}</Button>{" "}
                      <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: po.id as string, kind: "cancel" })}>{t("inventory.cancelPO")}</Button></>
                    )}
                  </TD>
                </TR>
                {expanded === po.id && (
                  <TR><TD colSpan={6} className="bg-muted/40">
                    <div className="py-1 px-2 space-y-1">
                      {((po.lines as Array<Record<string, unknown>>) || []).map((l) => (
                        <div key={l.id as string} className="flex justify-between text-sm">
                          <span className="my-text">{dn(l.ingredientName as string, l.ingredientNameMy as string | null)}</span>
                          <span>{l.quantity as number} {l.unit as string} × {formatKs(l.unitCostKs as number)} = <b>{formatKs((l.quantity as number) * (l.unitCostKs as number))}</b></span>
                        </div>
                      ))}
                      {po.notes ? <p className="text-xs text-muted-foreground pt-1">{po.notes as string}</p> : null}
                    </div>
                  </TD></TR>
                )}
              </React.Fragment>
            ))}</TBody>
          </Table>}
      </CardContent></Card>
      {res && <Pagination page={res.page} total={res.total} pageSize={res.pageSize} onPage={setPage} />}

      <PODialog open={dlg} onClose={() => setDlg(false)} ingredients={ingList} onSaved={() => mutate()} />
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.kind === "receive" ? t("inventory.receive") : t("inventory.cancelPO")}>
        <p className="text-sm mb-4">{confirm?.kind === "receive" ? t("inventory.receiveConfirm") : t("inventory.cancelPO") + "?"}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
          <Button onClick={doConfirm}>{t("common.yes")}</Button>
        </div>
      </Dialog>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { t } = useLang();
  const [tab, setTab] = useState<"ingredients" | "movements" | "pos">("ingredients");
  const tabs = [
    { id: "ingredients", label: t("inventory.tabIngredients") },
    { id: "movements", label: t("inventory.tabMovements") },
    { id: "pos", label: t("inventory.tabPurchaseOrders") },
  ] as const;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold my-text">{t("inventory.title")}</h1>
      <div className="flex gap-1 border-b border-border">
        {tabs.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px cursor-pointer ${tab === tb.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {tb.label}
          </button>
        ))}
      </div>
      {tab === "ingredients" && <IngredientsTab />}
      {tab === "movements" && <MovementsTab />}
      {tab === "pos" && <PurchaseOrdersTab />}
    </div>
  );
}
