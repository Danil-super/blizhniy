"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";
import { VacancyEmployerFields } from "@/components/VacancyEmployerFields";
import { VacancyFormValidator } from "@/components/VacancyFormValidator";
import { ListingLocationFields } from "@/components/listings/ListingFormControls";
import { markCabinetDataChanged } from "@/lib/cabinet-data-cache";
import { uploadPublicationImageSources } from "@/lib/client-publication-media";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { storeMediaFile } from "@/lib/client-media-store";
import { appendPublicationHistory, demoPublicationsStorageKey, demoPublicationsUpdatedEvent, unpublishedVacancyStatus, withPublicationHistory, withPublicationStatusHistory, type DemoPublication } from "@/lib/demo-publications";
import { normalizeListingPrice } from "@/lib/listing-price";
import { normalizeVacancyRequisites, validateVacancyRequisites } from "@/lib/vacancy-requisites";
import type { JobVacancy } from "@/lib/types";

type VacancyEditClientProps = {
  initialVacancy?: JobVacancy;
  vacancyId: string;
};

type UpdatedVacancyResponse = {
  error?: string;
  vacancy?: Partial<JobVacancy>;
};

function vacancyStatusLabel(status?: JobVacancy["status"] | string) {
  if (status === "published" || status === "paid") {
    return "Опубликовано";
  }

  if (status === "pending_payment") {
    return "Ждет оплаты";
  }

  if (status === "draft") {
    return "Черновик";
  }

  if (status === "archived") {
    return unpublishedVacancyStatus;
  }

  if (status === "expired") {
    return "Истек срок";
  }

  if (status === "rejected") {
    return "Отклонено";
  }

  return status ?? "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
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

function initialToPublication(vacancy: JobVacancy): DemoPublication {
  return {
    id: vacancy.id,
    type: "vacancy",
    title: vacancy.title,
    subtitle: vacancy.organization,
    city: vacancy.city,
    price: vacancy.salary,
    description: vacancy.description,
    lat: vacancy.lat,
    lng: vacancy.lng,
    address: vacancy.address,
    hasMapPoint: Boolean(vacancy.lat && vacancy.lng),
    showExactAddress: vacancy.showExactAddress,
    phone: vacancy.phone,
    email: vacancy.email,
    messengerUrl: vacancy.messengerUrl,
    profession: vacancy.profession,
    employerType: vacancy.employerType,
    inn: vacancy.inn,
    ogrn: vacancy.ogrn,
    ogrnip: vacancy.ogrnip,
    contactPerson: vacancy.contactPerson,
    website: vacancy.website,
    workFormat: vacancy.workFormat,
    schedule: vacancy.schedule,
    requirements: vacancy.requirements,
    responsibilities: vacancy.responsibilities,
    conditions: vacancy.conditions,
    placementRightConfirmed: vacancy.placementRightConfirmed,
    images: vacancy.images,
    status: vacancyStatusLabel(vacancy.status),
    createdAt: vacancy.createdAt ?? vacancy.publishedAt ?? new Date().toISOString(),
  };
}

function mergeServerVacancyIntoPublication(item: DemoPublication, serverVacancy: Partial<JobVacancy>) {
  return {
    ...item,
    address: serverVacancy.address ?? item.address,
    city: serverVacancy.city ?? item.city,
    conditions: serverVacancy.conditions ?? item.conditions,
    contactPerson: serverVacancy.contactPerson ?? item.contactPerson,
    description: serverVacancy.description ?? item.description,
    email: serverVacancy.email ?? item.email,
    employerType: serverVacancy.employerType ?? item.employerType,
    hasMapPoint: serverVacancy.hasMapPoint ?? item.hasMapPoint,
    images: serverVacancy.images?.length ? serverVacancy.images : item.images,
    inn: serverVacancy.inn ?? item.inn,
    lat: serverVacancy.lat ?? item.lat,
    lng: serverVacancy.lng ?? item.lng,
    messengerUrl: serverVacancy.messengerUrl ?? item.messengerUrl,
    ogrn: serverVacancy.ogrn ?? item.ogrn,
    ogrnip: serverVacancy.ogrnip ?? item.ogrnip,
    phone: serverVacancy.phone ?? item.phone,
    placementRightConfirmed: serverVacancy.placementRightConfirmed ?? item.placementRightConfirmed,
    price: serverVacancy.salary ?? item.price,
    profession: serverVacancy.profession ?? item.profession,
    requirements: serverVacancy.requirements ?? item.requirements,
    responsibilities: serverVacancy.responsibilities ?? item.responsibilities,
    schedule: serverVacancy.schedule ?? item.schedule,
    showExactAddress: serverVacancy.showExactAddress ?? item.showExactAddress,
    status: serverVacancy.status ? vacancyStatusLabel(serverVacancy.status) : item.status,
    subtitle: serverVacancy.organization ?? item.subtitle,
    title: serverVacancy.title ?? item.title,
    website: serverVacancy.website ?? item.website,
    workFormat: serverVacancy.workFormat ?? item.workFormat,
  };
}

function mergeStoredVacancyWithInitial(storedVacancy?: DemoPublication, initialVacancy?: JobVacancy) {
  const initialPublication = initialVacancy ? initialToPublication(initialVacancy) : undefined;

  if (!storedVacancy) {
    return initialPublication;
  }

  if (!initialPublication) {
    return storedVacancy;
  }

  return {
    ...initialPublication,
    ...storedVacancy,
    history: storedVacancy.history ?? initialPublication.history,
    images: storedVacancy.images?.length ? storedVacancy.images : initialPublication.images,
    ownerKey: storedVacancy.ownerKey,
    ownerName: storedVacancy.ownerName,
    placementRightConfirmed: storedVacancy.placementRightConfirmed ?? initialPublication.placementRightConfirmed,
  };
}

function readRawValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function readCoordinate(formData: FormData, name: string) {
  const rawValue = readRawValue(formData, name);

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function hasSelectedMapPoint(formData: FormData) {
  return readRawValue(formData, "locationMode") === "exact" && readRawValue(formData, "mapPointSelected") === "1";
}

function normalizeEmployerType(value?: string) {
  return value === "private" ? "person" : value;
}

function readExistingPhotos(formData: FormData) {
  return formData.getAll("existingPhotos").flatMap((value) => {
    const photo = String(value ?? "").trim();

    return photo ? [photo] : [];
  }).slice(0, 12);
}

async function readLocalImageReferences(formData: FormData) {
  const files = formData
    .getAll("photos")
    .filter((item): item is File => item instanceof File && item.size > 0 && item.type.startsWith("image/"))
    .slice(0, 12);
  const storedImages = await Promise.allSettled(files.map((file) => storeMediaFile(file)));

  return [...readExistingPhotos(formData), ...storedImages.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))];
}

