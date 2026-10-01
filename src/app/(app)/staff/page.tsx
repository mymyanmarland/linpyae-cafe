"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, Badge, Skeleton } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { formatDateTime, formatDate, yangonDateKey } from "@/lib/format";
import {
  listStaff, createStaff, updateStaff, resetPin,
  clockIn, clockOut, getMyAttendanceToday, getAttendance,
  getRoster, saveRoster, deleteRosterEntry, type StaffDTO, type RosterDTO,
} from "@/app/actions/staff";
import {
  createStaffSchema, updateStaffSchema, resetPinSchema,
  type CreateStaffInput, type UpdateStaffInput,
} from "@/lib/validations/staff";
import { normalizeMmPhone } from "@/lib/format";

const roleTone = (r: string) => r === "owner" ? "destructive" : r === "manager" ? "warning" : r === "cashier" ? "info" : "default";

function RoleBadge({ role }: { role: string }) {
  const { t } = useLang();
  const label = t(`staff.role${role[0].toUpperCase()}${role.slice(1)}` as never) || role;
  return <Badge tone={roleTone(role) as never}>{label}</Badge>;
}

// ── Staff dialog ────────────────────────────────────────────────────

function StaffDialog({ open, onClose, initial, onSaved }: {
  open: boolean; onClose: () => void; initial?: StaffDTO | null; onSaved: () => void;
}) {
  const { t } = useLang();
  const [err, setErr] = useState("");
  const isEdit = !!initial;
  const form = useForm<CreateStaffInput | UpdateStaffInput>({
    resolver: zodResolver(isEdit ? updateStaffSchema : createStaffSchema) as never,
    defaultValues: initial
      ? { id: initial.id, name: initial.name, nameMy: initial.nameMy ?? "", role: initial.role as never, phone: initial.phone ?? "", active: initial.active }
      : { name: "", nameMy: "", email: "", role: "cashier" as never, pin: "", phone: "" },
  });
  React.useEffect(() => { if (open) { form.reset(); setErr(""); } }, [open]); // eslint-disable-line

  async function submit(d: Record<string, unknown>) {
    setErr("");
    if (d.phone) {
      const norm = normalizeMmPhone(String(d.phone));
      if (!norm) { setErr(t("common.invalid")); return; }
      d.phone = norm;
    }
    const res = isEdit ? await updateStaff({ ...d, id: initial!.id }) : await createStaff(d);
    if (!res.ok) { setErr(res.error); return; }
    onSaved(); onClose();
  }
  const e = form.formState.errors as Record<string, { message?: string }>;
  return (
    <Dialog open={open} onClose={onClose} title={t(isEdit ? "staff.editStaff" : "staff.addStaff")}>
      <form onSubmit={form.handleSubmit(submit as never)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("common.nameEn")} *</Label><Input {...form.register("name" as never)} />{e.name && <p className="text-destructive text-xs mt-1">{e.name.message}</p>}</div>
          <div><Label>{t("common.nameMy")}</Label><Input {...form.register("nameMy" as never)} className="my-text" /></div>
          {!isEdit && <div className="col-span-2"><Label>{t("common.email")} *</Label><Input type="email" {...form.register("email" as never)} />{e.email && <p className="text-destructive text-xs mt-1">{e.email.message}</p>}</div>}
          <div><Label>{t("staff.role")} *</Label>
            <Select {...form.register("role" as never)}>
              <option value="barista">{t("staff.roleBarista")}</option>
              <option value="cashier">{t("staff.roleCashier")}</option>
              <option value="manager">{t("staff.roleManager")}</option>
              <option value="owner">{t("staff.roleOwner")}</option>
            </Select>{e.role && <p className="text-destructive text-xs mt-1">{e.role.message}</p>}</div>
          <div><Label>{t("common.phone")}</Label><Input {...form.register("phone" as never)} placeholder="09xxxxxxxxx" />{e.phone && <p className="text-destructive text-xs mt-1">{e.phone.message}</p>}</div>
          {!isEdit && <div className="col-span-2"><Label>{t("staff.pin")} * ({t("staff.pinHint")})</Label><Input inputMode="numeric" {...form.register("pin" as never)} />{e.pin && <p className="text-destructive text-xs mt-1">{e.pin.message}</p>}</div>}
          {isEdit && <label className="flex items-center gap-2 text-sm col-span-2"><input type="checkbox" {...form.register("active" as never)} className="size-4" />{t("common.active")}</label>}
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

function PinDialog({ open, onClose, staff, onSaved }: {
  open: boolean; onClose: () => void; staff: StaffDTO | null; onSaved: () => void;
}) {
  const { t } = useLang();
  const [err, setErr] = useState("");
  const form = useForm<{ pin: string }>({ resolver: zodResolver(resetPinSchema.omit({ id: true })) });
  React.useEffect(() => { if (open) { form.reset(); setErr(""); } }, [open]); // eslint-disable-line
  async function submit(d: { pin: string }) {
    setErr("");
    if (!staff) return;
    const res = await resetPin({ id: staff.id, pin: d.pin });
    if (!res.ok) { setErr(res.error); return; }
    onSaved(); onClose();
  }
  return (
    <Dialog open={open} onClose={onClose} title={`${t("staff.resetPin")} — ${staff?.name ?? ""}`}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <div><Label>{t("staff.newPin")} * ({t("staff.pinHint")})</Label>
          <Input inputMode="numeric" {...form.register("pin")} />
          {form.formState.errors.pin && <p className="text-destructive text-xs mt-1">{form.formState.errors.pin.message}</p>}
        </div>
        {err && <p className="text-destructive text-sm">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>{t("staff.resetPinConfirm")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Staff tab ───────────────────────────────────────────────────────

function StaffTab() {
  const { t, lang } = useLang();
  const dn = useDisplayName();
  const [role, setRole] = useState("");
  const [dlg, setDlg] = useState<{ open: boolean; initial: StaffDTO | null }>({ open: false, initial: null });
  const [pinDlg, setPinDlg] = useState<StaffDTO | null>(null);
  const { data, isLoading, mutate } = useSWR(["staff", role], () => listStaff({ role, activeOnly: false }));
  const rows = data?.ok ? data.data : [];

  async function toggleActive(s: StaffDTO) {
    const res = await updateStaff({ id: s.id, active: !s.active });
    if (!res.ok) alert(res.error); else mutate();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-44">
          <option value="">{t("common.all")}</option>
          {["owner", "manager", "cashier", "barista"].map((r) => <option key={r} value={r}>{t(`staff.role${r[0].toUpperCase()}${r.slice(1)}` as never)}</option>)}
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setDlg({ open: true, initial: null })}>{t("staff.addStaff")}</Button>
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        {isLoading ? <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        : !rows.length ? <p className="p-8 text-center text-muted-foreground">{t("staff.noStaff")}</p>
        : <Table>
            <THead><TR><TH>{t("common.name")}</TH><TH>{t("common.email")}</TH><TH>{t("staff.role")}</TH>
              <TH>{t("common.phone")}</TH><TH>{t("common.status")}</TH><TH className="text-right">{t("common.actions")}</TH></TR></THead>
            <TBody>{rows.map((s) => (
              <TR key={s.id} className={!s.active ? "opacity-50" : ""}>
                <TD className="font-medium my-text">{dn(s.name, s.nameMy)}</TD>
                <TD className="text-muted-foreground">{s.email}</TD>
                <TD><RoleBadge role={s.role} /></TD>
                <TD>{s.phone ?? "—"}</TD>
                <TD>{s.active ? <Badge tone="success">{t("common.active")}</Badge> : <Badge tone="default">{t("common.inactive")}</Badge>}</TD>
                <TD className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setDlg({ open: true, initial: s })}>{t("common.edit")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPinDlg(s)}>{t("staff.resetPin")}</Button>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(s)}>{s.active ? t("staff.deactivate") : t("staff.activate")}</Button>
                </TD>
              </TR>
            ))}</TBody>
          </Table>}
      </CardContent></Card>
      <StaffDialog open={dlg.open} initial={dlg.initial} onClose={() => setDlg({ open: false, initial: null })} onSaved={() => mutate()} />
      <PinDialog open={!!pinDlg} staff={pinDlg} onClose={() => setPinDlg(null)} onSaved={() => mutate()} />
    </div>
  );
}

// ── Attendance tab ──────────────────────────────────────────────────

function AttendanceTab() {
  const { t, lang } = useLang();
  const today = yangonDateKey();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);

  const mine = useSWR(["my-attendance"], () => getMyAttendanceToday());
  const hist = useSWR(["attendance", from, to], () => getAttendance({ from, to, userId: "" }));
  const rows = hist.data?.ok ? hist.data.data : [];
  const my = mine.data?.ok ? mine.data.data : null;

  async function doClock(kind: "in" | "out") {
    setBusy(true);
    const res = kind === "in" ? await clockIn() : await clockOut();
    if (!res.ok) alert(res.error);
    mine.mutate(); hist.mutate();
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">{t("staff.todayStatus")}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          {!my?.clockIn ? <Badge tone="warning">{t("staff.notClockedIn")}</Badge> : (
            <div className="text-sm space-y-1">
              <div>{t("staff.clockedInAt")}: <b>{my.clockIn ? formatDateTime(my.clockIn, lang) : "—"}</b></div>
              {my.clockOut && <div>{t("staff.clockedOutAt")}: <b>{formatDateTime(my.clockOut, lang)}</b></div>}
              {my.lateMin > 0 && <div className="text-warning">{t("staff.late")}: {my.lateMin} {t("staff.minutes")}</div>}
            </div>
          )}
          <div className="flex-1" />
          {!my?.clockIn
            ? <Button onClick={() => doClock("in")} disabled={busy}>{t("staff.clockIn")}</Button>
            : !my.clockOut
              ? <Button onClick={() => doClock("out")} disabled={busy}>{t("staff.clockOut")}</Button>
              : <Badge tone="success">{t("staff.clockedOutAt")}</Badge>}
        </CardContent>
      </Card>

      <div className="flex gap-2 items-end">
        <div><Label>{t("reports.from")}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>{t("reports.to")}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        {hist.isLoading ? <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        : !rows.length ? <p className="p-8 text-center text-muted-foreground">{t("staff.noAttendance")}</p>
        : <Table>
            <THead><TR><TH>{t("common.date")}</TH><TH>{t("common.name")}</TH>
              <TH>{t("staff.clockedInAt")}</TH><TH>{t("staff.clockedOutAt")}</TH>
              <TH className="text-right">{t("staff.hours")}</TH><TH className="text-right">{t("staff.late")}</TH></TR></THead>
            <TBody>{rows.map((a) => (
              <TR key={a.id}>
                <TD className="whitespace-nowrap">{formatDate(a.date, lang)}</TD>
                <TD className="my-text">{a.userNameMy && lang === "my" ? a.userNameMy : a.userName}</TD>
                <TD className="whitespace-nowrap">{a.clockIn ? formatDateTime(a.clockIn, lang) : "—"}</TD>
                <TD className="whitespace-nowrap">{a.clockOut ? formatDateTime(a.clockOut, lang) : "—"}</TD>
                <TD className="text-right">{a.hoursWorked != null ? a.hoursWorked.toFixed(1) : "—"}</TD>
                <TD className="text-right">{a.lateMin > 0 ? `${a.lateMin} ${t("staff.minutes")}` : "—"}</TD>
              </TR>
            ))}</TBody>
          </Table>}
      </CardContent></Card>
    </div>
  );
}

