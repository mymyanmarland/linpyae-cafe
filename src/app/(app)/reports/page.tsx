"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, Badge, Skeleton } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { formatKs, yangonDateKey } from "@/lib/format";
import {
  salesSummary, salesByItem, salesByCategory, salesByHour,
  staffPerformance, inventoryValuation, lowStockReport,
  getDailyClose, dailyClose, type SalesSummary,
} from "@/app/actions/reports";

function todayKey(): string { return yangonDateKey(); }
function shiftKey(days: number): string {
  return yangonDateKey(new Date(Date.now() + days * 86400000));
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "neutral" }) {
  return (
    <Card><CardContent className="py-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-xl font-bold ${tone === "down" ? "text-destructive" : tone === "up" ? "text-success" : ""}`}>{value}</div>
    </CardContent></Card>
  );
}

// Simple SVG bar chart — no extra deps
function BarChart({ data, label }: { data: Array<{ hour: number; totalKs: number; count: number }>; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.totalKs));
  const W = 720, H = 180, pad = 8;
  const bw = (W - pad * 2) / data.length;
  return (
    <div>
      <div className="text-sm font-medium mb-2">{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {data.map((d, i) => {
          const h = (H - 40) * (d.totalKs / max);
          return (
            <g key={i}>
              <rect x={pad + i * bw + 1} y={H - 24 - h} width={bw - 2} height={h}
                rx={2} className="fill-primary/70">
                <title>{`${d.hour}:00 — ${d.totalKs.toLocaleString()} Ks (${d.count})`}</title>
              </rect>
              {i % 3 === 0 && (
                <text x={pad + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} className="fill-muted-foreground">{d.hour}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent></Card>
  );
}

function methodLabel(m: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    cash: t("reports.methodCash"), kbzpay: "KBZPay", wavepay: "WavePay",
    ayapay: "AYA Pay", onepay: "OnePay", mab: "MAB", card: "Card", bank_transfer: "Bank",
  };
  return map[m] ?? m;
}
function typeLabel(ty: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    dinein: t("reports.typeDinein"), dine_in: t("reports.typeDinein"),
    takeaway: t("reports.typeTakeaway"), delivery: t("reports.typeDelivery"), online: t("reports.typeOnline"),
  };
  return map[ty] ?? ty;
}

export default function ReportsPage() {
  const { t, lang } = useLang();
  const dn = useDisplayName();
  const [from, setFrom] = useState(todayKey());
  const [to, setTo] = useState(todayKey());
  const [closeDlg, setCloseDlg] = useState(false);
  const [counted, setCounted] = useState("");
  const [closeErr, setCloseErr] = useState("");

  const range = { from, to };
  const summary = useSWR(["salesSummary", from, to], () => salesSummary(range));
  const byItem = useSWR(["salesByItem", from, to], () => salesByItem(range));
  const byCat = useSWR(["salesByCategory", from, to], () => salesByCategory(range));
  const byHour = useSWR(["salesByHour", from, to], () => salesByHour(range));
  const perf = useSWR(["staffPerf", from, to], () => staffPerformance(range));
  const valuation = useSWR(["valuation"], () => inventoryValuation());
  const lowStock = useSWR(["lowStockReport"], () => lowStockReport());
  const close = useSWR(["dailyClose", to], () => getDailyClose({ date: to }));

  const s: SalesSummary | null = summary.data?.ok ? summary.data.data : null;
  const closed = close.data?.ok ? close.data.data : null;
  const loading = summary.isLoading;

  function preset(kind: "today" | "yesterday" | "last7" | "last30") {
    const td = todayKey();
    if (kind === "today") { setFrom(td); setTo(td); }
    else if (kind === "yesterday") { const y = shiftKey(-1); setFrom(y); setTo(y); }
    else if (kind === "last7") { setFrom(shiftKey(-6)); setTo(td); }
    else { setFrom(shiftKey(-29)); setTo(td); }
  }

  async function doClose() {
    setCloseErr("");
    const n = parseInt(counted.replace(/[^0-9]/g, ""), 10);
    if (Number.isNaN(n) || n < 0) { setCloseErr(t("common.invalid")); return; }
    const res = await dailyClose({ date: to, countedCashKs: n, notes: "" });
    if (!res.ok) { setCloseErr(res.error); return; }
    setCloseDlg(false); setCounted(""); close.mutate();
  }

  function exportCsv() {
    if (!s) return;
    const lines: string[][] = [
      ["Report", `${from} to ${to}`],
      [],
      ["Metric", "Value (Ks)"],
      [t("reports.grossKs"), String(s.grossKs)],
      [t("reports.discounts"), String(s.discountKs)],
      [t("reports.tax"), String(s.taxKs)],
      [t("reports.netKs"), String(s.netKs)],
      [t("reports.tips"), String(s.tipsKs)],
      [t("reports.refunds"), String(s.refundsKs)],
      [t("reports.orderCount"), String(s.orderCount)],
      [],
      [t("reports.byPaymentMethod"), ""],
      ["Method", "Total (Ks)", "Count"],
      ...s.byPaymentMethod.map((m) => [methodLabel(m.method, t), String(m.totalKs), String(m.count)]),
      [],
      [t("reports.byItem"), ""],
      ["Item", "Qty", "Revenue (Ks)"],
      ...(byItem.data?.ok ? byItem.data.data.map((i) => [i.name, String(i.qty), String(i.revenueKs)]) : []),
    ];
    const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sales-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold my-text mr-auto">{t("reports.title")}</h1>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!s}>{t("reports.exportCsv")}</Button>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div><Label>{t("reports.from")}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>{t("reports.to")}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex gap-1 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => preset("today")}>{t("reports.today")}</Button>
          <Button size="sm" variant="outline" onClick={() => preset("yesterday")}>{t("reports.yesterday")}</Button>
          <Button size="sm" variant="outline" onClick={() => preset("last7")}>{t("reports.last7")}</Button>
          <Button size="sm" variant="outline" onClick={() => preset("last30")}>{t("reports.last30")}</Button>
        </div>
      </div>

      {loading ? <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      : !s ? <p className="text-muted-foreground">{t("reports.noData")}</p>
      : <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label={t("reports.grossKs")} value={formatKs(s.grossKs)} />
            <Kpi label={t("reports.discounts")} value={formatKs(s.discountKs)} tone="down" />
            <Kpi label={t("reports.netKs")} value={formatKs(s.netKs)} tone="up" />
            <Kpi label={t("reports.tax")} value={formatKs(s.taxKs)} />
            <Kpi label={t("reports.orderCount")} value={String(s.orderCount)} />
            <Kpi label={t("reports.avgOrder")} value={formatKs(s.avgOrderKs)} />
            <Kpi label={t("reports.tips")} value={formatKs(s.tipsKs)} />
            <Kpi label={t("reports.refunds")} value={formatKs(s.refundsKs)} tone="down" />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title={t("reports.byHour")}>
              {byHour.data?.ok ? <BarChart data={byHour.data.data} label="" /> : <Skeleton className="h-40" />}
            </Section>
            <Section title={t("reports.byPaymentMethod")}>
              <Table><THead><TR><TH>{t("common.status")}</TH><TH className="text-right">{t("reports.revenue")}</TH><TH className="text-right">{t("reports.orders")}</TH></TR></THead>
                <TBody>{s.byPaymentMethod.map((m) => (
                  <TR key={m.method}><TD>{methodLabel(m.method, t)}</TD><TD className="text-right">{formatKs(m.totalKs)}</TD><TD className="text-right">{m.count}</TD></TR>
                ))}</TBody></Table>
              {!s.byPaymentMethod.length && <p className="text-sm text-muted-foreground pt-2">{t("reports.noData")}</p>}
            </Section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title={t("reports.byOrderType")}>
              <Table><THead><TR><TH>{t("common.status")}</TH><TH className="text-right">{t("reports.revenue")}</TH><TH className="text-right">{t("reports.orders")}</TH></TR></THead>
                <TBody>{s.byOrderType.map((o) => (
                  <TR key={o.type}><TD>{typeLabel(o.type, t)}</TD><TD className="text-right">{formatKs(o.totalKs)}</TD><TD className="text-right">{o.count}</TD></TR>
                ))}</TBody></Table>
              {!s.byOrderType.length && <p className="text-sm text-muted-foreground pt-2">{t("reports.noData")}</p>}
            </Section>
            <Section title={t("reports.byCategory")}>
              <Table><THead><TR><TH>{t("reports.byCategory")}</TH><TH className="text-right">{t("reports.qty")}</TH><TH className="text-right">{t("reports.revenue")}</TH></TR></THead>
                <TBody>{(byCat.data?.ok ? byCat.data.data : []).slice(0, 8).map((c) => (
                  <TR key={c.categoryId ?? "x"}><TD className="my-text">{dn(c.name, c.nameMy)}</TD><TD className="text-right">{c.qty}</TD><TD className="text-right">{formatKs(c.revenueKs)}</TD></TR>
                ))}</TBody></Table>
              {!(byCat.data?.ok && byCat.data.data.length) && <p className="text-sm text-muted-foreground pt-2">{t("reports.noData")}</p>}
            </Section>
          </div>

          <Section title={t("reports.byItem")}>
            <div className="max-h-80 overflow-y-auto">
              <Table><THead><TR><TH>{t("reports.item")}</TH><TH className="text-right">{t("reports.qty")}</TH><TH className="text-right">{t("reports.revenue")}</TH></TR></THead>
                <TBody>{(byItem.data?.ok ? byItem.data.data : []).slice(0, 30).map((i, idx) => (
                  <TR key={idx}><TD className="my-text">{dn(i.name, i.nameMy)}</TD><TD className="text-right">{i.qty}</TD><TD className="text-right">{formatKs(i.revenueKs)}</TD></TR>
                ))}</TBody></Table>
              {!(byItem.data?.ok && byItem.data.data.length) && <p className="text-sm text-muted-foreground p-2">{t("reports.noData")}</p>}
            </div>
          </Section>

          <Section title={t("reports.staffPerformance")}>
            <Table><THead><TR><TH>{t("common.name")}</TH><TH className="text-right">{t("reports.orders")}</TH><TH className="text-right">{t("reports.netKs")}</TH></TR></THead>
              <TBody>{(perf.data?.ok ? perf.data.data : []).map((p) => (
                <TR key={p.userId}><TD className="my-text">{dn(p.name, p.nameMy)}</TD><TD className="text-right">{p.orders}</TD><TD className="text-right">{formatKs(p.netKs)}</TD></TR>
              ))}</TBody></Table>
            {!(perf.data?.ok && perf.data.data.length) && <p className="text-sm text-muted-foreground pt-2">{t("reports.noData")}</p>}
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title={`${t("reports.inventoryValuation")} (${valuation.data?.ok ? formatKs(valuation.data.data.totalKs) : "…"})`}>
              <div className="max-h-64 overflow-y-auto">
                <Table><THead><TR><TH>{t("reports.item")}</TH><TH className="text-right">{t("inventory.stock")}</TH><TH className="text-right">{t("reports.revenue")}</TH></TR></THead>
                  <TBody>{(valuation.data?.ok ? valuation.data.data.items : []).map((v) => (
                    <TR key={v.id}><TD className="my-text">{dn(v.name, v.nameMy)}</TD><TD className="text-right">{v.stockDisplay} {v.unit}</TD><TD className="text-right">{formatKs(v.valueKs)}</TD></TR>
                  ))}</TBody></Table>
              </div>
            </Section>
            <Section title={t("reports.lowStock")}>
              {(lowStock.data?.ok ? lowStock.data.data : []).map((l) => (
                <div key={l.id} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
                  <span className="my-text">{dn(l.name, l.nameMy)}</span>
                  <Badge tone="destructive">{l.stockDisplay} / {l.thresholdDisplay} {l.unit}</Badge>
                </div>
              ))}
              {!(lowStock.data?.ok && lowStock.data.data.length) && <p className="text-sm text-muted-foreground">{t("reports.noData")}</p>}
            </Section>
          </div>

          <Section title={t("reports.dailyClose")}>
            {closed ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-muted-foreground">{t("reports.netKs")}</div><b>{formatKs(closed.netKs)}</b></div>
                <div><div className="text-muted-foreground">{t("reports.expectedCash")}</div><b>{formatKs(closed.cashKs)}</b></div>
                <div><div className="text-muted-foreground">{t("reports.countedCash")}</div><b>{closed.countedCashKs != null ? formatKs(closed.countedCashKs) : "—"}</b></div>
                <div><div className="text-muted-foreground">{t("reports.variance")}</div>
                  <b className={closed.varianceKs != null && closed.varianceKs < 0 ? "text-destructive" : "text-success"}>
                    {closed.varianceKs != null ? `${closed.varianceKs > 0 ? "+" : ""}${formatKs(closed.varianceKs)}` : "—"}
                  </b></div>
                <div className="col-span-full text-xs text-muted-foreground">{t("reports.closedAt")}: {closed.createdAt}</div>
                <div className="col-span-full"><Button size="sm" variant="outline" onClick={() => setCloseDlg(true)}>{t("reports.closeDay")} ({t("common.update")})</Button></div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">{t("reports.closeConfirm")}</p>
                <div className="flex-1" />
                <Button size="sm" onClick={() => setCloseDlg(true)}>{t("reports.closeDay")}</Button>
              </div>
            )}
          </Section>
        </>}

      <Dialog open={closeDlg} onClose={() => setCloseDlg(false)} title={`${t("reports.dailyClose")} — ${to}`}>
        <div className="space-y-4">
          {closed && <p className="text-sm">{t("reports.expectedCash")}: <b>{formatKs(closed.cashKs)}</b></p>}
          <div><Label>{t("reports.countedCash")} *</Label>
            <Input inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" /></div>
          {closeErr && <p className="text-destructive text-sm">{closeErr}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCloseDlg(false)}>{t("common.cancel")}</Button>
            <Button onClick={doClose}>{t("reports.closeDay")}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
