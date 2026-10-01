"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { formatKs, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { listOrders, getOrder, updateOrderStatus } from "@/app/actions/orders";
import { voidOrder, voidCompletedOrder, createRefund, verifyManagerPin } from "@/app/actions/pos";
import { ReceiptPrint } from "@/components/pos/ReceiptPrint";

const STATUSES = ["active", "open", "held", "fired", "preparing", "ready", "completed", "voided"] as const;
const TYPES = ["dinein", "takeaway", "delivery", "online"] as const;

const statusTone = (s: string): "info" | "default" | "success" | "destructive" => {
  if (s === "completed") return "success";
  if (s === "voided") return "destructive";
  if (s === "ready") return "info";
  return "default";
};

export default function OrdersPage() {
  const { t, lang } = useLang();
  const dn = useDisplayName();
  const [toast, setToast] = useState("");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [type, setType] = useState<string>("");
  const [date, setDate] = useState("");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinAction, setPinAction] = useState<"void" | "refund" | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  };

  const key = useMemo(
    () => `orders:${page}:${search}:${status}:${type}:${date}`,
    [page, search, status, type, date]
  );
  const { data, isLoading, mutate } = useSWR(key, async () => {
    const r = await listOrders({
      page, pageSize: 15, search,
      status: status === "active" ? "active" : (status as never),
      type: type ? (type as never) : undefined,
      date: date || undefined,
    });
    if (!r.ok) throw new Error(r.error);
    return r.data;
  });

  const { data: detail, mutate: mutateDetail } = useSWR(
    detailId ? `orders:detail:${detailId}` : null,
    async () => {
      const r = await getOrder({ orderId: detailId! });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
  );

  const refresh = () => {
    mutate();
    if (detailId) mutateDetail();
  };

  const openDetail = (id: string) => setDetailId(id);

  const doUpdateStatus = async () => {
    if (!detailId || !newStatus) return;
    setBusy(true);
    const r = await updateOrderStatus({ orderId: detailId, status: newStatus as never });
    setBusy(false);
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    setStatusOpen(false);
    setNewStatus("");
    showToast(t("orders.statusUpdated"));
    refresh();
  };

  const doVoid = async (approverPin?: string) => {
    if (!detailId) return;
    setBusy(true);
    // Completed orders can't be plain-voided: voidCompletedOrder issues a full
    // refund and marks the order voided instead.
    const r = detail?.status === "completed"
      ? await voidCompletedOrder({ orderId: detailId, reason: voidReason, approverPin })
      : await voidOrder({ orderId: detailId, reason: voidReason, approverPin });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "pos.approvalNeeded") {
        setPinAction("void");
        setPinOpen(true);
        return;
      }
      showToast(r.error);
      return;
    }
    setStatusOpen(false);
    setVoidReason("");
    showToast(t("pos.orderVoided"));
    refresh();
  };

  const doRefund = async (approverPin?: string) => {
    if (!detailId || !refundAmount) return;
    setBusy(true);
    const r = await createRefund({
      orderId: detailId,
      amountKs: parseFloat(refundAmount) || 0,
      reason: refundReason,
      method: refundMethod as never,
      approverPin,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "pos.approvalNeeded") {
        setPinAction("refund");
        setPinOpen(true);
        return;
      }
      showToast(r.error);
      return;
    }
    setRefundOpen(false);
    setRefundAmount("");
    setRefundReason("");
    showToast(t("pos.refundDone"));
    refresh();
  };

  const confirmPin = async () => {
    const r = await verifyManagerPin({ pin });
    if (!r.ok) {
      showToast(t("pos.invalidPin"));
      return;
    }
    setPin("");
    setPinOpen(false);
    if (pinAction === "void") {
      setPinAction(null);
      doVoid(pin);
    } else if (pinAction === "refund") {
      setPinAction(null);
      doRefund(pin);
    }
  };

  const paid = detail ? detail.payments.reduce((s, p) => s + (p.status === "confirmed" ? p.amountKs : 0), 0) : 0;
  const refunded = detail ? detail.refunds.reduce((s, x) => s + x.amountKs, 0) : 0;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold">{t("orders.title")}</h1>

      {/* filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="col-span-2">
              <Input
                placeholder={t("orders.search")}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-11"
              />
            </div>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-11">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(s === "active" ? "orders.active" : `orders.status${s.charAt(0).toUpperCase()}${s.slice(1)}`)}</option>
              ))}
            </Select>
            <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="h-11">
              <option value="">{t("orders.all")}</option>
              {TYPES.map((x) => (
                <option key={x} value={x}>{t(`orders.type${x.charAt(0).toUpperCase()}${x.slice(1)}`)}</option>
              ))}
            </Select>
            <Input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setPage(1); }}
              className="h-11"
            />
          </div>
        </CardContent>
      </Card>

      {/* list */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !data || data.orders.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">{t("orders.noOrders")}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>{t("orders.typeDinein")}/{t("orders.typeTakeaway")}</TH>
                  <TH>{t("orders.customer")}</TH>
                  <TH>{t("orders.items")}</TH>
                  <TH>{t("orders.total")}</TH>
                  <TH>{t("orders.filterStatus")}</TH>
                  <TH>{t("orders.createdAt")}</TH>
                </TR>
              </THead>
              <TBody>
                {data.orders.map((o) => (
                  <TR key={o.id} className="cursor-pointer hover:bg-accent/50" onClick={() => openDetail(o.id)}>
                    <TD className="font-mono text-xs">
                      {o.orderNumber}
                      {o.queueNumber != null && <span className="block text-muted-foreground">Q{o.queueNumber}</span>}
                    </TD>
                    <TD className="text-sm">
                      {t(`orders.type${o.type.charAt(0).toUpperCase()}${o.type.slice(1)}`)}
                      {o.tableLabel && <span className="block text-muted-foreground text-xs">{o.tableLabel}</span>}
                    </TD>
                    <TD className="text-sm my-text">{o.customerName ?? "—"}</TD>
                    <TD className="text-sm">{o.itemCount}</TD>
                    <TD className="font-semibold">{formatKs(o.totalKs)}</TD>
                    <TD><Badge tone={statusTone(o.status)}>{t(`orders.status${o.status.charAt(0).toUpperCase()}${o.status.slice(1)}`)}</Badge></TD>
                    <TD className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(o.createdAt, lang)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("orders.prev")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("orders.page")} {data.page} {t("orders.of")} {data.totalPages}
          </span>
          <Button variant="outline" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            {t("orders.next")}
          </Button>
        </div>
      )}

      {/* ── detail dialog ── */}
      <Dialog open={!!detailId} onClose={() => setDetailId(null)} title={detail ? `#${detail.orderNumber}` : t("orders.detail")} wide>
        {!detail ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge tone={statusTone(detail.status)}>{t(`orders.status${detail.status.charAt(0).toUpperCase()}${detail.status.slice(1)}`)}</Badge>
              <Badge>{t(`orders.type${detail.type.charAt(0).toUpperCase()}${detail.type.slice(1)}`)}</Badge>
              {detail.table && <Badge>{detail.table.label}</Badge>}
              {detail.queueNumber != null && <Badge>Q{detail.queueNumber}</Badge>}
              <span className="text-xs text-muted-foreground ml-auto">{formatDateTime(detail.createdAt, lang)}</span>
            </div>

            {(detail.customerName || detail.customer) && (
              <p className="text-sm my-text">
                <span className="text-muted-foreground">{t("orders.customer")}: </span>
                {detail.customer ? dn(detail.customer.name, detail.customer.nameMy) : detail.customerName}
                {detail.customerPhone && <span className="text-muted-foreground"> · {detail.customerPhone}</span>}
              </p>
            )}
            {detail.createdBy && (
              <p className="text-sm"><span className="text-muted-foreground">{t("orders.createdBy")}: </span>{detail.createdBy.name}</p>
            )}

            <div>
              <h3 className="font-semibold mb-2">{t("orders.items")}</h3>
              <div className="space-y-1.5">
                {detail.items.map((i) => (
                  <div key={i.id} className="flex justify-between text-sm gap-2">
                    <span className="my-text">{i.quantity}x {lang === "my" ? i.nameMy || i.name : i.name}
                      <span className="text-muted-foreground text-xs"> ({i.kdsStatus})</span>
                    </span>
                    <span className="font-medium whitespace-nowrap">{formatKs(i.lineTotalKs)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-2 space-y-1 text-sm">
              <div className="flex justify-between"><span>{t("orders.subtotal")}</span><span>{formatKs(detail.subtotalKs)}</span></div>
              {detail.discountKs > 0 && <div className="flex justify-between"><span>{t("orders.discount")}</span><span>−{formatKs(detail.discountKs)}</span></div>}
              {detail.taxKs > 0 && <div className="flex justify-between"><span>{t("orders.tax")}</span><span>{formatKs(detail.taxKs)}</span></div>}
              <div className="flex justify-between font-bold text-base"><span>{t("orders.total")}</span><span>{formatKs(detail.totalKs)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>{t("orders.paid")}</span><span>{formatKs(paid)}</span></div>
              {detail.changeKs > 0 && <div className="flex justify-between text-muted-foreground"><span>{t("orders.change")}</span><span>{formatKs(detail.changeKs)}</span></div>}
              {refunded > 0 && <div className="flex justify-between text-destructive"><span>{t("orders.refunds")}</span><span>−{formatKs(refunded)}</span></div>}
            </div>

            {detail.payments.length > 0 && (
              <div>
                <h3 className="font-semibold mb-1">{t("orders.payments")}</h3>
                {detail.payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-sm">
                    <span>{p.method}{p.reference ? ` (${p.reference})` : ""} <span className="text-muted-foreground">· {p.status}</span></span>
                    <span>{formatKs(p.amountKs)}</span>
                  </div>
                ))}
              </div>
            )}
            {detail.refunds.length > 0 && (
              <div>
                <h3 className="font-semibold mb-1">{t("orders.refunds")}</h3>
                {detail.refunds.map((x) => (
                  <div key={x.id} className="flex justify-between text-sm">
                    <span className="my-text">{x.reason}</span>
                    <span>−{formatKs(x.amountKs)}</span>
                  </div>
                ))}
              </div>
            )}
            {detail.notes && <p className="text-sm my-text"><span className="text-muted-foreground">{t("orders.notes")}: </span>{detail.notes}</p>}

            {!["completed", "voided"].includes(detail.status) && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="md" variant="outline" onClick={() => setStatusOpen(true)}>{t("orders.updateStatus")}</Button>
                <Button size="md" variant="outline" onClick={() => setReceiptOpen(true)}>{t("orders.printReceipt")}</Button>
                <Button size="md" variant="outline" onClick={() => { setRefundOpen(true); setRefundAmount(String(Math.max(0, paid - refunded))); }}>
                  {t("pos.refund")}
                </Button>
              </div>
            )}
            {detail.status === "completed" && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="md" variant="outline" onClick={() => setReceiptOpen(true)}>{t("orders.printReceipt")}</Button>
                <Button size="md" variant="outline" onClick={() => { setRefundOpen(true); setRefundAmount(String(Math.max(0, paid - refunded))); }}>
                  {t("pos.refund")}
                </Button>
                <Button size="md" variant="destructive" onClick={() => setStatusOpen(true)}>{t("orders.void")}</Button>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* ── status update dialog (also hosts void / void-completed) ── */}
      <Dialog open={statusOpen} onClose={() => setStatusOpen(false)} title={detail?.status === "completed" ? t("orders.void") : t("orders.updateStatus")}>
        <div className="space-y-3">
          {detail?.status !== "completed" && (
            <>
              <div>
                <Label>{t("orders.filterStatus")}</Label>
                <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="h-12 mt-1">
                  <option value="">—</option>
                  {["held", "fired", "preparing", "ready", "completed"].map((s) => (
                    <option key={s} value={s}>{t(`orders.status${s.charAt(0).toUpperCase()}${s.slice(1)}`)}</option>
                  ))}
                </Select>
              </div>
              <Button size="lg" onClick={doUpdateStatus} disabled={!newStatus || busy} className="w-full min-h-[56px]">
                {t("orders.updateStatus")}
              </Button>
            </>
          )}
          <div className={detail?.status === "completed" ? "pt-1" : "border-t border-border pt-3"}>
            <Label>{t("orders.void")}</Label>
            {detail?.status === "completed" && (
              <p className="my-text mt-1 text-xs text-muted-foreground">{t("orders.voidCompletedHint")}</p>
            )}
            <Textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder={t("pos.voidReason")}
              rows={2}
              className="mt-1"
            />
            <Button size="lg" variant="destructive" onClick={() => doVoid()} disabled={!voidReason.trim() || busy} className="w-full min-h-[56px] mt-2">
              {t("orders.void")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ── refund dialog ── */}
      <Dialog open={refundOpen} onClose={() => setRefundOpen(false)} title={t("pos.refund")}>
        <div className="space-y-3">
          <div>
            <Label>{t("pos.refundAmount")}</Label>
            <Input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} inputMode="decimal" className="h-12 mt-1 text-lg font-semibold" />
          </div>
          <div>
            <Label>{t("pos.refundReason")}</Label>
            <Textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={2} className="mt-1" />
          </div>
          <div>
            <Label>{t("pos.paymentMethod")}</Label>
            <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className="h-12 mt-1">
              {["cash", "kbzpay", "wavepay", "ayapay", "onepay", "card", "bank_transfer"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </div>
          <Button size="lg" onClick={() => doRefund()} disabled={!refundAmount || !refundReason.trim() || busy} className="w-full min-h-[56px]">
            {t("pos.refund")} · {formatKs(parseFloat(refundAmount) || 0)}
          </Button>
        </div>
      </Dialog>

      {/* ── manager PIN dialog ── */}
      <Dialog open={pinOpen} onClose={() => { setPinOpen(false); setPinAction(null); }} title={t("pos.approvalNeeded")}>
        <div className="space-y-3">
          <Input
            type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
            className="h-14 text-center text-2xl tracking-widest" maxLength={8} autoFocus
          />
          <Button size="lg" onClick={confirmPin} className="w-full min-h-[56px]">{t("pos.confirmPayment")}</Button>
        </div>
      </Dialog>

      {/* ── receipt dialog ── */}
      <Dialog open={receiptOpen} onClose={() => setReceiptOpen(false)} title={t("orders.printReceipt")} wide>
        {detail && (
          <div className="space-y-4">
            <ReceiptPrint
              order={{
                orderNumber: detail.orderNumber,
                queueNumber: detail.queueNumber,
                type: detail.type,
                createdAt: detail.createdAt,
                customerName: detail.customerName,
                table: detail.table,
                subtotalKs: detail.subtotalKs,
                discountKs: detail.discountKs,
                taxKs: detail.taxKs,
                serviceKs: detail.serviceKs,
                deliveryFeeKs: detail.deliveryFeeKs,
                totalKs: detail.totalKs,
                paidKs: detail.paidKs,
                changeKs: detail.changeKs,
                items: detail.items.map((i) => ({
                  name: i.name, nameMy: i.nameMy, quantity: i.quantity, unitPriceKs: i.unitPriceKs,
                  modifiersJson: i.modifiersJson, modifiersTotalKs: i.modifiersTotalKs,
                  lineTotalKs: i.lineTotalKs, notes: i.notes,
                })),
                payments: detail.payments.map((p) => ({ method: p.method, amountKs: p.amountKs, reference: p.reference })),
              }}
              branch={null}
              settings={{ receiptHeader: [], receiptFooter: [], taxId: "" }}
              cashierName={detail.createdBy?.name}
            />
            <Button size="lg" onClick={() => window.print()} className="w-full min-h-[56px] print:hidden">
              {t("orders.printReceipt")}
            </Button>
          </div>
        )}
      </Dialog>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] rounded-xl bg-foreground text-background px-5 py-3 shadow-lg text-sm font-medium my-text">
          {toast}
        </div>
      )}
    </div>
  );
}
