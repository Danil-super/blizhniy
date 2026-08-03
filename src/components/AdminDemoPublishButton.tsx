"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { createStoredListingPublication } from "@/lib/client-listing-flow";
import { confirmClientPayment } from "@/lib/client-payment-flow";
import { shouldShowClientFallbackContent } from "@/lib/client-runtime-mode";
import { createStoredVacancyPublication } from "@/lib/client-vacancy-flow";
import { storeMediaFile } from "@/lib/client-media-store";
import { markCabinetDataChanged } from "@/lib/cabinet-data-cache";
import { formatBookingPrice, validateBookingDetailsForPublication } from "@/lib/booking-details";
import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationHistory, type DemoPublication, type DemoPublicationType } from "@/lib/demo-publications";
import { normalizeListingPrice } from "@/lib/listing-price";
import { isRentalSubcategorySlug } from "@/lib/listing-rental";
import { categories, cities } from "@/lib/data";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { TURNSTILE_ERROR_MESSAGE } from "@/lib/turnstile-shared";
import { normalizeVacancyRequisites, validateVacancyRequisites } from "@/lib/vacancy-requisites";
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
  captchaAfterButton?: boolean;
};

const clientFallbackContentEnabled = shouldShowClientFallbackContent();

type MediaUploadResponse = {
  files?: Array<{ path?: string }>;
  error?: string;
};

const pendingPaymentStorageKey = "blizhniy:pendingPaymentId";

function rememberPendingPaymentId(paymentId: string) {
  try {
    window.localStorage.setItem(pendingPaymentStorageKey, paymentId);
  } catch {
    // Storage can be unavailable; the return URL still contains the payment id.
  }
}

function readValue(formData: FormData, name: string, fallback = "") {
  return String(formData.get(name) ?? "").trim() || fallback;
}

function readRawValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function readCoordinate(formData: FormData, name: string) {
  const rawValue = readValue(formData, name);

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function readPositiveNumber(formData: FormData, name: string) {
  const value = Number(readRawValue(formData, name).replace(/\s/g, "").replace(",", "."));

  return Number.isFinite(value) && value > 0 ? value : undefined;
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

  return readRawValue(formData, name)
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item) && item >= today);
}

function parseListingBooking(formData: FormData, categorySlug: string, kind: ListingKind): BookingDetails | undefined {
  const subcategorySlug = readValue(formData, "subcategory");

  if (kind !== "arenda" || !isRentalSubcategorySlug(categorySlug, subcategorySlug)) {
    return undefined;
  }

  const mode: BookingDetails["mode"] = readValue(formData, "bookingMode", "stay") === "tour" ? "tour" : "stay";

  if (mode === "tour") {
    return {
      mode,
      pricePerPerson: readPositiveNumber(formData, "bookingPricePerPerson"),
      maxGuests: readPositiveNumber(formData, "bookingMaxGuests"),
      tourDate: normalizeFutureDate(readRawValue(formData, "tourDate")),
      tourTime: readRawValue(formData, "tourTime"),
      tourDuration: readRawValue(formData, "tourDuration"),
      tourDifficulty: readRawValue(formData, "tourDifficulty"),
      tourMeetingPoint: readRawValue(formData, "tourMeetingPoint"),
      included: readRawValue(formData, "bookingIncluded"),
      rules: readRawValue(formData, "bookingRules"),
    };
  }

  const availableFrom = normalizeFutureDate(readRawValue(formData, "bookingAvailableFrom"));

  return {
    mode,
    priceWeekday: readPositiveNumber(formData, "bookingPriceWeekday"),
    priceWeekend: readPositiveNumber(formData, "bookingPriceWeekend"),
    minNights: readPositiveNumber(formData, "bookingMinNights"),
    includedGuests: readPositiveNumber(formData, "bookingIncludedGuests"),
    maxGuests: readPositiveNumber(formData, "bookingMaxGuests"),
    extraGuestPrice: readPositiveNumber(formData, "bookingExtraGuestPrice"),
    availableFrom,
    availableTo: normalizeEndDate(readRawValue(formData, "bookingAvailableTo"), availableFrom),
    blockedDates: readFutureDateList(formData, "bookingBlockedDates"),
    checkInTime: readRawValue(formData, "bookingCheckIn"),
    checkOutTime: readRawValue(formData, "bookingCheckOut"),
    included: readRawValue(formData, "bookingIncluded"),
    rules: readRawValue(formData, "bookingRules"),
  };
}

