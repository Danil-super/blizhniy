"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { Field, FormPanel, TextAreaField } from "@/components/FormPanel";
import { markCabinetDataChanged } from "@/lib/cabinet-data-cache";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { appendPublicationHistory, demoPublicationsStorageKey, demoPublicationsUpdatedEvent, withPublicationStatusHistory, type DemoPublication } from "@/lib/demo-publications";

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

export function SpecialistEditClient({ specialistId }: { specialistId: string }) {
  const [storedItems, setStoredItems] = useState<DemoPublication[]>([]);
  const [message, setMessage] = useState("");

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
      const updatedSpecialist: DemoPublication = {
        ...specialist,
        ownerKey: identity.ownerKey,
        ownerName: identity.name,
        title: readValue(formData, "name", specialist.title),
        subtitle: readValue(formData, "profession", specialist.subtitle),
        city: readValue(formData, "city", specialist.city),
        price: readValue(formData, "price", specialist.price ?? "по договоренности"),
        description: readValue(formData, "description", specialist.description ?? ""),
        phone: readValue(formData, "phone", specialist.phone ?? ""),
        email: readValue(formData, "email", specialist.email ?? ""),
        messengerUrl: readValue(formData, "messengerUrl", specialist.messengerUrl ?? ""),
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
          <h1 className="text-2xl font-black text-[#060b27]">Анкета не найдена</h1>
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
              <Field name="name" label="Имя / название профиля" defaultValue={specialist.title} />
            </div>
            <div className="specialist-primary-profession">
              <Field name="profession" label="Профессия" defaultValue={specialist.subtitle} />
            </div>
            <div className="specialist-primary-price">
              <Field name="price" label="Стоимость работ" defaultValue={specialist.price} />
            </div>
            <div className="specialist-primary-phone">
              <Field name="phone" label="Телефон" defaultValue={specialist.phone} />
            </div>
            <div className="specialist-primary-email">
              <Field name="email" label="Email" type="email" defaultValue={specialist.email} />
            </div>
            <div className="specialist-primary-messenger">
              <Field name="messengerUrl" label="Telegram / WhatsApp" defaultValue={specialist.messengerUrl} />
            </div>
          </div>
          <div className="responsive-field-grid">
            <Field name="city" label="Город" defaultValue={specialist.city} />
            <Field name="status" label="Статус" defaultValue={specialist.status} placeholder="Опубликовано или Черновик" />
          </div>
          <TextAreaField name="description" label="О себе и опыт работы" defaultValue={specialist.description} />
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
