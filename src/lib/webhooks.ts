import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export type WalletProvider = "kbzpay" | "wavepay";

export type WebhookOutcome =
  | { status: 200; body: { ok: true; demo: boolean; orderNumber: string } }
  | { status: number; body: { ok: false; error: string } };

/**
 * Shared e-wallet webhook logic. SANDBOX-first:
 * - If `<PROVIDER>_WEBHOOK_SECRET` env is set, the request must carry a valid
 *   HMAC-SHA256 signature (hex) of the raw body in the `x-signature` header.
 * - If no secret is configured, the payload is accepted in DEMO mode and this
 *   is logged + returned explicitly. Demo mode never claims real settlement.
 *
 * Expected JSON payload (demo + live): { orderNumber, amountKs, txnId, status }
 */
export async function handleWalletWebhook(
  provider: WalletProvider,
  rawBody: string,
  signature: string | null
): Promise<WebhookOutcome> {
  const secret = process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`];
  const demo = !secret;

  if (!demo) {
    if (!signature) return { status: 401, body: { ok: false, error: "Missing signature" } };
    const expected = createHmac("sha256", secret!).update(rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await logAudit({ action: "webhook_rejected", entityType: "Payment", after: { provider, reason: "bad_signature" } });
      return { status: 401, body: { ok: false, error: "Invalid signature" } };
    }
  }

  let payload: { orderNumber?: string; amountKs?: number; txnId?: string; status?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "Invalid JSON" } };
  }
  const { orderNumber, amountKs, txnId, status } = payload;
  if (!orderNumber || typeof amountKs !== "number" || amountKs <= 0) {
    return { status: 400, body: { ok: false, error: "orderNumber and positive amountKs required" } };
  }
  if (status && status !== "success" && status !== "SUCCESS") {
    await logAudit({ action: "webhook_ignored", entityType: "Payment", after: { provider, orderNumber, status, demo } });
    return { status: 200, body: { ok: true, demo, orderNumber } };
  }

  // Match the pending payment created at checkout (reference = order number).
  const payment = await prisma.payment.findFirst({
    where: { method: provider, reference: orderNumber, status: "pending" },
    include: { order: true },
  });
  const order =
    payment?.order ??
    (await prisma.order.findFirst({ where: { orderNumber, status: { not: "voided" } } }));
  if (!order) {
    await logAudit({ action: "webhook_no_order", entityType: "Payment", after: { provider, orderNumber, demo } });
    return { status: 404, body: { ok: false, error: "Order not found" } };
  }
  if (Math.round(amountKs) < order.totalKs) {
    await logAudit({ branchId: order.branchId, action: "webhook_underpaid", entityType: "Payment", entityId: payment?.id, after: { provider, orderNumber, amountKs, totalKs: order.totalKs, demo } });
    return { status: 422, body: { ok: false, error: "Amount below order total" } };
  }

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "confirmed",
        confirmedAt: new Date(),
        reference: txnId ?? payment.reference,
        payloadJson: JSON.stringify({ ...payload, demo, verifiedAt: new Date().toISOString() }),
      },
    });
  }
  const paidKs = order.paidKs + Math.round(amountKs);
  await prisma.order.update({
    where: { id: order.id },
    data: { paidKs, changeKs: Math.max(0, paidKs - order.totalKs) },
  });

  await logAudit({
    branchId: order.branchId,
    action: "webhook_payment",
    entityType: "Payment",
    entityId: payment?.id ?? order.id,
    after: { provider, orderNumber, amountKs, txnId, demo },
  });

  if (demo) {
    console.log(`[webhook:${provider}:demo] confirmed ${orderNumber} for ${amountKs} Ks (txn ${txnId ?? "n/a"}) — SANDBOX, no real money`);
  }
  return { status: 200, body: { ok: true, demo, orderNumber } };
}
