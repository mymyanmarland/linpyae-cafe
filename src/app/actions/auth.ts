"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createPinSession, destroySession, requireUser, verifyPin } from "@/lib/session";
import { ok, type ActionResult } from "@/lib/action-result";

const pinSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/) });

export async function pinLogin(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const parsed = pinSchema.safeParse({ pin: String(formData.get("pin") ?? "") });
  if (!parsed.success) return { ok: false, error: "invalid_pin" };

  const users = await prisma.user.findMany({
    where: { active: true, pinHash: { not: null } },
    select: { id: true, pinHash: true },
  });
  const match = users.find((u) => u.pinHash && verifyPin(parsed.data.pin, u.pinHash));
  if (!match) {
    await prisma.auditLog.create({
      data: { action: "login_failed", entityType: "user", ipAddress: (await headers()).get("x-forwarded-for") },
    }).catch(() => {});
    return { ok: false, error: "wrong_pin" };
  }
  const h = await headers();
  await createPinSession(match.id, h.get("x-forwarded-for") ?? undefined, h.get("user-agent") ?? undefined);
  await prisma.auditLog.create({
    data: { action: "login", entityType: "user", entityId: match.id, userId: match.id },
  }).catch(() => {});
  return { ok: true };
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

/**
 * Current user's role, for client-side UI gating (e.g. showing the manual
 * "occupied" table status only to managers). The server still enforces
 * permissions on every action.
 */
export async function getMyRole(): Promise<ActionResult<{ role: string }>> {
  const user = await requireUser();
  return ok({ role: user.role });
}
