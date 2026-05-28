import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminDemoPublishButton } from "@/components/AdminDemoPublishButton";
import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";
import { createSpecialist } from "@/lib/mock-store";

type PageProps = {
  searchParams?: Promise<{ admin?: string }>;
};

export default async function SpecialistProfileFormPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1";

  async function publishSpecialistWithoutPaymentAction(formData: FormData) {
    "use server";

    createSpecialist({
      name: String(formData.get("name") ?? "").trim() || "Новый специалист",
      profession: String(formData.get("profession") ?? "").trim() || "Специалист",
      city: String(formData.get("city") ?? "").trim() || "Краснодар",
      district: String(formData.get("district") ?? "").trim() || undefined,
      address: String(formData.get("address") ?? "").trim() || undefined,
      price: String(formData.get("price") ?? "").trim() || undefined,
      phone: String(formData.get("phone") ?? "").trim() || undefined,
      messengerUrl: String(formData.get("messengerUrl") ?? "").trim() || undefined,
      skills: String(formData.get("skills") ?? "").trim() || undefined,
    });

    redirect("/cabinet/specialist");
  }

  return (
    <>
      <SiteHeader />
      <main className="page-container py-5 sm:py-10">
        <FormPanel title="Анкета специалиста" description="Создание и редактирование анкеты исполнителя. Анкета появляется в каталоге специалистов без оплаты, отклики на вакансии оплачиваются отдельно.">
          <form action={adminMode ? publishSpecialistWithoutPaymentAction : undefined} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2">
            <Field name="name" label="Имя / название профиля" placeholder="Александр" />
            <Field label="Регион" placeholder="Краснодарский край" />
            <Field name="city" label="Город" placeholder="Краснодар" />
            <Field name="district" label="Район / примерная зона" placeholder="Фестивальный район" />
            <Field name="address" label="Точный адрес (не показывается публично)" placeholder="Можно оставить пустым" />
            <Field name="profession" label="Профессия из классификатора" placeholder="Сантехник" />
            <Field name="price" label="Стоимость работ" placeholder="от 1 500 ₽" />
            <Field name="phone" label="Телефон" placeholder="+7..." />
            <Field name="email" label="Email" type="email" placeholder="name@example.ru" />
            <Field name="messengerUrl" label="Telegram / WhatsApp" placeholder="https://..." />
            <Field label="Широта примерной зоны" placeholder="45.056" />
            <Field label="Долгота примерной зоны" placeholder="38.958" />
          </div>
          <PhotoField label="Фото специалиста и работ" description="Добавьте портфолио, фото выполненных работ или рабочей зоны. В демо файлы выбираются локально, без загрузки на сервер." />
          <TextAreaField name="skills" label="Навыки" placeholder="Монтаж, ремонт, замена" />
          <TextAreaField label="О себе и опыт работы" />
          {adminMode ? (
            <AdminDemoPublishButton publicationType="specialist" returnHref="/cabinet/specialist" label="Сохранить анкету" />
          ) : (
            <Link href="/cabinet/specialist" className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#0875d1] px-5 text-sm font-bold text-white sm:h-12 sm:w-fit sm:px-7 sm:text-base">
              Сохранить анкету
            </Link>
          )}
          </form>
        </FormPanel>
      </main>
    </>
  );
}
