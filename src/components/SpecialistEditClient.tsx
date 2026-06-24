"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { DropdownSelect } from "@/components/DropdownSelect";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";
import { ListingLocationFields } from "@/components/listings/ListingFormControls";
import { markCabinetDataChanged } from "@/lib/cabinet-data-cache";
import { isStoredMediaReference, storeMediaDataUrl, storeMediaFile } from "@/lib/client-media-store";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { professions } from "@/lib/data";
import { appendPublicationHistory, demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationStatusHistory, type DemoPublication } from "@/lib/demo-publications";
import { normalizeListingPrice } from "@/lib/listing-price";
import { hasMapCoordinates } from "@/lib/map-location";

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

function isPendingPaymentStatus(status?: string) {
  const normalized = status?.trim().toLowerCase();
  return normalized === "ждет оплаты" || normalized === "ожидает оплату" || normalized === "pending_payment";
}

function readValue(formData: FormData, name: string, fallback = "") {
  return String(formData.get(name) ?? "").trim() || fallback;
}

function readOptionalValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function readPhotoRefs(formData: FormData) {
  const rawValue = String(formData.get("photosRefs") ?? "").trim();

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((value) => {
      const photo = String(value ?? "").trim();

      return photo ? [photo] : [];
    });
  } catch {
    return [];
  }
}

async function storeImageReference(source: string, index: number) {
  if (isStoredMediaReference(source) || /^https?:\/\//i.test(source)) {
    return source;
  }

  if (/^data:image\//i.test(source)) {
    return storeMediaDataUrl(source, `specialist-photo-${index + 1}.png`);
  }

  if (/^blob:/i.test(source)) {
    const response = await fetch(source);
    const blob = await response.blob();
    const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";

    return storeMediaFile(new File([blob], `specialist-photo-${index + 1}.${extension}`, { type: blob.type || "image/jpeg" }));
  }

  return source;
}

