import { NextResponse } from "next/server";
import { TURNSTILE_ERROR_MESSAGE, verifyTurnstileToken } from "@/lib/turnstile";

type VerifyTurnstileBody = {
  token?: string;
};

function getRemoteIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as VerifyTurnstileBody | null;
  const token = body?.token?.trim() ?? "";
  const verified = await verifyTurnstileToken(token, getRemoteIp(request));

  if (!verified) {
    return NextResponse.json({ error: TURNSTILE_ERROR_MESSAGE, ok: false }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
