"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { Field, FormPanel, TextAreaField } from "@/components/FormPanel";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, type DemoPublication } from "@/lib/demo-publications";
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
    phone: request.phone,
    messengerUrl: request.messengerUrl,
    status: request.status === "published" ? "Опубликовано" : request.status,
    createdAt: request.createdAt,
  };
}

function readValue(formData: FormData, name: string, fallback = "") {
  return String(formData.get(name) ?? "").trim() || fallback;
}

export function WorkRequestEditClient({ initialRequest, requestId }: WorkRequestEditClientProps) {
  const [storedItems, setStoredItems] = useState<DemoPublication[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setStoredItems(readStoredPublications());
  }, []);

  const storedRequest = useMemo(() => storedItems.find((item) => item.type === "workRequest" && item.id === requestId), [storedItems, requestId]);
  const request = storedRequest ?? (initialRequest ? initialToPublication(initialRequest) : undefined);
  const canPersist = Boolean(storedRequest);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!request) {
      return;
    }

    if (!canPersist) {
      window.location.href = "/cabinet/zakazy";
      return;
    }

    try {
      const identity = await resolveAuthenticatedClientUserIdentity();
      const formData = new FormData(event.currentTarget);
      const updatedRequest: DemoPublication = {
        ...request,
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        title: readValue(formData, "title", request.title),
        subtitle: readValue(formData, "profession", request.subtitle),
        city: readValue(formData, "city", request.city),
        price: readValue(formData, "budget", request.price ?? "по договоренности"),
        description: readValue(formData, "description", request.description ?? ""),
        phone: readValue(formData, "phone", request.phone ?? ""),
        messengerUrl: readValue(formData, "messengerUrl", request.messengerUrl ?? ""),
        status: readValue(formData, "status", request.status),
      };
      const nextItems = storedItems.map((item) => (item.id === request.id ? updatedRequest : item));
      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextItems));
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
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="title" label="Заголовок заказа" defaultValue={request.title} />
            <Field name="profession" label="Профессия" defaultValue={request.subtitle} />
            <Field name="city" label="Город" defaultValue={request.city} />
            <Field name="budget" label="Бюджет" defaultValue={request.price} />
            <Field name="phone" label="Телефон" defaultValue={request.phone} />
            <Field name="messengerUrl" label="Telegram / WhatsApp" defaultValue={request.messengerUrl} />
            <Field name="status" label="Статус" defaultValue={request.status} />
          </div>
          <TextAreaField name="description" label="Описание задачи" defaultValue={request.description} />
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
