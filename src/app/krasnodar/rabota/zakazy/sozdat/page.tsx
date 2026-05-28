import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminDemoPublishButton } from "@/components/AdminDemoPublishButton";
import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";
import { createWorkRequest } from "@/lib/mock-store";

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

export default async function CreateWorkRequestPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1";

  async function publishWorkRequestWithoutPaymentAction(formData: FormData) {
    "use server";

    createWorkRequest({
      author: String(formData.get("author") ?? "").trim() || "Пользователь",
      title: String(formData.get("title") ?? "").trim() || "Новый заказ исполнителю",
      profession: String(formData.get("profession") ?? "").trim() || "Специалист",
      city: String(formData.get("city") ?? "").trim() || "Краснодар",
      district: String(formData.get("district") ?? "").trim() || undefined,
      budget: String(formData.get("budget") ?? "").trim() || undefined,
      phone: String(formData.get("phone") ?? "").trim() || undefined,
      messengerUrl: String(formData.get("messengerUrl") ?? "").trim() || undefined,
      description: String(formData.get("description") ?? "").trim() || undefined,
    });

    redirect("/cabinet/zakazy");
  }

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <FormPanel
          title="Разместить заказ исполнителю"
          description={
            adminMode
              ? "Админ-режим: заказ можно разместить без оплаты, чтобы проверить отображение в кабинете."
              : "Опишите задачу для специалистов. В демо заказ сохраняется как черновик в разделе заказов кабинета."
          }
        >
          <form action={adminMode ? publishWorkRequestWithoutPaymentAction : undefined} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="author" label="Ваше имя" placeholder="Ольга" />
            <Field name="city" label="Город" placeholder="Краснодар" />
            <Field name="district" label="Район / ориентир" placeholder="Прикубанский округ" />
            <Field name="profession" label="Профессия" placeholder="Мастер ремонта квартир" />
            <Field name="budget" label="Бюджет" placeholder="до 25 000 ₽" />
            <Field name="phone" label="Телефон" placeholder="+7..." />
            <Field name="messengerUrl" label="Telegram / WhatsApp" placeholder="@username или ссылка" />
          </div>
          <Field name="title" label="Заголовок заказа" placeholder="Нужен мастер для ремонта кухни" />
          <TextAreaField name="description" label="Описание задачи" placeholder="Что нужно сделать, сроки, условия выезда" />
          <PhotoField label="Фото задачи или объекта" description="Добавьте фото помещения, вещи, поломки или примера результата. Это поможет исполнителю быстрее оценить заказ." />
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="font-black text-[#060b27]">Оплата в конце сценария</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Для демо заказ сохраняется без списания денег. Если заказчик утвердит платное размещение заказов, здесь появится переход к тестовой оплате по тарифу.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {adminMode ? (
              <AdminDemoPublishButton publicationType="workRequest" returnHref="/cabinet/zakazy" label="Сохранить заказ" />
            ) : (
              <Link href="/cabinet/zakazy" className="inline-flex h-12 items-center justify-center rounded-xl bg-[#0875d1] px-7 font-bold text-white">
                Сохранить заказ
              </Link>
            )}
            <Link href="/tarify" className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-7 font-bold text-slate-800">
              Посмотреть тарифы
            </Link>
          </div>
          </form>
        </FormPanel>
      </main>
    </>
  );
}