function validateListingBookingForSubmit(booking: BookingDetails | undefined, kind: ListingKind, isDraft: boolean) {
  if (isDraft || kind !== "arenda") {
    return;
  }

  const errors = validateBookingDetailsForPublication(booking);

  if (errors.length) {
    throw new Error(errors[0]);
  }
}

function hasSelectedMapPoint(formData: FormData) {
  return readValue(formData, "locationMode") === "exact" && readValue(formData, "mapPointSelected") === "1";
}

function inferCityFromFormData(formData: FormData, fallback = "Краснодар") {
  const location = readRawValue(formData, "location");
  const address = readRawValue(formData, "address");

  return location.split(",")[0]?.trim() || cities.find((city) => address.toLowerCase().includes(city.name.toLowerCase()))?.name || fallback;
}

function isDraftStatus(status: string) {
  return status.trim().toLowerCase() === "черновик";
}

function normalizeDuplicateText(value?: string) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function listingDraftDuplicateKey(item: Pick<DemoPublication, "city" | "description" | "listingKind" | "price" | "title">) {
  return [
    normalizeDuplicateText(item.title),
    normalizeDuplicateText(item.price),
    normalizeDuplicateText(item.city),
    normalizeDuplicateText(item.description),
    normalizeDuplicateText(item.listingKind),
  ].join("|");
}

function storedPublicationsWithReplacement(publication: DemoPublication, stored: DemoPublication[]) {
  if (publication.type !== "listing") {
    return [publication, ...stored.filter((item) => item.id !== publication.id)].slice(0, 50);
  }

  const publicationKey = listingDraftDuplicateKey(publication);

  return [
    publication,
    ...stored.filter((item) => {
      if (item.id === publication.id) {
        return false;
      }

      return item.type !== "listing" || listingDraftDuplicateKey(item) !== publicationKey;
    }),
  ].slice(0, 50);
}

function needsCaptcha(type: DemoPublicationType) {
  return type === "listing" || type === "vacancy" || type === "specialist" || type === "fairApplication";
}

function findMissingConsent(form: HTMLFormElement, requiresPayment: boolean) {
  const requiredConsents = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-required-consent="true"]'));
  const missingRequiredConsent = requiredConsents.find((input) => !input.checked);

  if (missingRequiredConsent) {
    return missingRequiredConsent.dataset.errorMessage || "Примите условия документов, чтобы продолжить";
  }

  if (requiresPayment) {
    const paymentConsent = form.querySelector<HTMLInputElement>('input[data-payment-consent="true"]');

    if (paymentConsent && !paymentConsent.checked) {
      return paymentConsent.dataset.errorMessage || "Примите условия публичной оферты, чтобы перейти к оплате";
    }
  }

  return "";
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

function readMediaFiles(formData: FormData) {
  return formData
    .getAll("photos")
    .filter((item): item is File => item instanceof File && item.size > 0 && item.type.startsWith("image/"))
    .slice(0, 20);
}

function readImageFiles(formData: FormData) {
  return readMediaFiles(formData).filter((file) => file.type.startsWith("image/"));
}

function readExistingPhotos(formData: FormData) {
  return formData.getAll("existingPhotos").flatMap((value) => {
    const photo = String(value ?? "").trim();

    return photo ? [photo] : [];
  });
}

