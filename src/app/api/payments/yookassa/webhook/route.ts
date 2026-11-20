import { readLegacyJson } from "@/lib/legacy-request-body";
import { NextResponse } from "next/server";
import { processYooKassaNotification } from "@/lib/payment-provider";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";

export const dynamic = "force-dynamic";

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const mode = process.env.BLIZHNIY_AUTH_MODE;
  if (mode && mode !== "local") {
    return reply({ error: { code: "LEGACY_WEBHOOK_DISABLED" } }, 503);
  }
  if (!isSupabaseServiceRoleConfigured()) {
    return reply({ ok: false, error: "Payment storage is unavailable" }, 503);
  }

  const payload = (await readLegacyJson(request).catch(() => null)) as unknown;

  if (
    !payload ||
    typeof payload !== "object" ||
    !("type" in payload) ||
    payload.type !== "notification" ||
    !("event" in payload) ||
    typeof payload.event !== "string" ||
    !("object" in payload) ||
    !payload.object ||
    typeof payload.object !== "object" ||
    !("id" in payload.object) ||
    typeof payload.object.id !== "string"
  ) {
    return reply({ ok: false, error: "Invalid YooKassa notification payload" }, 400);
  }

  try {
    // The sender's JSON is untrusted. The provider payment ID and current status
    // are checked against YooKassa's API before any payment is applied.
    const result = await processYooKassaNotification(payload as Parameters<typeof processYooKassaNotification>[0]);

    const payment = result.result?.payment;
    if (result.processed && payment?.status === "succeeded"
      && payment.fulfillmentStatus !== "applied" && payment.fulfillmentStatus !== "blocked") {
      // Finance was committed but fulfillment is unresolved. A 2xx would lose
      // YooKassa's genuine retry; terminal durable blocked/applied is safe to ACK.
      return reply({ ok: false, error: "Payment fulfillment is pending" }, 503);
    }

    return reply({ ok: true });
  } catch {
    return reply({ ok: false, error: "YooKassa webhook processing failed" }, 500);
  }
}
