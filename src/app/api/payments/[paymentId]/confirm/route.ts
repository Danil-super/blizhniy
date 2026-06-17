import { NextResponse } from "next/server";
import { getPayment, confirmPayment } from "@/lib/payment-provider";
import { findStoredPaymentByProvider, getLatestPendingStoredPaymentForUser, getStoredPayment } from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const body = (await request.json().catch(() => null)) as { trustSuccessfulReturn?: boolean } | null;

  try {
    let payment = (await getStoredPayment(paymentId)) ?? (await findStoredPaymentByProvider(paymentId)) ?? getPayment(paymentId);
    let resolvedPaymentId = payment?.id ?? paymentId;
    let canTrustSuccessfulReturn = false;

    if (isSupabaseServerConfigured()) {
      const auth = await getAuthenticatedRequestUser(request);

      if (!auth && !payment) {
        return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы подтвердить платеж" }, { status: 401 });
      }

      if (auth) {
        payment ??= await getLatestPendingStoredPaymentForUser(auth.user.id);
        const isAdmin = await isAdminRequest(request);

        if (payment?.userId && payment.userId !== auth.user.id && !isAdmin) {
          return NextResponse.json({ error: "Платеж принадлежит другому пользователю" }, { status: 403 });
        }

        canTrustSuccessfulReturn = Boolean(payment?.userId && (payment.userId === auth.user.id || isAdmin));
      }

      if (payment?.id) {
        resolvedPaymentId = payment.id;
      }
    }

    const result = await confirmPayment(payment ?? resolvedPaymentId, {
      trustSuccessfulReturn: Boolean(body?.trustSuccessfulReturn && canTrustSuccessfulReturn),
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment confirmation failed" }, { status: 404 });
  }
}
