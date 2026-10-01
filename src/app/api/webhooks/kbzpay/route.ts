import { NextRequest, NextResponse } from "next/server";
import { handleWalletWebhook } from "@/lib/webhooks";

/**
 * KBZPay payment callback. SANDBOX by default — set KBZPAY_WEBHOOK_SECRET to
 * enable HMAC signature verification for live callbacks.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-signature");
  const outcome = await handleWalletWebhook("kbzpay", rawBody, signature);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
