"use client";

import React, { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLang } from "@/lib/i18n/provider";
import {
  getSettings,
  getMyRole,
  updateGeneralSettings,
  updateReceiptSettings,
  updateLoyaltySettings,
  updatePaymentSettings,
  updateNotificationSettings,
  listAuditLogs,
  type SettingsBundle,
  type AuditLogRow,
} from "@/app/actions/settings";
import {
  generalSettingsSchema,
  receiptSettingsSchema,
  loyaltySettingsSchema,
  paymentSettingsSchema,
  notificationSettingsSchema,
  type GeneralSettingsInput,
  type ReceiptSettingsInput,
  type LoyaltySettingsInput,
  type PaymentSettingsInput,
  type NotificationSettingsInput,
} from "@/lib/validations/settings";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, Badge, Skeleton } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn } from "@/lib/cn";

const TABS = ["general", "receipt", "loyalty", "payments", "notifications", "audit"] as const;
type Tab = (typeof TABS)[number];

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Check({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-border px-3">
      <input type="checkbox" className="h-5 w-5 accent-primary" {...props} />
      <span className="my-text text-sm">{label}</span>
    </label>
  );
}

function SaveBar({ saving, saved, canEdit }: { saving: boolean; saved: boolean; canEdit: boolean }) {
  const { t } = useLang();
  if (!canEdit) return null;
  return (
    <div className="flex items-center gap-3">
      <Button type="submit" disabled={saving} className="min-h-[48px]">
        {saving ? "…" : t("settings.save")}
      </Button>
      {saved && <span className="text-sm text-success">{t("settings.saved")}</span>}
    </div>
  );
}

function useSavedFlag() {
  const [saved, setSaved] = useState(false);
  const mark = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return [saved, mark] as const;
}

// ── General tab ───────────────────────────────────────────────────
function GeneralTab({ bundle, canEdit }: { bundle: SettingsBundle; canEdit: boolean }) {
  const { t } = useLang();
  const [saved, markSaved] = useSavedFlag();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GeneralSettingsInput>({
    resolver: zodResolver(generalSettingsSchema) as Resolver<GeneralSettingsInput>,
    defaultValues: {
      name: bundle.branch.name,
      nameMy: bundle.branch.nameMy,
      address: bundle.branch.address,
      addressMy: bundle.branch.addressMy,
      phone: bundle.branch.phone,
      taxId: bundle.branch.taxId,
      managerName: bundle.branch.managerName,
      openingHours: bundle.branch.openingHours,
      taxRate: bundle.taxRate,
      taxInclusive: bundle.taxInclusive,
      serviceChargeEnabled: bundle.serviceChargeEnabled,
      serviceChargePercent: bundle.serviceChargePercent,
      kdsOverdueMinutes: bundle.kdsOverdueMinutes,
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    setSaving(true);
    setErr("");
    const r = await updateGeneralSettings(v);
    setSaving(false);
    if (r.ok) markSaved();
    else setErr(r.error);
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
      <Field label={t("settings.branchName")} error={errors.name?.message}>
        <Input {...register("name")} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.branchNameMy")} error={errors.nameMy?.message}>
        <Input {...register("nameMy")} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.address")} error={errors.address?.message}>
        <Input {...register("address")} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.addressMy")} error={errors.addressMy?.message}>
        <Input {...register("addressMy")} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.phone")} error={errors.phone?.message}>
        <Input {...register("phone")} disabled={!canEdit} placeholder="09xxxxxxxxx" />
      </Field>
      <Field label={t("settings.taxId")} error={errors.taxId?.message}>
        <Input {...register("taxId")} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.managerName")} error={errors.managerName?.message}>
        <Input {...register("managerName")} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.openingHours")} error={errors.openingHours?.message}>
        <Input {...register("openingHours")} disabled={!canEdit} placeholder="07:00 - 21:00" />
      </Field>
      <Field label={t("settings.taxRate")} error={errors.taxRate?.message}>
        <Input type="number" step="0.1" {...register("taxRate", { valueAsNumber: true })} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.kdsOverdue")} error={errors.kdsOverdueMinutes?.message}>
        <Input type="number" {...register("kdsOverdueMinutes", { valueAsNumber: true })} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.serviceChargePercent")} error={errors.serviceChargePercent?.message}>
        <Input type="number" step="0.5" {...register("serviceChargePercent", { valueAsNumber: true })} disabled={!canEdit} />
      </Field>
      <div className="space-y-2">
        <Check label={t("settings.taxInclusive")} {...register("taxInclusive")} disabled={!canEdit} />
        <Check label={t("settings.serviceCharge")} {...register("serviceChargeEnabled")} disabled={!canEdit} />
      </div>
      <div className="md:col-span-2">
        {err && <p className="mb-2 text-sm text-destructive">{err}</p>}
        <SaveBar saving={saving} saved={saved} canEdit={canEdit} />
      </div>
    </form>
  );
}

// ── Receipt tab ───────────────────────────────────────────────────
function LinesEditor({
  label,
  lines,
  setLines,
  canEdit,
}: {
  label: string;
  lines: string[];
  setLines: (l: string[]) => void;
  canEdit: boolean;
}) {
  const { t } = useLang();
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={l}
            disabled={!canEdit}
            onChange={(e) => setLines(lines.map((x, j) => (j === i ? e.target.value : x)))}
            className="my-text"
          />
          {canEdit && (
            <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              ✕
            </Button>
          )}
        </div>
      ))}
      {canEdit && (
        <Button type="button" variant="outline" onClick={() => setLines([...lines, ""])}>
          {t("settings.addLine")}
        </Button>
      )}
    </div>
  );
}