async function readLocalImageReferences(formData: FormData) {
  const previewRefs = readPhotoRefs(formData).slice(0, 12);

  if (previewRefs.length) {
    const storedRefs = await Promise.allSettled(previewRefs.map((source, index) => storeImageReference(source, index)));

    return storedRefs.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : [])).slice(0, 12);
  }

  return formData
    .getAll("existingPhotos")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function parseCoordinate(formData: FormData, name: string) {
  const rawValue = String(formData.get(name) ?? "").trim();

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function hasSelectedMapPoint(formData: FormData) {
  return String(formData.get("locationMode") ?? "") === "exact" && String(formData.get("mapPointSelected") ?? "") === "1";
}

export function SpecialistEditClient({ specialistId }: { specialistId: string }) {
  const [storedItems, setStoredItems] = useState<DemoPublication[]>([]);
  const [message, setMessage] = useState("");
  const professionOptions = useMemo(
    () =>
      professions
        .filter((profession) => profession.active)
        .map((profession) => ({
          value: profession.name,
          label: `${profession.name} · ${profession.parent}`,
        })),
    [],
  );

  useEffect(() => {
    setStoredItems(readStoredPublications());
  }, []);

  const specialist = useMemo(() => storedItems.find((item) => item.type === "specialist" && item.id === specialistId), [storedItems, specialistId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!specialist) {
      return;
    }

    try {
      const identity = await resolveAuthenticatedClientUserIdentity();
      const formData = new FormData(form);
      const nextStatus = isPendingPaymentStatus(specialist.status) ? specialist.status : readValue(formData, "status", specialist.status);
      const hasMapPoint = hasSelectedMapPoint(formData);
      const lat = hasMapPoint ? parseCoordinate(formData, "lat") : undefined;
      const lng = hasMapPoint ? parseCoordinate(formData, "lng") : undefined;
      const address = hasMapPoint ? readOptionalValue(formData, "address") : undefined;
      const phone = readOptionalValue(formData, "phone");
      const email = readOptionalValue(formData, "email");
      const messengerUrl = readOptionalValue(formData, "messengerUrl");

      if (!phone && !email && !messengerUrl) {
        setMessage("Укажите телефон, email или Telegram / WhatsApp.");
        return;
      }

      const updatedSpecialist: DemoPublication = {
        ...specialist,
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        title: readValue(formData, "name", specialist.title),
        subtitle: readValue(formData, "profession", specialist.subtitle),
        city: readValue(formData, "city", specialist.city),
        price: normalizeListingPrice(readValue(formData, "price", specialist.price ?? ""), specialist.price ?? "по договоренности"),
        description: readValue(formData, "description", specialist.description ?? ""),
        images: await readLocalImageReferences(formData),
        address,
        hasMapPoint,
        lat,
        lng,
        phone,
        email,
        messengerUrl,
        profession: readValue(formData, "profession", specialist.profession ?? specialist.subtitle),
        showExactAddress: hasMapPoint,
        skills: readValue(formData, "skills", specialist.skills ?? ""),
        status: nextStatus,
      };
      const nextItems = storedItems.map((item) => {
        if (item.id === specialist.id) {
          return specialist.status.trim().toLowerCase() === nextStatus.trim().toLowerCase()
            ? appendPublicationHistory(updatedSpecialist, "updated", {
                status: updatedSpecialist.status,
                description: "Анкета специалиста отредактирована владельцем.",
              })
            : withPublicationStatusHistory({ ...updatedSpecialist, status: specialist.status }, nextStatus);
        }

        if (item.type === "specialist" && !isDraftStatus(nextStatus) && !isDraftStatus(item.status)) {
          return withPublicationStatusHistory(item, "Черновик", {
            description: "Анкета переведена в черновик, потому что опубликована другая анкета специалиста.",
          });
        }

        return item;
      });

      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextItems));
      markCabinetDataChanged();
      window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
      window.location.href = "/cabinet/specialist";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить изменения. Попробуйте еще раз.");
    }
  }

  if (!specialist) {
    return (
      <main className="page-container py-10">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-xl font-bold text-[#060b27]">Анкета не найдена</h1>
          <p className="mt-2 text-slate-600">Черновики анкет хранятся в браузере, где они были созданы.</p>
          <BackLink fallbackHref="/cabinet/specialist" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться к анкетам
          </BackLink>
        </section>
      </main>
    );
  }

  return (
    <main className="page-container specialist-form-container py-5 sm:py-10">
      <BackLink fallbackHref="/cabinet/specialist" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
        Назад
      </BackLink>
      <FormPanel title="Редактировать анкету специалиста" description="Изменения применяются к выбранной анкете из личного кабинета. Активной может быть только одна анкета.">
        <form onSubmit={handleSubmit} className="responsive-form-panel grid gap-4">
          <div className="responsive-field-grid specialist-primary-field-grid">
            <div className="specialist-primary-name">
              <Field name="name" label="Имя / название профиля" defaultValue={specialist.title} minLength={2} maxLength={15} required />
            </div>
            <label className="specialist-primary-profession form-field grid min-w-0 gap-1.5 text-xs font-bold leading-4 text-slate-700 sm:gap-2 sm:text-sm" data-field-size="lg">
              <span className="line-clamp-2">Профессия из классификатора</span>
              <DropdownSelect name="profession" defaultValue={specialist.profession ?? specialist.subtitle} placeholder="Выбрать" options={professionOptions} required />
            </label>
            <div className="specialist-primary-price">
              <Field name="price" label="Стоимость работ" defaultValue={specialist.price} placeholder="1500" maxLength={9} required />
            </div>
            <div className="specialist-primary-phone">
              <Field name="phone" label="Телефон" placeholder="+7-(999)-999-99-99" defaultValue={specialist.phone} />
            </div>
            <div className="specialist-primary-email">
              <Field name="email" label="Email" type="email" placeholder="name@example.ru" defaultValue={specialist.email} maxLength={64} />
            </div>
            <div className="specialist-primary-messenger">
              <Field name="messengerUrl" label="Telegram / WhatsApp" placeholder="@username или ссылка" defaultValue={specialist.messengerUrl} maxLength={64} />
            </div>
          </div>
          <input type="hidden" name="status" value={specialist.status} />
          <ListingLocationFields
            addressLegend="Адрес специалиста"
            cityFieldName="city"
            defaultAddress={specialist.showExactAddress ? specialist.address : undefined}
            defaultCity={specialist.city}
            defaultLat={specialist.showExactAddress && (specialist.hasMapPoint ?? true) && hasMapCoordinates(specialist.lat, specialist.lng) ? specialist.lat : undefined}
            defaultLng={specialist.showExactAddress && (specialist.hasMapPoint ?? true) && hasMapCoordinates(specialist.lat, specialist.lng) ? specialist.lng : undefined}
            inlineControls
          />
          <PhotoField defaultPhotos={specialist.images} label="Фото специалиста и работ" description="Добавьте портфолио, фото выполненных работ или рабочей зоны." />
          <TextAreaField name="skills" label="Навыки" placeholder="Монтаж, ремонт, замена" defaultValue={specialist.skills} minLength={3} maxLength={120} required />
          <TextAreaField name="description" label="О себе и опыт работы" placeholder="Расскажите об опыте, подходе к работе, гарантиях и условиях выезда" defaultValue={specialist.description} maxLength={500} />
          {message ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0875d1] px-7 font-bold text-white">
              Сохранить изменения
            </button>
            <BackLink fallbackHref="/cabinet/specialist" className="inline-flex h-12 w-fit items-center justify-center gap-2 rounded-xl border border-slate-300 px-7 font-bold text-slate-800">
              Отмена
            </BackLink>
          </div>
        </form>
      </FormPanel>
    </main>
  );
}
