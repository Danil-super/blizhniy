import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, TextAreaField } from "@/components/FormPanel";

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

export default async function CreateVacancyPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1";

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
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Организация" placeholder="ООО РемДом" />
            <Field label="Вакансия" placeholder="Сантехник" />
            <Field label="Регион" placeholder="Краснодарский край" />
            <Field label="Город" placeholder="Краснодар" />
            <Field label="Район" placeholder="Центральный район" />
            <Field label="Точный адрес организации" placeholder="ул. Красная, 118" />
            <Field label="Зарплата / стоимость" placeholder="от 80 000 ₽" />
            <Field label="Категория специалиста" placeholder="Сантехник" />
            <Field label="График" placeholder="5/2" />
            <Field label="Телефон" placeholder="+7..." />
            <Field label="Email" type="email" placeholder="hr@example.ru" />
            <Field label="Широта" placeholder="45.037" />
            <Field label="Долгота" placeholder="38.975" />
          </div>
          <TextAreaField label="Описание вакансии" />
          <TextAreaField label="Требования" />
          <TextAreaField label="Обязанности" />
          {adminMode ? (
            <Link className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0aa337] px-7 font-bold text-white" href="/cabinet/vakansii">
              Сохранить вакансию без оплаты
            </Link>
          ) : (
            <Link className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0aa337] px-7 font-bold text-white" href="/blizhniy/oplata/vacancy-publication">
              Создать заказ и оплатить
            </Link>
          )}
        </FormPanel>
      </main>
    </>
  );
}
