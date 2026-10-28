import { NextResponse } from "next/server";
import { TURNSTILE_ERROR_MESSAGE, verifyTurnstileToken } from "@/lib/turnstile";
import { getTrustedProxyIp } from "@/lib/trusted-proxy-ip";
import { readTurnstileJson, TurnstileBodyError } from "@/lib/turnstile-request-body";

type VerifyTurnstileBody = {
  token?: unknown;
};

export async function POST(request: Request) {
  let body: VerifyTurnstileBody | null;
  try {
    body = await readTurnstileJson(request) as VerifyTurnstileBody | null;
  } catch (error) {
    const status = error instanceof TurnstileBodyError ? error.status : 400;
    return NextResponse.json({ error: TURNSTILE_ERROR_MESSAGE, ok: false }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const verified = await verifyTurnstileToken(body?.token, getTrustedProxyIp(request.headers));

  if (!verified) {
    return NextResponse.json({ error: TURNSTILE_ERROR_MESSAGE, ok: false }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
