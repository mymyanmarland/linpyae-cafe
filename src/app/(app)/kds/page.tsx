"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton } from "@/components/ui/card";
import {
  getKdsQueue,
  updateItemKdsStatus,
  bumpOrder,
  recallItem,
  type KdsTicket,
  type KdsTicketItem,
} from "@/app/actions/kds";

const COLUMNS = ["queued", "fired", "preparing", "ready"] as const;

const NEXT_ACTION: Record<string, string> = {
  queued: "kds.start",      // queued -> fired
  fired: "kds.start",       // fired -> preparing
  preparing: "kds.markReady", // preparing -> ready
  ready: "kds.bump",        // ready -> bumped
};

const NEXT_STATUS: Record<string, string> = {
  queued: "fired",
  fired: "preparing",
  preparing: "ready",
  ready: "bumped",
};

export default function KdsPage() {
  const { t } = useLang();
  const dn = useDisplayName();
  const [station, setStation] = useState<"all" | "barista" | "kitchen">("all");
  const [toast, setToast] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR(`kds:${station}`, async () => {
    const r = await getKdsQueue({ station });
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }, { refreshInterval: 5000, revalidateOnFocus: true });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const tickets = data?.tickets ?? [];
  const overdueMinutes = data?.overdueMinutes ?? 10;

  const byStatus = useMemo(() => {
    const map = new Map<string, Array<{ ticket: KdsTicket; item: KdsTicketItem }>>();
    for (const c of COLUMNS) map.set(c, []);
    for (const ticket of tickets) {
      for (const item of ticket.items) {
        const col = item.kdsStatus === "recalled" ? "preparing" : item.kdsStatus;
        if (map.has(col)) map.get(col)!.push({ ticket, item });
      }
    }
    return map;
  }, [tickets]);

  const advance = async (itemId: string, from: string) => {
    const to = NEXT_STATUS[from];
    if (!to || busyId) return;
    setBusyId(itemId);
    const r = await updateItemKdsStatus({ orderItemId: itemId, status: to as never });
    setBusyId(null);
    if (!r.ok) showToast(r.error);
    else mutate();
  };

  const doBumpOrder = async (orderId: string) => {
    if (busyId) return;
    setBusyId(orderId);
    const r = await bumpOrder({ orderId });
    setBusyId(null);
    if (!r.ok) showToast(r.error);
    else mutate();
  };

  const doRecall = async (itemId: string) => {
    if (busyId) return;
    setBusyId(itemId);
    const r = await recallItem({ orderItemId: itemId });
    setBusyId(null);
    if (!r.ok) showToast(r.error);
    else mutate();
  };

  const minutesSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

  const ticketLabel = (ticket: KdsTicket) => {
    const parts: string[] = [`#${ticket.orderNumber}`];
    if (ticket.queueNumber != null) parts.push(`Q${ticket.queueNumber}`);
    if (ticket.tableLabel) parts.push(ticket.tableLabel);
    return parts.join(" · ");
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t("kds.title")}</h1>
        <Badge tone="info" className="animate-pulse">{t("kds.autoRefresh")}</Badge>
        <div className="ml-auto flex gap-2">
          {(["all", "barista", "kitchen"] as const).map((s) => (
            <Button
              key={s}
              size="md"
              variant={station === s ? "primary" : "outline"}
              onClick={() => setStation(s)}
              className="min-h-[48px]"
            >
              {t(s === "all" ? "kds.allStations" : s === "barista" ? "kds.stationBarista" : "kds.stationKitchen")}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      ) : tickets.length === 0 ? (
        <p className="text-muted-foreground text-center py-16 text-lg">{t("kds.noTickets")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {COLUMNS.map((col) => {
            const cards = byStatus.get(col) ?? [];
            return (
              <div key={col} className="space-y-3">
                <div className="flex items-center gap-2 sticky top-0 bg-background py-1 z-10">
                  <h2 className="font-bold">{t(`kds.${col}`)}</h2>
                  <Badge>{cards.length}</Badge>
                </div>
                {cards.map(({ ticket, item }) => {
                  const mins = minutesSince(item.firedAt ?? item.createdAt);
                  const overdue = mins >= overdueMinutes && col !== "ready";
                  const busy = busyId === item.id;
                  return (
                    <Card
                      key={item.id}
                      className={cn(
                        "overflow-hidden",
                        overdue && "border-destructive border-2",
                        col === "ready" && "border-success"
                      )}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-base">{ticketLabel(ticket)}</CardTitle>
                          {overdue && <Badge tone="destructive">{t("kds.overdue")}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("kds.minutesAgo", { n: mins })}
                          {ticket.customerName && <span className="my-text"> · {ticket.customerName}</span>}
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-lg my-text">
                            {item.quantity}x {dn(item.name, item.nameMy)}
                          </p>
                          <Badge>{item.station}</Badge>
                        </div>
                        {item.modifiers.length > 0 && (
                          <p className="text-sm text-muted-foreground my-text">
                            {item.modifiers.map((m) => m.option).join(", ")}
                          </p>
                        )}
                        {item.notes && (
                          <p className="text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 my-text">
                            {item.notes}
                          </p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="lg"
                            onClick={() => advance(item.id, item.kdsStatus === "recalled" ? "preparing" : item.kdsStatus)}
                            disabled={busy}
                            className="flex-1 min-h-[56px]"
                            variant={col === "ready" ? "success" : "primary"}
                          >
                            {t(NEXT_ACTION[item.kdsStatus] ?? "kds.bump")}
                          </Button>
                          {(item.kdsStatus === "ready" || item.kdsStatus === "bumped") && (
                            <Button
                              size="lg"
                              variant="outline"
                              onClick={() => doRecall(item.id)}
                              disabled={busy}
                              className="min-h-[56px]"
                            >
                              {t("kds.recall")}
                            </Button>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => doBumpOrder(ticket.orderId)}
                          disabled={busyId === ticket.orderId}
                          className="w-full"
                        >
                          {t("kds.bumpOrder")}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] rounded-xl bg-foreground text-background px-5 py-3 shadow-lg text-sm font-medium my-text">
          {toast}
        </div>
      )}
    </div>
  );
}
