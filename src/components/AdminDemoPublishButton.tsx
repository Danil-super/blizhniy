"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { addPublicationDaysIsoDate, demoPublicationLabels, demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationHistory, withPublicationStatusHistory, DemoPublication, DemoPublicationType } from "@/lib/demo-publications";
import { confirmClientPayment, createClientPayment } from "@/lib/client-payment-flow";
import { isStoredMediaReference, storeMediaFile } from "@/lib/client-media-store";
import { normalizeListingPrice } from "@/lib/listing-price";
import { filterFormPhotoFiles, filterListingMediaFiles } from "@/lib/media-limits";
import type { Payment } from "@/lib/types";
import { categories, cities } from "@/lib/data";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { TURNSTILE_ERROR_MESSAGE } from "@/lib/turnstile-shared";
import type { BookingDetails, ListingKind } from "@/lib/types";

type AdminDemoPublishButtonProps = {
  publicationType: DemoPublicationType;
  returnHref: string;
  label: string;
  status?: string;
  validateForm?: boolean;
  requireCaptcha?: boolean;
  buttonClassName?: string;
  paymentTariffId?: string;
};

type PaymentTargetType = Payment["targetType"];

function readValue(formData: FormData, name: string, fallback = "") {
  return String(formData.get(name) ?? "").trim() || fallback;
}

function readRawValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function readEmailOrMessenger(formData: FormData) {
  const value = readValue(formData, "emailOrMessenger");
  const isEmail = value.includes("@") && !value.startsWith("@") && !value.startsWith("http");

  return {
    email: isEmail ? value : readValue(formData, "email"),
    messengerUrl: value && !isEmail ? value : readValue(formData, "messengerUrl"),
  };
}