async function uploadPublicationMedia(formData: FormData, folder: "fair-applications" | "listings" | "vacancies", accessToken: string) {
  const files = readImageFiles(formData).slice(0, 20);

  if (!files.length) {
    return [];
  }

  const uploadedPaths: string[] = [];

  for (let index = 0; index < files.length; index += 10) {
    const uploadFormData = new FormData();
    uploadFormData.set("folder", folder);
    files.slice(index, index + 10).forEach((file) => uploadFormData.append("files", file));

    const response = await fetch("/api/uploads/media", {
      body: uploadFormData,
      headers: { Authorization: `Bearer ${accessToken}` },
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as MediaUploadResponse | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? "Не удалось загрузить фото.");
    }

    uploadedPaths.push(...(payload?.files?.map((file) => file.path).filter((path): path is string => Boolean(path)) ?? []));
  }

  return uploadedPaths;
}

async function readLocalImageReferences(formData: FormData) {
  const files = readImageFiles(formData);
  const storedImages = await Promise.allSettled(files.map((file) => storeMediaFile(file)));

  return [...readExistingPhotos(formData), ...storedImages.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))];
}

async function readLocalMediaReferences(formData: FormData) {
  const storedMedia = await Promise.allSettled(
    readMediaFiles(formData).map(async (file) => ({
      kind: file.type.startsWith("video/") ? "video" : "image",
      source: await storeMediaFile(file),
    })),
  );
  const fulfilledMedia = storedMedia.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

  return {
    images: [...readExistingPhotos(formData), ...fulfilledMedia.filter((item) => item.kind === "image").map((item) => item.source)],
    videos: fulfilledMedia.filter((item) => item.kind === "video").map((item) => item.source),
  };
}

function readEmailOrMessengerEmail(formData: FormData) {
  const value = readRawValue(formData, "emailOrMessenger");

  return value.includes("@") && !value.startsWith("@") && !value.startsWith("http") ? value : "";
}

function readEmailOrMessengerUrl(formData: FormData) {
  const value = readRawValue(formData, "emailOrMessenger");

  return value && !readEmailOrMessengerEmail(formData) ? value : readRawValue(formData, "messengerUrl");
}

async function buildFallbackPublication(formData: FormData, type: DemoPublicationType, status: string): Promise<DemoPublication> {
  const now = new Date().toISOString();
  const id = `demo-${type}-${Date.now().toString(36)}`;
  const categorySlug = readValue(formData, "category", "dlya-doma-i-dachi");
  const listingKind = readValue(formData, "kind", "prodam") as ListingKind;
  const booking = type === "listing" ? parseListingBooking(formData, categorySlug, listingKind) : undefined;
  const categoryName = categories.find((category) => category.slug === categorySlug)?.name ?? "Категория";
  const media = type === "listing" ? await readLocalMediaReferences(formData) : { images: await readLocalImageReferences(formData), videos: [] };
  const isVacancy = type === "vacancy";
  const requisites = isVacancy
    ? normalizeVacancyRequisites({
        employerType: readValue(formData, "employerType"),
        inn: readValue(formData, "inn"),
        ogrn: readValue(formData, "ogrn"),
        ogrnip: readValue(formData, "ogrnip"),
      })
    : undefined;

  return withPublicationHistory({
    id,
    type,
    title: readValue(formData, type === "specialist" ? "name" : "title", "Новая публикация"),
    subtitle: type === "listing" ? categoryName : isVacancy ? readValue(formData, "organization", "Работодатель") : readValue(formData, "profession", "Публикация"),
    city: inferCityFromFormData(formData),
    price:
      type === "listing" && booking
        ? formatBookingPrice(booking)
        : normalizeListingPrice(readRawValue(formData, type === "vacancy" ? "salary" : type === "specialist" ? "price" : "price"), "по договоренности"),
    description: readValue(formData, "description", "Описание будет дополнено."),
    phone: readValue(formData, "phone"),
    email: isVacancy ? readEmailOrMessengerEmail(formData) || readValue(formData, "email") : readValue(formData, "email"),
    messengerUrl: isVacancy ? readEmailOrMessengerUrl(formData) : readValue(formData, "messengerUrl"),
    profession: isVacancy ? readValue(formData, "profession") || readValue(formData, "title") : readValue(formData, "profession"),
    employerType: requisites?.employerType,
    inn: requisites?.inn,
    ogrn: requisites?.ogrn,
    ogrnip: requisites?.ogrnip,
    contactPerson: isVacancy ? readValue(formData, "contactPerson") : undefined,
    website: isVacancy ? readValue(formData, "website") : undefined,
    schedule: isVacancy ? readValue(formData, "schedule") : undefined,
    workFormat: isVacancy ? readValue(formData, "workFormat") : undefined,
    requirements: isVacancy ? readValue(formData, "requirements") : undefined,
    responsibilities: isVacancy ? readValue(formData, "responsibilities") : undefined,
    conditions: isVacancy ? readValue(formData, "conditions") : undefined,
    placementRightConfirmed: isVacancy ? readRawValue(formData, "placementRightConfirmed") === "1" : undefined,
    address: hasSelectedMapPoint(formData) ? readValue(formData, "address") : undefined,
    lat: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lat") : undefined,
    lng: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lng") : undefined,
    hasMapPoint: hasSelectedMapPoint(formData),
    showExactAddress: hasSelectedMapPoint(formData),
    listingKind,
    categorySlug,
    subcategorySlug: readValue(formData, "subcategory"),
    booking,
    images: media.images,
    videos: media.videos,
    status,
    createdAt: now,
  });
}

