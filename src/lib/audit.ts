import { prisma } from "./db";

export async function logAudit(opts: {
  userId?: string | null;
  branchId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: opts.userId ?? undefined,
        branchId: opts.branchId ?? undefined,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        beforeJson: opts.before === undefined ? undefined : JSON.stringify(opts.before),
        afterJson: opts.after === undefined ? undefined : JSON.stringify(opts.after),
        ipAddress: opts.ipAddress,
      },
    });
  } catch {
    // audit must never break the main flow
  }
}
