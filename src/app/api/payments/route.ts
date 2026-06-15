import { NextResponse } from "next/server";
import { createPayment, listPayments } from "@/lib/payment-provider";
import { getAuthenticatedRequestUser, isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";
import type { Payment } from "@/lib/types";

type CreatePaymentBody = {
  tariffId?: string;
  targetId?: string;
  targetType?: Payment["targetType"];
  targetTitle?: string;
};

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const payments = await listPayments();

  return NextResponse.json({ payments });
}

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы создать платеж" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreatePaymentBody | null;

  if (!body?.tariffId) {
    return NextResponse.json({ error: "tariffId is required" }, { status: 400 });
  }

  try {
    const payment = await createPayment({
      tariffId: body.tariffId,
      targetId: body.targetId,
      targetType: body.targetType,
      targetTitle: body.targetTitle,
      userId: auth.user.id,
    });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment creation failed" }, { status: 400 });
  }
}
