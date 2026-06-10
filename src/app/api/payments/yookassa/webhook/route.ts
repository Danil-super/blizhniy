import { NextResponse } from "next/server";
import { processYooKassaNotification } from "@/lib/payment-provider";

function isValidWebhookRequest(request: Request) {
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

export async function POST(request: Request) {
  if (!process.env.YOOKASSA_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ ok: false, error: "YooKassa webhook secret is not configured" }, { status: 503 });
  }

  if (!isValidWebhookRequest(request)) {
    return NextResponse.json({ ok: false, error: "Invalid YooKassa webhook secret" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as unknown;

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid YooKassa notification payload" }, { status: 400 });
  }

  const result = await processYooKassaNotification(payload);

  return NextResponse.json({ ok: true, ...result });
}
