import { NextResponse } from "next/server";
import { processYooKassaNotification } from "@/lib/payment-provider";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const mode = process.env.BLIZHNIY_AUTH_MODE;
  if (mode && mode !== "local") {
    return NextResponse.json({ error: { code: "LEGACY_WEBHOOK_DISABLED" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ ok: false, error: "Payment storage is unavailable" }, { status: 503 });
  }

  const payload = (await request.json().catch(() => null)) as unknown;

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
    return NextResponse.json({ ok: false, error: "Invalid YooKassa notification payload" }, { status: 400 });
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
      return NextResponse.json({ ok: false, error: "Payment fulfillment is pending" }, { status: 503 });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "YooKassa webhook processing failed";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
