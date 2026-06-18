import { NextResponse } from "next/server";
import { processYooKassaNotification } from "@/lib/payment-provider";

function hasValidWebhookSecret(request: Request) {
  const secret = process.env.YOOKASSA_WEBHOOK_SECRET?.trim();

  if (!secret) {
    return false;
  }

  const url = new URL(request.url);
  const headerSecret = request.headers.get("x-yookassa-webhook-secret")?.trim();
  const bearerSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const querySecret = url.searchParams.get("secret")?.trim();

  return headerSecret === secret || bearerSecret === secret || querySecret === secret;
}

function requiresWebhookSecret() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.YOOKASSA_WEBHOOK_SECRET?.trim());
}

export async function POST(request: Request) {
  if (requiresWebhookSecret() && !hasValidWebhookSecret(request)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid YooKassa webhook payload" }, { status: 400 });
  }

  try {
    const processed = await processYooKassaNotification(payload);

    if (!processed.processed) {
      return NextResponse.json({ ok: true, processed: false, reason: processed.reason });
    }

    return NextResponse.json({ ok: true, processed: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "YooKassa webhook processing failed" },
      { status: 500 },
    );
  }
}
