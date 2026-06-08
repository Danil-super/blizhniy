"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { Field, FormPanel, TextAreaField } from "@/components/FormPanel";
import { resolveAuthenticatedClientUserIdentity } from "@/lib/client-user-profile";
import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, type DemoPublication } from "@/lib/demo-publications";
import type { JobVacancy } from "@/lib/types";

type VacancyEditClientProps = {
  initialVacancy?: JobVacancy;
  vacancyId: string;
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
    workFormat: vacancy.workFormat,
    schedule: vacancy.schedule,
    requirements: vacancy.requirements,
    responsibilities: vacancy.responsibilities,
    conditions: vacancy.conditions,
    status: vacancy.status === "published" ? "Опубликовано" : vacancy.status,
    createdAt: vacancy.createdAt ?? vacancy.publishedAt ?? new Date().toISOString(),
  };
}

function readRawValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export function VacancyEditClient({ initialVacancy, vacancyId }: VacancyEditClientProps) {
  const [storedItems, setStoredItems] = useState<DemoPublication[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setStoredItems(readStoredPublications());
  }, []);

  const storedVacancy = useMemo(() => storedItems.find((item) => item.type === "vacancy" && item.id === vacancyId), [storedItems, vacancyId]);
  const vacancy = storedVacancy ?? (initialVacancy ? initialToPublication(initialVacancy) : undefined);
  const canPersist = Boolean(storedVacancy);

  async function saveVacancy(form: HTMLFormElement, status: string) {
    if (!vacancy) {
      return;
    }

    const formData = new FormData(form);
    const identity = await resolveAuthenticatedClientUserIdentity();
    const updatedVacancy: DemoPublication = {
      ...vacancy,
      id: canPersist ? vacancy.id : `demo-vacancy-${Date.now().toString(36)}`,
      ownerKey: identity.ownerKey,
      ownerName: identity.name,
      title: readRawValue(formData, "title"),
      subtitle: readRawValue(formData, "organization"),
      city: readRawValue(formData, "city"),
      price: readRawValue(formData, "salary"),
      description: readRawValue(formData, "description"),
      status,
      schedule: readRawValue(formData, "schedule"),
      workFormat: readRawValue(formData, "workFormat"),
      requirements: readRawValue(formData, "requirements"),
      responsibilities: readRawValue(formData, "responsibilities"),
      conditions: readRawValue(formData, "conditions"),
      phone: readRawValue(formData, "phone"),
      email: readRawValue(formData, "email"),
    };

    try {
      const nextItems = canPersist ? storedItems.map((item) => (item.id === vacancy.id ? updatedVacancy : item)) : [updatedVacancy, ...storedItems].slice(0, 50);
      window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(nextItems));
      window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
      window.location.href = "/cabinet/vakansii";
    } catch {
      setMessage("Не удалось сохранить изменения. Попробуйте еще раз.");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveVacancy(event.currentTarget, "Опубликовано");
  }

  function handleSaveDraft() {
    const form = document.querySelector<HTMLFormElement>("[data-vacancy-edit-form]");

    if (!form) {
      return;
    }

    void saveVacancy(form, "Черновик");
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
        <form onSubmit={handleSubmit} className="grid gap-4" data-vacancy-edit-form>
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="organization" label="Организация" defaultValue={vacancy.subtitle} placeholder="ООО РемДом" />
            <Field name="title" label="Вакансия" defaultValue={vacancy.title} placeholder="Сантехник" />
            <Field name="city" label="Город" defaultValue={vacancy.city} placeholder="Краснодар" />
            <Field name="salary" label="Оплата" defaultValue={vacancy.price} placeholder="по договоренности" />
            <Field name="schedule" label="График" defaultValue={vacancy.schedule} placeholder="5/2" />
            <Field name="workFormat" label="Формат работы" defaultValue={vacancy.workFormat} placeholder="На месте, удаленно, разъездная" />
            <Field name="phone" label="Телефон" defaultValue={vacancy.phone} placeholder="+7..." />
            <Field name="email" label="Email" type="email" defaultValue={vacancy.email} placeholder="hr@example.ru" />
          </div>
          <TextAreaField name="description" label="Описание" defaultValue={vacancy.description} />
          <TextAreaField name="responsibilities" label="Обязанности" defaultValue={vacancy.responsibilities} />
          <TextAreaField name="requirements" label="Требования" defaultValue={vacancy.requirements} />
          <TextAreaField name="conditions" label="Условия" defaultValue={vacancy.conditions} />
          {message ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={handleSaveDraft} className="inline-flex h-12 w-fit items-center justify-center rounded-xl border border-slate-300 bg-white px-7 font-bold text-slate-800">
              Сохранить черновик
            </button>
            <button type="submit" className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0875d1] px-7 font-bold text-white">
              Сохранить изменения
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
