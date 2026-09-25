import type { Payment } from "@/lib/types";

export type YooKassaPaymentStatus = "pending" | "waiting_for_capture" | "succeeded" | "canceled";

export type YooKassaPaymentResponse = {
  confirmation?: { confirmation_url?: string };
  id: string;
  paid?: boolean;
  amount?: { value: string; currency: string };
  status: YooKassaPaymentStatus;
  test?: boolean;
  metadata?: {
    localPaymentId?: string;
    tariffId?: string;
    targetId?: string;
    targetType?: Payment["targetType"];
  };
};

export function yookassaStatusToPaymentStatus(status: YooKassaPaymentStatus, paid?: boolean): Payment["status"] {
  if (typeof paid !== "boolean") {
    throw new Error("YooKassa payment paid flag is missing");
  }

  // `paid: true` also occurs in waiting_for_capture, before funds are captured.
  if (status === "succeeded") {
    if (!paid) throw new Error("YooKassa payment status and paid flag disagree");
    return "succeeded";
  }

  if (status === "canceled") {
    if (paid) throw new Error("YooKassa payment status and paid flag disagree");
    return "failed";
  }

  if (status === "pending" || status === "waiting_for_capture") {
    return "pending";
  }

  throw new Error("Unknown YooKassa payment status");
}

export function verifyYooKassaPayment(
  payment: Pick<Payment, "id" | "providerPaymentId" | "amount" | "targetId" | "targetType" | "tariffId">,
  providerPayment: YooKassaPaymentResponse,
) {
  if (!payment.providerPaymentId || providerPayment.id !== payment.providerPaymentId) {
    throw new Error("YooKassa payment id mismatch");
  }

  const providerAmount = providerPayment.amount;
  if (
    !providerAmount ||
    providerAmount.currency !== "RUB" ||
    !/^\d+\.\d{2}$/.test(providerAmount.value) ||
    Math.round(Number(providerAmount.value) * 100) !== Math.round(payment.amount * 100)
  ) {
    throw new Error("YooKassa payment amount mismatch");
  }

  // We supply all four values when creating every new provider payment. A
  // missing or partial echo cannot safely bind a payment to a local target.
  const metadata = providerPayment.metadata;
  if (
    !payment.targetId ||
    !payment.tariffId ||
    metadata?.localPaymentId !== payment.id ||
    metadata.targetId !== payment.targetId ||
    metadata.targetType !== payment.targetType ||
    metadata.tariffId !== payment.tariffId
  ) {
    throw new Error("YooKassa payment metadata mismatch or missing");
  }
}
