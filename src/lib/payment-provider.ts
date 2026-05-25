import { payments, tariffs } from "@/lib/data";
import type { Payment, Tariff } from "@/lib/types";

type PaymentTargetType = Payment["targetType"];

declare global {
  var __blizhniyMockPayments: Payment[] | undefined;
}

export type CreatePaymentInput = {
  tariffId: string;
  targetType?: PaymentTargetType;
  targetTitle?: string;
};

export type PaymentResult = {
  payment: Payment;
  nextStatus: "published" | "sent";
  notification: {
    subject: string;
    body: string;
  };
};

function getMockPayments() {
  globalThis.__blizhniyMockPayments ??= [...payments];
  return globalThis.__blizhniyMockPayments;
}

function resolveTargetType(tariff: Tariff): PaymentTargetType {
  if (tariff.action === "vacancy_publication") {
    return "vacancy";
  }

  if (tariff.action === "job_response") {
    return "application";
  }

  if (tariff.action === "fair_participation") {
    return "fair_application";
  }

  return "listing";
}

function resolveTargetTitle(tariff: Tariff, targetTitle?: string) {
  return targetTitle?.trim() || tariff.name;
}

function createPaymentId() {
  return `pay-mock-${Date.now().toString(36)}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getPaymentProviderName() {
  return "mock" as const;
}

export function listPayments() {
  return getMockPayments();
}

export function getPayment(paymentId: string) {
  return getMockPayments().find((payment) => payment.id === paymentId);
}

export function createPayment(input: CreatePaymentInput) {
  const tariff = tariffs.find((item) => item.id === input.tariffId && item.active);

  if (!tariff) {
    throw new Error("Tariff not found or inactive");
  }

  const payment: Payment = {
    id: createPaymentId(),
    targetType: input.targetType ?? resolveTargetType(tariff),
    targetTitle: resolveTargetTitle(tariff, input.targetTitle),
    tariffId: tariff.id,
    amount: tariff.price,
    status: "created",
    provider: getPaymentProviderName(),
    createdAt: todayIsoDate(),
  };

  getMockPayments().unshift(payment);
  return payment;
}

export function confirmMockPayment(paymentId: string): PaymentResult {
  const payment = getPayment(paymentId);

  if (!payment) {
    throw new Error("Payment not found");
  }

  payment.status = "succeeded";
  payment.paidAt = todayIsoDate();

  const nextStatus = payment.targetType === "application" ? "sent" : "published";

  return {
    payment,
    nextStatus,
    notification: {
      subject: "Оплата прошла",
      body: `${payment.targetTitle}: статус изменен на ${nextStatus}.`,
    },
  };
}
