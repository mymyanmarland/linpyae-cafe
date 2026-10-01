"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { formatKs, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Badge, Skeleton } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea, Label, Select } from "@/components/ui/input";
import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  adjustPoints,
  type CustomerListDTO,
  type CustomerDetailDTO,
} from "@/app/actions/customers";
import { createCustomerSchema, adjustPointsSchema } from "@/lib/validations/customers";

const TIER_TONE: Record<string, "default" | "warning" | "info" | "success"> = {
  none: "default",
  bronze: "warning",
  silver: "info",
  gold: "success",
};

function CustomerForm({ initial, onDone }: { initial?: CustomerDetailDTO; onDone: () => void }) {
  const { t } = useLang();
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      name: initial?.name ?? "",
      nameMy: initial?.nameMy ?? "",
      phone: initial?.phone ?? "",
      email: initial?.email ?? "",
      birthday: initial?.birthday ?? "",
      tier: (initial?.tier ?? "none") as "none" | "bronze" | "silver" | "gold",
      notes: initial?.notes ?? "",
    },
  });

  const onSubmit = async (values: z.infer<typeof createCustomerSchema>) => {
    setServerError("");
    const r = initial ? await updateCustomer({ id: initial.id, ...values }) : await createCustomer(values);
    if (!r.ok) {
      setServerError(r.error);
      return;
    }
    mutate((key) => typeof key === "string" && key.startsWith("customers:"));
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
          <Label>{t("common.phone")} *</Label>
          <Input {...register("phone")} placeholder="09xxxxxxxxx" />
          {errors.phone && <p className="mt-1 text-sm text-destructive">{errors.phone.message}</p>}
        </div>
        <div>
          <Label>{t("common.email")}</Label>
          <Input {...register("email")} />
          {errors.email && <p className="mt-1 text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <div>
          <Label>{t("customers.birthday")}</Label>
          <Input type="date" {...register("birthday")} />
          {errors.birthday && <p className="mt-1 text-sm text-destructive">{errors.birthday.message}</p>}
        </div>
        <div>
          <Label>{t("customers.tier")}</Label>
          <Select {...register("tier")}>
            {(["none", "bronze", "silver", "gold"] as const).map((x) => (
              <option key={x} value={x}>
                {t(`customers.tier.${x}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label>{t("common.notes")}</Label>
        <Textarea {...register("notes")} rows={2} />
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

function PointsForm({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const { t } = useLang();
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(adjustPointsSchema.omit({ id: true })),
    defaultValues: { delta: 0, reason: "" },
  });

  const onSubmit = async (values: { delta: number; reason: string }) => {
    setServerError("");
    const r = await adjustPoints({ id: customerId, ...values });
    if (!r.ok) {
      setServerError(r.error);
      return;
    }
    mutate((key) => typeof key === "string" && key.startsWith("customers:"));
    onDone();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label>{t("customers.delta")}</Label>
        <Input type="number" {...register("delta", { valueAsNumber: true })} placeholder="+100 / -50" />
        {errors.delta && <p className="mt-1 text-sm text-destructive">{errors.delta.message}</p>}
      </div>
      <div>
        <Label>{t("customers.reason")} *</Label>
        <Input {...register("reason")} />
        {errors.reason && <p className="mt-1 text-sm text-destructive">{errors.reason.message}</p>}
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

function CustomerDetail({ id, onEdit }: { id: string; onEdit: (c: CustomerDetailDTO) => void }) {
  const { t, lang } = useLang();
  const dn = useDisplayName();
  const [pointsOpen, setPointsOpen] = useState(false);
  const { data: customer, isLoading } = useSWR(`customers:detail:${id}`, async () => {
    const r = await getCustomer({ id });
    if (!r.ok) throw new Error(r.error);
    return r.data;
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (!customer) return <p className="text-muted-foreground">{t("common.noData")}</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-bold my-text">{dn(customer.name, customer.nameMy)}</div>
          <div className="text-sm text-muted-foreground">{customer.phone}</div>
          {customer.email && <div className="text-sm text-muted-foreground">{customer.email}</div>}
          <div className="mt-1">
            <Badge tone={TIER_TONE[customer.tier] ?? "default"}>{t(`customers.tier.${customer.tier}`)}</Badge>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => onEdit(customer)}>
          {t("common.edit")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t("customers.points"), value: String(customer.points) },
          { label: t("customers.stamps"), value: String(customer.stamps) },
          { label: t("customers.visits"), value: String(customer.visitCount) },
          { label: t("customers.totalSpend"), value: formatKs(customer.totalSpendKs) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setPointsOpen(true)}>
          {t("customers.adjustPoints")}
        </Button>
      </div>

      <div>
        <h3 className="mb-2 font-semibold">{t("customers.orderHistory")}</h3>
        {customer.recentOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("customers.noHistory")}</p>
        ) : (
          <ul className="space-y-1">
            {customer.recentOrders.map((o) => (
              <li key={o.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>
                  #{o.orderNumber} · <span className="text-muted-foreground">{formatDate(o.createdAt, lang)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={o.status === "completed" ? "success" : o.status === "voided" ? "destructive" : "info"}>
                    {o.status}
                  </Badge>
                  <span className="font-medium">{formatKs(o.totalKs)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={pointsOpen} onClose={() => setPointsOpen(false)} title={t("customers.adjustPoints")}>
        <PointsForm customerId={customer.id} onDone={() => setPointsOpen(false)} />
      </Dialog>
    </div>
  );
}

export default function CustomersPage() {
  const { t, lang } = useLang();
  const dn = useDisplayName();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerDetailDTO | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [toast, setToast] = useState("");

  const key = useMemo(() => `customers:${page}:${search}`, [page, search]);
  const { data, error, isLoading } = useSWR(key, async () => {
    const r = await listCustomers({ page, pageSize: 15, search });
    if (!r.ok) throw new Error(r.error);
    return r.data;
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("customers.title")}</h1>
        <Button
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          {t("customers.add")}
        </Button>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        placeholder={t("customers.search")}
        className="max-w-sm"
      />

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}
      {error && <p className="text-destructive">{error.message}</p>}
      {!isLoading && !error && (!data || data.customers.length === 0) && (
        <p className="text-muted-foreground">{t("common.noData")}</p>
      )}

      <div className="space-y-2">
        {(data?.customers ?? []).map((c: CustomerListDTO) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className="flex w-full items-center justify-between rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0">
              <div className="font-semibold truncate my-text">{dn(c.name, c.nameMy)}</div>
              <div className="text-sm text-muted-foreground">{c.phone}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-sm">
                <div className="font-medium">{c.points} {t("customers.points")}</div>
                <div className="text-muted-foreground">{c.visitCount} {t("customers.visits")}</div>
              </div>
              <Badge tone={TIER_TONE[c.tier] ?? "default"}>{t(`customers.tier.${c.tier}`)}</Badge>
            </div>
          </button>
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

      <Dialog open={!!selectedId} onClose={() => setSelectedId(undefined)} title={t("customers.detail")} wide>
        {selectedId && (
          <CustomerDetail
            id={selectedId}
            onEdit={(c) => {
              setEditing(c);
              setSelectedId(undefined);
              setFormOpen(true);
            }}
          />
        )}
      </Dialog>

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} title={t(editing ? "customers.edit" : "customers.add")} wide>
        <CustomerForm
          initial={editing}
          onDone={() => {
            setFormOpen(false);
            setEditing(undefined);
            showToast(t("customers.saved"));
          }}
        />
      </Dialog>
    </div>
  );
}
