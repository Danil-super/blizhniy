import { NextResponse } from "next/server";
import { getPayment, confirmPayment } from "@/lib/payment-provider";
import { findStoredPaymentByProvider, getLatestPendingStoredPaymentForUser, getStoredPayment } from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;

  try {
    let payment = (await getStoredPayment(paymentId)) ?? (await findStoredPaymentByProvider(paymentId)) ?? getPayment(paymentId);
    let resolvedPaymentId = payment?.id ?? paymentId;

    if (isSupabaseServerConfigured()) {
      const auth = await getAuthenticatedRequestUser(request);

      if (!auth) {
        return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы подтвердить платеж" }, { status: 401 });
      }

      payment ??= await getLatestPendingStoredPaymentForUser(auth.user.id);
      const isAdmin = await isAdminRequest(request);

      if (payment?.userId && payment.userId !== auth.user.id && !isAdmin) {
        return NextResponse.json({ error: "Платеж принадлежит другому пользователю" }, { status: 403 });
      }

      if (payment?.id) {
        resolvedPaymentId = payment.id;
      }
    }

    const result = await confirmPayment(payment ?? resolvedPaymentId);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment confirmation failed" }, { status: 404 });
  }
}