async function createSupabaseListing(formData: FormData, options: { accessToken: string; status?: "draft"; tariffId?: string }) {
  const categorySlug = readValue(formData, "category", "dlya-doma-i-dachi");
  const rawKind = readValue(formData, "kind", "prodam") as ListingKind;
  const subcategorySlug = readValue(formData, "subcategory");
  const kind = rawKind === "arenda" || isRentalSubcategorySlug(categorySlug, subcategorySlug) ? "arenda" : rawKind;
  const booking = parseListingBooking(formData, categorySlug, kind);
  const phone = readRawValue(formData, "phone");
  const messengerUrl = readRawValue(formData, "messengerUrl");
  const email = readRawValue(formData, "email");
  const isDraft = options.status === "draft";

  if (!isDraft && !phone && !messengerUrl && !email) {
    throw new Error("Укажите хотя бы один контакт объявления: телефон, email или Telegram/WhatsApp.");
  }

  validateListingBookingForSubmit(booking, kind, isDraft);

  const mediaPaths = await uploadPublicationMedia(formData, "listings", options.accessToken);
  const result = await createStoredListingPublication({
    accessToken: options.accessToken,
    address: hasSelectedMapPoint(formData) ? readValue(formData, "address") : undefined,
    booking,
    categorySlug,
    city: inferCityFromFormData(formData),
    description: readValue(formData, "description", "Описание будет дополнено."),
    kind,
    lat: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lat") : undefined,
    lng: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lng") : undefined,
    mediaPaths,
    messengerUrl: messengerUrl || undefined,
    email: email || undefined,
    phone: phone || undefined,
    price: booking ? formatBookingPrice(booking) : normalizeListingPrice(readRawValue(formData, "price"), "по договоренности"),
    status: options.status,
    subcategory: subcategorySlug,
    tariffId: options.tariffId,
    title: readValue(formData, "title", isDraft ? "Черновик объявления" : "Новое объявление"),
  });

  return result;
}

