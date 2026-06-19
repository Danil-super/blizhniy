import { NextResponse } from "next/server";
import { getPayment, confirmPayment } from "@/lib/payment-provider";
import {
  findStoredPaymentByProvider,
  getLatestPendingStoredPaymentForUser,
  getStoredPayment,
  markStoredPaymentTargetSucceeded,
  updateStoredPayment,
} from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";
import type { Payment } from "@/lib/types";

function isTestYooKassaMode() {
  return process.env.YOOKASSA_SECRET_KEY?.trim().startsWith("test_") ?? false;
}

function canTrustSuccessfulReturnInThisEnvironment() {
  if (!isTestYooKassaMode()) {
    return false;
  }

  return process.env.NODE_ENV !== "production" || process.env.YOOKASSA_TRUST_SUCCESSFUL_RETURN === "true";
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
      subject: "Тестовая оплата прошла",
      body: `${paidPayment.targetTitle}: статус изменен на ${nextStatus}.`,
    },
  };
}

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
      trustSuccessfulReturn: Boolean(body?.trustSuccessfulReturn && canTrustSuccessfulReturn && canTrustSuccessfulReturnInThisEnvironment()),
    });

    if (
      body?.trustSuccessfulReturn &&
      canTrustSuccessfulReturn &&
      canTrustSuccessfulReturnInThisEnvironment() &&
      result.payment.provider === "yookassa" &&
      (result.payment.targetType === "listing" || result.payment.targetType === "vacancy" || result.payment.targetType === "workRequest") &&
      result.payment.status !== "succeeded"
    ) {
      return NextResponse.json(await forceSucceededTestPayment(result.payment));
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment confirmation failed" }, { status: 404 });
  }
}
