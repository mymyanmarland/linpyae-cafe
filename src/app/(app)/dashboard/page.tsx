"use client";

import React, { useEffect, useState } from "react";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { getDashboardStats, type DashboardStats } from "@/app/actions/dashboard";
import { formatKs } from "@/lib/format";
import { Card, CardHeader, CardTitle, CardContent, Badge, Skeleton } from "@/components/ui/card";
import { cn } from "@/lib/cn";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function WeekChart({ data, lang }: { data: DashboardStats["weekRevenue"]; lang: "my" | "en" }) {
  const max = Math.max(1, ...data.map((d) => d.revenueKs));
  const dayLabel = (iso: string) => {
    const d = new Date(iso + "T00:00:00+06:30");
    return d.toLocaleDateString(lang === "my" ? "my-MM" : "en-US", { weekday: "short", timeZone: "Asia/Yangon" });
  };
  return (
    <div className="flex h-40 items-end gap-2">
      {data.map((d) => (
        <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
          <div className="text-[10px] tabular-nums text-muted-foreground">
            {d.revenueKs >= 1000 ? `${Math.round(d.revenueKs / 1000)}k` : d.revenueKs}
          </div>
          <div
            className="w-full rounded-t-md bg-primary/80"
            style={{ height: `${Math.max(4, (d.revenueKs / max) * 100)}%` }}
            title={`${d.date}: ${formatKs(d.revenueKs)}`}
          />
          <div className="text-[10px] text-muted-foreground">{dayLabel(d.date)}</div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { t, lang } = useLang();
  const dn = useDisplayName();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getDashboardStats().then((r) => {
      if (r.ok) setStats(r.data);
      else setError(r.error);
    });
  }, []);

  if (error) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="pt-4 text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  const ts = stats.tableStatus;
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">{t("dashboard.title")}</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`${t("dashboard.revenue")} (${t("dashboard.today")})`} value={formatKs(stats.today.revenueKs)} />
        <Kpi label={`${t("dashboard.orders")} (${t("dashboard.today")})`} value={String(stats.today.orderCount)} />
        <Kpi label={t("dashboard.avgTicket")} value={formatKs(stats.today.avgTicketKs)} />
        <Kpi
          label={t("dashboard.activeTables")}
          value={`${stats.activeTables}/${stats.totalTables}`}
          sub={`${t("dashboard.openOrders")}: ${stats.openOrders}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Week revenue */}
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.weekRevenue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekChart data={stats.weekRevenue} lang={lang} />
          </CardContent>
        </Card>

        {/* Top items */}
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.topItems")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topItems.length === 0 ? (
              <p className="my-text text-sm text-muted-foreground">{t("dashboard.noTopItems")}</p>
            ) : (
              <ul className="space-y-2">
                {stats.topItems.map((it, i) => (
                  <li key={it.id} className="flex items-center justify-between gap-2">
                    <span className="my-text truncate text-sm">
                      <span className="mr-2 font-bold text-muted-foreground">{i + 1}</span>
                      {dn(it.name, it.nameMy)}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {it.qty} {t("dashboard.units")} · {formatKs(it.revenueKs)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Low stock */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {t("dashboard.lowStock")}
              {stats.lowStockCount > 0 && <Badge tone="warning">{stats.lowStockCount}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.lowStockCount === 0 ? (
              <p className="my-text text-sm text-muted-foreground">{t("dashboard.noLowStock")}</p>
            ) : (
              <>
                <p className="my-text mb-2 text-xs text-muted-foreground">{t("dashboard.lowStockDesc")}</p>
                <ul className="space-y-1">
                  {stats.lowStockItems.map((i) => (
                    <li key={i.id} className="flex justify-between text-sm">
                      <span className="my-text">{dn(i.name, i.nameMy)}</span>
                      <span className="tabular-nums text-warning">
                        {i.currentStock} {i.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        {/* Tables + shift */}
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.tableStatus")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["free", "success"],
                  ["occupied", "destructive"],
                  ["reserved", "info"],
                  ["cleaning", "warning"],
                ] as Array<[string, "success" | "destructive" | "info" | "warning"]>
              ).map(([k, tone]) => (
                <Badge key={k} tone={tone} className={cn("text-sm")}>
                  {t(`dashboard.${k}`)}: {ts[k] ?? 0}
                </Badge>
              ))}
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("dashboard.onShift")}</div>
              {stats.onShift.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {stats.onShift.map((s) => (
                    <Badge key={s.id} tone="default">
                      {dn(s.name, s.nameMy)} · {s.role}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
