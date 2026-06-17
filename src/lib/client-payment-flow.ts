"use client";

import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationStatusHistory, type DemoPublication } from "@/lib/demo-publications";
import { getStoredMediaFile } from "@/lib/client-media-store";
import { addCurrentUserNotification } from "@/lib/site-notifications";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { Listing, ListingKind, Payment } from "@/lib/types";

type ConfirmPaymentPayload = {
  nextStatus?: string;
  payment?: {
    id?: string;
    provider?: Payment["provider"];
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

type CreatedListingPaymentPayload = {
  listing?: {
    id?: string;
    images?: string[];
    slug?: string;
    status?: string;
    title?: string;
  };
  payment?: CreatedPaymentPayload;
  error?: string;
};

type MediaUploadResponse = {
  files?: Array<{ path?: string }>;
  error?: string;
};

type CabinetListingsPayload = {
  listings?: Listing[];
};

const pendingPaymentStorageKey = "blizhniy:pendingPaymentId";
const confirmationRetryDelayMs = 1500;
const confirmationRetryAttempts = 20;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function isUuid(value?: string) {
  return Boolean(value && uuidPattern.test(value));
}

function readPendingPaymentId() {
  try {
    return window.localStorage.getItem(pendingPaymentStorageKey)?.trim() || "";
  } catch {
    return "";
  }
}

function rememberPendingPaymentId(paymentId: string) {
  try {
    window.localStorage.setItem(pendingPaymentStorageKey, paymentId);
  } catch {
    // localStorage can be unavailable in private modes; payment flow still has the URL id fallback.
  }
}

function clearPendingPaymentId(paymentId?: string) {
  try {
    const storedPaymentId = readPendingPaymentId();

    if (!paymentId || !storedPaymentId || storedPaymentId === paymentId) {
      window.localStorage.removeItem(pendingPaymentStorageKey);
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}

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

function writeStoredPublications(items: DemoPublication[]) {
  window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(items));
  window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
}

function isDraftStatus(status: string) {
  return status.trim().toLowerCase() === "черновик";
}

function normalizeListingKind(value?: ListingKind): ListingKind {
  return value === "kuplyu" || value === "menyayu" || value === "otdam-darom" || value === "arenda" ? value : "prodam";
}

function normalizeDuplicateText(value?: string) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function listingDraftDuplicateKey(item: Pick<DemoPublication, "city" | "price" | "title">) {
  return [normalizeDuplicateText(item.title), normalizeDuplicateText(item.price), normalizeDuplicateText(item.city)].join("|");
}

function listingDraftMatchesServerListing(draft: DemoPublication, listing: Listing) {
  const draftDescription = normalizeDuplicateText(draft.description || "Описание будет дополнено.");
  const listingDescription = normalizeDuplicateText(listing.description || "Описание будет дополнено.");
  const draftPhone = normalizeDuplicateText(draft.phone);
  const listingPhone = normalizeDuplicateText(listing.phone);
  const draftMessenger = normalizeDuplicateText(draft.messengerUrl);
  const listingMessenger = normalizeDuplicateText(listing.messengerUrl);

  return (
    listingDraftDuplicateKey({
      city: listing.city,
      price: listing.price,
      title: listing.title,
    }) === listingDraftDuplicateKey(draft) &&
    listing.kind === normalizeListingKind(draft.listingKind) &&
    listingDescription === draftDescription &&
    (!draftPhone || !listingPhone || draftPhone === listingPhone) &&
    (!draftMessenger || !listingMessenger || draftMessenger === listingMessenger)
  );
}

function apiListingPayloadFromDraft(item: DemoPublication, tariffId: string, mediaPaths: string[] = []) {
  return {
    address: item.hasMapPoint ? item.address : undefined,
    categorySlug: item.categorySlug || "dlya-doma-i-dachi",
    city: item.city || "Краснодар",
    description: item.description || "Описание будет дополнено.",
    kind: normalizeListingKind(item.listingKind),
    lat: item.hasMapPoint ? item.lat : undefined,
    lng: item.hasMapPoint ? item.lng : undefined,
    mediaPaths,
    messengerUrl: item.messengerUrl || undefined,
    phone: item.phone || undefined,
    price: item.price || undefined,
    subcategory: item.subcategorySlug || undefined,
    tariffId,
    title: item.title || "Новое объявление",
  };
}

async function uploadDraftListingImages(item: DemoPublication) {
  const imageFiles = (
    await Promise.all(
      (item.images ?? []).slice(0, 10).map(async (source) => {
        const file = await getStoredMediaFile(source);

        return file?.type.startsWith("image/") ? file : undefined;
      }),
    )
  ).filter((file): file is File => Boolean(file));

  if (!imageFiles.length) {
    return [];
  }

  const uploadedPaths: string[] = [];

  for (let index = 0; index < imageFiles.length; index += 10) {
    const uploadFormData = new FormData();

    uploadFormData.set("folder", "listings");
    imageFiles.slice(index, index + 10).forEach((file) => uploadFormData.append("files", file));

    const response = await fetch("/api/uploads/media", {
      body: uploadFormData,
      headers: await getAuthHeaders(),
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as MediaUploadResponse | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? "Не удалось загрузить фото объявления.");
    }

    uploadedPaths.push(...(payload?.files ?? []).map((file) => file.path).filter((path): path is string => Boolean(path)));
  }

  return uploadedPaths;
}

async function findMatchingServerListing(draft: DemoPublication) {
  try {
    const response = await fetch("/api/cabinet/listings", {
      cache: "no-store",
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json().catch(() => null)) as CabinetListingsPayload | null;
    const matches = (payload?.listings ?? []).filter((listing) => {
      const status = listing.status;

      return (status === "draft" || status === "pending_payment") && listingDraftMatchesServerListing(draft, listing);
    });

    return matches.sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime())[0];
  } catch {
    return undefined;
  }
}

export function syncPaidPublication(confirmPayload: ConfirmPaymentPayload) {
  const targetId = confirmPayload.payment?.targetId;

  if (!targetId || confirmPayload.nextStatus !== "published" || confirmPayload.payment?.status !== "succeeded") {
    return;
  }

  const items = readStoredPublications();

  if (confirmPayload.payment?.targetType === "listing" && isUuid(targetId)) {
    writeStoredPublications(items.filter((item) => item.id !== targetId));
    return;
  }

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

  writeStoredPublications(nextItems);
}

async function requestPaymentConfirmation(paymentId: string) {
  const response = await fetch(`/api/payments/${paymentId}/confirm`, {
    method: "POST",
    headers: await getAuthHeaders(),
  });
  const payload = (await response.json().catch(() => null)) as (ConfirmPaymentPayload & { error?: string }) | null;

  return { payload, response };
}

function shouldRetryWithRememberedPayment(payload: (ConfirmPaymentPayload & { error?: string }) | null, responseOk: boolean) {
  return !responseOk && /payment not found/i.test(payload?.error ?? "");
}

function shouldRetryPendingConfirmation(payload: (ConfirmPaymentPayload & { error?: string }) | null, responseOk: boolean) {
  return responseOk && payload?.payment?.status !== "succeeded";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function confirmClientPayment(paymentId: string) {
  let confirmedPaymentId = paymentId;
  let { payload, response } = await requestPaymentConfirmation(paymentId);

  if (shouldRetryWithRememberedPayment(payload, response.ok)) {
    const rememberedPaymentId = readPendingPaymentId();

    if (rememberedPaymentId && rememberedPaymentId !== paymentId) {
      confirmedPaymentId = rememberedPaymentId;
      ({ payload, response } = await requestPaymentConfirmation(rememberedPaymentId));
    }
  }

  for (let attempt = 1; attempt < confirmationRetryAttempts && shouldRetryPendingConfirmation(payload, response.ok); attempt += 1) {
    await wait(confirmationRetryDelayMs);
    ({ payload, response } = await requestPaymentConfirmation(confirmedPaymentId));
  }

  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? "Не удалось подтвердить платеж.");
  }

  if (payload.payment?.status === "succeeded") {
    clearPendingPaymentId(payload.payment.id ?? confirmedPaymentId);
    syncPaidPublication(payload);
    void addCurrentUserNotification({
      category: "payment",
      title: "Оплата прошла",
      message: payload.payment.targetTitle
        ? `${payload.payment.targetTitle}: публикация активирована.`
        : "Платеж подтвержден, публикация активирована.",
      tone: "success",
      actionHref: "/cabinet/oplata",
      actionLabel: "История оплат",
      dedupeKey: `payment:${payload.payment.id ?? confirmedPaymentId}:succeeded`,
    });
  } else {
    rememberPendingPaymentId(payload.payment?.id ?? confirmedPaymentId);
    void addCurrentUserNotification({
      category: "payment",
      title: "Платеж ожидает подтверждения",
      message: payload.payment?.targetTitle
        ? `${payload.payment.targetTitle}: банк или ЮKassa еще не прислали финальный статус.`
        : "Платеж создан, ожидаем финальный статус от платежного провайдера.",
      tone: "warning",
      actionHref: "/cabinet/oplata",
      actionLabel: "Проверить оплату",
      dedupeKey: `payment:${payload.payment?.id ?? confirmedPaymentId}:pending`,
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

  if (payload.payment.confirmationUrl) {
    rememberPendingPaymentId(payload.payment.id);
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

async function createListingPaymentFromLocalDraft(input: CreatePaymentInput) {
  const draft = readStoredPublications().find((item) => item.type === "listing" && item.id === input.targetId);

  if (!draft) {
    throw new Error("Черновик объявления не найден. Откройте черновик и попробуйте сохранить его заново.");
  }

  const matchingServerListing = await findMatchingServerListing(draft);

  if (matchingServerListing?.id) {
    const payment = await createClientPayment({
      ...input,
      targetId: matchingServerListing.id,
      targetTitle: matchingServerListing.title || draft.title,
    });
    const serverDraftCopy = withPublicationStatusHistory(
      {
        ...draft,
        id: matchingServerListing.id,
        images: matchingServerListing.images?.length ? matchingServerListing.images : draft.images,
        status: "Ждет оплаты",
      },
      "Ждет оплаты",
      {
        description: "Черновик связан с уже созданным объявлением и отправлен на оплату.",
      },
    );
    const nextItems = [serverDraftCopy, ...readStoredPublications().filter((item) => item.id !== draft.id && item.id !== matchingServerListing.id)].slice(0, 50);

    writeStoredPublications(nextItems);
    rememberPendingPaymentId(payment.id);

    return payment;
  }

  const mediaPaths = await uploadDraftListingImages(draft);
  const response = await fetch("/api/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(apiListingPayloadFromDraft(draft, input.tariffId, mediaPaths)),
  });
  const payload = (await response.json().catch(() => null)) as CreatedListingPaymentPayload | null;

  if (!response.ok || !payload?.listing?.id || !payload.payment?.id) {
    throw new Error(payload?.error ?? "Не удалось создать оплату для черновика.");
  }

  const serverListingId = payload.listing.id;
  const serverDraftCopy = withPublicationStatusHistory(
    {
      ...draft,
      id: serverListingId,
      images: payload.listing.images?.length ? payload.listing.images : draft.images,
      status: "Ждет оплаты",
    },
    "Ждет оплаты",
    {
      description: "Черновик перенесен в базу и отправлен на оплату перед публикацией.",
    },
  );
  const nextItems = [serverDraftCopy, ...readStoredPublications().filter((item) => item.id !== draft.id && item.id !== serverListingId)].slice(0, 50);

  writeStoredPublications(nextItems);
  rememberPendingPaymentId(payload.payment.id);

  return payload.payment;
}

export async function createAndConfirmClientPayment(input: CreatePaymentInput) {
  const payment =
    input.targetType === "listing" && input.targetId && !isUuid(input.targetId)
      ? await createListingPaymentFromLocalDraft(input)
      : await createClientPayment(input);

  if (payment.confirmationUrl) {
    rememberPendingPaymentId(payment.id);
    window.location.href = payment.confirmationUrl;
    return { confirmation: null, paymentId: payment.id };
  }

  const confirmation = await confirmClientPayment(payment.id);

  return { confirmation, paymentId: payment.id };
}
