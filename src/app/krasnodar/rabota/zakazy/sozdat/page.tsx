import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, TextAreaField } from "@/components/FormPanel";

export default function CreateWorkRequestPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <FormPanel title="Разместить заказ исполнителю" description="Опишите задачу для специалистов. В демо заказ сохраняется как черновик в разделе заказов кабинета.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Ваше имя" placeholder="Ольга" />
            <Field label="Город" placeholder="Краснодар" />
            <Field label="Район / ориентир" placeholder="Прикубанский округ" />
            <Field label="Профессия" placeholder="Мастер ремонта квартир" />
            <Field label="Бюджет" placeholder="до 25 000 ₽" />
            <Field label="Телефон" placeholder="+7..." />
            <Field label="Telegram / WhatsApp" placeholder="@username или ссылка" />
          </div>
          <TextAreaField label="Описание задачи" placeholder="Что нужно сделать, сроки, условия выезда" />
          <Link href="/cabinet/zakazy" className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0875d1] px-7 font-bold text-white">
            Сохранить заказ
          </Link>
        </FormPanel>
      </main>
    </>
  );
}
