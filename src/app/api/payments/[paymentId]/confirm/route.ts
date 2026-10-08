import { NextResponse } from "next/server";
import { getPayment, confirmPayment } from "@/lib/payment-provider";
import {
  findStoredPaymentByProvider,
  getStoredPayment,
} from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;

  if (process.env.NODE_ENV === "production" && !isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  try {
    const payment = (await getStoredPayment(paymentId)) ?? (await findStoredPaymentByProvider(paymentId)) ?? getPayment(paymentId);

    if (isSupabaseServerConfigured()) {
      const auth = await getAuthenticatedRequestUser(request);

      if (!auth) {
        return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы подтвердить платеж" }, { status: 401 });
      }

      if (!payment) {
        // A return URL is bound to one exact local/provider payment id. Never
        // substitute a different pending payment for the newly signed-in user:
        // an A → B account switch could otherwise confirm B's payment.
        return NextResponse.json({ error: "Платеж не найден" }, { status: 404 });
      }

      const isAdmin = await isAdminRequest(request);

      if (payment.userId !== auth.user.id && !isAdmin) {
        return NextResponse.json({ error: "Платеж принадлежит другому пользователю" }, { status: 403 });
      }

    }

    if (!payment) {
      return NextResponse.json({ error: "Платеж не найден" }, { status: 404 });
    }

    const result = await confirmPayment(payment);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment confirmation failed" }, { status: 404 });
  }
}
