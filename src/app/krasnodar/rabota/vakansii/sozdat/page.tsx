import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminDemoPublishButton } from "@/components/AdminDemoPublishButton";
import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, TextAreaField } from "@/components/FormPanel";
import { createVacancy } from "@/lib/mock-store";
import { YandexMapPicker } from "@/components/YandexMapPicker";

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

function parseCoordinate(formData: FormData, name: string) {
  const value = Number(String(formData.get(name) ?? "").replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

export default async function CreateVacancyPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1";
  
  async function publishVacancyWithoutPaymentAction(formData: FormData) {
    "use server";

    createVacancy({
      organization: String(formData.get("organization") ?? "").trim() || "Организация",
      title: String(formData.get("title") ?? "").trim() || "Новая вакансия",
      profession: String(formData.get("profession") ?? "").trim() || "Специалист",
      city: String(formData.get("city") ?? "").trim() || "Краснодар",
      district: String(formData.get("district") ?? "").trim() || undefined,
      address: String(formData.get("address") ?? "").trim() || undefined,
      salary: String(formData.get("salary") ?? "").trim() || undefined,
      phone: String(formData.get("phone") ?? "").trim() || undefined,
      email: String(formData.get("email") ?? "").trim() || undefined,
      schedule: String(formData.get("schedule") ?? "").trim() || undefined,
      description: String(formData.get("description") ?? "").trim() || undefined,
      lat: parseCoordinate(formData, "lat"),
      lng: parseCoordinate(formData, "lng"),
    });

    redirect("/cabinet/vakansii");
  }

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <FormPanel
          title="Разместить вакансию"
          description={
            adminMode
              ? "Админ-режим для тестирования: вакансию можно сохранить без оплаты."
              : "После заполнения создается заказ на оплату тарифа размещения вакансии. После оплаты вакансия будет опубликована."
          }
        >
          <form action={adminMode ? publishVacancyWithoutPaymentAction : undefined} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="organization" label="Организация" placeholder="ООО РемДом" />
            <Field name="title" label="Вакансия" placeholder="Сантехник" />
            <Field label="Регион" placeholder="Краснодарский край" />
            <Field name="city" label="Город" placeholder="Краснодар" />
            <Field name="district" label="Район" placeholder="Центральный район" />
            <Field name="address" label="Точный адрес организации" placeholder="ул. Красная, 118" />
            <Field name="salary" label="Зарплата / стоимость" placeholder="от 80 000 ₽" />
            <Field name="profession" label="Категория специалиста" placeholder="Сантехник" />
            <Field name="schedule" label="График" placeholder="5/2" />
            <Field name="phone" label="Телефон" placeholder="+7..." />
            <Field name="email" label="Email" type="email" placeholder="hr@example.ru" />
          </div>
          <YandexMapPicker />
          <TextAreaField name="description" label="Описание вакансии" />
          <TextAreaField label="Требования" />
          <TextAreaField label="Обязанности" />
          {adminMode ? (
            <AdminDemoPublishButton publicationType="vacancy" returnHref="/cabinet/vakansii" label="Сохранить вакансию без оплаты" />
          ) : (
            <Link className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0aa337] px-7 font-bold text-white" href="/blizhniy/oplata/vacancy-publication">
              Создать заказ и оплатить
            </Link>
          )}
          </form>
        </FormPanel>
      </main>
    </>
  );
}
