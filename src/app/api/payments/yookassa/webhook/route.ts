import { NextResponse } from "next/server";
import { processYooKassaNotification } from "@/lib/payment-provider";

export const dynamic = "force-dynamic";

function hasValidWebhookSecret(request: Request) {
  const secret = process.env.YOOKASSA_WEBHOOK_SECRET?.trim();

  if (!secret) {
    return false;
  }

  const headerSecret = request.headers.get("x-yookassa-webhook-secret")?.trim();
  const bearerSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  return headerSecret === secret || bearerSecret === secret;
}

function requiresWebhookSecret() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.YOOKASSA_WEBHOOK_SECRET?.trim());
}

export function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "yookassa-webhook",
  });
}

export async function POST(request: Request) {
  if (requiresWebhookSecret() && !hasValidWebhookSecret(request)) {
    return NextResponse.json({ ok: false, error: "Invalid webhook secret" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as unknown;

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid YooKassa notification payload" }, { status: 400 });
  }

  try {
    const result = await processYooKassaNotification(payload);

    return NextResponse.json({ ok: true, verifiedBySecret: hasValidWebhookSecret(request), ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "YooKassa webhook processing failed";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