function ReceiptTab({ bundle, canEdit }: { bundle: SettingsBundle; canEdit: boolean }) {
  const [saved, markSaved] = useSavedFlag();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [header, setHeader] = useState(bundle.receiptHeader);
  const [footer, setFooter] = useState(bundle.receiptFooter);
  const { t } = useLang();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = receiptSettingsSchema.safeParse({ headerLines: header, footerLines: footer });
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? t("settings.saveFailed"));
      return;
    }
    setSaving(true);
    setErr("");
    const r = await updateReceiptSettings(parsed.data as ReceiptSettingsInput);
    setSaving(false);
    if (r.ok) markSaved();
    else setErr(r.error);
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-6 md:grid-cols-2">
      <LinesEditor label={t("settings.receiptHeader")} lines={header} setLines={setHeader} canEdit={canEdit} />
      <LinesEditor label={t("settings.receiptFooter")} lines={footer} setLines={setFooter} canEdit={canEdit} />
      <div className="md:col-span-2">
        {err && <p className="mb-2 text-sm text-destructive">{err}</p>}
        <SaveBar saving={saving} saved={saved} canEdit={canEdit} />
      </div>
    </form>
  );
}

// ── Loyalty tab ───────────────────────────────────────────────────
function LoyaltyTab({ bundle, canEdit }: { bundle: SettingsBundle; canEdit: boolean }) {
  const { t } = useLang();
  const [saved, markSaved] = useSavedFlag();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoyaltySettingsInput>({
    resolver: zodResolver(loyaltySettingsSchema) as Resolver<LoyaltySettingsInput>,
    defaultValues: {
      stampsToFree: bundle.stampsToFree,
      pointsPerKs: bundle.pointsPerKs,
      freeItemCategory: bundle.freeItemCategory,
    },
  });
  const onSubmit = handleSubmit(async (v) => {
    setSaving(true);
    setErr("");
    const r = await updateLoyaltySettings(v);
    setSaving(false);
    if (r.ok) markSaved();
    else setErr(r.error);
  });
  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-4">
      <Field label={t("settings.stampsToFree")} error={errors.stampsToFree?.message}>
        <Input type="number" {...register("stampsToFree", { valueAsNumber: true })} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.pointsPerKs")} error={errors.pointsPerKs?.message}>
        <Input type="number" {...register("pointsPerKs", { valueAsNumber: true })} disabled={!canEdit} />
      </Field>
      <Field label={t("settings.freeItemCategory")} error={errors.freeItemCategory?.message}>
        <Input {...register("freeItemCategory")} disabled={!canEdit} />
      </Field>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <SaveBar saving={saving} saved={saved} canEdit={canEdit} />
    </form>
  );
}

