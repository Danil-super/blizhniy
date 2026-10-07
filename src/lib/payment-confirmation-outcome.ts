import type { AddSiteNotificationInput } from "@/lib/site-notifications";

export type PaymentConfirmationPayload = {
  nextStatus?: string;
  payment?: {
    id?: string;
    status?: string;
    fulfillmentStatus?: string;
    fulfillmentReason?: string;
    targetTitle?: string;
    targetType?: string;
  };
};

export type PaymentConfirmationOutcome = {
  kind: "pending" | "applied" | "fulfillment_pending" | "blocked" | "failed" | "refunded" | "unavailable";
  title: string;
  message: string;
  tone: "success" | "warning" | "danger";
  canRetry: boolean;
};

/** Financial success and delivered service are separate, authoritative states. */
export function getPaymentConfirmationOutcome(payload: PaymentConfirmationPayload): PaymentConfirmationOutcome {
  const payment = payload.payment;
  if (payment?.status === "failed") {
    return {
      kind: "failed", title: "Оплата не завершена", tone: "danger", canRetry: false,
      message: "Платеж отменен или не завершен. Услуга по этому платежу не активирована.",
    };
  }
  if (payment?.status === "refunded") {
    return {
      kind: "refunded", title: "Платеж возвращен", tone: "warning", canRetry: false,
      message: "У платежа статус возврата. Сведения о платеже и текущем статусе услуги доступны в кабинете.",
    };
  }
  if (payment?.status === "succeeded") {
    if (payment.fulfillmentStatus === "blocked") {
      return {
        kind: "blocked", title: "Оплата требует проверки", tone: "warning", canRetry: false,
        message: "Оплата прошла, но услуга не применена. Требуется проверка: обратитесь в поддержку. Повторно оплачивать не нужно.",
      };
    }
    if (payment.fulfillmentStatus !== "applied") {
      return {
        kind: "fulfillment_pending", title: "Услуга ожидает применения", tone: "warning", canRetry: true,
        message: "Оплата подтверждена. Применение услуги еще не подтверждено. Проверьте статус позже; повторно оплачивать не нужно.",
      };
    }
    return {
      kind: "applied", title: "Платеж подтвержден", tone: "success", canRetry: false,
      message: payment.targetType === "ad_marquee" && payload.nextStatus === "paid"
        ? "Реклама оплачена и ожидает активации в очереди. Текущий статус доступен в кабинете."
        : "Оплата подтверждена, услуга применена. Текущий статус доступен в кабинете.",
    };
  }
  if (payment?.status === "created" || payment?.status === "pending") {
    return {
      kind: "pending", title: "Платеж ожидает подтверждения", tone: "warning", canRetry: true,
      message: "Банк или ЮKassa еще не прислали финальный статус платежа. Проверьте статус позже.",
    };
  }
  return {
    kind: "unavailable", title: "Статус платежа недоступен", tone: "danger", canRetry: true,
    message: "Не удалось получить статус платежа. Попробуйте проверить его еще раз.",
  };
}

export function shouldRetryPaymentConfirmation(payload: PaymentConfirmationPayload | null, responseOk: boolean) {
  return responseOk && (payload?.payment?.status === "created" || payload?.payment?.status === "pending");
}

export function paymentConfirmationNotification(payload: PaymentConfirmationPayload, paymentId: string): AddSiteNotificationInput {
  const outcome = getPaymentConfirmationOutcome(payload);
  return {
    category: "payment",
    title: outcome.title,
    message: payload.payment?.targetTitle ? `${payload.payment.targetTitle}: ${outcome.message}` : outcome.message,
    tone: outcome.tone,
    dedupeKey: `payment:${payload.payment?.id ?? paymentId}:${outcome.kind}`,
  };
}
