"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLang } from "@/lib/i18n/provider";
import { formatKs } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import {
  listTables,
  createTable,
  updateTable,
  setTableStatus,
  deleteTable,
  type TableWithOrders,
} from "@/app/actions/tables";
import { createTableSchema, setTableStatusSchema, type TableStatus } from "@/lib/validations/tables";
import { getMyRole } from "@/app/actions/auth";

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "default"> = {
  free: "success",
  occupied: "warning",
  reserved: "info",
  cleaning: "default",
};

const STATUS_COLOR: Record<string, string> = {
  free: "border-success/40 bg-success/10 hover:bg-success/20",
  occupied: "border-warning/40 bg-warning/10 hover:bg-warning/20",
  reserved: "border-primary/40 bg-primary/10 hover:bg-primary/20",
  cleaning: "border-muted bg-muted/40 hover:bg-muted/60",
};

const fetcher = async () => {
  const r = await listTables();
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

function TableForm({
  initial,
  onDone,
}: {
  initial?: Partial<TableWithOrders>;
  onDone: () => void;
}) {
  const { t } = useLang();
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createTableSchema),
    defaultValues: {
      label: initial?.label ?? "",
      seats: initial?.seats ?? 4,
      zone: initial?.zone ?? "Main",
      posX: initial?.posX ?? 0,
      posY: initial?.posY ?? 0,
    },
  });

  const onSubmit = async (values: z.infer<typeof createTableSchema>) => {
    setServerError("");
    const r = initial?.id ? await updateTable({ id: initial.id, ...values }) : await createTable(values);
    if (!r.ok) {
      setServerError(r.error);
      return;
    }
    mutate("tables");
    onDone();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label>{t("tables.label")}</Label>
        <Input {...register("label")} placeholder={t("tables.labelHint")} />
        {errors.label && <p className="mt-1 text-sm text-destructive">{errors.label.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t("tables.seats")}</Label>
          <Input type="number" min={1} max={50} {...register("seats")} />
          {errors.seats && <p className="mt-1 text-sm text-destructive">{errors.seats.message}</p>}
        </div>
        <div>
          <Label>{t("tables.zone")}</Label>
          <Input {...register("zone")} />
          {errors.zone && <p className="mt-1 text-sm text-destructive">{errors.zone.message}</p>}
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

export default function TablesPage() {
  const { t } = useLang();
  const { data: tables, error, isLoading } = useSWR("tables", fetcher, { refreshInterval: 15000 });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TableWithOrders | undefined>();
  const [selected, setSelected] = useState<TableWithOrders | undefined>();
  const [deleting, setDeleting] = useState<TableWithOrders | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  // "occupied" can only be set manually by managers/owners (server-enforced);
  // fetch the role once so the option isn't offered to staff who can't use it.
  const [myRole, setMyRole] = useState("");
  useEffect(() => {
    getMyRole().then((r) => {
      if (r.ok) setMyRole(r.data.role);
    });
  }, []);
  const canSetOccupied = myRole === "manager" || myRole === "owner";

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const changeStatus = async (table: TableWithOrders, status: TableStatus) => {
    const parsed = setTableStatusSchema.safeParse({ id: table.id, status });
    if (!parsed.success) return;
    setBusy(true);
    const r = await setTableStatus(parsed.data);
    setBusy(false);
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    mutate("tables");
    setSelected((s) => (s && s.id === table.id ? { ...s, status } : s));
    showToast(t("tables.saved"));
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const r = await deleteTable({ id: deleting.id });
    setBusy(false);
    setConfirmDelete(false);
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    mutate("tables");
    setDeleting(undefined);
    setSelected(undefined);
    showToast(t("tables.deleted"));
  };

  const zones = [...new Set((tables ?? []).map((x) => x.zone))].sort();

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("tables.title")}</h1>
        <Button
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          {t("tables.add")}
        </Button>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}

      {error && <p className="text-destructive">{error.message}</p>}

      {!isLoading && !error && (!tables || tables.length === 0) && (
        <p className="text-muted-foreground">{t("common.noData")}</p>
      )}

      {zones.map((zone) => (
        <div key={zone} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t("tables.zone")}: {zone}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {(tables ?? [])
              .filter((x) => x.zone === zone)
              .map((table) => (
                <button
                  key={table.id}
                  onClick={() => setSelected(table)}
                  className={cn(
                    "min-h-32 rounded-xl border-2 p-4 text-left transition-colors",
                    STATUS_COLOR[table.status] ?? STATUS_COLOR.cleaning
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold">{table.label}</span>
                    <Badge tone={STATUS_TONE[table.status] ?? "default"}>
                      {t(`tables.status.${table.status}`)}
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {table.seats} {t("tables.seats")}
                  </div>
                  {table.activeOrderCount > 0 && (
                    <div className="mt-1 text-sm font-medium">
                      {table.activeOrderCount} {t("tables.activeOrders")}
                    </div>
                  )}
                </button>
              ))}
          </div>
        </div>
      ))}

      {/* Detail dialog */}
      <Dialog open={!!selected} onClose={() => setSelected(undefined)} title={selected?.label}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[selected.status] ?? "default"}>
                {t(`tables.status.${selected.status}`)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {selected.seats} {t("tables.seats")} · {selected.zone}
              </span>
            </div>

            <div>
              <h3 className="mb-2 font-semibold">{t("tables.activeOrders")}</h3>
              {selected.activeOrderCount === 0 ? (
                <p className="text-sm text-muted-foreground">{t("tables.noOrders")}</p>
              ) : (
                <ul className="space-y-1">
                  {selected.activeOrders.map((o) => (
                    <li key={o.id} className="flex justify-between text-sm">
                      <span>#{o.orderNumber}</span>
                      <span className="font-medium">{formatKs(o.totalKs)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 font-semibold">{t("tables.setStatus")}</h3>
              <div className="flex flex-wrap gap-2">
                {(canSetOccupied
                  ? (["free", "occupied", "reserved", "cleaning"] as TableStatus[])
                  : (["free", "reserved", "cleaning"] as TableStatus[])
                ).map((s) => (
                  <Button
                    key={s}
                    variant={selected.status === s ? "primary" : "outline"}
                    size="sm"
                    disabled={busy || selected.status === s}
                    onClick={() => changeStatus(selected, s)}
                  >
                    {t(`tables.status.${s}`)}
                  </Button>
                ))}
              </div>
              {selected.status === "occupied" && (
                <p className="mt-2 text-xs text-muted-foreground">{t("tables.occupiedHint")}</p>
              )}
            </div>

            <div className="flex justify-between border-t pt-4">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setDeleting(selected);
                  setConfirmDelete(true);
                }}
              >
                {t("common.delete")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(selected);
                  setSelected(undefined);
                  setFormOpen(true);
                }}
              >
                {t("common.edit")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Add/edit dialog */}
      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={t(editing ? "tables.edit" : "tables.add")}
      >
        <TableForm initial={editing} onDone={() => setFormOpen(false)} />
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("tables.deleteConfirm")}>
        <p className="mb-4 text-sm">
          {deleting?.label} — {t("tables.deleteConfirm")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={doDelete}>
            {t("common.delete")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