// ── Payments tab ──────────────────────────────────────────────────
const METHODS = ["cash", "kbzpay", "wavepay", "ayapay", "onepay", "card", "bank_transfer"] as const;

function PaymentsTab({ bundle, canEdit }: { bundle: SettingsBundle; canEdit: boolean }) {
  const { t } = useLang();
  const [saved, markSaved] = useSavedFlag();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [enabled, setEnabled] = useState<string[]>(bundle.paymentsEnabled);
  const [kbz, setKbz] = useState(bundle.kbzpayMode);
  const [wave, setWave] = useState(bundle.wavepayMode);

  const toggle = (m: string) =>
    setEnabled((e) => (e.includes(m) ? e.filter((x) => x !== m) : [...e, m]));

  const sandbox = kbz === "sandbox" || wave === "sandbox";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = paymentSettingsSchema.safeParse({
      enabled,
      kbzpayMode: kbz,
      wavepayMode: wave,
    });
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? t("settings.saveFailed"));
      return;
    }
    setSaving(true);
    setErr("");
    const r = await updatePaymentSettings(parsed.data as PaymentSettingsInput);
    setSaving(false);
    if (r.ok) markSaved();
    else setErr(r.error);
  };

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      {sandbox && (
        <div className="my-text rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          ⚠️ {t("settings.sandboxBanner")}
        </div>
      )}
      <div>
        <Label>{t("settings.enabledMethods")}</Label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <Check key={m} label={m} checked={enabled.includes(m)} onChange={() => toggle(m)} disabled={!canEdit} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("settings.kbzpayMode")}>
          <Select value={kbz} onChange={(e) => setKbz(e.target.value)} disabled={!canEdit}>
            <option value="sandbox">{t("settings.modeSandbox")}</option>
            <option value="live">{t("settings.modeLive")}</option>
          </Select>
        </Field>
        <Field label={t("settings.wavepayMode")}>
          <Select value={wave} onChange={(e) => setWave(e.target.value)} disabled={!canEdit}>
            <option value="sandbox">{t("settings.modeSandbox")}</option>
            <option value="live">{t("settings.modeLive")}</option>
          </Select>
        </Field>
      </div>
      {enabled.includes("kbzpay") && kbz === "sandbox" && (
        <Badge tone="warning">KBZPay · {t("settings.modeSandbox")}</Badge>
      )}{" "}
      {enabled.includes("wavepay") && wave === "sandbox" && (
        <Badge tone="warning">WavePay · {t("settings.modeSandbox")}</Badge>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <SaveBar saving={saving} saved={saved} canEdit={canEdit} />
    </form>
  );
}

