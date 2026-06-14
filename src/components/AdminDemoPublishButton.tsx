"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { confirmClientPayment } from "@/lib/client-payment-flow";
import { createStoredListingPublication } from "@/lib/client-listing-flow";
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
    status,
    createdAt: now,
  });
}

async function createSupabaseListing(formData: FormData, tariffId: string, accessToken: string) {
  const categorySlug = readValue(formData, "category", "dlya-doma-i-dachi");
  const rawKind = readValue(formData, "kind", "prodam") as ListingKind;
  const kind = categorySlug === "otdyh" || (categorySlug === "nedvizhimost" && rawKind === "arenda") ? "arenda" : rawKind;
  const phone = readRawValue(formData, "phone");
  const messengerUrl = readRawValue(formData, "messengerUrl");
  const email = readRawValue(formData, "email");

  if (!phone && !messengerUrl && !email) {
    throw new Error("Укажите хотя бы один контакт объявления: телефон, email или Telegram/WhatsApp.");
  }

  const result = await createStoredListingPublication({
    accessToken,
    address: hasSelectedMapPoint(formData) ? readValue(formData, "address") : undefined,
    categorySlug,
    city: inferCityFromFormData(formData),
    description: readValue(formData, "description", "Описание будет дополнено."),
    kind,
    lat: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lat") : undefined,
    lng: hasSelectedMapPoint(formData) ? readCoordinate(formData, "lng") : undefined,
    messengerUrl: messengerUrl || undefined,
    phone: phone || undefined,
    price: normalizeListingPrice(readRawValue(formData, "price"), "по договоренности"),
    subcategory: readValue(formData, "subcategory"),
    tariffId,
    title: readValue(formData, "title", "Новое объявление"),
  });

  if (result.payment?.confirmationUrl) {
    window.location.href = result.payment.confirmationUrl;
    return;
  }

  if (result.payment?.id) {
    await confirmClientPayment(result.payment.id);
  }

  window.location.href = result.listing?.slug ? `/obyavlenie/${result.listing.slug}` : "/cabinet/obyavleniya";
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

      if (publicationType === "listing" && requiresPayment && paymentTariffId) {
        const identity = await resolveAuthenticatedClientUserIdentity();

        if (!identity.accessToken) {
          throw new Error("Сессия входа устарела. Выйдите и войдите снова, затем повторите публикацию.");
        }

        await createSupabaseListing(formData, paymentTariffId, identity.accessToken);
        return;
      }

      const identity = await resolveAuthenticatedClientUserIdentity();
      const publication = {
        ...(await buildFallbackPublication(formData, publicationType, status)),
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
      };
      const stored = readStoredPublications();

      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify([publication, ...stored].slice(0, 50)));
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
