"use server";

import { prisma } from "@/lib/db";
import { requireRole, requireUser, hashPin, roleRank } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { ok, fail, zodFail, type ActionResult } from "@/lib/action-result";
import {
  createStaffSchema,
  updateStaffSchema,
  resetPinSchema,
  staffListSchema,
  saveRosterSchema,
  attendanceListSchema,
} from "@/lib/validations/staff";
import { idSchema } from "@/lib/validators";
import { hashPassword } from "better-auth/crypto";
import { yangonDayStart, yangonDateKey } from "@/lib/format";

export type StaffDTO = {
  id: string;
  name: string;
  nameMy: string | null;
  email: string;
  role: string;
  phone: string | null;
  active: boolean;
  createdAt: string;
};

function toDTO(u: {
  id: string; name: string; nameMy: string | null; email: string;
  role: string; phone: string | null; active: boolean; createdAt: Date;
}): StaffDTO {
  return { ...u, createdAt: u.createdAt.toISOString() };
}

// ── Staff CRUD ────────────────────────────────────────────────────

export async function listStaff(input: unknown): Promise<ActionResult<StaffDTO[]>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = staffListSchema.safeParse(input ?? {});
  if (!parsed.success) return zodFail(parsed.error as never);
  const { role, activeOnly } = parsed.data;
  const rows = await prisma.user.findMany({
    where: {
      branchId: branchId,
      ...(role ? { role } : {}),
      ...(activeOnly ? { active: true } : {}),
    },
    orderBy: [{ role: "desc" }, { name: "asc" }],
  });
  return ok(rows.map(toDTO));
}

function canAssignRole(actorRole: string, targetRole: string): boolean {
  // owner+manager assignment is owner-only
  if (targetRole === "owner" || targetRole === "manager") return roleRank(actorRole) >= roleRank("owner");
  return roleRank(actorRole) >= roleRank("manager");
}

export async function createStaff(input: unknown): Promise<ActionResult<StaffDTO>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = createStaffSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const d = parsed.data;
  if (!canAssignRole(u.role, d.role)) return fail("Only the owner can assign this role");
  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return fail("Email already in use");
  const created = await prisma.user.create({
    data: {
      name: d.name,
      nameMy: d.nameMy || null,
      email: d.email,
      role: d.role,
      phone: d.phone || null,
      branchId: branchId,
      emailVerified: true,
      active: true,
      pinHash: hashPin(d.pin),
    },
  });
  // Email login uses the same secret as the PIN (hashed via better-auth)
  await prisma.account.create({
    data: {
      userId: created.id,
      accountId: d.email,
      providerId: "credential",
      password: await hashPassword(d.pin),
    },
  });
  await logAudit({ userId: u.id, branchId: branchId, action: "staff_create", entityType: "User", entityId: created.id, after: { email: d.email, role: d.role } });
  return ok(toDTO(created));
}

export async function updateStaff(input: unknown): Promise<ActionResult<StaffDTO>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = updateStaffSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { id, ...d } = parsed.data;
  if (id === u.id) return fail("You cannot modify your own account");
  const target = await prisma.user.findFirst({ where: { id, branchId: branchId } });
  if (!target) return fail("Staff not found");
  if (d.role && !canAssignRole(u.role, d.role)) return fail("Only the owner can assign this role");
  const updated = await prisma.user.update({
    where: { id },
    data: {
      name: d.name,
      nameMy: d.nameMy === "" ? null : d.nameMy,
      role: d.role,
      phone: d.phone === "" ? null : d.phone,
      active: d.active,
    },
  });
  await logAudit({ userId: u.id, branchId: branchId, action: "staff_update", entityType: "User", entityId: id, before: { role: target.role, active: target.active }, after: { role: updated.role, active: updated.active } });
  return ok(toDTO(updated));
}

export async function resetPin(input: unknown): Promise<ActionResult<void>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = resetPinSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { id, pin } = parsed.data;
  if (id === u.id) return fail("You cannot reset your own PIN here");
  const target = await prisma.user.findFirst({ where: { id, branchId: branchId } });
  if (!target) return fail("Staff not found");
  await prisma.user.update({ where: { id }, data: { pinHash: hashPin(pin) } });
  await prisma.account.updateMany({
    where: { userId: id, providerId: "credential" },
    data: { password: await hashPassword(pin) },
  });
  await logAudit({ userId: u.id, branchId: branchId, action: "staff_pin_reset", entityType: "User", entityId: id });
  return ok(undefined as void);
}

// ── Attendance ────────────────────────────────────────────────────

export type AttendanceDTO = {
  id: string;
  userId: string;
  userName: string;
  userNameMy: string | null;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  lateMin: number;
  hoursWorked: number | null;
  status: string;
};

function attendanceDTO(a: {
  id: string; userId: string; date: Date; clockIn: Date | null; clockOut: Date | null;
  lateMin: number; status: string; user: { name: string; nameMy: string | null };
}): AttendanceDTO {
  return {
    id: a.id,
    userId: a.userId,
    userName: a.user.name,
    userNameMy: a.user.nameMy,
    date: yangonDateKey(a.date),
    clockIn: a.clockIn?.toISOString() ?? null,
    clockOut: a.clockOut?.toISOString() ?? null,
    lateMin: a.lateMin,
    hoursWorked: a.clockIn && a.clockOut ? (a.clockOut.getTime() - a.clockIn.getTime()) / 3600000 : null,
    status: a.status,
  };
}

