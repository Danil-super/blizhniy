import { listMockPayments, markPaymentTargetSucceeded } from "@/lib/mock-store";
import {
  canStorePayment,
  createStoredPayment,
  findStoredPaymentByProvider,
  getStoredPayment,
  markStoredPaymentTargetSucceeded,
  updateStoredPayment,
} from "@/lib/payment-store";
import { getPublicSiteUrl } from "@/lib/site-url";
import { getActiveTariffById } from "@/lib/tariff-store";
import type { Payment, Tariff } from "@/lib/types";

type PaymentTargetType = Payment["targetType"];
type YooKassaPaymentStatus = "pending" | "waiting_for_capture" | "succeeded" | "canceled";
type YooKassaPaymentResponse = {
  confirmation?: {
    confirmation_url?: string;
  };
  id: string;
  paid?: boolean;
  status: YooKassaPaymentStatus;
  metadata?: {
    localPaymentId?: string;
    tariffId?: string;
    targetId?: string;
    targetType?: PaymentTargetType;
  };
};

type YooKassaNotificationPayload = {
  event?: string;
  object?: YooKassaPaymentResponse;
};

export type CreatePaymentInput = {
  tariffId: string;
  targetId?: string;
  targetType?: PaymentTargetType;
  targetTitle?: string;
  userId?: string;
};

export type PaymentResult = {
  payment: Payment;
  nextStatus: "published" | "sent";
  notification: {
    subject: string;
    body: string;
  };
};

function resolveTargetType(tariff: Tariff): PaymentTargetType {
  if (tariff.action === "vacancy_publication") {
    return "vacancy";
  }

  if (tariff.action === "specialist_publication") {
    return "specialist";
  }

  if (tariff.action === "job_response") {
    return "application";
  }

  if (tariff.action === "fair_participation") {
    return "fair_application";
  }

  if (tariff.action === "ad_marquee") {
    return "ad_marquee";
  }

  return "listing";
}

function resolveTargetTitle(tariff: Tariff, targetTitle?: string) {
  return targetTitle?.trim() || tariff.name;
}

function createPaymentId() {
  return crypto.randomUUID();
}

function createMockPaymentId() {
  return `pay-mock-${Date.now().toString(36)}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getPaymentProviderName() {
  const provider = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  return provider === "yookassa" ? "yookassa" : ("mock" as const);
}

export function listPayments() {
  return listMockPayments();
}

export function getPayment(paymentId: string) {
  return listMockPayments().find((payment) => payment.id === paymentId);
}

async function fetchYooKassaPayment(providerPaymentId: string) {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    throw new Error("YooKassa credentials are not configured");
  }

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  const response = await fetch(`https://api.yookassa.ru/v3/payments/${providerPaymentId}`, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as (YooKassaPaymentResponse & { description?: string }) | null;

  if (!response.ok || !payload?.id) {
    throw new Error(payload?.description ?? "YooKassa payment status check failed");
  }

  return payload;
}

function getPublicBaseUrl() {
  return getPublicSiteUrl();
}

function yookassaStatusToPaymentStatus(status: YooKassaPaymentStatus): Payment["status"] {
  if (status === "succeeded" || status === "waiting_for_capture") {
    return "succeeded";
  }

  if (status === "canceled") {
    return "failed";
  }

  return "pending";
}

function applyYooKassaPaymentState(payment: Payment, yookassaPayment: YooKassaPaymentResponse) {
  payment.provider = "yookassa";
  payment.providerPaymentId = yookassaPayment.id;
  payment.status = yookassaStatusToPaymentStatus(yookassaPayment.status);
  payment.confirmationUrl = yookassaPayment.confirmation?.confirmation_url ?? payment.confirmationUrl;

  if (payment.status === "succeeded") {
    payment.paidAt = payment.paidAt ?? todayIsoDate();
  }

  return payment;
}

function createPendingPaymentResult(payment: Payment): PaymentResult {
  return {
    payment,
    nextStatus: payment.targetType === "application" ? "sent" : "published",
    notification: {
      subject: "Оплата ожидает подтверждения",
      body: `${payment.targetTitle}: ЮKassa еще не подтвердила успешную оплату.`,
    },
  };
}

async function applySucceededPayment(payment: Payment): Promise<PaymentResult> {
  payment.status = "succeeded";
  payment.paidAt = payment.paidAt ?? todayIsoDate();

  await updateStoredPayment(payment);
  const nextStatus = canStorePayment(payment) ? await markStoredPaymentTargetSucceeded(payment) : markPaymentTargetSucceeded(payment);

  return {
    payment,
    nextStatus,
    notification: {
      subject: "Оплата прошла",
      body: `${payment.targetTitle}: статус изменен на ${nextStatus}.`,
    },
  };
}

