"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { demoPublicationLabels, demoPublicationsStorageKey, DemoPublication, DemoPublicationType } from "@/lib/demo-publications";
import { categories } from "@/lib/data";
import { resolveClientUserIdentity } from "@/lib/client-user-profile";
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
};

function readValue(formData: FormData, name: string, fallback = "") {
  return String(formData.get(name) ?? "").trim() || fallback;
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
      tourDate: readValue(formData, "tourDate"),
      tourTime: readValue(formData, "tourTime"),
      tourDuration: readValue(formData, "tourDuration"),
      tourDifficulty: readValue(formData, "tourDifficulty"),
      tourMeetingPoint: readValue(formData, "tourMeetingPoint"),
      included: readValue(formData, "bookingIncluded"),
      rules: readValue(formData, "bookingRules"),
    };
  }

  return {
    mode,
    priceWeekday: readNumber(formData, "bookingPriceWeekday"),
    priceWeekend: readNumber(formData, "bookingPriceWeekend"),
    minNights: readNumber(formData, "bookingMinNights"),
    includedGuests: readNumber(formData, "bookingIncludedGuests"),
    maxGuests: readNumber(formData, "bookingMaxGuests"),
    extraGuestPrice: readNumber(formData, "bookingExtraGuestPrice"),
    availableFrom: readValue(formData, "bookingAvailableFrom"),
    availableTo: readValue(formData, "bookingAvailableTo"),
    blockedDates: readDateList(formData, "bookingBlockedDates"),
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

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось подготовить фото"));
    image.src = src;
  });
}

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Не удалось прочитать фото"));
    reader.onload = () => {
      resolve(String(reader.result));
    };
    reader.readAsDataURL(file);
  });
}

function readMediaFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      resolve(String(reader.result));
    };
    reader.readAsDataURL(file);
  });
}

async function readCompressedImage(file: File) {
  const dataUrl = await readImageFile(file);

  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return dataUrl;
  }

  const image = await loadImage(dataUrl);
  const maxSide = 1440;
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    return dataUrl;
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function readSelectedImages(formData: FormData) {
  const files = formData
    .getAll("photos")
    .filter((file): file is File => file instanceof File && file.size > 0 && file.type.startsWith("image/"))
    .slice(0, 20);

  const images = await Promise.allSettled(files.map((file) => readCompressedImage(file)));
  return images.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

async function readSelectedListingMedia(formData: FormData) {
  const files = formData
    .getAll("photos")
    .filter((file): file is File => file instanceof File && file.size > 0 && (file.type.startsWith("image/") || file.type.startsWith("video/")))
    .slice(0, 20);
  const media = await Promise.allSettled(
    files.map(async (file) => ({
      kind: file.type.startsWith("video/") ? "video" : "image",
      value: file.type.startsWith("video/") ? await readMediaFile(file) : await readCompressedImage(file),
    })),
  );
  const fulfilled = media.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

  return {
    images: fulfilled.filter((item) => item.kind === "image").map((item) => item.value),
    videos: fulfilled.filter((item) => item.kind === "video").map((item) => item.value),
  };
}

async function buildPublication(formData: FormData, type: DemoPublicationType): Promise<DemoPublication> {
  const now = new Date().toISOString();
  const id = `demo-${type}-${Date.now().toString(36)}`;
  const listingKind = readValue(formData, "kind", "prodam") as ListingKind;

  if (type === "listing") {
    const categorySlug = readValue(formData, "category", "mebel-i-interer");
    const categoryName = categories.find((category) => category.slug === categorySlug)?.name ?? "Категория";
    const safeListingKind = categorySlug === "otdyh" || (categorySlug === "nedvizhimost" && listingKind === "arenda") ? "arenda" : listingKind;
    const media = await readSelectedListingMedia(formData);

    return {
      id,
      type,
      title: readValue(formData, "title", "Новое объявление"),
      subtitle: categoryName,
      city: readValue(formData, "location", "Краснодар").split(",")[0]?.trim() || "Краснодар",
      price: readValue(formData, "price", safeListingKind === "arenda" && isBookingCategory(categorySlug) ? "расчет по датам" : "по договоренности"),
      description: readValue(formData, "description", "Описание будет дополнено."),
      images: media.images,
      videos: media.videos,
      lat: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lat") : undefined,
      lng: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lng") : undefined,
      address: hasSelectedMapPoint(formData) ? readValue(formData, "address") : undefined,
      hasMapPoint: hasSelectedMapPoint(formData),
      showExactAddress: false,
      phone: readValue(formData, "phone", "+78610009999"),
      messengerUrl: readValue(formData, "messengerUrl"),
      listingKind: ["prodam", "kuplyu", "menyayu", "otdam-darom", "arenda"].includes(safeListingKind) ? safeListingKind : "prodam",
      categorySlug,
      subcategorySlug: readValue(formData, "subcategory", "mebel"),
      booking: safeListingKind === "arenda" ? readBookingDetails(formData, categorySlug) : undefined,
      status: "Опубликовано",
      createdAt: now,
    };
  }

  if (type === "vacancy") {
    const hasMapPoint = hasSelectedMapPoint(formData);

    return {
      id,
      type,
      title: readValue(formData, "title", "Новая вакансия"),
      subtitle: readValue(formData, "organization", "Организация"),
      city: readValue(formData, "location", "Краснодар").split(",")[0]?.trim() || "Краснодар",
      price: readValue(formData, "salary", "по договоренности"),
      lat: hasMapPoint ? readCoordinate(formData, "lat") : undefined,
      lng: hasMapPoint ? readCoordinate(formData, "lng") : undefined,
      address: hasMapPoint ? readValue(formData, "address") : undefined,
      hasMapPoint,
      showExactAddress: Boolean(hasMapPoint && readValue(formData, "address")),
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
      lat: readCoordinate(formData, "lat"),
      lng: readCoordinate(formData, "lng"),
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

      const identity = await resolveClientUserIdentity();
      const publication = {
        ...(await buildPublication(new FormData(form), publicationType)),
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        status,
      };
      const stored = readStoredPublications();
      const nextPublications = [publication, ...stored].slice(0, 50);

      try {
        window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextPublications));
      } catch {
        window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify([{ ...publication, images: [], videos: [] }, ...stored].slice(0, 50)));
      }

      window.dispatchEvent(new Event("blizhniy-demo-publications-updated"));
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
        {saving ? "Сохраняем..." : label}
        <ArrowRight className="h-5 w-5" />
      </button>
      {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}
    </div>
  );
}
