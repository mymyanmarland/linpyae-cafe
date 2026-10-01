"use server";

import { ok, fail, type ActionResult } from "@/lib/action-result";
import { getSetting } from "@/lib/settings";
import { normalizeMmPhone } from "@/lib/format";
import { logAudit } from "@/lib/audit";

export type SmsResult = {
  messageId: string;
  provider: string;
  demo: boolean;
};

/**
 * Send an SMS. Provider is configured per branch via settings:
 *   sms.provider: "none" | "stub" | "http"
 *   sms.http.endpoint / sms.http.apiKey
 *
 * - "none": skipped, recorded as skipped_no_provider
 * - "stub": SANDBOX — logs to console, returns a fake message id. No SMS is sent.
 * - "http": posts JSON {to, message} to the configured endpoint with a
 *   Bearer API key. Real provider credentials required — configure in Settings.
 */
export async function sendSms(
  branchId: string,
  to: string,
  message: string
): Promise<ActionResult<SmsResult>> {
  const phone = normalizeMmPhone(to);
  if (!phone) return fail("Invalid phone number");
  if (!message.trim()) return fail("Message is empty");

  const provider = await getSetting(branchId, "sms.provider", "none");

  if (provider === "none") {
    return fail("No SMS provider configured");
  }

  if (provider === "stub") {
    // SANDBOX: never sends a real SMS.
    const messageId = `stub-${Date.now().toString(36)}`;
    console.log(`[sms:stub] to=${phone} message=${message}`);
    await logAudit({
      branchId,
      action: "sms_sent",
      entityType: "Notification",
      after: { to: phone, provider: "stub", messageId, demo: true },
    });
    return ok({ messageId, provider: "stub", demo: true });
  }

  if (provider === "http") {
    const endpoint = await getSetting(branchId, "sms.http.endpoint", "");
    const apiKey = await getSetting(branchId, "sms.http.apiKey", "");
    if (!endpoint) return fail("SMS endpoint not configured");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ to: phone, message }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        await logAudit({ branchId, action: "sms_failed", entityType: "Notification", after: { to: phone, status: res.status, body: body.slice(0, 200) } });
        return fail(`SMS provider error (${res.status})`);
      }
      const data = (await res.json().catch(() => ({}))) as { messageId?: string };
      const messageId = data.messageId ?? `http-${Date.now().toString(36)}`;
      await logAudit({ branchId, action: "sms_sent", entityType: "Notification", after: { to: phone, provider: "http", messageId } });
      return ok({ messageId, provider: "http", demo: false });
    } catch (e) {
      return fail(`SMS request failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  return fail(`Unknown SMS provider: ${provider}`);
}
