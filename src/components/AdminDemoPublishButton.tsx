"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { createStoredListingPublication } from "@/lib/client-listing-flow";
import { storeMediaFile } from "@/lib/client-media-store";
import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationHistory, type DemoPublication, type DemoPublicationType } from "@/lib/demo-publications";
import { normalizeListingPrice } from "@/lib/listing-price";
import { categories, cities } from "@/lib/data";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { TURNSTILE_ERROR_MESSAGE } from "@/lib/turnstile-shared";
import type { ListingKind } from "@/lib/types";

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

function readImageFiles(formData: FormData) {
  return formData.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0 && item.type.startsWith("image/"));
}

async function uploadPublicationMedia(formData: FormData, folder: "fair-applications" | "listings", accessToken: string) {
  const files = readImageFiles(formData);

  if (!files.length) {
    return [];
  }

  const uploadFormData = new FormData();
  uploadFormData.set("folder", folder);
  files.slice(0, 10).forEach((file) => uploadFormData.append("files", file));

  const response = await fetch("/api/uploads/media", {
    body: uploadFormData,
    headers: { Authorization: `Bearer ${accessToken}` },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as MediaUploadResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Не удалось загрузить фото.");
  }

  return payload?.files?.map((file) => file.path).filter((path): path is string => Boolean(path)) ?? [];
}

async function readLocalImageReferences(formData: FormData) {
  const files = readImageFiles(formData).slice(0, 10);
  const storedImages = await Promise.allSettled(files.map((file) => storeMediaFile(file)));

  return storedImages.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

async function buildFallbackPublication(formData: FormData, type: DemoPublicationType, status: string): Promise<DemoPublication> {
  const now = new Date().toISOString();
  const id = `demo-${type}-${Date.now().toString(36)}`;
  const categorySlug = readValue(formData, "category", "dlya-doma-i-dachi");
  const categoryName = categories.find((category) => category.slug === categorySlug)?.name ?? "Категория";

  return withPublicationHistory({
    id,
    type,
    title: readValue(formData, type === "specialist" ? "name" : "title", "Новая публикация"),
    subtitle: type === "listing" ? categoryName : readValue(formData, "profession", "Публикация"),
    city: inferCityFromFormData(formData),
    price: normalizeListingPrice(readRawValue(formData, type === "vacancy" ? "salary" : type === "specialist" ? "price" : "price"), "по договоренности"),
    description: readValue(formData, "description", "Описание будет дополнено."),
    phone: readValue(formData, "phone"),
    email: readValue(formData, "email"),
    messengerUrl: readValue(formData, "messengerUrl"),
    listingKind: readValue(formData, "kind", "prodam") as ListingKind,
    categorySlug,
    subcategorySlug: readValue(formData, "subcategory"),
    images: await readLocalImageReferences(formData),
    status,
    createdAt: now,
  });
}

async function createSupabaseListing(formData: FormData, options: { accessToken: string; status?: "draft"; tariffId?: string }) {
  const categorySlug = readValue(formData, "category", "dlya-doma-i-dachi");
  const rawKind = readValue(formData, "kind", "prodam") as ListingKind;
  const kind = categorySlug === "otdyh" || (categorySlug === "nedvizhimost" && rawKind === "arenda") ? "arenda" : rawKind;
  const phone = readRawValue(formData, "phone");
  const messengerUrl = readRawValue(formData, "messengerUrl");
  const email = readRawValue(formData, "email");
  const isDraft = options.status === "draft";

  if (!isDraft && !phone && !messengerUrl && !email) {
    throw new Error("Укажите хотя бы один контакт объявления: телефон, email или Telegram/WhatsApp.");
  }

  const mediaPaths = await uploadPublicationMedia(formData, "listings", options.accessToken);
  const result = await createStoredListingPublication({
    accessToken: options.accessToken,
    address: hasSelectedMapPoint(formData) ? readValue(formData, "address") : undefined,
    categorySlug,
    city: inferCityFromFormData(formData),
    description: readValue(formData, "description", "Описание будет дополнено."),
    kind,
    lat: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lat") : undefined,
    lng: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lng") : undefined,
    mediaPaths,
    messengerUrl: messengerUrl || undefined,
    phone: phone || undefined,
    price: normalizeListingPrice(readRawValue(formData, "price"), "по договоренности"),
    status: options.status,
    subcategory: readValue(formData, "subcategory"),
    tariffId: options.tariffId,
    title: readValue(formData, "title", isDraft ? "Черновик объявления" : "Новое объявление"),
  });

  return result;
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

      const formData = new FormData(form);
      const requiresPayment = Boolean(paymentTariffId && !isDraftStatus(status));

      if (publicationType === "listing") {
        const identity = await resolveAuthenticatedClientUserIdentity();

        if (identity.accessToken && isDraftStatus(status)) {
          const result = await createSupabaseListing(formData, { accessToken: identity.accessToken, status: "draft" });
          const fallbackPublication = await buildFallbackPublication(formData, publicationType, status);
          const publication = {
            ...fallbackPublication,
            id: result.listing?.id ?? `demo-${publicationType}-${Date.now().toString(36)}`,
            images: result.listing?.images ?? fallbackPublication.images,
            ownerKey: identity.ownerKey,
            ownerName: identity.name,
          };
          const stored = readStoredPublications();

          window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(storedPublicationsWithReplacement(publication, stored)));
          window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
          window.location.href = returnHref;
          return;
        }

        if (requiresPayment && paymentTariffId) {
          if (!identity.accessToken) {
            throw new Error("Сессия входа устарела. Выйдите и войдите снова, затем повторите публикацию.");
          }

          const result = await createSupabaseListing(formData, { accessToken: identity.accessToken, tariffId: paymentTariffId });

          if (!result.payment?.confirmationUrl || !result.payment.id) {
            throw new Error("Платеж создан, но ЮKassa не вернула ссылку на оплату. Проверьте YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY и PAYMENT_PROVIDER=yookassa на сервере.");
          }

          rememberPendingPaymentId(result.payment.id);
          window.location.href = result.payment.confirmationUrl;
          return;
        }
      }

      const identity = await resolveAuthenticatedClientUserIdentity();
      const publication = {
        ...(await buildFallbackPublication(formData, publicationType, status)),
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
      };
      const stored = readStoredPublications();

      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(storedPublicationsWithReplacement(publication, stored)));
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
    <div className="grid gap-2">
      {captchaRequired ? <TurnstileWidget resetKey={captchaResetKey} onVerify={setCaptchaToken} /> : null}
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