function isPendingPaymentStatus(status?: string) {
  const normalized = status?.trim().toLowerCase();
  return normalized === "ждет оплаты" || normalized === "ожидает оплату" || normalized === "pending_payment";
}

function isDraftStatus(status?: string) {
  const normalized = status?.trim().toLowerCase();
  return normalized === "черновик" || normalized === "draft";
}

function readEmailOrMessengerEmail(formData: FormData) {
  const value = readRawValue(formData, "emailOrMessenger");

  return value.includes("@") && !value.startsWith("@") && !value.startsWith("http") ? value : "";
}

function readEmailOrMessengerUrl(formData: FormData) {
  const value = readRawValue(formData, "emailOrMessenger");

  return value && !readEmailOrMessengerEmail(formData) ? value : readRawValue(formData, "messengerUrl");
}

export function VacancyEditClient({ initialVacancy, vacancyId }: VacancyEditClientProps) {
  const [storedItems, setStoredItems] = useState<DemoPublication[]>([]);
  const [message, setMessage] = useState("");
  const [savingAction, setSavingAction] = useState<"save" | "">("");

  useEffect(() => {
    setStoredItems(readStoredPublications());
  }, []);

  const storedVacancy = useMemo(() => storedItems.find((item) => item.type === "vacancy" && item.id === vacancyId), [storedItems, vacancyId]);
  const vacancy = useMemo(() => mergeStoredVacancyWithInitial(storedVacancy, initialVacancy), [initialVacancy, storedVacancy]);
  const canPersist = Boolean(storedVacancy);

  async function saveVacancy(form: HTMLFormElement, status: string, options: { validate?: boolean } = {}) {
    if (!vacancy) {
      setSavingAction("");
      return;
    }

    if (options.validate !== false && !form.reportValidity()) {
      setSavingAction("");
      return;
    }

    const formData = new FormData(form);
    const identity = await resolveAuthenticatedClientUserIdentity();
    const employerType = normalizeEmployerType(readRawValue(formData, "employerType") || vacancy.employerType);
    const email = employerType === "person" ? "" : readEmailOrMessengerEmail(formData);
    const messengerUrl = employerType === "person" ? readRawValue(formData, "messengerUrl") : readEmailOrMessengerUrl(formData);
    const requisites = normalizeVacancyRequisites({
      employerType,
      inn: readRawValue(formData, "inn"),
      ogrn: readRawValue(formData, "ogrn"),
      ogrnip: readRawValue(formData, "ogrnip"),
    });
    const requisitesError = validateVacancyRequisites(requisites, { requireInn: true });

    if (requisitesError) {
      setMessage(requisitesError);
      setSavingAction("");
      return;
    }

    const exactMapPoint = hasSelectedMapPoint(formData);
    const updatedVacancy: DemoPublication = {
      ...vacancy,
      id: canPersist || isUuid(vacancy.id) ? vacancy.id : `demo-vacancy-${Date.now().toString(36)}`,
      ownerKey: identity.ownerKey,
      ownerName: identity.name,
      title: readRawValue(formData, "title"),
      subtitle: readRawValue(formData, "organization"),
      city: readRawValue(formData, "city") || vacancy.city,
      price: normalizeListingPrice(readRawValue(formData, "salary")),
      description: readRawValue(formData, "description"),
      status,
      profession: readRawValue(formData, "profession") || readRawValue(formData, "title"),
      employerType: requisites.employerType,
      inn: requisites.inn,
      ogrn: requisites.ogrn,
      ogrnip: requisites.ogrnip,
      contactPerson: readRawValue(formData, "contactPerson"),
      website: readRawValue(formData, "website"),
      schedule: readRawValue(formData, "schedule"),
      workFormat: readRawValue(formData, "workFormat"),
      requirements: readRawValue(formData, "requirements"),
      responsibilities: readRawValue(formData, "responsibilities"),
      conditions: readRawValue(formData, "conditions"),
      placementRightConfirmed: readRawValue(formData, "placementRightConfirmed") === "1",
      phone: readRawValue(formData, "phone"),
      email,
      messengerUrl,
      address: exactMapPoint ? readRawValue(formData, "address") : undefined,
      lat: exactMapPoint ? readCoordinate(formData, "lat") : undefined,
      lng: exactMapPoint ? readCoordinate(formData, "lng") : undefined,
      hasMapPoint: exactMapPoint,
      showExactAddress: exactMapPoint,
      images: await readLocalImageReferences(formData),
    };

    try {
      const uploadedMediaPaths =
        identity.accessToken && isUuid(vacancy.id) && options.validate !== false
          ? await uploadPublicationImageSources(updatedVacancy.images ?? [], "vacancies", identity.accessToken)
          : undefined;

      if (identity.accessToken && isUuid(vacancy.id) && options.validate !== false) {
        const response = await fetch("/api/cabinet/vacancies", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${identity.accessToken}` },
          body: JSON.stringify({
            address: updatedVacancy.address,
            city: updatedVacancy.city,
            clearMedia: !(updatedVacancy.images?.length ?? 0),
            conditions: updatedVacancy.conditions,
            contactPerson: updatedVacancy.contactPerson,
            description: updatedVacancy.description,
            email: updatedVacancy.email,
            employerType: updatedVacancy.employerType,
            id: vacancy.id,
            inn: updatedVacancy.inn,
            lat: updatedVacancy.lat,
            lng: updatedVacancy.lng,
            mediaPaths: uploadedMediaPaths,
            messengerUrl: updatedVacancy.messengerUrl,
            ogrn: updatedVacancy.ogrn,
            ogrnip: updatedVacancy.ogrnip,
            organization: updatedVacancy.subtitle,
            placementRightConfirmed: updatedVacancy.placementRightConfirmed,
            phone: updatedVacancy.phone,
            profession: updatedVacancy.profession,
            requirements: updatedVacancy.requirements,
            responsibilities: updatedVacancy.responsibilities,
            salary: updatedVacancy.price,
            schedule: updatedVacancy.schedule,
            title: updatedVacancy.title,
            website: updatedVacancy.website,
            workFormat: updatedVacancy.workFormat,
          }),
        });
        const payload = (await response.json().catch(() => null)) as UpdatedVacancyResponse | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Не удалось сохранить вакансию на сервере.");
        }

        if (payload?.vacancy) {
          Object.assign(updatedVacancy, mergeServerVacancyIntoPublication(updatedVacancy, payload.vacancy));
        }
      }

      const updatedWithHistory =
        vacancy.status.trim().toLowerCase() === status.trim().toLowerCase()
          ? appendPublicationHistory(updatedVacancy, "updated", {
              status: updatedVacancy.status,
              description: "Вакансия отредактирована владельцем.",
            })
          : withPublicationStatusHistory({ ...updatedVacancy, status: vacancy.status }, status);
      const nextItems = canPersist ? storedItems.map((item) => (item.id === vacancy.id ? updatedWithHistory : item)) : [withPublicationHistory(updatedVacancy), ...storedItems].slice(0, 50);
      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextItems));
      markCabinetDataChanged();
      window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
      window.location.href = "/cabinet/vakansii";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить изменения. Попробуйте еще раз.");
    } finally {
      setSavingAction("");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSavingAction("save");
    const nextStatus = isDraftStatus(vacancy?.status)
      ? "Черновик"
      : isPendingPaymentStatus(vacancy?.status)
        ? vacancy?.status ?? "Ждет оплаты"
        : vacancy?.status === unpublishedVacancyStatus
          ? unpublishedVacancyStatus
          : "Опубликовано";

    void saveVacancy(event.currentTarget, nextStatus);
  }

  if (!vacancy) {
    return (
      <main className="page-container py-10">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-2xl font-black text-[#060b27]">Вакансия не найдена</h1>
          <p className="mt-2 text-slate-600">Черновики вакансий хранятся в браузере, где они были созданы.</p>
          <BackLink fallbackHref="/cabinet/vakansii" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться к вакансиям
          </BackLink>
        </section>
      </main>
    );
  }

  return (
    <main className="page-container py-10">
      <BackLink fallbackHref="/cabinet/vakansii" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
        Назад
      </BackLink>
      <FormPanel title="Редактировать вакансию" description="Изменения применяются к выбранной вакансии из личного кабинета.">
        <form onSubmit={handleSubmit} className="vacancy-create-form responsive-form-panel grid gap-4" data-vacancy-edit-form>
          <VacancyFormValidator />
          <VacancyEmployerFields
            defaults={{
              contactPerson: vacancy.contactPerson,
              email: vacancy.email,
              employerType: vacancy.employerType,
              inn: vacancy.inn,
              messengerUrl: vacancy.messengerUrl,
              organization: vacancy.subtitle,
              ogrn: vacancy.ogrn,
              ogrnip: vacancy.ogrnip,
              phone: vacancy.phone,
              website: vacancy.website,
            }}
          >
            <div className="vacancy-fields-grid">
              <div className="vacancy-title-field">
                <Field name="title" label="Название" defaultValue={vacancy.title} placeholder="Сантехник" minLength={3} maxLength={90} required />
              </div>
              <Field name="schedule" label="График" defaultValue={vacancy.schedule} placeholder="5/2" maxLength={60} />
              <Field name="workFormat" label="Формат работы" defaultValue={vacancy.workFormat} placeholder="На месте, удаленно, разъездная" minLength={2} maxLength={80} required />
              <Field name="salary" label="Оплата" defaultValue={vacancy.price} placeholder="80000" minLength={2} maxLength={80} required />
            </div>
            <ListingLocationFields
              className="vacancy-location-fields"
              addressLegend="Адрес вакансии"
              cityFieldName="city"
              cityLabel="Город / район"
              defaultAddress={vacancy.showExactAddress ? vacancy.address : undefined}
              defaultCity={vacancy.city}
              defaultLat={vacancy.showExactAddress && vacancy.hasMapPoint ? vacancy.lat : undefined}
              defaultLng={vacancy.showExactAddress && vacancy.hasMapPoint ? vacancy.lng : undefined}
              inlineControls
            />
            <PhotoField
              defaultPhotos={vacancy.images}
              label="Фото работодателя или рабочего места"
              description="Можно оставить текущие фото, удалить лишние или добавить новые. Первое фото будет обложкой вакансии."
              required
              autoOpenCropper={false}
              maxPhotos={12}
            />
            <TextAreaField name="description" label="Описание" defaultValue={vacancy.description} minLength={30} maxLength={1800} required />
            <TextAreaField name="responsibilities" label="Обязанности" defaultValue={vacancy.responsibilities} minLength={20} maxLength={1400} required />
            <TextAreaField name="requirements" label="Требования" defaultValue={vacancy.requirements} minLength={10} maxLength={1400} required />
            <TextAreaField name="conditions" label="Условия" defaultValue={vacancy.conditions} minLength={10} maxLength={1400} required />
            <label className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold leading-5 text-slate-700">
              <input name="placementRightConfirmed" value="1" type="checkbox" defaultChecked={vacancy.placementRightConfirmed !== false} required className="mt-0.5 h-4 w-4 shrink-0 accent-[#0875d1]" />
              <span>Подтверждаю, что имею право размещать эту вакансию и указывать контакты работодателя.</span>
            </label>
          </VacancyEmployerFields>
          {message ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={Boolean(savingAction)} className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0875d1] px-7 font-bold text-white disabled:cursor-wait disabled:bg-slate-300">
              {savingAction === "save" ? "Сохраняем..." : "Сохранить изменения"}
            </button>
            <BackLink fallbackHref="/cabinet/vakansii" className="inline-flex h-12 w-fit items-center justify-center gap-2 rounded-xl border border-slate-300 px-7 font-bold text-slate-800">
              Отмена
            </BackLink>
          </div>
        </form>
      </FormPanel>
    </main>
  );
}