export async function clockIn(): Promise<ActionResult<AttendanceDTO>> {
  const u = await requireUser();
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const dayStart = yangonDayStart();
  const existing = await prisma.attendance.findUnique({
    where: { branchId_userId_date: { branchId: branchId, userId: u.id, date: dayStart } },
    include: { user: { select: { name: true, nameMy: true } } },
  });
  if (existing?.clockIn && !existing.clockOut) return fail("Already clocked in");
  const now = new Date();
  // late = clock-in after roster start (if a roster exists today)
  let lateMin = 0;
  const roster = await prisma.roster.findFirst({
    where: { branchId: branchId, userId: u.id, date: dayStart },
    orderBy: { startTime: "asc" },
  });
  if (roster) {
    const localStart = new Date(`${yangonDateKey()}T${roster.startTime}:00+06:30`);
    lateMin = Math.max(0, Math.round((now.getTime() - localStart.getTime()) / 60000));
  }
  const row = existing
    ? await prisma.attendance.update({
        where: { id: existing.id },
        data: { clockIn: now, lateMin, status: "present" },
        include: { user: { select: { name: true, nameMy: true } } },
      })
    : await prisma.attendance.create({
        data: { branchId: branchId, userId: u.id, date: dayStart, clockIn: now, lateMin, status: "present" },
        include: { user: { select: { name: true, nameMy: true } } },
      });
  return ok(attendanceDTO(row));
}

export async function clockOut(): Promise<ActionResult<AttendanceDTO>> {
  const u = await requireUser();
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const dayStart = yangonDayStart();
  const existing = await prisma.attendance.findUnique({
    where: { branchId_userId_date: { branchId: branchId, userId: u.id, date: dayStart } },
    include: { user: { select: { name: true, nameMy: true } } },
  });
  if (!existing?.clockIn) return fail("Clock in first");
  if (existing.clockOut) return fail("Already clocked out");
  const now = new Date();
  const row = await prisma.attendance.update({
    where: { id: existing.id },
    data: { clockOut: now },
    include: { user: { select: { name: true, nameMy: true } } },
  });
  return ok(attendanceDTO(row));
}

export async function getMyAttendanceToday(): Promise<ActionResult<AttendanceDTO | null>> {
  const u = await requireUser();
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  if (!branchId) return ok(null);
  const row = await prisma.attendance.findUnique({
    where: { branchId_userId_date: { branchId: branchId, userId: u.id, date: yangonDayStart() } },
    include: { user: { select: { name: true, nameMy: true } } },
  });
  return ok(row ? attendanceDTO(row) : null);
}

export async function getAttendance(input: unknown): Promise<ActionResult<AttendanceDTO[]>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = attendanceListSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { from, to, userId } = parsed.data;
  const rows = await prisma.attendance.findMany({
    where: {
      branchId: branchId,
      date: { gte: yangonDayStart(from), lt: new Date(yangonDayStart(to).getTime() + 24 * 3600 * 1000) },
      ...(userId ? { userId } : {}),
    },
    include: { user: { select: { name: true, nameMy: true } } },
    orderBy: [{ date: "desc" }, { clockIn: "desc" }],
    take: 500,
  });
  return ok(rows.map(attendanceDTO));
}

// ── Roster ────────────────────────────────────────────────────────

export type RosterDTO = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  shiftName: string;
  startTime: string;
  endTime: string;
};

export async function getRoster(input: unknown): Promise<ActionResult<{ weekStart: string; days: string[]; entries: RosterDTO[] }>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const weekStart = typeof input === "string" ? input : (input as { weekStart?: string } | null)?.weekStart;
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return fail("Invalid week start");
  const start = yangonDayStart(weekStart);
  const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
  const rows = await prisma.roster.findMany({
    where: { branchId: branchId, date: { gte: start, lt: end } },
    include: { user: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  const days = Array.from({ length: 7 }, (_, i) => yangonDateKey(new Date(start.getTime() + i * 24 * 3600 * 1000)));
  return ok({
    weekStart,
    days,
    entries: rows.map((r) => ({
      id: r.id, userId: r.userId, userName: r.user.name,
      date: yangonDateKey(r.date), shiftName: r.shiftName,
      startTime: r.startTime, endTime: r.endTime,
    })),
  });
}

export async function saveRoster(input: unknown): Promise<ActionResult<{ saved: number }>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = saveRosterSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error as never);
  const { weekStart, entries } = parsed.data;
  const start = yangonDayStart(weekStart);
  const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
  // validate users belong to branch
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, branchId: branchId }, select: { id: true } });
  if (users.length !== userIds.length) return fail("One or more staff not found");
  await prisma.$transaction(async (tx) => {
    await tx.roster.deleteMany({ where: { branchId: branchId, date: { gte: start, lt: end } } });
    for (const e of entries) {
      await tx.roster.create({
        data: {
          branchId: branchId,
          userId: e.userId,
          date: yangonDayStart(e.date),
          shiftName: e.shiftName,
          startTime: e.startTime,
          endTime: e.endTime,
        },
      });
    }
  });
  await logAudit({ userId: u.id, branchId: branchId, action: "roster_save", entityType: "Roster", after: { weekStart, count: entries.length } });
  return ok({ saved: entries.length });
}

export async function deleteRosterEntry(input: unknown): Promise<ActionResult<void>> {
  const u = await requireRole("manager");
  if (!u.branchId) return fail("No branch assigned");
  const branchId = u.branchId;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid id");
  const row = await prisma.roster.findFirst({ where: { id: parsed.data, branchId: branchId } });
  if (!row) return fail("Roster entry not found");
  await prisma.roster.delete({ where: { id: row.id } });
  return ok(undefined as void);
}
