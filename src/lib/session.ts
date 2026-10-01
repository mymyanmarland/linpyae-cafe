import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { prisma } from "./db";

export { hashPin, verifyPin } from "./pin";

// ── Session cookies ───────────────────────────────────────────────
export const PIN_SESSION_COOKIE = "cafe_session";
const BETTER_AUTH_COOKIE = "better-auth.session_token";

export type SessionUser = {
  id: string;
  name: string;
  nameMy: string | null;
  email: string;
  role: string; // owner | manager | cashier | barista
  branchId: string | null;
  phone: string | null;
  active: boolean;
};

const ROLE_RANK: Record<string, number> = { barista: 1, cashier: 2, manager: 3, owner: 4 };

export function roleRank(role: string): number {
  return ROLE_RANK[role] ?? 0;
}

/** Read the current session (PIN cookie or better-auth cookie). Returns null when signed out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const c = await cookies();
  const token = c.get(PIN_SESSION_COOKIE)?.value ?? c.get(BETTER_AUTH_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (!session.user.active) return null;
  const u = session.user;
  return {
    id: u.id,
    name: u.name,
    nameMy: u.nameMy,
    email: u.email,
    role: u.role,
    branchId: u.branchId,
    phone: u.phone,
    active: u.active,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}

/** Require one of the given roles (or any higher rank). */
export async function requireRole(...roles: string[]): Promise<SessionUser> {
  const u = await requireUser();
  const need = Math.min(...roles.map(roleRank));
  if (roleRank(u.role) < need) redirect("/unauthorized");
  return u;
}

// ── PIN hashing (scrypt) — imported from the dependency-free pin module ──

// ── PIN login ─────────────────────────────────────────────────────
export async function createPinSession(userId: string, ip?: string, ua?: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId, token, expiresAt, ipAddress: ip, userAgent: ua },
  });
  const c = await cookies();
  c.set(PIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    secure: process.env.NODE_ENV === "production",
  });
  return token;
}

export async function destroySession() {
  const c = await cookies();
  const tokens = [c.get(PIN_SESSION_COOKIE)?.value, c.get(BETTER_AUTH_COOKIE)?.value].filter(
    Boolean
  ) as string[];
  if (tokens.length) {
    await prisma.session.deleteMany({ where: { token: { in: tokens } } });
  }
  c.delete(PIN_SESSION_COOKIE);
  c.delete(BETTER_AUTH_COOKIE);
}