// ── Notifications tab ─────────────────────────────────────────────
function NotificationsTab({ bundle, canEdit }: { bundle: SettingsBundle; canEdit: boolean }) {
  const { t } = useLang();
  const [saved, markSaved] = useSavedFlag();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NotificationSettingsInput>({
    resolver: zodResolver(notificationSettingsSchema) as Resolver<NotificationSettingsInput>,
    defaultValues: {
      lowStock: bundle.notifications.lowStock,
      eodSummary: bundle.notifications.eodSummary,
      smsProvider: bundle.sms.provider as "none" | "stub" | "http",
      smsHttpEndpoint: bundle.sms.endpoint,
      smsHttpApiKey: "",
    },
  });
  const provider = watch("smsProvider");
  const onSubmit = handleSubmit(async (v) => {
    setSaving(true);
    setErr("");
    const r = await updateNotificationSettings(v);
    setSaving(false);
    if (r.ok) markSaved();
    else setErr(r.error);
  });
  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <Check label={t("settings.notifyLowStock")} {...register("lowStock")} disabled={!canEdit} />
      <Check label={t("settings.notifyEod")} {...register("eodSummary")} disabled={!canEdit} />
      <Field label={t("settings.smsProvider")}>
        <Select {...register("smsProvider")} disabled={!canEdit}>
          <option value="none">{t("settings.providerNone")}</option>
          <option value="stub">{t("settings.providerStub")}</option>
          <option value="http">{t("settings.providerHttp")}</option>
        </Select>
      </Field>
      {provider === "http" && (
        <>
          <Field label={t("settings.smsEndpoint")} error={errors.smsHttpEndpoint?.message}>
            <Input {...register("smsHttpEndpoint")} disabled={!canEdit} placeholder="https://…" />
          </Field>
          <Field label={t("settings.smsApiKey")} error={errors.smsHttpApiKey?.message}>
            <Input type="password" {...register("smsHttpApiKey")} disabled={!canEdit} placeholder={bundle.sms.hasApiKey ? "••••••••" : ""} />
          </Field>
        </>
      )}
      {provider === "stub" && (
        <div className="my-text rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          ⚠️ {t("settings.sandboxBanner")}
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <SaveBar saving={saving} saved={saved} canEdit={canEdit} />
    </form>
  );
}

// ── Audit tab ─────────────────────────────────────────────────────
function AuditTab() {
  const { t, lang } = useLang();
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  useEffect(() => {
    setLoading(true);
    listAuditLogs({ page, pageSize, search: "" }).then((r) => {
      setLoading(false);
      if (r.ok) {
        setRows(r.data.rows);
        setTotal(r.data.total);
      }
    });
  }, [page]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Card>
      <CardContent className="pt-4">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>{t("settings.auditTime")}</TH>
                  <TH>{t("settings.auditUser")}</TH>
                  <TH>{t("settings.auditAction")}</TH>
                  <TH>{t("settings.auditDetails")}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt, lang)}</TD>
                    <TD>{r.userName ?? "—"}</TD>
                    <TD>
                      <Badge>{r.action}</Badge>
                    </TD>
                    <TD className="max-w-xs truncate text-xs text-muted-foreground">
                      {r.entityType ?? ""} {r.summary}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("common.noData")}</p>}
            <div className="mt-3 flex items-center justify-between">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ←
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {pages}
              </span>
              <Button variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                →
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("general");
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getSettings(), getMyRole()]).then(([s, r]) => {
      if (s.ok) setBundle(s.data);
      else setError(s.error);
      if (r.ok) setRole(r.data.role);
    });
  }, []);

  const canEdit = role === "owner" || role === "manager";
  const tabs: Tab[] = canEdit ? [...TABS] : TABS.filter((x) => x !== "audit");

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">{t("settings.title")}</h1>
        {!canEdit && bundle && <Badge tone="info">{t("settings.needManager")}</Badge>}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={cn(
              "my-text min-h-[44px] shrink-0 border-b-2 px-3 text-sm font-medium",
              tab === x ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            )}
          >
            {t(`settings.tab${x[0].toUpperCase()}${x.slice(1)}`)}
          </button>
        ))}
      </div>

      {error && (
        <Card>
          <CardContent className="pt-4 text-destructive">{error}</CardContent>
        </Card>
      )}

      {!bundle && !error && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64" />
        </div>
      )}

      {bundle && (
        <Card>
          <CardHeader>
            <CardTitle>{t(`settings.tab${tab[0].toUpperCase()}${tab.slice(1)}`)}</CardTitle>
          </CardHeader>
          <CardContent>
            {tab === "general" && <GeneralTab bundle={bundle} canEdit={canEdit} />}
            {tab === "receipt" && <ReceiptTab bundle={bundle} canEdit={canEdit} />}
            {tab === "loyalty" && <LoyaltyTab bundle={bundle} canEdit={canEdit} />}
            {tab === "payments" && <PaymentsTab bundle={bundle} canEdit={canEdit} />}
            {tab === "notifications" && <NotificationsTab bundle={bundle} canEdit={canEdit} />}
            {tab === "audit" && canEdit && <AuditTab />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