// ── Roster tab ──────────────────────────────────────────────────────

function mondayOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00+06:30`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return yangonDateKey(new Date(d.getTime() - dow * 24 * 3600 * 1000));
}

function RosterTab() {
  const { t, lang } = useLang();
  const [week, setWeek] = useState(() => mondayOf(yangonDateKey()));
  const [entries, setEntries] = useState<RosterDTO[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dlg, setDlg] = useState<{ userId: string; userName: string; date: string } | null>(null);

  const { data, isLoading, mutate } = useSWR(["roster", week], () => getRoster({ weekStart: week }));
  const staff = useSWR(["staff-all"], () => listStaff({ role: "", activeOnly: true }));
  const staffRows = staff.data?.ok ? staff.data.data : [];

  React.useEffect(() => {
    if (data?.ok) { setEntries(data.data.entries); setDirty(false); }
  }, [data]);

  const days = data?.ok ? data.data.days : [];

  function addShift(userId: string, userName: string, date: string, shift: { shiftName: string; startTime: string; endTime: string }) {
    setEntries((prev) => [...prev, { id: `tmp-${Date.now()}`, userId, userName, date, ...shift }]);
    setDirty(true);
    setDlg(null);
  }
  async function removeShift(id: string) {
    if (id.startsWith("tmp-")) { setEntries((p) => p.filter((e) => e.id !== id)); setDirty(true); return; }
    const res = await deleteRosterEntry(id);
    if (res.ok) { setEntries((p) => p.filter((e) => e.id !== id)); }
  }
  async function save() {
    setSaving(true);
    const res = await saveRoster({
      weekStart: week,
      entries: entries.map((e) => ({ userId: e.userId, date: e.date, shiftName: e.shiftName, startTime: e.startTime, endTime: e.endTime })),
    });
    if (!res.ok) alert(res.error);
    setSaving(false); setDirty(false); mutate();
  }

  const dayName = (dk: string) => new Intl.DateTimeFormat(lang === "my" ? "my-MM" : "en-GB", { timeZone: "Asia/Yangon", weekday: "short" }).format(new Date(`${dk}T00:00:00+06:30`));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setWeek(mondayOf(yangonDateKey(new Date(new Date(`${week}T00:00:00+06:30`).getTime() - 7 * 86400000))))}>‹</Button>
        <span className="text-sm font-medium">{t("staff.weekOf")}: {week}</span>
        <Button size="sm" variant="outline" onClick={() => setWeek(mondayOf(yangonDateKey(new Date(new Date(`${week}T00:00:00+06:30`).getTime() + 7 * 86400000))))}>›</Button>
        <div className="flex-1" />
        {dirty && <Button size="sm" onClick={save} disabled={saving}>{t("staff.saveRoster")}</Button>}
      </div>
      {isLoading ? <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      : <div className="overflow-x-auto">
          <Table>
            <THead><TR><TH>{t("common.name")}</TH>{days.map((d) => <TH key={d}>{dayName(d)}<br /><span className="font-normal text-xs">{d.slice(5)}</span></TH>)}</TR></THead>
            <TBody>{staffRows.map((s) => (
              <TR key={s.id}>
                <TD className="font-medium whitespace-nowrap my-text">{s.nameMy && lang === "my" ? s.nameMy : s.name}<br /><span className="text-xs font-normal text-muted-foreground"><RoleBadge role={s.role} /></span></TD>
                {days.map((d) => (
                  <TD key={d} className="min-w-32 align-top">
                    <div className="space-y-1">
                      {entries.filter((e) => e.userId === s.id && e.date === d).map((e) => (
                        <div key={e.id} className="text-xs bg-primary/10 rounded px-2 py-1 flex items-center justify-between gap-1">
                          <span>{e.shiftName}<br /><span className="text-muted-foreground">{e.startTime}–{e.endTime}</span></span>
                          <button onClick={() => removeShift(e.id)} className="text-destructive cursor-pointer" aria-label="remove">✕</button>
                        </div>
                      ))}
                      <button onClick={() => setDlg({ userId: s.id, userName: s.name, date: d })}
                        className="text-xs text-muted-foreground hover:text-primary cursor-pointer">+ {t("staff.addShift")}</button>
                    </div>
                  </TD>
                ))}
              </TR>
            ))}</TBody>
          </Table>
        </div>}
      <ShiftDialog dlg={dlg} onClose={() => setDlg(null)} onAdd={addShift} />
    </div>
  );
}

function ShiftDialog({ dlg, onClose, onAdd }: {
  dlg: { userId: string; userName: string; date: string } | null;
  onClose: () => void;
  onAdd: (userId: string, userName: string, date: string, s: { shiftName: string; startTime: string; endTime: string }) => void;
}) {
  const { t } = useLang();
  const [shiftName, setShiftName] = useState(t("staff.morning"));
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("16:00");
  React.useEffect(() => { if (dlg) { setShiftName(t("staff.morning")); setStartTime("08:00"); setEndTime("16:00"); } }, [dlg, t]);
  if (!dlg) return null;
  return (
    <Dialog open={!!dlg} onClose={onClose} title={`${t("staff.addShift")} — ${dlg.userName} (${dlg.date})`}>
      <div className="space-y-4">
        <div><Label>{t("staff.shiftName")}</Label>
          <Select value={shiftName} onChange={(e) => setShiftName(e.target.value)}>
            <option value={t("staff.morning")}>{t("staff.morning")}</option>
            <option value={t("staff.evening")}>{t("staff.evening")}</option>
          </Select></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("staff.startTime")}</Label><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div><Label>{t("staff.endTime")}</Label><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => onAdd(dlg.userId, dlg.userName, dlg.date, { shiftName, startTime, endTime })}>{t("common.add")}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Page ────────────────────────────────────────────────────────────

export default function StaffPage() {
  const { t } = useLang();
  const [tab, setTab] = useState<"staff" | "attendance" | "roster">("staff");
  const tabs = [
    { id: "staff", label: t("staff.tabStaff") },
    { id: "attendance", label: t("staff.tabAttendance") },
    { id: "roster", label: t("staff.tabRoster") },
  ] as const;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold my-text">{t("staff.title")}</h1>
      <div className="flex gap-1 border-b border-border">
        {tabs.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px cursor-pointer ${tab === tb.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {tb.label}
          </button>
        ))}
      </div>
      {tab === "staff" && <StaffTab />}
      {tab === "attendance" && <AttendanceTab />}
      {tab === "roster" && <RosterTab />}
    </div>
  );
}
