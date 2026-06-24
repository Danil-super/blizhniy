import { listMockPayments, markPaymentTargetSucceeded } from "@/lib/mock-store";
import {
  canStorePayment,
  createStoredPayment,
  findActiveStoredPaymentForTarget,
  findStoredPaymentByProvider,
  getStoredPayment,
  listStoredPayments,
  markStoredPaymentTargetSucceeded,
  updateStoredPayment,
} from "@/lib/payment-store";
import { shouldAllowMockPayments } from "@/lib/runtime-mode";
import { getPublicSiteUrl } from "@/lib/site-url";
import { isSupabaseRestConfigured } from "@/lib/supabase-rest";
import { getActiveStoredTariffById } from "@/lib/tariff-store";
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
  test?: boolean;
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

type ConfirmPaymentOptions = {
  trustSuccessfulReturn?: boolean;
};

function resolveTargetType(tariff: Tariff): PaymentTargetType {
  if (tariff.action === "vacancy_publication") {
    return "vacancy";
  }

  if (tariff.action === "work_request_publication") {
    return "workRequest";
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

  if (provider === "yookassa") {
    return "yookassa";
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("PAYMENT_PROVIDER=yookassa is required in production");
  }

  return "mock" as const;
}

export async function listPayments() {
  if (isSupabaseRestConfigured()) {
    return listStoredPayments();
  }

  return shouldAllowMockPayments() ? listMockPayments() : [];
}

export function getPayment(paymentId: string) {
  return shouldAllowMockPayments() ? listMockPayments().find((payment) => payment.id === paymentId) : undefined;
}

async function fetchYooKassaJson<T>(url: string, init: RequestInit) {
  let response: Response | undefined;
  let payload: T | null = null;
  let fetchError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(url, init);
      payload = (await response.json().catch(() => null)) as T | null;

      if (response.status < 500 || attempt === 3) {
        break;
      }
    } catch (error) {
      fetchError = error;

      if (attempt === 3) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }

  if (!response) {
    throw fetchError instanceof Error ? fetchError : new Error("YooKassa request failed");
  }

  return { payload, response };
}

async function fetchYooKassaPayment(providerPaymentId: string) {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    throw new Error("YooKassa credentials are not configured");
  }

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  const { payload, response } = await fetchYooKassaJson<YooKassaPaymentResponse & { description?: string }>(`https://api.yookassa.ru/v3/payments/${providerPaymentId}`, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  if (!response.ok || !payload?.id) {
    throw new Error(payload?.description ?? "YooKassa payment status check failed");
  }

  return payload;
}

function getPublicBaseUrl() {
  return getPublicSiteUrl();
}

function yookassaStatusToPaymentStatus(status: YooKassaPaymentStatus, paid?: boolean): Payment["status"] {
  if (paid || status === "succeeded" || status === "waiting_for_capture") {
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
  payment.status = yookassaStatusToPaymentStatus(yookassaPayment.status, yookassaPayment.paid);
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

function canTrustYooKassaReturn(payment: Payment, options?: ConfirmPaymentOptions) {
  return Boolean(
    options?.trustSuccessfulReturn &&
      payment.provider === "yookassa" &&
      (payment.status === "created" || payment.status === "pending"),
  );
}

async function applySucceededPayment(payment: Payment): Promise<PaymentResult> {
  payment.status = "succeeded";
  payment.paidAt = payment.paidAt ?? todayIsoDate();

  await updateStoredPayment(payment);
  const nextStatus = canStorePayment(payment)
    ? await markStoredPaymentTargetSucceeded(payment)
    : shouldAllowMockPayments()
      ? markPaymentTargetSucceeded(payment)
      : undefined;

  if (!nextStatus) {
    throw new Error("Stored payment target is required before confirming payment");
  }

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
  if (!canStorePayment(input)) {
    throw new Error("Payment persistence is required before creating YooKassa payment");
  }

  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    throw new Error("YooKassa credentials are not configured");
  }

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  const targetType = input.targetType ?? resolveTargetType(tariff);
  const localPaymentId = createPaymentId();
  const returnUrl = `${getPublicBaseUrl()}/oplata/${localPaymentId}`;

  const activePayment = await findActiveStoredPaymentForTarget({
    targetId: input.targetId,
    targetType,
    userId: input.userId,
  });

  if (activePayment?.provider === "yookassa" && activePayment.providerPaymentId) {
    try {
      const yookassaPayment = await fetchYooKassaPayment(activePayment.providerPaymentId);

      applyYooKassaPaymentState(activePayment, yookassaPayment);

      if (activePayment.status === "succeeded") {
        await applySucceededPayment(activePayment);
        return activePayment;
      } else {
        await updateStoredPayment(activePayment);
      }

      if (activePayment.confirmationUrl) {
        return activePayment;
      }
    } catch (error) {
      console.error("Failed to sync active YooKassa payment before creating a new one", error);
    }
  }

  const { payload, response } = await fetchYooKassaJson<YooKassaPaymentResponse & { description?: string }>("https://api.yookassa.ru/v3/payments", {
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
    status: yookassaStatusToPaymentStatus(payload.status, payload.paid),
    provider: "yookassa",
    providerPaymentId: payload.id,
    confirmationUrl: payload.confirmation?.confirmation_url,
    createdAt: todayIsoDate(),
    ...(yookassaStatusToPaymentStatus(payload.status, payload.paid) === "succeeded" ? { paidAt: todayIsoDate() } : {}),
  };

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

  if (payment.status === "succeeded") {
    await applySucceededPayment(payment);
  }

  return payment;
}

export async function createPayment(input: CreatePaymentInput) {
  const tariff = await getActiveStoredTariffById(input.tariffId);

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
  } else if (shouldAllowMockPayments()) {
    listMockPayments().unshift(payment);
  } else {
    throw new Error("Payment persistence is required");
  }

  return payment;
}

async function resolvePaymentForConfirmation(paymentId: string) {
  return (await getStoredPayment(paymentId)) ?? (await findStoredPaymentByProvider(paymentId)) ?? (shouldAllowMockPayments() ? getPayment(paymentId) : undefined);
}

export async function confirmPayment(paymentOrId: Payment | string, options?: ConfirmPaymentOptions): Promise<PaymentResult> {
  const payment = typeof paymentOrId === "string" ? await resolvePaymentForConfirmation(paymentOrId) : paymentOrId;

  if (!payment) {
    throw new Error("Payment not found");
  }

  if (payment.provider === "yookassa") {
    if (!payment.providerPaymentId) {
      throw new Error("YooKassa payment id is missing");
    }

    if (canTrustYooKassaReturn(payment, options)) {
      payment.status = "succeeded";
      payment.paidAt = payment.paidAt ?? todayIsoDate();

      return applySucceededPayment(payment);
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

  return shouldAllowMockPayments() ? listMockPayments().find((payment) => payment.id === localPaymentId || payment.providerPaymentId === yookassaPayment.id) : undefined;
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

  const verifiedYooKassaPayment = await fetchYooKassaPayment(yookassaPayment.id);

  applyYooKassaPaymentState(payment, verifiedYooKassaPayment);

  if (payment.status !== "succeeded") {
    await updateStoredPayment(payment);
    return { processed: true, result: createPendingPaymentResult(payment) };
  }

  return { processed: true, result: await applySucceededPayment(payment) };
}
