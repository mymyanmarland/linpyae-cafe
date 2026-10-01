"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLang, useDisplayName } from "@/lib/i18n/provider";
import { getOnlineMenu, placeOnlineOrder, type OnlineMenu, type PlacedOrder } from "@/app/actions/online";
import { formatKs, normalizeMmPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, Select } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, Badge, Skeleton } from "@/components/ui/card";
import { cn } from "@/lib/cn";

type Cart = Record<string, number>;

function LanguageToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="flex rounded-full border border-border p-0.5 text-sm">
      {(["my", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={cn(
            "min-h-[36px] rounded-full px-3 font-medium",
            lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          )}
        >
          {l === "my" ? "မြန်မာ" : "EN"}
        </button>
      ))}
    </div>
  );
}

export default function OnlinePage() {
  const { t, lang } = useLang();
  const dn = useDisplayName();
  const [menu, setMenu] = useState<OnlineMenu | null>(null);
  const [error, setError] = useState("");
  const [cart, setCart] = useState<Cart>({});
  const [catId, setCatId] = useState<string>("");
  const [showCart, setShowCart] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "", notes: "", paymentMethod: "cash" });
  const [formError, setFormError] = useState("");
  const [fieldErr, setFieldErr] = useState({ name: false, phone: false, address: false });
  const errRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    getOnlineMenu().then((r) => {
      if (r.ok) {
        setMenu(r.data);
        setCatId(r.data.categories[0]?.id ?? "");
        if (r.data.paymentsEnabled[0]) setForm((f) => ({ ...f, paymentMethod: r.data.paymentsEnabled[0] }));
      } else setError(r.error);
    });
  }, []);

  const priceOf = useMemo(() => {
    const m = new Map<string, number>();
    menu?.categories.forEach((c) => c.items.forEach((i) => m.set(i.id, i.priceKs)));
    return m;
  }, [menu]);

  const cartCount = Object.values(cart).reduce((s, q) => s + q, 0);
  const subtotal = Object.entries(cart).reduce((s, [id, q]) => s + (priceOf.get(id) ?? 0) * q, 0);
  const total = subtotal + (menu?.deliveryFeeKs ?? 0);

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const dec = (id: string) =>
    setCart((c) => {
      const q = (c[id] ?? 0) - 1;
      const n = { ...c };
      if (q <= 0) delete n[id];
      else n[id] = q;
      return n;
    });

  /** Show a validation error where it can't be missed: top of the form + scrolled into view. */
  const failValidation = (msg: string, fields: { name?: boolean; phone?: boolean; address?: boolean }) => {
    setFormError(msg);
    setFieldErr({ name: !!fields.name, phone: !!fields.phone, address: !!fields.address });
    setTimeout(() => errRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFieldErr({ name: false, phone: false, address: false });
    const nameBad = !form.name.trim();
    const addressBad = !form.address.trim();
    const phoneBad = !normalizeMmPhone(form.phone);
    if (cartCount === 0) {
      failValidation(t("online.emptyCart"), {});
      return;
    }
    if (nameBad || addressBad) {
      failValidation(t("online.fillRequired"), { name: nameBad, address: addressBad, phone: phoneBad });
      return;
    }
    if (phoneBad) {
      failValidation(t("online.invalidPhone"), { phone: true });
      return;
    }
    setPlacing(true);
    const r = await placeOnlineOrder({
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
      paymentMethod: form.paymentMethod as "cash" | "kbzpay" | "wavepay",
      items: Object.entries(cart).map(([menuItemId, qty]) => ({ menuItemId, qty })),
    });
    setPlacing(false);
    if (r.ok) {
      setPlaced(r.data);
      setCart({});
      setShowCart(false);
    } else {
      setFormError(r.error);
    }
  };

  if (placed) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-6xl">✅</div>
        <h1 className="my-text text-2xl font-bold">{t("online.orderPlaced")}</h1>
        <p className="my-text text-muted-foreground">{t("online.orderPlacedDesc")}</p>
        <div className="rounded-xl border border-border bg-card px-8 py-4">
          <div className="text-3xl font-bold tabular-nums">{placed.orderNumber}</div>
          <div className="mt-1 text-lg tabular-nums">{formatKs(placed.totalKs)}</div>
        </div>
        <p className="my-text text-sm text-muted-foreground">{t("online.weWillCall")}</p>
        <Button onClick={() => setPlaced(null)} className="min-h-[48px]">
          {t("online.backToMenu")}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 p-3">
          <div>
            <h1 className="my-text text-lg font-bold leading-tight">
              {menu ? dn(menu.branch.name, menu.branch.nameMy) : t("online.title")}
            </h1>
            <p className="my-text text-xs text-muted-foreground">{t("online.subtitle")}</p>
          </div>
          <LanguageToggle />
        </div>
        {menu && menu.demoPayments && (
          <div className="border-t border-warning/30 bg-warning/10 px-3 py-1.5 text-center">
            <span className="my-text text-xs">⚠️ {t("online.demoPayments")}</span>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-3xl p-3 pb-32">
        {error && (
          <Card>
            <CardContent className="pt-4 text-destructive">{error}</CardContent>
          </Card>
        )}
        {!menu && !error && (
          <div className="space-y-3">
            <Skeleton className="h-10" />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        )}

        {menu && (
          <>
            {/* Category nav */}
            <div className="sticky top-[68px] z-10 -mx-3 flex gap-2 overflow-x-auto bg-background/95 px-3 py-2 backdrop-blur">
              {menu.categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCatId(c.id)}
                  className={cn(
                    "my-text min-h-[44px] shrink-0 rounded-full border px-4 text-sm font-medium",
                    catId === c.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card"
                  )}
                >
                  {dn(c.name, c.nameMy)}
                </button>
              ))}
            </div>

            {/* Items */}
            {menu.categories
              .filter((c) => !catId || c.id === catId)
              .map((c) => (
                <section key={c.id} className="mt-4">
                  <h2 className="my-text mb-2 text-base font-bold">{dn(c.name, c.nameMy)}</h2>
                  <div className="grid gap-2">
                    {c.items.map((it) => {
                      const q = cart[it.id] ?? 0;
                      return (
                        <Card key={it.id}>
                          <CardContent className="flex items-center gap-3 pt-3">
                            <div className="min-w-0 flex-1">
                              <div className="my-text truncate text-sm font-semibold">{dn(it.name, it.nameMy)}</div>
                              {it.description && (
                                <div className="my-text truncate text-xs text-muted-foreground">
                                  {dn(it.description, it.descriptionMy)}
                                </div>
                              )}
                              <div className="mt-1 text-sm font-bold tabular-nums">{formatKs(it.priceKs)}</div>
                            </div>
                            {q === 0 ? (
                              <Button size="sm" onClick={() => add(it.id)} className="min-h-[44px] shrink-0">
                                {t("online.add")}
                              </Button>
                            ) : (
                              <div className="flex shrink-0 items-center gap-2">
                                <Button size="sm" variant="outline" onClick={() => dec(it.id)} className="min-h-[44px] min-w-[44px]">
                                  −
                                </Button>
                                <span className="w-6 text-center font-bold tabular-nums">{q}</span>
                                <Button size="sm" onClick={() => add(it.id)} className="min-h-[44px] min-w-[44px]">
                                  +
                                </Button>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              ))}
          </>
        )}
      </main>

      {/* Cart bar */}
      {cartCount > 0 && !showCart && (
        <div className="fixed inset-x-0 bottom-0 z-20 p-3">
          <div className="mx-auto max-w-3xl">
            <Button onClick={() => setShowCart(true)} className="min-h-[56px] w-full text-base shadow-lg">
              🛒 {t("online.cart")} · {cartCount} · {formatKs(subtotal)}
            </Button>
          </div>
        </div>
      )}

      {/* Checkout sheet */}
      {showCart && menu && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50" onClick={() => setShowCart(false)}>
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-background p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="my-text mb-3 text-lg font-bold">{t("online.checkout")}</h2>

            <div className="mb-4 space-y-2">
              {Object.entries(cart).map(([id, q]) => {
                const item = menu.categories.flatMap((c) => c.items).find((i) => i.id === id);
                if (!item) return null;
                return (
                  <div key={id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="my-text truncate">
                      {dn(item.name, item.nameMy)} × {q}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatKs(item.priceKs * q)}</span>
                      <button onClick={() => dec(id)} className="min-h-[36px] min-w-[36px] rounded border border-border">
                        −
                      </button>
                      <button onClick={() => add(id)} className="min-h-[36px] min-w-[36px] rounded border border-border">
                        +
                      </button>
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-between border-t border-border pt-2 text-sm">
                <span className="my-text">{t("online.subtotal")}</span>
                <span className="tabular-nums">{formatKs(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="my-text">{t("online.deliveryFee")}</span>
                <span className="tabular-nums">{formatKs(menu.deliveryFeeKs)}</span>
              </div>
              <div className="flex justify-between text-base font-bold">
                <span className="my-text">{t("online.total")}</span>
                <span className="tabular-nums">{formatKs(total)}</span>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-3" noValidate>
              {formError && (
                <p
                  ref={errRef}
                  role="alert"
                  className="my-text rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
                >
                  {formError}
                </p>
              )}
              <div>
                <Label>{t("online.name")} *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={cn("my-text mt-1 min-h-[48px]", fieldErr.name && "border-destructive ring-1 ring-destructive")}
                  aria-invalid={fieldErr.name}
                  required
                />
              </div>
              <div>
                <Label>{t("online.phone")} *</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className={cn("mt-1 min-h-[48px]", fieldErr.phone && "border-destructive ring-1 ring-destructive")}
                  placeholder="09xxxxxxxxx"
                  inputMode="tel"
                  aria-invalid={fieldErr.phone}
                  required
                />
              </div>
              <div>
                <Label>{t("online.address")} *</Label>
                <Textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className={cn("my-text mt-1", fieldErr.address && "border-destructive ring-1 ring-destructive")}
                  rows={2}
                  aria-invalid={fieldErr.address}
                  required
                />
              </div>
              <div>
                <Label>{t("online.notes")}</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="my-text mt-1 min-h-[48px]"
                />
              </div>
              <div>
                <Label>{t("online.paymentMethod")}</Label>
                <Select
                  value={form.paymentMethod}
                  onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                  className="mt-1 min-h-[48px]"
                >
                  {menu.paymentsEnabled.map((m) => (
                    <option key={m} value={m}>
                      {t(`online.${m === "cash" ? "cash" : m}`) ?? m}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex gap-2 pb-2">
                <Button type="button" variant="outline" onClick={() => setShowCart(false)} className="min-h-[52px] flex-1">
                  ←
                </Button>
                <Button type="submit" disabled={placing} className="min-h-[52px] flex-[3] text-base">
                  {placing ? "…" : `${t("online.placeOrder")} · ${formatKs(total)}`}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
