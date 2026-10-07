import { NextResponse } from "next/server";
import { TURNSTILE_ERROR_MESSAGE, verifyTurnstileToken } from "@/lib/turnstile";
import { getTrustedProxyIp } from "@/lib/trusted-proxy-ip";

type VerifyTurnstileBody = {
  token?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as VerifyTurnstileBody | null;
  const verified = await verifyTurnstileToken(body?.token, getTrustedProxyIp(request.headers));

  if (!verified) {
    return NextResponse.json({ error: TURNSTILE_ERROR_MESSAGE, ok: false }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
