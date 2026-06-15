import { NextResponse } from "next/server";
import { processYooKassaNotification } from "@/lib/payment-provider";

export async function POST(request: Request) {
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
