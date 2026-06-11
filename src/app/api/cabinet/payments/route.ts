import { NextResponse } from "next/server";
import { listStoredPaymentsForUser } from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы открыть платежи" }, { status: 401 });
  }

  const payments = await listStoredPaymentsForUser(auth.user.id);

  return NextResponse.json({ payments });
}
