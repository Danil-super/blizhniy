import { NextResponse } from "next/server";
import { processYooKassaNotification } from "@/lib/payment-provider";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "yookassa-webhook",
  });
}

export async function POST(request: Request) {
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

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "YooKassa webhook processing failed";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
