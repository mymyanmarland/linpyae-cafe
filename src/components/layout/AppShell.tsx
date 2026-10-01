"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";
import { logout } from "@/app/actions/auth";

export type NavItem = { href: string; icon: string; labelKey: string; minRank: number };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", icon: "📊", labelKey: "nav.dashboard", minRank: 1 },
  { href: "/pos", icon: "🧾", labelKey: "nav.pos", minRank: 2 },
  { href: "/orders", icon: "📦", labelKey: "nav.orders", minRank: 2 },
  { href: "/kds", icon: "👨‍🍳", labelKey: "nav.kds", minRank: 1 },
  { href: "/tables", icon: "🪑", labelKey: "nav.tables", minRank: 2 },
  { href: "/menu", icon: "📋", labelKey: "nav.menu", minRank: 3 },
  { href: "/inventory", icon: "📦", labelKey: "nav.inventory", minRank: 3 },
  { href: "/customers", icon: "👥", labelKey: "nav.customers", minRank: 2 },
  { href: "/staff", icon: "👔", labelKey: "nav.staff", minRank: 3 },
  { href: "/reports", icon: "📈", labelKey: "nav.reports", minRank: 3 },
  { href: "/settings", icon: "⚙️", labelKey: "nav.settings", minRank: 4 },
];

const RANK: Record<string, number> = { barista: 1, cashier: 2, manager: 3, owner: 4 };

export type ShellUser = {
  name: string;
  nameMy: string | null;
  role: string;
  branchName: string | null;
};

function ThemeToggle() {
  const { t } = useLang();
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("cafe_theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button
      onClick={toggle}
      title={dark ? t("common.lightMode") : t("common.darkMode")}
      className="rounded-lg p-2 hover:bg-accent text-lg leading-none cursor-pointer"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}

function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <button
      onClick={() => setLang(lang === "my" ? "en" : "my")}
      className="rounded-lg px-2.5 py-1.5 text-sm font-semibold hover:bg-accent border border-border cursor-pointer"
      title="Switch language / ဘာသာစကားပြောင်းရန်"
    >
      {lang === "my" ? "EN" : "မြန်မာ"}
    </button>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const { t, lang } = useLang();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rank = RANK[user.role] ?? 0;
  const items = NAV_ITEMS.filter((i) => rank >= i.minRank);

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="text-lg font-bold">☕ {t("app.name")}</div>
        {user.branchName && <div className="text-xs text-muted-foreground mt-0.5">{user.branchName}</div>}
      </div>
      <nav className="flex-1 overflow-y-auto thin-scroll p-2 space-y-0.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              )}
            >
              <span className="text-lg w-6 text-center">{item.icon}</span>
              <span className={cn(lang === "my" && "my-text")}>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 px-1 mb-2">
          <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
            {(user.nameMy || user.name).slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{lang === "my" ? user.nameMy || user.name : user.name}</div>
            <div className="text-xs text-muted-foreground capitalize">{user.role}</div>
          </div>
        </div>
        <button
          onClick={() => logout()}
          className="w-full rounded-lg px-3 py-2 text-sm hover:bg-accent text-left text-destructive cursor-pointer"
        >
          🚪 {t("nav.logout")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-card sticky top-0 h-screen">
        {sidebar}
      </aside>
      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-card shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-2 px-4 h-14">
            <button
              className="lg:hidden rounded-lg p-2 hover:bg-accent text-xl cursor-pointer"
              onClick={() => setOpen(true)}
              aria-label="Menu"
            >
              ☰
            </button>
            <div className="flex-1" />
            <LangToggle />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6 max-w-[1400px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
