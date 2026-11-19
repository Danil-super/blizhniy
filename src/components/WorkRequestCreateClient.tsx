"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { BrandName } from "@/components/BrandName";
import { CitySelectField } from "@/components/CitySelectField";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";
import { LegalConsentCheckbox, LegalLink } from "@/components/LegalConsentCheckbox";
import { markCabinetDataChanged } from "@/lib/cabinet-data-cache";
import { draftRetryMessage, prepareLegacyDraftMedia, sendLegacyCreation } from "@/lib/legacy-draft-attempt";
import { uploadPublicationImageSources } from "@/lib/client-publication-media";
import { storeFormPhotos } from "@/lib/client-media-store";
import { shouldShowClientFallbackContent } from "@/lib/client-runtime-mode";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { readStoredDemoPublications, writeStoredDemoPublications, demoPublicationsUpdatedEvent, type DemoPublication, withPublicationHistory } from "@/lib/demo-publications";
import { normalizeListingPrice } from "@/lib/listing-price";

type CreatedWorkRequestResponse = {
  error?: string;
  payment?: {
    confirmationUrl?: string;
    id?: string;
  };
  workRequest?: {
    id?: string;
    images?: string[];
    status?: string;
    title?: string;
  };
};

const clientFallbackContentEnabled = shouldShowClientFallbackContent();

function readStoredPublications() {
  try {
    const stored = readStoredDemoPublications();
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "id" in item));
    }
  } catch {
    return [];
  }

  return [];
}

function readValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function createWorkRequestId() {
  return crypto.randomUUID();
}

function mergeSavedImages(serverImages: string[] | undefined, localImages: string[]) {
  if (!serverImages?.length) {
    return localImages;
  }

  return [...serverImages, ...localImages.slice(serverImages.length)].slice(0, 6);
}

type SaveMode = "draft" | "publish";

async function createSupabaseWorkRequest(formData: FormData, options: { accessToken: string; mediaPaths: string[]; creationKey?: string; status?: "draft"; tariffId?: string }) {
  const mediaPaths = options.mediaPaths;
  const response = await sendLegacyCreation("/api/work-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.accessToken}` },
    body: JSON.stringify({
      budget: readValue(formData, "budget"),
      city: readValue(formData, "city") || "Краснодар",
      description: readValue(formData, "description"),
      mediaPaths,
      messengerUrl: readValue(formData, "messengerUrl") || undefined,
      phone: readValue(formData, "phone") || undefined,
      placementRightConfirmed: formData.get("placementRightConfirmed") === "on",
      profession: readValue(formData, "profession") || undefined,
      status: options.status,
      tariffId: options.tariffId,
      title: readValue(formData, "title"),
    }),
  }, options.creationKey);
  const payload = (await response.json().catch(() => null)) as CreatedWorkRequestResponse | null;

  if (!response.ok || !payload?.workRequest?.id) {
    throw new Error(payload?.error ?? (options.creationKey ? draftRetryMessage : "Не удалось создать заказ."));
  }

  return payload;
}

