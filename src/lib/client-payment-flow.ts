"use client";

import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationStatusHistory, type DemoPublication } from "@/lib/demo-publications";
import { markCabinetDataChanged } from "@/lib/cabinet-data-cache";
import { getStoredMediaFile } from "@/lib/client-media-store";
import { normalizeListingPrice } from "@/lib/listing-price";
import { addCurrentUserNotification } from "@/lib/site-notifications";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";
import type { JobVacancy, Listing, ListingKind, Payment } from "@/lib/types";

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
  listingDraft?: DemoPublication;
  tariffId: string;
  targetId?: string;
  targetType?: Payment["targetType"];
  targetTitle?: string;
  vacancyDraft?: DemoPublication;
  workRequestDraft?: DemoPublication;
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

type CreatedVacancyPaymentPayload = {
  error?: string;
  payment?: CreatedPaymentPayload;
  vacancy?: Partial<JobVacancy> & {
    id?: string;
    images?: string[];
    status?: string;
    title?: string;
  };
};

type CreatedWorkRequestPaymentPayload = {
  error?: string;
  payment?: CreatedPaymentPayload;
  workRequest?: {
    budget?: string;
    city?: string;
    description?: string;
    id?: string;
    images?: string[];
    status?: string;
    title?: string;
  };
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
const publicMediaPathMarker = "/storage/v1/object/public/blizhniy-media/";

function isUuid(value?: string) {
  return Boolean(value && uuidPattern.test(value));
}

function storagePathFromMediaSource(source: string) {
  const cleanSource = source.trim();

  if (/^(vacancies|work-requests)\/.+/i.test(cleanSource)) {
    return cleanSource;
  }

  const markerIndex = cleanSource.indexOf(publicMediaPathMarker);

  if (markerIndex < 0) {
    return "";
  }

  const encodedPath = cleanSource.slice(markerIndex + publicMediaPathMarker.length).split(/[?#]/)[0] ?? "";

  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}

function fileNameForImageSource(source: string, index: number, mimeType: string) {
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : mimeType === "image/gif" ? "gif" : "jpg";
  const sourceName = source.split(/[/?#]/).filter(Boolean).at(-1)?.replace(/\.[^.]+$/, "") || `vacancy-photo-${index + 1}`;

  return `${sourceName}.${extension}`;
}

async function imageSourceToFile(source: string, index: number) {
  const storedFile = await getStoredMediaFile(source);

  if (storedFile?.type.startsWith("image/")) {
    return storedFile;
  }

  if (!/^(data:image\/|blob:|https?:\/\/)/i.test(source)) {
    return undefined;
  }

  const response = await fetch(source).catch(() => null);

  if (!response?.ok) {
    return undefined;
  }

  const blob = await response.blob();

  if (!blob.type.startsWith("image/")) {
    return undefined;
  }

  return new File([blob], fileNameForImageSource(source, index, blob.type), { type: blob.type });
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
  markCabinetDataChanged();
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
      (item.images ?? []).slice(0, 20).map(async (source) => {
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

function apiVacancyPayloadFromDraft(item: DemoPublication, tariffId: string, mediaPaths: string[] = []) {
  return {
    address: item.hasMapPoint ? item.address : undefined,
    city: item.city || "Краснодар",
    conditions: item.conditions || undefined,
    contactPerson: item.contactPerson || undefined,
    description: item.description || "Описание вакансии будет дополнено.",
    email: item.email || undefined,
    employerType: item.employerType || undefined,
    inn: item.inn || undefined,
    lat: item.hasMapPoint ? item.lat : undefined,
    lng: item.hasMapPoint ? item.lng : undefined,
    mediaPaths,
    messengerUrl: item.messengerUrl || undefined,
    ogrn: item.ogrn || undefined,
    ogrnip: item.ogrnip || undefined,
    organization: item.subtitle || "Работодатель",
    placementRightConfirmed: item.placementRightConfirmed,
    phone: item.phone || undefined,
    profession: item.profession || item.title,
    requirements: item.requirements || undefined,
    responsibilities: item.responsibilities || undefined,
    salary: item.price ? normalizeListingPrice(item.price) : undefined,
    schedule: item.schedule || undefined,
    tariffId,
    title: item.title || "Новая вакансия",
    website: item.website || undefined,
    workFormat: item.workFormat || undefined,
  };
}

function mergeCreatedVacancyIntoDraft(draft: DemoPublication, vacancy?: CreatedVacancyPaymentPayload["vacancy"]) {
  return {
    ...draft,
    city: vacancy?.city ?? draft.city,
    description: vacancy?.description ?? draft.description,
    images: vacancy?.images?.length ? vacancy.images : draft.images,
    price: vacancy?.salary ?? draft.price,
    status: vacancy?.status === "published" ? "Опубликовано" : vacancy?.status === "draft" ? "Черновик" : draft.status,
    subtitle: vacancy?.organization ?? draft.subtitle,
    title: vacancy?.title ?? draft.title,
  };
}

function mergeWorkRequestServerImages(serverImages: string[] | undefined, localImages: string[] | undefined) {
  const local = localImages ?? [];

  if (!serverImages?.length) {
    return local;
  }

  return [...serverImages, ...local.slice(serverImages.length)].slice(0, 6);
}

async function uploadDraftVacancyImage(item: DemoPublication) {
  const sources = (item.images ?? []).slice(0, 12);

  if (!sources.length) {
    return [];
  }

  const existingStoragePaths = sources.map(storagePathFromMediaSource).filter(Boolean);
  const sourcesToUpload = sources.filter((source) => !storagePathFromMediaSource(source));

  const imageFiles = (
    await Promise.all(
      sourcesToUpload.map((source, index) => imageSourceToFile(source, index)),
    )
  ).filter((file): file is File => Boolean(file));

  if (!imageFiles.length) {
    return existingStoragePaths.slice(0, 12);
  }

  const uploadFormData = new FormData();

  uploadFormData.set("folder", "vacancies");
  imageFiles.forEach((file) => uploadFormData.append("files", file));

  const response = await fetch("/api/uploads/media", {
    body: uploadFormData,
    headers: await getAuthHeaders(),
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as MediaUploadResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Не удалось загрузить фото вакансии.");
  }

  const uploadedPaths = (payload?.files ?? []).map((uploadedFile) => uploadedFile.path).filter((path): path is string => Boolean(path));

  return [...existingStoragePaths, ...uploadedPaths].slice(0, 12);
}

function apiWorkRequestPayloadFromDraft(item: DemoPublication, tariffId: string, mediaPaths: string[] = []) {
  return {
    address: item.hasMapPoint ? item.address : undefined,
    budget: item.price ? normalizeListingPrice(item.price) : undefined,
    city: item.city || "Краснодар",
    description: item.description || "Описание задачи будет дополнено.",
    lat: item.hasMapPoint ? item.lat : undefined,
    lng: item.hasMapPoint ? item.lng : undefined,
    mediaPaths,
    messengerUrl: item.messengerUrl || undefined,
    phone: item.phone || undefined,
    placementRightConfirmed: true,
    profession: item.profession || item.subtitle || item.title,
    tariffId,
    title: item.title || "Новый заказ",
  };
}

async function uploadDraftWorkRequestImage(item: DemoPublication) {
  const sources = (item.images ?? []).slice(0, 6);

  if (!sources.length) {
    return [];
  }

  const existingStoragePaths = sources.map(storagePathFromMediaSource).filter(Boolean);
  const sourcesToUpload = sources.filter((source) => !storagePathFromMediaSource(source));
  const imageFiles = (
    await Promise.all(sourcesToUpload.map((source, index) => imageSourceToFile(source, index)))
  ).filter((file): file is File => Boolean(file));

  if (!imageFiles.length) {
    return existingStoragePaths.slice(0, 6);
  }

  const uploadFormData = new FormData();

  uploadFormData.set("folder", "work-requests");
  imageFiles.forEach((file) => uploadFormData.append("files", file));

  const response = await fetch("/api/uploads/media", {
    body: uploadFormData,
    headers: await getAuthHeaders(),
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as MediaUploadResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Не удалось загрузить фото заказа.");
  }

  const uploadedPaths = (payload?.files ?? []).map((uploadedFile) => uploadedFile.path).filter((path): path is string => Boolean(path));

  return [...existingStoragePaths, ...uploadedPaths].slice(0, 6);
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
  const targetType = confirmPayload.payment?.targetType;

  if ((targetType === "listing" || targetType === "vacancy") && isUuid(targetId)) {
    writeStoredPublications(items.filter((item) => item.id !== targetId));
    window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
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
  window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
}

async function requestPaymentConfirmation(paymentId: string) {
  const response = await fetch(`/api/payments/${paymentId}/confirm`, {
    body: JSON.stringify({ trustSuccessfulReturn: true }),
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
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
  const paymentInput = {
    tariffId: input.tariffId,
    targetId: input.targetId,
    targetTitle: input.targetTitle,
    targetType: input.targetType,
  };
  const response = await fetch("/api/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(paymentInput),
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
  const draft = input.listingDraft ?? readStoredPublications().find((item) => item.type === "listing" && item.id === input.targetId);

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

async function createVacancyPaymentFromLocalDraft(input: CreatePaymentInput) {
  const draft = input.vacancyDraft ?? readStoredPublications().find((item) => item.type === "vacancy" && item.id === input.targetId);

  if (!draft) {
    throw new Error("Черновик вакансии не найден. Откройте черновик и попробуйте сохранить его заново.");
  }

  if (!draft.price || normalizeListingPrice(draft.price, "") === "") {
    throw new Error("Укажите оплату вакансии и сохраните черновик перед публикацией.");
  }

  if (isUuid(draft.id)) {
    const payment = await createClientPayment({
      tariffId: input.tariffId,
      targetId: draft.id,
      targetTitle: draft.title,
      targetType: "vacancy",
    });
    const serverDraftCopy = withPublicationStatusHistory(
      {
        ...draft,
        id: draft.id,
        status: "Ждет оплаты",
      },
      "Ждет оплаты",
      {
        description: "Вакансия сохранена и отправлена на оплату перед публикацией.",
      },
    );
    const nextItems = [serverDraftCopy, ...readStoredPublications().filter((item) => item.id !== draft.id)].slice(0, 50);

    writeStoredPublications(nextItems);
    rememberPendingPaymentId(payment.id);

    return payment;
  }

  const mediaPaths = await uploadDraftVacancyImage(draft);

  if (!mediaPaths.length) {
    throw new Error("Добавьте фото работодателя или рабочего места перед оплатой вакансии.");
  }

  const response = await fetch("/api/vacancies", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(apiVacancyPayloadFromDraft(draft, input.tariffId, mediaPaths)),
  });
  const payload = (await response.json().catch(() => null)) as CreatedVacancyPaymentPayload | null;

  if (!response.ok || !payload?.vacancy?.id || !payload.payment?.id) {
    throw new Error(payload?.error ?? "Не удалось создать оплату для черновика вакансии.");
  }

  const serverVacancyId = payload.vacancy.id;
  const serverDraftCopy = withPublicationStatusHistory(
    {
      ...mergeCreatedVacancyIntoDraft(draft, payload.vacancy),
      id: serverVacancyId,
      status: "Ждет оплаты",
    },
    "Ждет оплаты",
    {
      description: "Черновик вакансии перенесен в базу и отправлен на оплату перед публикацией.",
    },
  );
  const nextItems = [serverDraftCopy, ...readStoredPublications().filter((item) => item.id !== draft.id && item.id !== serverVacancyId)].slice(0, 50);

  writeStoredPublications(nextItems);
  rememberPendingPaymentId(payload.payment.id);

  return payload.payment;
}

async function createWorkRequestPaymentFromLocalDraft(input: CreatePaymentInput) {
  const draft = input.workRequestDraft ?? readStoredPublications().find((item) => item.type === "workRequest" && item.id === input.targetId);

  if (!draft) {
    throw new Error("Черновик заказа не найден. Откройте черновик и попробуйте сохранить его заново.");
  }

  if (isUuid(draft.id)) {
    const payment = await createClientPayment({
      tariffId: input.tariffId,
      targetId: draft.id,
      targetTitle: draft.title,
      targetType: "workRequest",
    });
    const serverDraftCopy = withPublicationStatusHistory(
      {
        ...draft,
        id: draft.id,
        status: "Ждет оплаты",
      },
      "Ждет оплаты",
      {
        description: "Заказ сохранен и отправлен на оплату перед публикацией.",
      },
    );

    writeStoredPublications([serverDraftCopy, ...readStoredPublications().filter((item) => item.id !== draft.id)].slice(0, 80));
    rememberPendingPaymentId(payment.id);

    return payment;
  }

  const mediaPaths = await uploadDraftWorkRequestImage(draft);
  const response = await fetch("/api/work-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(apiWorkRequestPayloadFromDraft(draft, input.tariffId, mediaPaths)),
  });
  const payload = (await response.json().catch(() => null)) as CreatedWorkRequestPaymentPayload | null;

  if (!response.ok || !payload?.workRequest?.id || !payload.payment?.id) {
    throw new Error(payload?.error ?? "Не удалось создать оплату для черновика заказа.");
  }

  const serverRequestId = payload.workRequest.id;
  const serverDraftCopy = withPublicationStatusHistory(
    {
      ...draft,
      id: serverRequestId,
      city: payload.workRequest.city ?? draft.city,
      description: payload.workRequest.description ?? draft.description,
      images: mergeWorkRequestServerImages(payload.workRequest.images, draft.images),
      price: payload.workRequest.budget ?? draft.price,
      status: "Ждет оплаты",
      title: payload.workRequest.title ?? draft.title,
    },
    "Ждет оплаты",
    {
      description: "Черновик заказа перенесен в базу и отправлен на оплату перед публикацией.",
    },
  );

  writeStoredPublications([serverDraftCopy, ...readStoredPublications().filter((item) => item.id !== draft.id && item.id !== serverRequestId)].slice(0, 80));
  rememberPendingPaymentId(payload.payment.id);

  return payload.payment;
}

export async function createAndConfirmClientPayment(input: CreatePaymentInput) {
  const payment =
    input.targetType === "listing" && input.listingDraft
      ? await createListingPaymentFromLocalDraft(input)
      : input.targetType === "vacancy" && input.vacancyDraft
      ? await createVacancyPaymentFromLocalDraft(input)
      : input.targetType === "workRequest" && input.workRequestDraft
      ? await createWorkRequestPaymentFromLocalDraft(input)
      : input.targetType === "listing" && input.targetId && !isUuid(input.targetId)
      ? await createListingPaymentFromLocalDraft(input)
      : input.targetType === "vacancy" && input.targetId && !isUuid(input.targetId)
      ? await createVacancyPaymentFromLocalDraft(input)
      : input.targetType === "workRequest" && input.targetId && !isUuid(input.targetId)
      ? await createWorkRequestPaymentFromLocalDraft(input)
      : await createClientPayment(input);

  if (payment.confirmationUrl) {
    rememberPendingPaymentId(payment.id);
    window.location.href = payment.confirmationUrl;
    return { confirmation: null, paymentId: payment.id };
  }

  const confirmation = await confirmClientPayment(payment.id);

  return { confirmation, paymentId: payment.id };
}
