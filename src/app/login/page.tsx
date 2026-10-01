"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n/provider";
import { authClient } from "@/lib/auth-client";
import { pinLogin } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";

function PinPad() {
  const { t, lang } = useLang();
  const router = useRouter();
  const next = useSearchParams().get("next") || "/dashboard";
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const press = (d: string) => {
    setError("");
    if (pin.length < 8) setPin(pin + d);
  };

  const submit = async (value: string = pin) => {
    if (value.length < 4 || busy) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("pin", value);
    const res = await pinLogin(fd);
    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      setError(res.error === "wrong_pin" ? (lang === "my" ? "PIN မှားနေပါတယ်" : "Wrong PIN") : t("common.invalid"));
      setPin("");
      setBusy(false);
    }
  };

  React.useEffect(() => {
    if (pin.length === 4) {
      const id = setTimeout(() => submit(pin), 350);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <div>
      <div className="flex justify-center gap-2 mb-5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "w-4 h-4 rounded-full border-2",
              pin.length > i ? "bg-primary border-primary" : "border-border"
            )}
          />
        ))}
      </div>
      {error && <p className="text-destructive text-sm text-center mb-3">{error}</p>}
      <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            onClick={() => press(d)}
            className="h-14 rounded-xl bg-muted text-xl font-semibold hover:bg-accent active:scale-95 transition cursor-pointer"
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => setPin(pin.slice(0, -1))}
          className="h-14 rounded-xl bg-muted text-xl hover:bg-accent active:scale-95 transition cursor-pointer"
        >
          ⌫
        </button>
        <button
          onClick={() => press("0")}
          className="h-14 rounded-xl bg-muted text-xl font-semibold hover:bg-accent active:scale-95 transition cursor-pointer"
        >
          0
        </button>
        <button
          onClick={() => submit()}
          disabled={busy || pin.length < 4}
          className="h-14 rounded-xl bg-primary text-primary-foreground text-xl hover:opacity-90 active:scale-95 transition disabled:opacity-40 cursor-pointer"
        >
          →
        </button>
      </div>
    </div>
  );
}

function EmailLogin() {
  const { t } = useLang();
  const router = useRouter();
  const next = useSearchParams().get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await authClient.signIn.email({ email, password });
    if (res.error) {
      setError(res.error.message || t("common.error"));
      setBusy(false);
    } else {
      router.push(next);
      router.refresh();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div>
        <Label>{t("common.email")}</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </div>
      <div>
        <Label>Password / စကားဝှက်</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t("common.loading") : t("common.confirm")}
      </Button>
    </form>
  );
}

function LoginInner() {
  const { t, lang, setLang } = useLang();
  const [tab, setTab] = useState<"pin" | "email">("pin");

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-orange-950 via-amber-900 to-stone-950">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <div className="text-center mb-5">
            <div className="text-4xl mb-2">☕</div>
            <h1 className={cn("text-xl font-bold", lang === "my" && "my-text")}>{t("app.name")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {lang === "my" ? "ဆိုင်ဝန်ထမ်း ဝင်ရောက်ရန်" : "Staff sign in"}
            </p>
          </div>
          <div className="flex rounded-lg bg-muted p-1 mb-5">
            {(["pin", "email"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTab(m)}
                className={cn(
                  "flex-1 rounded-md py-2 text-sm font-medium transition cursor-pointer",
                  tab === m ? "bg-card shadow" : "text-muted-foreground"
                )}
              >
                {m === "pin" ? (lang === "my" ? "🔢 PIN" : "🔢 PIN") : `📧 Email`}
              </button>
            ))}
          </div>
          {tab === "pin" ? <PinPad /> : <EmailLogin />}
          <div className="mt-5 text-center">
            <button
              onClick={() => setLang(lang === "my" ? "en" : "my")}
              className="text-sm text-muted-foreground hover:text-foreground underline cursor-pointer"
            >
              {lang === "my" ? "English" : "မြန်မာ"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