async function createSupabaseVacancy(formData: FormData, options: { accessToken: string; status?: "draft"; tariffId?: string }) {
  const isDraft = options.status === "draft";
  const email = readEmailOrMessengerEmail(formData) || readRawValue(formData, "email");
  const messengerUrl = readEmailOrMessengerUrl(formData);
  const phone = readRawValue(formData, "phone");
  const requisites = normalizeVacancyRequisites({
    employerType: readValue(formData, "employerType"),
    inn: readValue(formData, "inn"),
    ogrn: readValue(formData, "ogrn"),
    ogrnip: readValue(formData, "ogrnip"),
  });
  const requisitesError = validateVacancyRequisites(requisites, { requireInn: !isDraft });

  if (requisitesError) {
    throw new Error(requisitesError);
  }

  if (!isDraft && !phone && !messengerUrl && !email) {
    throw new Error("Укажите хотя бы один контакт вакансии: телефон, email или Telegram/WhatsApp.");
  }

  const mediaPaths = await uploadPublicationMedia(formData, "vacancies", options.accessToken);
  const result = await createStoredVacancyPublication({
    accessToken: options.accessToken,
    address: hasSelectedMapPoint(formData) ? readValue(formData, "address") : undefined,
    city: inferCityFromFormData(formData),
    conditions: readValue(formData, "conditions"),
    contactPerson: readValue(formData, "contactPerson") || undefined,
    description: readValue(formData, "description", "Описание вакансии будет дополнено."),
    email: email || undefined,
    employerType: requisites.employerType,
    inn: requisites.inn || undefined,
    ogrn: requisites.ogrn || undefined,
    ogrnip: requisites.ogrnip || undefined,
    lat: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lat") : undefined,
    lng: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lng") : undefined,
    mediaPaths,
    messengerUrl: messengerUrl || undefined,
    organization: readValue(formData, "organization", "Работодатель"),
    placementRightConfirmed: readRawValue(formData, "placementRightConfirmed") === "1",
    phone: phone || undefined,
    profession: readValue(formData, "profession") || readValue(formData, "title"),
    requirements: readValue(formData, "requirements"),
    responsibilities: readValue(formData, "responsibilities"),
    salary: normalizeListingPrice(readRawValue(formData, "salary"), "по договоренности"),
    schedule: readValue(formData, "schedule"),
    status: options.status,
    tariffId: options.tariffId,
    title: readValue(formData, "title", isDraft ? "Черновик вакансии" : "Новая вакансия"),
    website: readValue(formData, "website") || undefined,
    workFormat: readValue(formData, "workFormat"),
  });

  return result;
}