async function createYooKassaPayment(input: CreatePaymentInput, tariff: Tariff) {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    throw new Error("YooKassa credentials are not configured");
  }

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  const targetType = input.targetType ?? resolveTargetType(tariff);
  const localPaymentId = createPaymentId();
  const returnUrl = `${getPublicBaseUrl()}/oplata/${localPaymentId}`;

  if (targetType === "listing" && !canStorePayment(input)) {
    throw new Error("YooKassa listing payments require a stored listing UUID before payment creation");
  }

  const response = await fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "Idempotence-Key": localPaymentId,
    },
    body: JSON.stringify({
      amount: {
        value: tariff.price.toFixed(2),
        currency: "RUB",
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: returnUrl,
      },
      description: resolveTargetTitle(tariff, input.targetTitle).slice(0, 128),
      metadata: {
        localPaymentId,
        targetId: input.targetId,
        targetType,
        tariffId: tariff.id,
      },
    }),
  });
  const payload = (await response.json().catch(() => null)) as (YooKassaPaymentResponse & { description?: string }) | null;

  if (!response.ok || !payload?.id) {
    throw new Error(payload?.description ?? "YooKassa payment creation failed");
  }

  const payment: Payment = {
    id: localPaymentId,
    targetType,
    targetId: input.targetId,
    targetTitle: resolveTargetTitle(tariff, input.targetTitle),
    tariffId: tariff.id,
    amount: tariff.price,
    status: yookassaStatusToPaymentStatus(payload.status),
    provider: "yookassa",
    providerPaymentId: payload.id,
    confirmationUrl: payload.confirmation?.confirmation_url,
    createdAt: todayIsoDate(),
    ...(payload.status === "succeeded" || payload.status === "waiting_for_capture" ? { paidAt: todayIsoDate() } : {}),
  };

  if (canStorePayment(input)) {
    const storedPayment = await createStoredPayment({
      amount: payment.amount,
      id: payment.id,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      status: payment.status,
      targetId: payment.targetId,
      targetTitle: payment.targetTitle,
      targetType: payment.targetType,
      tariff,
      userId: input.userId,
    });

    if (!storedPayment) {
      throw new Error("YooKassa payment was created, but local payment persistence failed");
    }
  } else {
    listMockPayments().unshift(payment);
  }

  if (payment.status === "succeeded") {
    if (canStorePayment(input)) {
      await markStoredPaymentTargetSucceeded(payment);
    } else {
      markPaymentTargetSucceeded(payment);
    }
  }

  return payment;
}

export async function createPayment(input: CreatePaymentInput) {
  const tariff = getActiveTariffById(input.tariffId);

  if (!tariff) {
    throw new Error("Tariff not found or inactive");
  }

  const provider = getPaymentProviderName();

  if (provider === "yookassa") {
    return createYooKassaPayment(input, tariff);
  }

  const payment: Payment = {
    id: canStorePayment(input) ? createPaymentId() : createMockPaymentId(),
    targetType: input.targetType ?? resolveTargetType(tariff),
    targetId: input.targetId,
    targetTitle: resolveTargetTitle(tariff, input.targetTitle),
    tariffId: tariff.id,
    amount: tariff.price,
    status: "created",
    provider,
    createdAt: todayIsoDate(),
  };

  if (canStorePayment(input)) {
    await createStoredPayment({
      amount: payment.amount,
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      targetId: payment.targetId,
      targetTitle: payment.targetTitle,
      targetType: payment.targetType,
      tariff,
      userId: input.userId,
    });
  } else {
    listMockPayments().unshift(payment);
  }

  return payment;
}

export async function confirmPayment(paymentId: string): Promise<PaymentResult> {
  const payment = (await getStoredPayment(paymentId)) ?? getPayment(paymentId);

  if (!payment) {
    throw new Error("Payment not found");
  }

  if (payment.provider === "yookassa") {
    if (!payment.providerPaymentId) {
      throw new Error("YooKassa payment id is missing");
    }

    const yookassaPayment = await fetchYooKassaPayment(payment.providerPaymentId);
    applyYooKassaPaymentState(payment, yookassaPayment);

    if (payment.status !== "succeeded") {
      await updateStoredPayment(payment);
      return createPendingPaymentResult(payment);
    }
  }

  return applySucceededPayment(payment);
}

async function findPaymentByYooKassaObject(yookassaPayment: YooKassaPaymentResponse) {
  const localPaymentId = yookassaPayment.metadata?.localPaymentId;
  const storedPayment = await findStoredPaymentByProvider(yookassaPayment.id, localPaymentId);

  if (storedPayment) {
    return storedPayment;
  }

  return listMockPayments().find((payment) => payment.id === localPaymentId || payment.providerPaymentId === yookassaPayment.id);
}

export async function processYooKassaNotification(payload: YooKassaNotificationPayload) {
  const yookassaPayment = payload.object;

  if (!payload.event?.startsWith("payment.") || !yookassaPayment?.id) {
    return { processed: false, reason: "unsupported_notification" as const };
  }

  const payment = await findPaymentByYooKassaObject(yookassaPayment);

  if (!payment) {
    return { processed: false, reason: "payment_not_found" as const };
  }

  applyYooKassaPaymentState(payment, yookassaPayment);
  await updateStoredPayment(payment);

  if (payment.status !== "succeeded") {
    return { processed: true, result: createPendingPaymentResult(payment) };
  }

  return { processed: true, result: applySucceededPayment(payment) };
}
