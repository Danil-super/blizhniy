"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { DropdownSelect } from "@/components/DropdownSelect";
import { LegalConsentCheckbox, LegalLink } from "@/components/LegalConsentCheckbox";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { fairCategories } from "@/lib/data";
import { ValidatedInput } from "@/components/ValidatedInput";
import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationHistory, type DemoPublication } from "@/lib/demo-publications";
import { confirmClientPayment } from "@/lib/client-payment-flow";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";

type SubmitState = "idle" | "loading" | "error";

type MediaUploadResponse = {
  error?: string;
  files?: Array<{ path?: string }>;
};

function readStoredPublications() {
  try {
    const storedRaw = window.localStorage.getItem(demoPublicationsStorageKey);
    const stored = storedRaw ? (JSON.parse(storedRaw) as unknown) : [];

    return Array.isArray(stored) ? stored.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "id" in item)) : [];
  } catch {
    return [];
  }
}

function writeFairApplicationPublication(publication: DemoPublication) {
  const stored = readStoredPublications().filter((item) => item.id !== publication.id);

  window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify([publication, ...stored].slice(0, 50)));
  window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
}

function readPhotoFiles(data: FormData) {
  return data.getAll("productPhotos").filter((item): item is File => item instanceof File && item.size > 0 && item.type.startsWith("image/"));
}

async function uploadFairPhotos(data: FormData, accessToken: string) {
  const photos = readPhotoFiles(data);

  if (!photos.length) {
    return [];
  }

  const uploadData = new FormData();
  uploadData.set("folder", "fair-applications");
  photos.slice(0, 10).forEach((photo) => uploadData.append("files", photo));

  const response = await fetch("/api/uploads/media", {
    body: uploadData,
    headers: { Authorization: `Bearer ${accessToken}` },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as MediaUploadResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Не удалось загрузить фото товаров");
  }

  return payload?.files?.map((file) => file.path).filter((path): path is string => Boolean(path)) ?? [];
}

function findMissingConsent(form: HTMLFormElement) {
  const missingRequiredConsent = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-required-consent="true"]')).find((input) => !input.checked);

  if (missingRequiredConsent) {
    return missingRequiredConsent.dataset.errorMessage || "Примите условия документов, чтобы продолжить";
  }

  const paymentConsent = form.querySelector<HTMLInputElement>('input[data-payment-consent="true"]');

  if (paymentConsent && !paymentConsent.checked) {
    return paymentConsent.dataset.errorMessage || "Примите условия публичной оферты, чтобы перейти к оплате";
  }

  return "";
}

