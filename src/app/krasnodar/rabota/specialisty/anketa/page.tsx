import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";

export default function SpecialistProfileFormPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-5 sm:py-10">
        <FormPanel title="Анкета специалиста" description="Создание и редактирование анкеты исполнителя. Анкета появляется в каталоге специалистов без оплаты, отклики на вакансии оплачиваются отдельно.">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2">
            <Field label="Имя / название профиля" placeholder="Александр" />
            <Field label="Регион" placeholder="Краснодарский край" />
            <Field label="Город" placeholder="Краснодар" />
            <Field label="Район / примерная зона" placeholder="Фестивальный район" />
            <Field label="Точный адрес (не показывается публично)" placeholder="Можно оставить пустым" />
            <Field label="Профессия из классификатора" placeholder="Сантехник" />
            <Field label="Стоимость работ" placeholder="от 1 500 ₽" />
            <Field label="Телефон" placeholder="+7..." />
            <Field label="Email" type="email" placeholder="name@example.ru" />
            <Field label="Telegram / WhatsApp" placeholder="https://..." />
            <Field label="Широта примерной зоны" placeholder="45.056" />
            <Field label="Долгота примерной зоны" placeholder="38.958" />
          </div>
          <PhotoField label="Фото специалиста и работ" description="Добавьте портфолио, фото выполненных работ или рабочей зоны. В демо файлы выбираются локально, без загрузки на сервер." />
          <TextAreaField label="Навыки" placeholder="Монтаж, ремонт, замена" />
          <TextAreaField label="О себе и опыт работы" />
          <Link href="/cabinet/specialist" className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#0875d1] px-5 text-sm font-bold text-white sm:h-12 sm:w-fit sm:px-7 sm:text-base">
            Сохранить анкету
          </Link>
        </FormPanel>
      </main>
    </>
  );
}