export function AdminDemoPublishButton({
  buttonClassName,
  captchaAfterButton = false,
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
  const captchaWidget = captchaRequired ? <TurnstileWidget inline={captchaAfterButton} resetKey={captchaResetKey} onVerify={setCaptchaToken} /> : null;

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;

    if (!form) {
      return;
    }

    const requiresPayment = Boolean(paymentTariffId && !isDraftStatus(status));
    const missingConsent = findMissingConsent(form, requiresPayment);

    if (missingConsent) {
      setError(missingConsent);
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

      const formData = new FormData(form);

      if (publicationType === "listing") {
        const identity = await resolveAuthenticatedClientUserIdentity();

        if (identity.accessToken && isDraftStatus(status)) {
          const result = await createSupabaseListing(formData, { accessToken: identity.accessToken, status: "draft" });

          if (!clientFallbackContentEnabled) {
            markCabinetDataChanged();
            window.location.href = returnHref;
            return;
          }

          const fallbackPublication = await buildFallbackPublication(formData, publicationType, status);
          const publication = {
            ...fallbackPublication,
            id: result.listing?.id ?? `demo-${publicationType}-${Date.now().toString(36)}`,
            images: result.listing?.images?.length ? result.listing.images : fallbackPublication.images,
            ownerKey: identity.ownerKey,
            ownerName: identity.name,
          };
          const stored = readStoredPublications();

          window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(storedPublicationsWithReplacement(publication, stored)));
          markCabinetDataChanged();
          window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
          window.location.href = returnHref;
          return;
        }

        if (requiresPayment && paymentTariffId) {
          if (!identity.accessToken) {
            throw new Error("Сессия входа устарела. Выйдите и войдите снова, затем повторите публикацию.");
          }

          const result = await createSupabaseListing(formData, { accessToken: identity.accessToken, tariffId: paymentTariffId });

          if (!result.payment?.id) {
            throw new Error("Платеж не был создан. Проверьте настройки тарифа размещения объявления.");
          }

          rememberPendingPaymentId(result.payment.id);

          if (result.payment.confirmationUrl) {
            window.location.href = result.payment.confirmationUrl;
            return;
          }

          await confirmClientPayment(result.payment.id);
          window.location.href = returnHref;
          return;
        }
      }

      if (publicationType === "vacancy") {
        const identity = await resolveAuthenticatedClientUserIdentity();

        if (identity.accessToken && isDraftStatus(status)) {
          const result = await createSupabaseVacancy(formData, { accessToken: identity.accessToken, status: "draft" });

          if (!clientFallbackContentEnabled) {
            markCabinetDataChanged();
            window.location.href = returnHref;
            return;
          }

          const fallbackPublication = await buildFallbackPublication(formData, publicationType, status);
          const publication = {
            ...fallbackPublication,
            id: result.vacancy?.id ?? `demo-${publicationType}-${Date.now().toString(36)}`,
            images: result.vacancy?.images?.length ? result.vacancy.images : fallbackPublication.images,
            ownerKey: identity.ownerKey,
            ownerName: identity.name,
          };
          const stored = readStoredPublications();

          window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(storedPublicationsWithReplacement(publication, stored)));
          markCabinetDataChanged();
          window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
          window.location.href = returnHref;
          return;
        }

        if (requiresPayment && paymentTariffId) {
          if (!identity.accessToken) {
            throw new Error("Сессия входа устарела. Выйдите и войдите снова, затем повторите публикацию.");
          }

          const result = await createSupabaseVacancy(formData, { accessToken: identity.accessToken, tariffId: paymentTariffId });

          if (!result.payment?.id) {
            throw new Error("Платеж не был создан. Проверьте настройки тарифа размещения вакансии.");
          }

          rememberPendingPaymentId(result.payment.id);

          if (result.payment.confirmationUrl) {
            window.location.href = result.payment.confirmationUrl;
            return;
          }

          await confirmClientPayment(result.payment.id);
          window.location.href = returnHref;
          return;
        }
      }

      const identity = await resolveAuthenticatedClientUserIdentity();

      if (!clientFallbackContentEnabled) {
        throw new Error("Сохранение без серверной записи недоступно.");
      }

      const publication = {
        ...(await buildFallbackPublication(formData, publicationType, status)),
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
      };
      const stored = readStoredPublications();

      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(storedPublicationsWithReplacement(publication, stored)));
      markCabinetDataChanged();
      window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
      window.location.href = returnHref;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить публикацию.");
      setCaptchaToken("");
      setCaptchaResetKey((value) => value + 1);
      setSaving(false);
    }
  }

  return (
    <div className={captchaAfterButton ? "grid gap-2 md:contents" : "grid gap-2"}>
      {!captchaAfterButton ? captchaWidget : null}
      <button
        type="button"
        onClick={handleClick}
        disabled={saving || (captchaRequired && !captchaToken)}
        className={
          buttonClassName ??
          "inline-flex h-12 w-fit items-center justify-center gap-2 rounded-xl bg-[#d92d20] px-6 font-bold text-white transition hover:bg-[#b42318] disabled:cursor-wait disabled:bg-slate-300"
        }
      >
        {saving ? (paymentTariffId && !isDraftStatus(status) ? "Создаем и оплачиваем..." : "Сохраняем...") : label}
        <ArrowRight className="h-5 w-5" />
      </button>
      {captchaAfterButton ? captchaWidget : null}
      {error ? <p className={`text-sm font-semibold text-rose-600 ${captchaAfterButton ? "md:basis-full" : ""}`}>{error}</p> : null}
    </div>
  );
}
