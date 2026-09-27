import { NextResponse } from "next/server";
import { canForceSucceedYooKassaReturn, getPayment, confirmPayment } from "@/lib/payment-provider";
import {
  findStoredPaymentByProvider,
  getStoredPayment,
  markStoredPaymentTargetSucceeded,
  updateStoredPayment,
} from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";
import type { Payment } from "@/lib/types";

function canTrustSuccessfulReturnInThisEnvironment() {
  return canForceSucceedYooKassaReturn();
}

async function forceSucceededTestPayment(payment: Payment) {
  const paidPayment: Payment = {
    ...payment,
    paidAt: payment.paidAt ?? new Date().toISOString().slice(0, 10),
    status: "succeeded",
  };
  const nextStatus = await markStoredPaymentTargetSucceeded(paidPayment);

  await updateStoredPayment(paidPayment);

  return {
    payment: paidPayment,
    nextStatus,
    notification: {
      subject: "Оплата подтверждена",
      body: `${paidPayment.targetTitle}: статус изменен на ${nextStatus}.`,
    },
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const body = (await request.json().catch(() => null)) as { trustSuccessfulReturn?: boolean } | null;

  if (process.env.NODE_ENV === "production" && !isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  try {
    const payment = (await getStoredPayment(paymentId)) ?? (await findStoredPaymentByProvider(paymentId)) ?? getPayment(paymentId);
    let canTrustSuccessfulReturn = false;

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

      canTrustSuccessfulReturn = Boolean(payment.userId && (payment.userId === auth.user.id || isAdmin));
    }

    if (!payment) {
      return NextResponse.json({ error: "Платеж не найден" }, { status: 404 });
    }

    const result = await confirmPayment(payment, {
      trustSuccessfulReturn: Boolean(body?.trustSuccessfulReturn && canTrustSuccessfulReturn && canTrustSuccessfulReturnInThisEnvironment()),
    });

    if (
      body?.trustSuccessfulReturn &&
      canTrustSuccessfulReturn &&
      canTrustSuccessfulReturnInThisEnvironment() &&
      result.payment.provider === "yookassa" &&
      (result.payment.targetType === "listing" ||
        result.payment.targetType === "vacancy" ||
        result.payment.targetType === "workRequest" ||
        result.payment.targetType === "application" ||
        result.payment.targetType === "ad_marquee") &&
      result.payment.status !== "succeeded"
    ) {
      return NextResponse.json(await forceSucceededTestPayment(result.payment));
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment confirmation failed" }, { status: 404 });
  }
}