export function WorkRequestCreateClient() {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [savingMode, setSavingMode] = useState<SaveMode | null>(null);

  async function saveRequest(mode: SaveMode) {
    const form = formRef.current;

    if (!form || savingMode) {
      return;
    }

    setMessage("");

    if (mode === "publish" && !form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    const phone = readValue(formData, "phone");
    const messengerUrl = readValue(formData, "messengerUrl");

    if (mode === "publish" && !phone && !messengerUrl) {
      setMessage("Укажите телефон или мессенджер для связи по заказу. Контакты не показываются публично.");
      return;
    }

    if (mode === "publish" && formData.get("placementRightConfirmed") !== "on") {
      setMessage("Подтвердите правила размещения заказа.");
      return;
    }

    setSavingMode(mode);

    try {
      const identity = await resolveAuthenticatedClientUserIdentity();
      const now = new Date().toISOString();
      const title = readValue(formData, "title") || "Черновик заказа";
      const profession = readValue(formData, "profession") || "Заказ исполнителю";
      const city = readValue(formData, "city") || "Краснодар";
      const rawBudget = readValue(formData, "budget");
      const upload = async () => {
        const images = await storeFormPhotos(formData, 6);
        return { images, paths: await uploadPublicationImageSources(images, "work-requests", identity.accessToken) };
      };
      const media = mode === "draft"
        ? await prepareLegacyDraftMedia(form, identity.ownerKey, formData, upload)
        : { ...await upload(), creationKey: undefined };
      const result = await createSupabaseWorkRequest(formData, {
        accessToken: identity.accessToken ?? "",
        mediaPaths: media.paths,
        creationKey: media.creationKey,
        status: mode === "draft" ? "draft" : undefined,
        tariffId: mode === "publish" ? "work-request-publication" : undefined,
      });
      if (clientFallbackContentEnabled) {
        const publication = withPublicationHistory({
          id: result.workRequest?.id ?? createWorkRequestId(),
          type: "workRequest",
          ownerKey: identity.ownerKey,
          ownerName: identity.name,
          title,
          subtitle: profession,
          profession,
          city,
          price: normalizeListingPrice(rawBudget, "по договоренности"),
          description: readValue(formData, "description"),
          images: mergeSavedImages(result.workRequest?.images, media.images ?? []),
          phone,
          messengerUrl,
          status: mode === "publish" ? "Ждет оплаты" : "Черновик",
          createdAt: now,
        });
        const nextItems = [publication, ...readStoredPublications()].slice(0, 80);

        writeStoredDemoPublications(JSON.stringify(nextItems));
        window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
      }

      markCabinetDataChanged();

      if (mode === "publish") {
        if (!result.payment?.id) {
          throw new Error("Платеж не был создан. Проверьте тариф размещения заказа.");
        }

        if (result.payment.confirmationUrl) {
          window.location.href = result.payment.confirmationUrl;
          return;
        }

        router.push(`/oplata/${result.payment.id}`);
        return;
      }

      router.push("/cabinet/zakazy");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить заказ. Попробуйте еще раз.");
      setSavingMode(null);
    }
  }

  return (
    <main className="page-container py-6 sm:py-10">
      <BackLink fallbackHref="/cabinet/zakazy" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
        Назад к заказам
      </BackLink>
      <FormPanel title="Разместить заказ" description="Опишите задачу для исполнителя: что нужно сделать, где и как с вами связаться.">
        <form ref={formRef} className="responsive-form-panel grid gap-4" noValidate>
          <div className="responsive-field-grid">
            <Field name="title" label="Название заказа" placeholder="Нужен сантехник" maxLength={90} minLength={3} required />
            <Field name="profession" label="Профессия / категория" placeholder="Сантехник" maxLength={80} minLength={2} required />
            <CitySelectField name="city" label="Город" required />
            <Field name="budget" label="Оплата" placeholder="15000" maxLength={9} />
            <Field name="phone" label="Телефон" placeholder="+7-(999)-999-99-99" />
            <Field name="messengerUrl" label="Telegram / WhatsApp" placeholder="@username или ссылка" maxLength={120} />
          </div>
          <p className="text-sm leading-6 text-slate-600">Контакты не показываются публично. После отклика вы сможете выбрать исполнителя и связаться с ним.</p>
          <TextAreaField name="description" label="Описание задачи" placeholder="Опишите объем работ, сроки, важные условия и пожелания к исполнителю." minLength={30} maxLength={1800} required />
          <PhotoField label="Фото к заказу" description="Можно добавить фото объекта, поломки или места работ. Это необязательно." maxPhotos={6} autoOpenCropper={false} />
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-5 text-slate-700">
            <input name="placementRightConfirmed" type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#0875d1]" />
            <span>Подтверждаю, что заказ реальный, данные указаны корректно и я смогу связаться с выбранным исполнителем.</span>
          </label>
          <LegalConsentCheckbox name="publicOfferAccepted" paymentConsent errorMessage="Примите условия публичной оферты, чтобы перейти к оплате">
            Я принимаю условия <LegalLink href="/legal/offer">Публичной оферты</LegalLink> и понимаю, что оплачиваю услугу размещения заказа на сайте <BrandName />.
          </LegalConsentCheckbox>
          {message ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{message}</p> : null}
          <div className="grid gap-3 sm:flex sm:flex-wrap">
            <button
              type="button"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-7 font-bold text-slate-800 transition hover:border-[#0875d1] hover:text-[#0875d1] disabled:cursor-wait disabled:opacity-70"
              disabled={Boolean(savingMode)}
              onClick={() => void saveRequest("draft")}
            >
              {savingMode === "draft" ? "Сохраняем..." : "Сохранить черновик"}
            </button>
            <button
              type="button"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-[#d92d20] px-7 font-bold text-white transition hover:bg-[#b42318] disabled:cursor-wait disabled:opacity-70"
              disabled={Boolean(savingMode)}
              onClick={() => void saveRequest("publish")}
            >
              {savingMode === "publish" ? "Сохраняем..." : "Создать и оплатить"}
            </button>
          </div>
        </form>
      </FormPanel>
    </main>
  );
}