export function FairApplicationForm({ adminMode = false }: { adminMode?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [captchaToken, setCaptchaToken] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const missingConsent = findMissingConsent(form);

    if (missingConsent) {
      setState("error");
      setMessage(missingConsent);
      return;
    }

    if (!form.reportValidity()) {
      return;
    }

    const data = new FormData(form);
    setState("loading");
    setMessage("");

    try {
      const identity = await resolveAuthenticatedClientUserIdentity();

      if (!identity.accessToken) {
        throw new Error("Сессия входа устарела. Выйдите и войдите снова, затем повторите отправку заявки.");
      }

      const productPhotos = await uploadFairPhotos(data, identity.accessToken);
      const response = await fetch("/api/fair-applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${identity.accessToken}`,
        },
        body: JSON.stringify({
          participantName: data.get("participantName"),
          city: data.get("city"),
          category: data.get("category"),
          description: data.get("description"),
          productPhotos,
          videoUrl: data.get("videoUrl"),
          phone: data.get("phone"),
          email: data.get("email"),
          comment: data.get("comment"),
          captchaToken,
          skipPayment: adminMode,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось создать заявку");
      }

      const applicationId = typeof payload.application?.id === "string" ? payload.application.id : `demo-fairApplication-${Date.now().toString(36)}`;
      const publication: DemoPublication = withPublicationHistory({
        id: applicationId,
        type: "fairApplication",
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        title: String(data.get("participantName") ?? "").trim() || "Новая заявка",
        subtitle: String(data.get("category") ?? "").trim() || "Заявка на ярмарку",
        city: String(data.get("city") ?? "").trim() || "Краснодар",
        description: String(data.get("description") ?? "").trim(),
        phone: String(data.get("phone") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        status: adminMode ? "Опубликовано" : "Ждет оплаты",
        createdAt: new Date().toISOString(),
      });

      writeFairApplicationPublication(publication);

      if (adminMode) {
        router.push("/cabinet/fair-applications");
        return;
      }

      if (typeof payload.payment?.id !== "string") {
        throw new Error("Не удалось создать платеж по заявке.");
      }

      if (typeof payload.payment.confirmationUrl === "string" && payload.payment.confirmationUrl) {
        window.location.href = payload.payment.confirmationUrl;
        return;
      }

      await confirmClientPayment(payload.payment.id);
      router.push("/cabinet/fair-applications");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось отправить заявку");
      setCaptchaToken("");
      setCaptchaResetKey((value) => value + 1);
    }
  }

  return (
    <form className="mt-6 grid gap-4" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Название мастерской или ФИО
          <input name="participantName" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="Мастерская Кубань Дуб" required />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Город
          <input name="city" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="Краснодар" required />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-bold text-slate-600">
        Категория ярмарки
        <DropdownSelect name="category" options={fairCategories.map((category) => ({ value: category, label: category }))} buttonClassName="h-11 font-normal sm:h-12" />
      </label>
      <label className="grid gap-2 text-sm font-bold text-slate-600">
        Описание работ или товаров
        <textarea name="description" className="min-h-24 rounded-lg border border-slate-300 px-3 py-3 font-normal outline-none focus:border-[#0875d1] sm:min-h-28 sm:px-4" placeholder="Что вы покажете на ярмарке" required />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Фото товаров
          <input name="productPhotos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="rounded-lg border border-slate-300 px-3 py-2 font-normal outline-none file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-bold file:text-[#0875d1] focus:border-[#0875d1]" />
          <span className="text-xs font-semibold text-slate-500">До 10 изображений, каждый файл до 10 МБ.</span>
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Ссылка на видео
          <ValidatedInput name="videoUrl" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="https://..." validation="url" />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Телефон
          <ValidatedInput name="phone" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="+7..." validation="phone" required />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-600">
          Email
          <ValidatedInput name="email" className="h-11 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4" placeholder="you@example.ru" validation="email" required />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-bold text-slate-600">
        Комментарий
        <textarea name="comment" className="min-h-20 rounded-lg border border-slate-300 px-3 py-3 font-normal outline-none focus:border-[#0875d1] sm:min-h-24 sm:px-4" placeholder="Пожелания к месту, столу, электричеству" />
      </label>
      <LegalConsentCheckbox name="fairLegalAccepted" errorMessage="Примите условия документов, чтобы продолжить">
        Я соглашаюсь с <LegalLink href="/legal/agreement">Пользовательским соглашением</LegalLink> и{" "}
        <LegalLink href="/legal/privacy">Политикой обработки персональных данных</LegalLink>.
      </LegalConsentCheckbox>
      {!adminMode ? (
        <LegalConsentCheckbox
          name="publicOfferAccepted"
          requiredConsent={false}
          paymentConsent
          errorMessage="Примите условия публичной оферты, чтобы перейти к оплате"
        >
          Я принимаю условия <LegalLink href="/legal/offer">Публичной оферты</LegalLink> и понимаю, что оплачиваю участие в ярмарке на сайте БЛИЖНИЙ.
        </LegalConsentCheckbox>
      ) : null}
      <TurnstileWidget
        resetKey={captchaResetKey}
        onVerify={setCaptchaToken}
      />
      <button type="submit" disabled={state === "loading" || !captchaToken} className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0aa337] px-5 text-sm font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-not-allowed disabled:bg-slate-300 sm:h-12 sm:w-fit sm:px-7 sm:text-base">
        {state === "loading" ? (adminMode ? "Создаем заявку..." : "Создаем и оплачиваем...") : adminMode ? "Создать заявку без оплаты" : "Создать заявку и оплатить"}
      </button>
      {state === "error" ? <p className="text-sm font-semibold text-rose-600">{message}</p> : null}
    </form>
  );
}
