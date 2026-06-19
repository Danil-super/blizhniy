"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { CitySelectField } from "@/components/CitySelectField";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";
import { markCabinetDataChanged } from "@/lib/cabinet-data-cache";
import { storeMediaFile } from "@/lib/client-media-store";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { appendPublicationHistory, demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationStatusHistory, type DemoPublication } from "@/lib/demo-publications";
import { normalizeListingPrice } from "@/lib/listing-price";
import type { WorkRequest } from "@/lib/types";

type WorkRequestEditClientProps = {
  initialRequest?: WorkRequest;
  requestId: string;
};

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

function initialToPublication(request: WorkRequest): DemoPublication {
  return {
    id: request.id,
    type: "workRequest",
    title: request.title,
    subtitle: request.profession,
    city: request.city,
    price: request.budget,
    description: request.description,
    lat: request.lat,
    lng: request.lng,
    address: request.address,
    showExactAddress: request.showExactAddress,
    images: request.images,
    phone: request.phone,
    messengerUrl: request.messengerUrl,
    status: request.status === "published" ? "Опубликовано" : request.status,
    createdAt: request.createdAt,
  };
}

function readValue(formData: FormData, name: string, fallback = "") {
  return String(formData.get(name) ?? "").trim() || fallback;
}

function readExistingPhotos(formData: FormData) {
  return formData
    .getAll("existingPhotos")
    .flatMap((value) => {
      const photo = String(value ?? "").trim();

      return photo ? [photo] : [];
    })
    .slice(0, 6);
}

async function readLocalImageReferences(formData: FormData) {
  const files = formData
    .getAll("photos")
    .filter((item): item is File => item instanceof File && item.size > 0 && item.type.startsWith("image/"))
    .slice(0, 6);
  const storedImages = await Promise.allSettled(files.map((file) => storeMediaFile(file)));

  return [...readExistingPhotos(formData), ...storedImages.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))].slice(0, 6);
}

export function WorkRequestEditClient({ initialRequest, requestId }: WorkRequestEditClientProps) {
  const [storedItems, setStoredItems] = useState<DemoPublication[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setStoredItems(readStoredPublications());
  }, []);

  const storedRequest = useMemo(() => storedItems.find((item) => item.type === "workRequest" && item.id === requestId), [storedItems, requestId]);
  const request = storedRequest ?? (initialRequest ? initialToPublication(initialRequest) : undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!request) {
      return;
    }

    if (!form.reportValidity()) {
      return;
    }

    try {
      const identity = await resolveAuthenticatedClientUserIdentity();
      const formData = new FormData(form);
      const phone = readValue(formData, "phone", request.phone ?? "");
      const messengerUrl = readValue(formData, "messengerUrl", request.messengerUrl ?? "");
      const nextStatus = readValue(formData, "status", request.status);
      const images = await readLocalImageReferences(formData);

      if (nextStatus.trim().toLowerCase() !== "черновик" && !phone && !messengerUrl) {
        setMessage("Укажите телефон или мессенджер, чтобы исполнитель мог связаться по заказу.");
        return;
      }

      const updatedRequest: DemoPublication = {
        ...request,
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        title: readValue(formData, "title", request.title),
        subtitle: readValue(formData, "profession", request.subtitle),
        profession: readValue(formData, "profession", request.profession ?? request.subtitle),
        city: readValue(formData, "city", request.city),
        price: normalizeListingPrice(readValue(formData, "budget", request.price ?? ""), "по договоренности"),
        description: readValue(formData, "description", request.description ?? ""),
        images,
        phone,
        messengerUrl,
        status: nextStatus,
      };
      const updatedWithHistory =
        request.status.trim().toLowerCase() === updatedRequest.status.trim().toLowerCase()
          ? appendPublicationHistory(updatedRequest, "updated", {
              status: updatedRequest.status,
              description: "Заказ отредактирован владельцем.",
            })
          : withPublicationStatusHistory({ ...updatedRequest, status: request.status }, updatedRequest.status);
      const nextItems = storedItems.some((item) => item.id === request.id)
        ? storedItems.map((item) => (item.id === request.id ? updatedWithHistory : item))
        : [updatedWithHistory, ...storedItems].slice(0, 50);

      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextItems));
      markCabinetDataChanged();
      window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
      window.location.href = "/cabinet/zakazy";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить изменения. Попробуйте еще раз.");
    }
  }

  if (!request) {
    return (
      <main className="page-container py-10">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-2xl font-black text-[#060b27]">Заказ не найден</h1>
          <p className="mt-2 text-slate-600">Черновики заказов хранятся в браузере, где они были созданы.</p>
          <BackLink fallbackHref="/cabinet/zakazy" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться к заказам
          </BackLink>
        </section>
      </main>
    );
  }

  return (
    <main className="page-container py-10">
      <BackLink fallbackHref="/cabinet/zakazy" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
        Назад
      </BackLink>
      <FormPanel title="Редактировать заказ" description="Изменения применяются к выбранному заказу из личного кабинета.">
        <form onSubmit={handleSubmit} className="responsive-form-panel grid gap-4">
          <div className="responsive-field-grid">
            <Field name="title" label="Заголовок заказа" defaultValue={request.title} maxLength={90} minLength={3} required />
            <Field name="profession" label="Профессия / категория" defaultValue={request.subtitle} maxLength={80} minLength={2} required />
            <CitySelectField name="city" label="Город" defaultValue={request.city} required />
            <Field name="budget" label="Оплата" defaultValue={request.price} maxLength={9} />
            <Field name="phone" label="Телефон" defaultValue={request.phone} />
            <Field name="messengerUrl" label="Telegram / WhatsApp" defaultValue={request.messengerUrl} maxLength={120} />
          </div>
          <input type="hidden" name="status" value={request.status} />
          <TextAreaField name="description" label="Описание задачи" defaultValue={request.description} minLength={30} maxLength={1800} required />
          <PhotoField label="Фото к заказу" description="Можно оставить текущие фото, удалить лишние или добавить новые. Фото необязательны." defaultPhotos={request.images ?? []} maxPhotos={6} autoOpenCropper={false} />
          {message ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0875d1] px-7 font-bold text-white">
              Сохранить изменения
            </button>
            <BackLink fallbackHref="/cabinet/zakazy" className="inline-flex h-12 w-fit items-center justify-center gap-2 rounded-xl border border-slate-300 px-7 font-bold text-slate-800">
              Отмена
            </BackLink>
          </div>
        </form>
      </FormPanel>
    </main>
  );
}
