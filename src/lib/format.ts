// ── Currency: Myanmar Kyat (no decimals) ──────────────────────────
export function formatKs(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0 Ks";
  return `${Math.round(n).toLocaleString("en-US")} Ks`;
}

export function parseKs(s: string): number {
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

// ── Dates in Asia/Yangon ──────────────────────────────────────────
export const YANGON_TZ = "Asia/Yangon";

export function nowYangon(): Date {
  return new Date();
}

/** YYYY-MM-DD in Asia/Yangon */
export function yangonDateKey(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: YANGON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts; // en-CA → YYYY-MM-DD
}

/** Start of the Yangon business day as a UTC Date */
export function yangonDayStart(dateKey?: string): Date {
  const key = dateKey ?? yangonDateKey();
  // Asia/Yangon is UTC+6:30 with no DST
  return new Date(`${key}T00:00:00+06:30`);
}

export function formatDateTime(d: Date | string, lang: "my" | "en" = "en"): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(lang === "my" ? "my-MM" : "en-GB", {
    timeZone: YANGON_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDate(d: Date | string, lang: "my" | "en" = "en"): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(lang === "my" ? "my-MM" : "en-GB", {
    timeZone: YANGON_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

// ── Myanmar phone validation: 09xxxxxxxxx / +959xxxxxxxxx ────────
export function normalizeMmPhone(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  let d = digits;
  if (d.startsWith("95")) d = d.slice(2);
  if (d.startsWith("9") && d.length >= 9 && d.length <= 11) {
    return "0" + d;
  }
  if (d.startsWith("09") && d.length >= 10 && d.length <= 12) {
    return d;
  }
  return null;
}

// ── Order numbers: YYYYMMDD-NNN per branch ────────────────────────
export function orderNumberFor(dateKey: string, seq: number): string {
  return `${dateKey.replace(/-/g, "")}-${String(seq).padStart(3, "0")}`;
}

// ── Misc ─────────────────────────────────────────────────────────
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
