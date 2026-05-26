import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";

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
          <PhotoField label="Фото задачи или объекта" description="Добавьте фото помещения, вещи, поломки или примера результата. Это поможет исполнителю быстрее оценить заказ." />
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="font-black text-[#060b27]">Оплата в конце сценария</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Для демо заказ сохраняется без списания денег. Если заказчик утвердит платное размещение заказов, здесь появится переход к тестовой оплате по тарифу.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/cabinet/zakazy" className="inline-flex h-12 items-center justify-center rounded-xl bg-[#0875d1] px-7 font-bold text-white">
              Сохранить заказ
            </Link>
            <Link href="/tarify" className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-7 font-bold text-slate-800">
              Посмотреть тарифы
            </Link>
          </div>
        </FormPanel>
      </main>
    </>
  );
}