function readCoordinate(formData: FormData, name: string) {
  const rawValue = readValue(formData, name);

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function hasSelectedMapPoint(formData: FormData) {
  return readValue(formData, "locationMode") === "exact" && readValue(formData, "mapPointSelected") === "1";
}

function inferCityFromFormData(formData: FormData, fallback = "Краснодар") {
  const location = readRawValue(formData, "location");
  const address = readRawValue(formData, "address");

  return location.split(",")[0]?.trim() || cities.find((city) => address.toLowerCase().includes(city.name.toLowerCase()))?.name || fallback;
}

function readNumber(formData: FormData, name: string) {
  const value = Number(readValue(formData, name).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readDateList(formData: FormData, name: string) {
  return readValue(formData, name)
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeFutureDate(value: string) {
  const date = value.trim();

  if (!date) {
    return "";
  }

  return date < todayInputValue() ? todayInputValue() : date;
}

function normalizeEndDate(value: string, startDate: string) {
  const date = value.trim();

  if (!date) {
    return "";
  }

  const minDate = startDate || todayInputValue();
  return date < minDate ? minDate : date;
}

function readFutureDateList(formData: FormData, name: string) {
  const today = todayInputValue();

  return readDateList(formData, name).filter((date) => date >= today);
}

function isBookingCategory(categorySlug: string) {
  return categorySlug === "otdyh" || categorySlug === "nedvizhimost";
}

function readBookingDetails(formData: FormData, categorySlug: string): BookingDetails | undefined {
  if (!isBookingCategory(categorySlug)) {
    return undefined;
  }

  const mode = readValue(formData, "bookingMode", "stay") === "tour" ? "tour" : "stay";

  if (mode === "tour") {
    return {
      mode,
      pricePerPerson: readNumber(formData, "bookingPricePerPerson"),
      maxGuests: readNumber(formData, "bookingMaxGuests"),
      tourDate: normalizeFutureDate(readValue(formData, "tourDate")),
      tourTime: readValue(formData, "tourTime"),
      tourDuration: readValue(formData, "tourDuration"),
      tourDifficulty: readValue(formData, "tourDifficulty"),
      tourMeetingPoint: readValue(formData, "tourMeetingPoint"),
      included: readValue(formData, "bookingIncluded"),
      rules: readValue(formData, "bookingRules"),
    };
  }

  const availableFrom = normalizeFutureDate(readValue(formData, "bookingAvailableFrom"));

  return {
    mode,
    priceWeekday: readNumber(formData, "bookingPriceWeekday"),
    priceWeekend: readNumber(formData, "bookingPriceWeekend"),
    minNights: readNumber(formData, "bookingMinNights"),
    includedGuests: readNumber(formData, "bookingIncludedGuests"),
    maxGuests: readNumber(formData, "bookingMaxGuests"),
    extraGuestPrice: readNumber(formData, "bookingExtraGuestPrice"),
    availableFrom,
    availableTo: normalizeEndDate(readValue(formData, "bookingAvailableTo"), availableFrom),
    blockedDates: readFutureDateList(formData, "bookingBlockedDates"),
    checkInTime: readValue(formData, "bookingCheckIn"),
    checkOutTime: readValue(formData, "bookingCheckOut"),
    included: readValue(formData, "bookingIncluded"),
    rules: readValue(formData, "bookingRules"),
  };
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

function isDraftStatus(status: string) {
  return status.trim().toLowerCase() === "черновик";
}

function isPublishedStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  return normalized === "опубликовано" || normalized === "published";
}

function getPaymentTargetType(type: DemoPublicationType): PaymentTargetType | undefined {
  if (type === "listing" || type === "vacancy") {
    return type;
  }

  if (type === "specialist") {
    return "specialist";
  }

  if (type === "fairApplication") {
    return "fair_application";
  }

  return undefined;
}

async function readOriginalImage(file: File) {
  return storeMediaFile(file);
}

async function readOriginalMedia(file: File) {
  return storeMediaFile(file);
}

function readImageDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Не удалось прочитать фото"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

async function readSelectedImages(formData: FormData) {
  const selectedFiles = formData
    .getAll("photos")
    .filter((file): file is File => file instanceof File && file.size > 0 && file.type.startsWith("image/"))
    .slice(0, 20);
  const { accepted: files } = filterFormPhotoFiles(selectedFiles);

  const images = await Promise.allSettled(files.map((file) => readImageDataUrl(file)));
  return images.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

async function readSelectedListingMedia(formData: FormData) {
  const selectedFiles = formData
    .getAll("photos")
    .filter((file): file is File => file instanceof File && file.size > 0 && (file.type.startsWith("image/") || file.type.startsWith("video/")))
    .slice(0, 20);
  const { accepted: files } = filterListingMediaFiles(selectedFiles);

  const media = await Promise.allSettled(
    files.map(async (file) => ({
      kind: file.type.startsWith("video/") ? "video" : "image",
      value: file.type.startsWith("video/") ? await readOriginalMedia(file) : await readOriginalImage(file),
    })),
  );
  const fulfilled = media.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

  return {
    images: fulfilled.filter((item) => item.kind === "image").map((item) => item.value),
    videos: fulfilled.filter((item) => item.kind === "video").map((item) => item.value),
  };
}

function hasInlineStoredMedia(value: string) {
  return value.startsWith("data:");
}

function compactPublicationsForLocalStorage(items: DemoPublication[]) {
  return items.map((item) => {
    if (item.type !== "listing") {
      return item;
    }

    return {
      ...item,
      images: item.images?.filter((image) => isStoredMediaReference(image) || !hasInlineStoredMedia(image)),
      videos: item.videos?.filter((video) => isStoredMediaReference(video) || !hasInlineStoredMedia(video)),
    };
  });
}

async function buildPublication(formData: FormData, type: DemoPublicationType): Promise<DemoPublication> {
  const now = new Date().toISOString();
  const id = `demo-${type}-${Date.now().toString(36)}`;
  const listingKind = readValue(formData, "kind", "prodam") as ListingKind;

  if (type === "listing") {
    const categorySlug = readValue(formData, "category", "mebel-i-interer");
    const categoryName = categories.find((category) => category.slug === categorySlug)?.name ?? "Категория";
    const safeListingKind = categorySlug === "otdyh" || (categorySlug === "nedvizhimost" && listingKind === "arenda") ? "arenda" : listingKind;
    const phone = readRawValue(formData, "phone");
    const email = readRawValue(formData, "email");
    const messengerUrl = readRawValue(formData, "messengerUrl");

    if (!phone && !email && !messengerUrl) {
      throw new Error("Укажите хотя бы один контакт объявления: телефон, email или Telegram/WhatsApp.");
    }

    const media = await readSelectedListingMedia(formData);

    return {
      id,
      type,
      title: readValue(formData, "title", "Новое объявление"),
      subtitle: categoryName,
      city: inferCityFromFormData(formData),
      price: normalizeListingPrice(readRawValue(formData, "price"), safeListingKind === "arenda" && isBookingCategory(categorySlug) ? "расчет по датам" : "по договоренности"),
      description: readValue(formData, "description", "Описание будет дополнено."),
      images: media.images,
      videos: media.videos,
      lat: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lat") : undefined,
      lng: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lng") : undefined,
      address: hasSelectedMapPoint(formData) ? readValue(formData, "address") : undefined,
      hasMapPoint: hasSelectedMapPoint(formData),
      showExactAddress: false,
      phone,
      email,
      messengerUrl,
      listingKind: ["prodam", "kuplyu", "menyayu", "otdam-darom", "arenda"].includes(safeListingKind) ? safeListingKind : "prodam",
      categorySlug,
      subcategorySlug: readValue(formData, "subcategory", "mebel"),
      booking: safeListingKind === "arenda" ? readBookingDetails(formData, categorySlug) : undefined,
      status: "Опубликовано",
      expiresAt: addPublicationDaysIsoDate(30),
      createdAt: now,
    };
  }

  if (type === "vacancy") {
    const hasMapPoint = hasSelectedMapPoint(formData);
    const images = await readSelectedImages(formData);
    const employerType = readRawValue(formData, "employerType");
    const contact = readEmailOrMessenger(formData);

    return {
      id,
      type,
      title: readRawValue(formData, "title"),
      subtitle: readRawValue(formData, "organization"),
      city: readRawValue(formData, "location").split(",")[0]?.trim() || "",
      price: readRawValue(formData, "salary"),
      description: readRawValue(formData, "description"),
      images,
      lat: hasMapPoint ? readCoordinate(formData, "lat") : undefined,
      lng: hasMapPoint ? readCoordinate(formData, "lng") : undefined,
      address: hasMapPoint ? readValue(formData, "address") : undefined,
      hasMapPoint,
      showExactAddress: Boolean(hasMapPoint && readValue(formData, "address")),
      phone: readValue(formData, "phone"),
      messengerUrl: contact.messengerUrl,
      email: contact.email,
      employerType,
      inn: readValue(formData, "inn"),
      ogrn: readValue(formData, "ogrn"),
      ogrnip: readValue(formData, "ogrnip"),
      contactPerson: readValue(formData, "contactPerson"),
      website: readValue(formData, "website"),
      workFormat: readValue(formData, "workFormat"),
      schedule: readValue(formData, "schedule"),
      requirements: readValue(formData, "requirements"),
      responsibilities: readValue(formData, "responsibilities"),
      conditions: readValue(formData, "conditions"),
      placementRightConfirmed: readValue(formData, "placementRightConfirmed") === "1",
      status: "Опубликовано",
      createdAt: now,
    };
  }

  if (type === "workRequest") {
    return {
      id,
      type,
      title: readValue(formData, "title", "Новый заказ исполнителю"),
      subtitle: readValue(formData, "profession", "Специалист"),
      city: readValue(formData, "city", "Краснодар"),
      price: readValue(formData, "budget", "по договоренности"),
      description: readValue(formData, "description", "Описание заказа будет дополнено."),
      images: await readSelectedImages(formData),
      lat: readCoordinate(formData, "lat"),
      lng: readCoordinate(formData, "lng"),
      phone: readValue(formData, "phone"),
      messengerUrl: readValue(formData, "messengerUrl"),
      showExactAddress: false,
      status: "Опубликовано",
      createdAt: now,
    };
  }

  if (type === "specialist") {
    const hasMapPoint = hasSelectedMapPoint(formData);

    return {
      id,
      type,
      title: readValue(formData, "name", "Новый специалист"),
      subtitle: readValue(formData, "profession", "Специалист"),
      city: readValue(formData, "city", "Краснодар").split(",")[0]?.trim() || "Краснодар",
      price: readValue(formData, "price", "по договоренности"),
      images: await readSelectedImages(formData),
      description: readValue(formData, "description"),
      phone: readValue(formData, "phone"),
      email: readValue(formData, "email"),
      messengerUrl: readValue(formData, "messengerUrl"),
      lat: hasMapPoint ? readCoordinate(formData, "lat") : undefined,
      lng: hasMapPoint ? readCoordinate(formData, "lng") : undefined,
      address: hasMapPoint ? readValue(formData, "address") : undefined,
      hasMapPoint,
      showExactAddress: false,
      status: "Опубликовано",
      createdAt: now,
    };
  }

  return {
    id,
    type,
    title: readValue(formData, "participantName", "Новая заявка"),
    subtitle: readValue(formData, "category", demoPublicationLabels.fairApplication),
    city: readValue(formData, "city", "Краснодар"),
    status: "Опубликовано",
    createdAt: now,
  };
}

function needsCaptcha(type: DemoPublicationType) {
  return type === "listing" || type === "vacancy" || type === "specialist" || type === "fairApplication";
}

async function verifyCaptchaToken(token: string) {
  const response = await fetch("/api/turnstile/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? TURNSTILE_ERROR_MESSAGE);
  }
}

export function AdminDemoPublishButton({
  buttonClassName,
  label,
  publicationType,
  requireCaptcha,
  returnHref,
  status = "Опубликовано",
  validateForm = true,
  paymentTariffId,
}: AdminDemoPublishButtonProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const captchaRequired = requireCaptcha ?? needsCaptcha(publicationType);

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;

    if (!form) {
      return;
    }

    if (validateForm && !form.reportValidity()) {
      return;
    }

      setSaving(true);
      setError("");
    try {
      if (captchaRequired) {
        await verifyCaptchaToken(captchaToken);
      }

      const identity = await resolveAuthenticatedClientUserIdentity();
      const requiresPayment = Boolean(paymentTariffId && !isDraftStatus(status));
      const publicationStatus = requiresPayment ? "Ждет оплаты" : status;
      const publication = withPublicationHistory({
        ...(await buildPublication(new FormData(form), publicationType)),
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        status: publicationStatus,
      });
      let paymentId = "";
      let confirmationUrl = "";

      if (requiresPayment) {
        const tariffId = paymentTariffId;
        const targetType = getPaymentTargetType(publicationType);

        if (!tariffId) {
          throw new Error("Для оплаты публикации не выбран тариф.");
        }

        if (!targetType) {
          throw new Error("Для этого типа публикации еще не настроен тариф оплаты.");
        }

        const payment = await createClientPayment({
          tariffId,
          targetId: publication.id,
          targetType,
          targetTitle: publication.title,
        });
        paymentId = payment.id;
        confirmationUrl = payment.confirmationUrl ?? "";
      }

      const stored = readStoredPublications();
      let nextStored = stored;

      if (publicationType === "specialist") {
        const draftCount = stored.filter((item) => item.type === "specialist" && isDraftStatus(item.status)).length;

        if (isDraftStatus(publicationStatus) && draftCount >= 10) {
          throw new Error("Можно создать максимум 10 черновиков анкет.");
        }

        if (isPublishedStatus(publicationStatus)) {
          nextStored = stored.map((item) =>
            item.type === "specialist" && !isDraftStatus(item.status)
              ? withPublicationStatusHistory(item, "Черновик", {
                  description: "Анкета переведена в черновик, потому что опубликована новая анкета специалиста.",
                })
              : item,
          );
        }
      }

      const nextPublications = compactPublicationsForLocalStorage([publication, ...nextStored].slice(0, 50));

      try {
        window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextPublications));
      } catch {
        const compactStored = compactPublicationsForLocalStorage([{ ...publication, images: [], videos: [] }, ...stored].slice(0, 50));
        window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(compactStored));
      }

      window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));

      if (confirmationUrl) {
        window.location.href = confirmationUrl;
        return;
      }

      if (paymentId) {
        await confirmClientPayment(paymentId);
      }

      window.location.href = returnHref;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить публикацию в демо-режиме.");
      setCaptchaToken("");
      setCaptchaResetKey((value) => value + 1);
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      {captchaRequired ? (
        <TurnstileWidget
          resetKey={captchaResetKey}
          onVerify={setCaptchaToken}
        />
      ) : null}
      <button
        type="button"
        onClick={handleClick}
        disabled={saving || (captchaRequired && !captchaToken)}
        className={
          buttonClassName ??
          "inline-flex h-12 w-fit items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-6 font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-wait disabled:bg-slate-300"
        }
      >
        {saving ? (paymentTariffId && !isDraftStatus(status) ? "Создаем и оплачиваем..." : "Сохраняем...") : label}
        <ArrowRight className="h-5 w-5" />
      </button>
      {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}
    </div>
  );
}
