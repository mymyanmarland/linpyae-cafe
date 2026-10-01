"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { formatKs } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import {
  getPosData,
  createOrder,
  holdOrder,
  fireOrder,
  addPayment,
  applyDiscount,
  verifyManagerPin,
  attachCustomer,
  lookupCustomer,
  getOrderDetail,
  type PosMenuData,
  type OrderSummary,
} from "@/app/actions/pos";
import { ReceiptPrint, type ReceiptOrder } from "@/components/pos/ReceiptPrint";

type CartModifier = { groupId: string; group: string; optionId: string; option: string; delta: number };
type CartLine = {
  key: string;
  menuItemId: string;
  name: string;
  nameMy: string | null;
  priceKs: number;
  station: string;
  qty: number;
  modifiers: CartModifier[];
  notes: string;
};

type CustomerPick = { id: string; name: string; nameMy: string | null; phone: string } | null;

const PAY_METHODS = ["cash", "kbzpay", "wavepay", "ayapay", "onepay", "card", "bank_transfer"] as const;
const QUICK_CASH = [1000, 5000, 10000, 20000];

export default function PosPage() {
  const { t, lang } = useLang();
  const dn = useDisplayName();
  const [toast, setToast] = useState("");

  const { data, isLoading, mutate } = useSWR("pos:data", async () => {
    const r = await getPosData();
    if (!r.ok) throw new Error(r.error);
    return r.data;
  });

  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<"dinein" | "takeaway" | "delivery">("dinein");
  const [tableId, setTableId] = useState<string>("");
  const [customer, setCustomer] = useState<CustomerPick>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountType, setDiscountType] = useState<"none" | "percent" | "amount">("none");
  const [discountValue, setDiscountValue] = useState("");
  const [orderNotes, setOrderNotes] = useState("");

  // modifier dialog
  const [modItem, setModItem] = useState<PosMenuData["items"][number] | null>(null);
  const [modSel, setModSel] = useState<Record<string, string[]>>({}); // groupId -> optionIds
  const [modNotes, setModNotes] = useState("");

  // customer dialog
  const [custOpen, setCustOpen] = useState(false);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<Array<{ id: string; name: string; nameMy: string | null; phone: string; points: number; stamps: number }>>([]);

  // discount approval PIN
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pendingDiscount, setPendingDiscount] = useState(false);

  // current order + payment dialog
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<string>("cash");
  const [payAmount, setPayAmount] = useState("");
  const [tendered, setTendered] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payTip, setPayTip] = useState("");
  const [payBusy, setPayBusy] = useState(false);

  // receipt dialog
  const [receipt, setReceipt] = useState<{ order: ReceiptOrder; branch: never; settings: never; cashier: string } | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const [placing, setPlacing] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  };

  // ── cart math (mirrors server computeTotals for display) ──
  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + (l.priceKs + l.modifiers.reduce((a, m) => a + m.delta, 0)) * l.qty, 0);
    let discountKs = 0;
    if (discountType === "percent") discountKs = Math.round((subtotal * (parseFloat(discountValue) || 0)) / 100);
    else if (discountType === "amount") discountKs = Math.min(parseFloat(discountValue) || 0, subtotal);
    const after = subtotal - discountKs;
    const rate = data?.settings.taxRate ?? 0;
    const inclusive = data?.settings.taxInclusive ?? true;
    let taxKs = 0;
    let total = after;
    if (rate > 0) {
      if (inclusive) taxKs = Math.round(after - after / (1 + rate / 100));
      else { taxKs = Math.round((after * rate) / 100); total = after + taxKs; }
    }
    return { subtotal, discountKs, taxKs, total };
  }, [cart, discountType, discountValue, data]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    return data.items.filter(
      (i) =>
        (activeCat === "all" || i.categoryId === activeCat) &&
        (search === "" ||
          i.name.toLowerCase().includes(search.toLowerCase()) ||
          (i.nameMy ?? "").includes(search))
    );
  }, [data, activeCat, search]);

  const groupsFor = (menuItemId: string) =>
    data?.modifierGroups.filter((g) => g.itemIds.includes(menuItemId)) ?? [];

  // ── cart ops ──
  const openModifiers = (item: PosMenuData["items"][number]) => {
    const groups = groupsFor(item.id);
    if (groups.length === 0) {
      addLine(item, [], "");
      return;
    }
    const init: Record<string, string[]> = {};
    for (const g of groups) {
      if (g.required && g.options.length > 0 && !g.multiSelect) init[g.id] = [g.options[0].id];
    }
    setModSel(init);
    setModNotes("");
    setModItem(item);
  };

  const toggleModOption = (groupId: string, optionId: string, multi: boolean) => {
    setModSel((prev) => {
      const cur = prev[groupId] ?? [];
      if (multi) {
        return { ...prev, [groupId]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
      }
      return { ...prev, [groupId]: [optionId] };
    });
  };

  const addLine = (item: PosMenuData["items"][number], modifiers: CartModifier[], notes: string) => {
    const key = `${item.id}|${modifiers.map((m) => m.optionId).sort().join(",")}|${notes}`;
    setCart((prev) => {
      const found = prev.find((l) => l.key === key);
      if (found) return prev.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + 1) } : l));
      return [...prev, { key, menuItemId: item.id, name: item.name, nameMy: item.nameMy, priceKs: item.priceKs, station: item.station, qty: 1, modifiers, notes }];
    });
    setModItem(null);
  };

  const confirmModifiers = () => {
    if (!modItem || !data) return;
    const groups = groupsFor(modItem.id);
    for (const g of groups) {
      if (g.required && !(modSel[g.id]?.length)) {
        showToast(g.name);
        return;
      }
    }
    const modifiers: CartModifier[] = [];
    for (const g of groups) {
      for (const oid of modSel[g.id] ?? []) {
        const o = g.options.find((x) => x.id === oid);
        if (o) modifiers.push({ groupId: g.id, group: g.name, optionId: o.id, option: o.name, delta: o.priceDeltaKs });
      }
    }
    addLine(modItem, modifiers, modNotes);
  };

  const setQty = (key: string, qty: number) => {
    if (qty <= 0) setCart((prev) => prev.filter((l) => l.key !== key));
    else setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.min(99, qty) } : l)));
  };

  const clearAll = () => {
    setCart([]);
    setOrder(null);
    setTableId("");
    setCustomer(null);
    setCustomerName("");
    setCustomerPhone("");
    setDiscountType("none");
    setDiscountValue("");
    setOrderNotes("");
  };

  // ── place order ──
  const discountNeedsPin = () =>
    (discountType === "percent" && (parseFloat(discountValue) || 0) > 20) ||
    (discountType === "amount" && (parseFloat(discountValue) || 0) > 10000);

  const doPlaceOrder = async (approverPin?: string) => {
    if (cart.length === 0) return;
    if (orderType === "dinein" && !tableId) {
      showToast(t("pos.requiresTable"));
      return;
    }
    setPlacing(true);
    const r = await createOrder({
      type: orderType,
      tableId: orderType === "dinein" ? tableId : null,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? customerName,
      customerPhone: customer?.phone ?? customerPhone,
      items: cart.map((l) => ({
        menuItemId: l.menuItemId,
        qty: l.qty,
        unitPrice: l.priceKs,
        modifiersJson: JSON.stringify(l.modifiers.map((m) => ({ group: m.group, option: m.option, delta: m.delta }))),
        notes: l.notes,
      })),
      discountType,
      discountValue: parseFloat(discountValue) || 0,
      notes: orderNotes,
      approverPin,
    });
    setPlacing(false);
    if (!r.ok) {
      if (r.error === "pos.approvalNeeded") {
        setPendingDiscount(true);
        setPinOpen(true);
        return;
      }
      showToast(r.error);
      return;
    }
    setOrder(r.data);
    setCart([]);
    mutate(); // refresh table statuses
    showToast(t("pos.orderCreated", { num: r.data.orderNumber }));
    setPayOpen(true);
    setPayAmount(String(r.data.totalKs - r.data.paidKs));
    setTendered("");
    setPayRef("");
    setPayTip("");
  };

  const placeOrder = () => {
    if (discountNeedsPin()) {
      setPendingDiscount(true);
      setPinOpen(true);
      return;
    }
    doPlaceOrder();
  };

  const confirmPin = async () => {
    const r = await verifyManagerPin({ pin });
    if (!r.ok) {
      showToast(t("pos.invalidPin"));
      return;
    }
    setPin("");
    setPinOpen(false);
    if (pendingDiscount) {
      setPendingDiscount(false);
      doPlaceOrder(pin);
    }
  };

  const doHold = async () => {
    if (!order) return;
    const r = await holdOrder({ orderId: order.id });
    if (!r.ok) showToast(r.error);
    else {
      setOrder(r.data);
      showToast(t("pos.orderHeld"));
    }
  };

  const doFire = async () => {
    if (!order) return;
    const r = await fireOrder({ orderId: order.id });
    if (!r.ok) showToast(r.error);
    else {
      setOrder(r.data);
      showToast(t("pos.orderFired"));
    }
  };

  // ── payments ──
  const remaining = order ? Math.max(0, order.totalKs - order.paidKs) : 0;
  const payAmt = parseFloat(payAmount) || 0;
  const tenderedAmt = payMethod === "cash" ? parseFloat(tendered) || 0 : payAmt;
  const change = Math.max(0, tenderedAmt - payAmt);

  const submitPayment = async () => {
    if (!order || payAmt <= 0 || payBusy) return;
    setPayBusy(true);
    const r = await addPayment({
      orderId: order.id,
      method: payMethod,
      amount: Math.min(payAmt, remaining || payAmt),
      reference: payRef,
      tipAmount: parseFloat(payTip) || 0,
      tenderedKs: payMethod === "cash" && tenderedAmt > 0 ? tenderedAmt : undefined,
    });
    setPayBusy(false);
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    setOrder(r.data.summary);
    const left = Math.max(0, r.data.summary.totalKs - r.data.summary.paidKs);
    setPayAmount(left > 0 ? String(left) : "");
    setTendered("");
    setPayRef("");
    setPayTip("");
    if (left <= 0) {
      setPayOpen(false);
      openReceipt(r.data.summary.id);
    }
  };

  const openReceipt = async (orderId: string) => {
    const r = await getOrderDetail({ orderId });
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    const { order: o, branch, settings } = r.data;
    setReceipt({
      order: {
        orderNumber: o.orderNumber,
        queueNumber: o.queueNumber,
        type: o.type,
        createdAt: o.createdAt,
        customerName: o.customerName,
        table: o.table,
        subtotalKs: o.subtotalKs,
        discountKs: o.discountKs,
        taxKs: o.taxKs,
        serviceKs: o.serviceKs,
        deliveryFeeKs: o.deliveryFeeKs,
        totalKs: o.totalKs,
        paidKs: o.paidKs,
        changeKs: o.changeKs,
        items: o.items.map((i) => ({
          name: i.name, nameMy: i.nameMy, quantity: i.quantity, unitPriceKs: i.unitPriceKs,
          modifiersJson: i.modifiersJson, modifiersTotalKs: i.modifiersTotalKs,
          lineTotalKs: i.lineTotalKs, notes: i.notes,
        })),
        payments: o.payments.map((p) => ({ method: p.method, amountKs: p.amountKs, reference: p.reference })),
      },
      branch: branch as never,
      settings: settings as never,
      cashier: "",
    });
    setReceiptOpen(true);
  };

  // ── customer search ──
  const searchCustomers = async () => {
    if (!custQuery.trim()) return;
    const r = await lookupCustomer({ query: custQuery.trim() });
    if (r.ok) setCustResults(r.data);
  };

  const pickCustomer = async (c: { id: string; name: string; nameMy: string | null; phone: string }) => {
    setCustomer(c);
    setCustOpen(false);
    if (order) {
      const r = await attachCustomer({ orderId: order.id, customerId: c.id });
      if (r.ok) setOrder(r.data);
    }
  };

  const methodLabel = (m: string) => {
    const key = `pos.method${m.charAt(0).toUpperCase()}${m.slice(1).replace("_transfer", "Transfer")}`;
    const label = t(key);
    return label === key ? m : label;
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="p-6">{t("common.error")}</div>;
  }

  const enabledMethods = data.settings.paymentsEnabled.length > 0 ? data.settings.paymentsEnabled : ["cash"];
  const tablesByZone = new Map<string, typeof data.tables>();
  for (const tb of data.tables) {
    const arr = tablesByZone.get(tb.zone) ?? [];
    arr.push(tb);
    tablesByZone.set(tb.zone, arr);
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4 md:p-6 min-h-[calc(100vh-4rem)]">
      {/* ── left: menu ── */}
      <div className="flex-1 space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{t("pos.title")}</h1>
          {order && (
            <Badge>
              #{order.orderNumber} · {formatKs(order.totalKs)}
            </Badge>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <Button
            size="lg"
            variant={activeCat === "all" ? "primary" : "outline"}
            onClick={() => setActiveCat("all")}
            className="min-h-[56px] shrink-0"
          >
            {t("pos.all")}
          </Button>
          {data.categories.map((c) => (
            <Button
              key={c.id}
              size="lg"
              variant={activeCat === c.id ? "primary" : "outline"}
              onClick={() => setActiveCat(c.id)}
              className="min-h-[56px] shrink-0 my-text"
            >
              {dn(c.name, c.nameMy)}
            </Button>
          ))}
        </div>

        <Input
          placeholder={t("pos.searchMenu")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md h-12"
        />

        {filteredItems.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center">{t("pos.noItems")}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                onClick={() => openModifiers(item)}
                className="min-h-[88px] rounded-xl border border-border bg-card p-3 text-left hover:bg-accent active:scale-[0.98] transition cursor-pointer"
              >
                <p className="font-medium leading-snug my-text">{dn(item.name, item.nameMy)}</p>
                <p className="text-primary font-semibold mt-1">{formatKs(item.priceKs)}</p>
                {groupsFor(item.id).length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">+ {t("pos.modifiers")}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── right: cart / order ── */}
      <div className="w-full lg:w-[380px] shrink-0">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{order ? `#${order.orderNumber}` : t("pos.cart")}</CardTitle>
              {!order && cart.length > 0 && (
                <Button size="sm" variant="ghost" onClick={clearAll}>{t("pos.clearCart")}</Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* order type + table */}
            {!order && (
              <>
                <div>
                  <Label>{t("pos.orderType")}</Label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {(["dinein", "takeaway", "delivery"] as const).map((ty) => (
                      <Button
                        key={ty}
                        size="md"
                        variant={orderType === ty ? "primary" : "outline"}
                        onClick={() => setOrderType(ty)}
                        className="min-h-[56px]"
                      >
                        {t(`pos.type${ty === "dinein" ? "Dinein" : ty === "takeaway" ? "Takeaway" : "Delivery"}`)}
                      </Button>
                    ))}
                  </div>
                </div>
                {orderType === "dinein" && (
                  <div>
                    <Label>{t("pos.selectTable")}</Label>
                    <div className="space-y-2 mt-1 max-h-44 overflow-y-auto thin-scroll">
                      {[...tablesByZone.entries()].map(([zone, tables]) => (
                        <div key={zone}>
                          <p className="text-xs text-muted-foreground">{zone}</p>
                          <div className="grid grid-cols-4 gap-1.5 mt-1">
                            {tables.map((tb) => (
                              <button
                                key={tb.id}
                                disabled={tb.status !== "free" && tableId !== tb.id}
                                onClick={() => setTableId(tb.id === tableId ? "" : tb.id)}
                                className={cn(
                                  "min-h-[48px] rounded-lg border text-sm font-medium cursor-pointer",
                                  tableId === tb.id
                                    ? "border-primary bg-primary/10 text-primary"
                                    : tb.status === "free"
                                      ? "border-border hover:bg-accent"
                                      : "border-border opacity-40"
                                )}
                              >
                                {tb.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* customer */}
                <div>
                  <Label>{t("pos.customer")}</Label>
                  {customer ? (
                    <div className="flex items-center justify-between rounded-lg border border-border p-2 mt-1">
                      <span className="text-sm my-text">{customer.name} · {customer.phone}</span>
                      <Button size="sm" variant="ghost" onClick={() => setCustomer(null)}>✕</Button>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-1">
                      <Input
                        placeholder={t("pos.customerName")}
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="h-11"
                      />
                      <Button size="md" variant="outline" onClick={() => setCustOpen(true)} className="min-h-[44px] shrink-0">
                        {t("pos.attachCustomer")}
                      </Button>
                    </div>
                  )}
                  {!customer && (
                    <Input
                      placeholder={t("pos.customerPhone")}
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="h-11 mt-2"
                      inputMode="tel"
                    />
                  )}
                </div>
              </>
            )}

            {/* cart lines */}
            {cart.length === 0 && !order ? (
              <p className="text-muted-foreground text-center py-6">{t("pos.cartEmpty")}</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto thin-scroll">
                {cart.map((l) => (
                  <div key={l.key} className="rounded-lg border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium my-text flex-1">{dn(l.name, l.nameMy)}</p>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" onClick={() => setQty(l.key, l.qty - 1)} className="min-h-[40px] min-w-[40px]">−</Button>
                        <span className="w-8 text-center font-medium">{l.qty}</span>
                        <Button size="sm" variant="outline" onClick={() => setQty(l.key, l.qty + 1)} className="min-h-[40px] min-w-[40px]">+</Button>
                      </div>
                    </div>
                    {l.modifiers.length > 0 && (
                      <p className="text-xs text-muted-foreground my-text">
                        {l.modifiers.map((m) => m.option).join(", ")}
                        {l.modifiers.some((m) => m.delta > 0) &&
                          ` (+${formatKs(l.modifiers.reduce((s, m) => s + m.delta, 0))})`}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <Input
                        placeholder={t("pos.itemNotes")}
                        value={l.notes}
                        onChange={(e) =>
                          setCart((prev) => prev.map((x) => (x.key === l.key ? { ...x, notes: e.target.value } : x)))
                        }
                        className="h-8 text-xs"
                      />
                      <span className="text-sm font-semibold ml-2 whitespace-nowrap">
                        {formatKs((l.priceKs + l.modifiers.reduce((s, m) => s + m.delta, 0)) * l.qty)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* discount */}
            {!order && cart.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>{t("pos.discountType")}</Label>
                  <Select value={discountType} onChange={(e) => setDiscountType(e.target.value as never)} className="h-11 mt-1">
                    <option value="none">{t("pos.discountNone")}</option>
                    <option value="percent">{t("pos.discountPercent")}</option>
                    <option value="amount">{t("pos.discountFixed")}</option>
                  </Select>
                </div>
                <div>
                  <Label>{t("pos.discountValue")}</Label>
                  <Input
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    inputMode="decimal"
                    className="h-11 mt-1"
                    disabled={discountType === "none"}
                  />
                </div>
              </div>
            )}

            {!order && (
              <Textarea
                placeholder={t("pos.orderNotes")}
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                rows={2}
              />
            )}

            {/* totals */}
            <div className="space-y-1 text-sm border-t border-border pt-3">
              <div className="flex justify-between"><span>{t("pos.subtotal")}</span><span>{formatKs(order ? order.totalKs : totals.subtotal)}</span></div>
              {!order && totals.discountKs > 0 && (
                <div className="flex justify-between text-success"><span>{t("pos.discount")}</span><span>−{formatKs(totals.discountKs)}</span></div>
              )}
              {!order && totals.taxKs > 0 && (
                <div className="flex justify-between text-muted-foreground"><span>{t("pos.tax")}</span><span>{formatKs(totals.taxKs)}</span></div>
              )}
              <div className="flex justify-between text-lg font-bold">
                <span>{t("pos.total")}</span>
                <span>{formatKs(order ? order.totalKs - order.paidKs : totals.total)}</span>
              </div>
              {order && (
                <>
                  <div className="flex justify-between text-muted-foreground"><span>{t("pos.paidSoFar")}</span><span>{formatKs(order.paidKs)}</span></div>
                  <div className="flex justify-between"><span>{t("pos.remaining")}</span><span className="font-semibold">{formatKs(Math.max(0, order.totalKs - order.paidKs))}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>{t("orders.statusOpen")}</span><Badge>{order.status}</Badge></div>
                </>
              )}
            </div>

            {/* actions */}
            {!order ? (
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" variant="secondary" onClick={placeOrder} disabled={cart.length === 0 || placing} className="min-h-[56px]">
                  {t("pos.placeOrder")}
                </Button>
                <Button size="lg" onClick={() => { setPayOpen(false); placeOrder(); }} disabled={cart.length === 0 || placing} className="min-h-[56px]">
                  {t("pos.placeOrder")} + {t("pos.pay")}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="lg"
                  onClick={() => {
                    setPayOpen(true);
                    setPayAmount(String(Math.max(0, order.totalKs - order.paidKs)));
                  }}
                  disabled={order.totalKs - order.paidKs <= 0}
                  className="min-h-[56px]"
                >
                  {t("pos.pay")}
                </Button>
                <Button size="lg" variant="secondary" onClick={doFire} className="min-h-[56px]">
                  {t("pos.fireOrder")}
                </Button>
                <Button size="md" variant="outline" onClick={doHold}>
                  {t("pos.holdOrder")}
                </Button>
                <Button size="md" variant="outline" onClick={() => openReceipt(order.id)}>
                  {t("pos.printReceipt")}
                </Button>
                <Button size="md" variant="ghost" onClick={clearAll} className="col-span-2">
                  {t("pos.newOrder")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── modifier dialog ── */}
      <Dialog open={!!modItem} onClose={() => setModItem(null)} title={modItem ? dn(modItem.name, modItem.nameMy) : ""} wide>
        {modItem && (
          <div className="space-y-4">
            {groupsFor(modItem.id).map((g) => (
              <div key={g.id}>
                <p className="font-medium mb-2 my-text">
                  {dn(g.name, g.nameMy)}
                  {g.required && <span className="text-destructive"> *</span>}
                </p>
                <div className="flex flex-wrap gap-2">
                  {g.options.map((o) => {
                    const selected = (modSel[g.id] ?? []).includes(o.id);
                    return (
                      <button
                        key={o.id}
                        onClick={() => toggleModOption(g.id, o.id, g.multiSelect)}
                        className={cn(
                          "min-h-[56px] px-4 rounded-xl border text-sm font-medium cursor-pointer my-text",
                          selected ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
                        )}
                      >
                        {dn(o.name, o.nameMy)}
                        {o.priceDeltaKs > 0 && <span className="block text-xs">+{formatKs(o.priceDeltaKs)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div>
              <Label>{t("pos.notes")}</Label>
              <Input value={modNotes} onChange={(e) => setModNotes(e.target.value)} className="h-12 mt-1" placeholder={t("pos.itemNotes")} />
            </div>
            <Button size="lg" onClick={confirmModifiers} className="w-full min-h-[56px]">
              {t("pos.addToCart")}
            </Button>
          </div>
        )}
      </Dialog>

      {/* ── customer search dialog ── */}
      <Dialog open={custOpen} onClose={() => setCustOpen(false)} title={t("pos.attachCustomer")}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder={t("pos.searchCustomer")}
              value={custQuery}
              onChange={(e) => setCustQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchCustomers()}
              className="h-12"
            />
            <Button onClick={searchCustomers} className="min-h-[48px]">{t("pos.search")}</Button>
          </div>
          {custResults.map((c) => (
            <button
              key={c.id}
              onClick={() => pickCustomer(c)}
              className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent cursor-pointer"
            >
              <p className="font-medium my-text">{dn(c.name, c.nameMy)}</p>
              <p className="text-sm text-muted-foreground">{c.phone} · {c.points} pts · {c.stamps} stamps</p>
            </button>
          ))}
        </div>
      </Dialog>

      {/* ── manager PIN dialog ── */}
      <Dialog open={pinOpen} onClose={() => { setPinOpen(false); setPendingDiscount(false); }} title={t("pos.approvalNeeded")}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("pos.approverPin")}</p>
          <Input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="h-14 text-center text-2xl tracking-widest"
            maxLength={8}
            autoFocus
          />
          <Button size="lg" onClick={confirmPin} className="w-full min-h-[56px]">
            {t("pos.confirmPayment")}
          </Button>
        </div>
      </Dialog>

      {/* ── payment dialog ── */}
      <Dialog open={payOpen} onClose={() => setPayOpen(false)} title={t("pos.payment")} wide>
        {order && (
          <div className="space-y-4">
            <div className="flex justify-between text-lg">
              <span className="font-bold">{t("pos.remaining")}</span>
              <span className="font-bold text-primary">{formatKs(remaining)}</span>
            </div>
            <div>
              <Label>{t("pos.paymentMethod")}</Label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-1">
                {(enabledMethods.length > 0 ? enabledMethods : [...PAY_METHODS]).map((m) => (
                  <Button
                    key={m}
                    variant={payMethod === m ? "primary" : "outline"}
                    onClick={() => setPayMethod(m)}
                    className="min-h-[56px]"
                  >
                    {methodLabel(m)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("pos.amount")}</Label>
                <Input
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  inputMode="decimal"
                  className="h-12 mt-1 text-lg font-semibold"
                />
              </div>
              <div>
                <Label>{t("pos.tip")}</Label>
                <Input
                  value={payTip}
                  onChange={(e) => setPayTip(e.target.value)}
                  inputMode="decimal"
                  className="h-12 mt-1"
                  placeholder="0"
                />
              </div>
            </div>
            {payMethod === "cash" && (
              <div>
                <Label>{t("pos.tendered")}</Label>
                <div className="flex flex-wrap gap-2 mt-1 mb-2">
                  {QUICK_CASH.map((d) => (
                    <Button key={d} variant="outline" onClick={() => setTendered(String((parseFloat(tendered) || 0) + d))} className="min-h-[48px]">
                      {formatKs(d)}
                    </Button>
                  ))}
                  <Button variant="ghost" onClick={() => setTendered(payAmount)} className="min-h-[48px]">
                    {t("pos.amount")}
                  </Button>
                </div>
                <Input
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  inputMode="decimal"
                  className="h-12 text-lg font-semibold"
                  placeholder={t("pos.tendered")}
                />
                <div className="flex justify-between mt-2 text-lg">
                  <span>{t("pos.change")}</span>
                  <span className="font-bold text-success">{formatKs(change)}</span>
                </div>
              </div>
            )}
            {payMethod !== "cash" && (
              <div>
                <Label>{t("pos.reference")}</Label>
                <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} className="h-12 mt-1" placeholder={t("pos.reference")} />
              </div>
            )}
            <Button size="lg" onClick={submitPayment} disabled={payBusy || payAmt <= 0} className="w-full min-h-[56px]">
              {t("pos.confirmPayment")} · {formatKs(payAmt)}
            </Button>
          </div>
        )}
      </Dialog>

      {/* ── receipt dialog ── */}
      <Dialog open={receiptOpen} onClose={() => setReceiptOpen(false)} title={t("pos.printReceipt")} wide>
        {receipt && (
          <div className="space-y-4">
            <ReceiptPrint order={receipt.order} branch={receipt.branch} settings={receipt.settings} />
            <div className="flex gap-2 print:hidden">
              <Button size="lg" onClick={() => window.print()} className="flex-1 min-h-[56px]">
                {t("pos.printReceipt")}
              </Button>
              <Button size="lg" variant="outline" onClick={() => { setReceiptOpen(false); clearAll(); }} className="flex-1 min-h-[56px]">
                {t("pos.newOrder")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] rounded-xl bg-foreground text-background px-5 py-3 shadow-lg text-sm font-medium my-text">
          {toast}
        </div>
      )}
    </div>
  );
}
