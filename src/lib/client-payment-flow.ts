"use client";

import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationStatusHistory, type DemoPublication } from "@/lib/demo-publications";
import { addCurrentUserNotification } from "@/lib/site-notifications";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { Payment } from "@/lib/types";

type ConfirmPaymentPayload = {
  nextStatus?: string;
  payment?: {
    id?: string;
    status?: Payment["status"];
    targetId?: string;
    targetTitle?: string;
    targetType?: string;
  };
};

type CreatePaymentInput = {
  tariffId: string;
  targetId?: string;
  targetType?: Payment["targetType"];
  targetTitle?: string;
};

type CreatedPaymentPayload = {
  confirmationUrl?: string;
  id: string;
  provider?: Payment["provider"];
  status?: Payment["status"];
};

function readStoredPublications() {
  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "id" in item));
    }
  } catch {
    return [];
  }

  return [];
}

function isDraftStatus(status: string) {
  return status.trim().toLowerCase() === "черновик";
}

export function syncPaidPublication(confirmPayload: ConfirmPaymentPayload) {
  const targetId = confirmPayload.payment?.targetId;

  if (!targetId || confirmPayload.nextStatus !== "published" || confirmPayload.payment?.status !== "succeeded") {
    return;
  }

  const items = readStoredPublications();
  const nextItems = items.map((item) => {
    if (item.id === targetId) {
      return withPublicationStatusHistory(item, "Опубликовано", {
        description: "Оплата прошла, публикация стала активной.",
      });
    }

    if (confirmPayload.payment?.targetType === "specialist" && item.type === "specialist" && !isDraftStatus(item.status)) {
      return withPublicationStatusHistory(item, "Черновик", {
        description: "Анкета переведена в черновик, потому что оплачена и опубликована новая анкета специалиста.",
      });
    }

    return item;
  });

  window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextItems));
  window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
}

export async function confirmClientPayment(paymentId: string) {
  const response = await fetch(`/api/payments/${paymentId}/confirm`, {
    method: "POST",
    headers: await getAuthHeaders(),
  });
  const payload = (await response.json().catch(() => null)) as (ConfirmPaymentPayload & { error?: string }) | null;

  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? "Не удалось подтвердить платеж.");
  }

  syncPaidPublication(payload);
  if (payload.payment?.status === "succeeded") {
    void addCurrentUserNotification({
      category: "payment",
      title: "Оплата прошла",
      message: payload.payment.targetTitle
        ? `${payload.payment.targetTitle}: публикация активирована.`
        : "Платеж подтвержден, публикация активирована.",
      tone: "success",
      actionHref: "/cabinet/oplata",
      actionLabel: "История оплат",
      dedupeKey: `payment:${paymentId}:succeeded`,
    });
  } else {
    void addCurrentUserNotification({
      category: "payment",
      title: "Платеж ожидает подтверждения",
      message: payload.payment?.targetTitle
        ? `${payload.payment.targetTitle}: банк или ЮKassa еще не прислали финальный статус.`
        : "Платеж создан, ожидаем финальный статус от платежного провайдера.",
      tone: "warning",
      actionHref: "/cabinet/oplata",
      actionLabel: "Проверить оплату",
      dedupeKey: `payment:${paymentId}:pending`,
    });
  }

  return payload;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!isSupabaseBrowserConfigured()) {
    return {};
  }

  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createClientPayment(input: CreatePaymentInput): Promise<CreatedPaymentPayload> {
  const response = await fetch("/api/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as { error?: string; payment?: CreatedPaymentPayload } | null;

  if (!response.ok || !payload?.payment?.id) {
    throw new Error(payload?.error ?? "Не удалось создать платеж.");
  }

  void addCurrentUserNotification({
    category: "payment",
    title: payload.payment.confirmationUrl ? "Платеж создан" : "Демо-платеж готов",
    message: payload.payment.confirmationUrl
      ? "Перейдите к оплате в ЮKassa. После успешной оплаты публикация включится автоматически."
      : "Платеж создан в демо-режиме. Подтвердите его, чтобы активировать публикацию.",
    tone: "info",
    actionHref: payload.payment.confirmationUrl ? payload.payment.confirmationUrl : "/cabinet/oplata",
    actionLabel: payload.payment.confirmationUrl ? "Перейти к оплате" : "Открыть оплаты",
    dedupeKey: `payment:${payload.payment.id}:created`,
  });

  return payload.payment;
}

export async function createAndConfirmClientPayment(input: CreatePaymentInput) {
  const payment = await createClientPayment(input);

  if (payment.confirmationUrl) {
    window.location.href = payment.confirmationUrl;
    return { confirmation: null, paymentId: payment.id };
  }

  const confirmation = await confirmClientPayment(payment.id);

  return { confirmation, paymentId: payment.id };
}
