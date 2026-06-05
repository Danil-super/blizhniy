import { redirect } from "next/navigation";
import { AdminDemoPublishButton } from "@/components/AdminDemoPublishButton";
import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, TextAreaField } from "@/components/FormPanel";
import { createVacancy } from "@/lib/mock-store";
import { TurnstileVerifiedLinkButton } from "@/components/TurnstileVerifiedLinkButton";
import { ListingLocationFields } from "@/components/listings/ListingFormControls";
import { TURNSTILE_ERROR_MESSAGE, verifyTurnstileFormData } from "@/lib/turnstile";

type PageProps = {
  searchParams?: Promise<{ admin?: string; error?: string }>;
};

function parseCoordinate(formData: FormData, name: string) {
  const rawValue = String(formData.get(name) ?? "").trim();

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

export default async function CreateVacancyPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1";

  async function publishVacancyWithoutPaymentAction(formData: FormData) {
    "use server";

    const captchaVerified = await verifyTurnstileFormData(formData);

    if (!captchaVerified) {
      redirect(`/blizhniy/rabota/vakansii/sozdat?admin=1&error=${encodeURIComponent(TURNSTILE_ERROR_MESSAGE)}`);
    }

    createVacancy({
      organization: String(formData.get("organization") ?? "").trim() || "Организация",
      title: String(formData.get("title") ?? "").trim() || "Новая вакансия",
      profession: String(formData.get("profession") ?? "").trim() || "Специалист",
      city: String(formData.get("location") ?? "").trim().split(",")[0]?.trim() || "Краснодар",
      address: String(formData.get("locationMode") ?? "") === "exact" && String(formData.get("mapPointSelected") ?? "") === "1" ? String(formData.get("address") ?? "").trim() || undefined : undefined,
      salary: String(formData.get("salary") ?? "").trim() || undefined,
      phone: String(formData.get("phone") ?? "").trim() || undefined,
      email: String(formData.get("email") ?? "").trim() || undefined,
      schedule: String(formData.get("schedule") ?? "").trim() || undefined,
      description: String(formData.get("description") ?? "").trim() || undefined,
      lat: String(formData.get("locationMode") ?? "") === "exact" && String(formData.get("mapPointSelected") ?? "") === "1" ? parseCoordinate(formData, "lat") : undefined,
      lng: String(formData.get("locationMode") ?? "") === "exact" && String(formData.get("mapPointSelected") ?? "") === "1" ? parseCoordinate(formData, "lng") : undefined,
      hasMapPoint: String(formData.get("locationMode") ?? "") === "exact" && String(formData.get("mapPointSelected") ?? "") === "1",
    });

    redirect("/cabinet/vakansii");
  }

  return (
    <>
      <SiteHeader />
      <main className="page-container py-4 sm:py-6 lg:py-8">
        <FormPanel
          title="Разместить вакансию"
          description={
            adminMode
              ? "Админ-режим для тестирования: вакансию можно сохранить без оплаты."
              : "После заполнения создается заказ на оплату тарифа размещения вакансии. После оплаты вакансия будет опубликована."
          }
        >
          {params?.error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{params.error}</p> : null}
          <form action={adminMode ? publishVacancyWithoutPaymentAction : undefined} className="vacancy-create-form responsive-form-panel grid gap-3 sm:gap-3.5">
            <div className="vacancy-fields-grid">
              <div className="vacancy-organization-field">
                <Field name="organization" label="Организация" placeholder="ООО РемДом" />
              </div>
              <div className="vacancy-title-field">
                <Field name="title" label="Вакансия" placeholder="Сантехник" />
              </div>
              <div className="vacancy-salary-field">
                <Field name="salary" label="Зарплата / стоимость" placeholder="от 80 000 ₽" />
              </div>
              <div className="vacancy-schedule-field">
                <Field name="schedule" label="График" placeholder="5/2" />
              </div>
              <div className="vacancy-phone-field">
                <Field name="phone" label="Телефон" placeholder="+7..." />
              </div>
              <div className="vacancy-email-field">
                <Field name="email" label="Email" type="email" placeholder="hr@example.ru" />
              </div>
            </div>
            <ListingLocationFields className="vacancy-location-fields" addressLegend="Адрес вакансии" defaultCity="Краснодар" inlineControls />
            <TextAreaField name="description" label="Описание вакансии" />
            <TextAreaField label="Требования" />
            <TextAreaField label="Обязанности" />
            {adminMode ? (
              <AdminDemoPublishButton publicationType="vacancy" returnHref="/cabinet/vakansii" label="Сохранить вакансию без оплаты" />
            ) : (
              <TurnstileVerifiedLinkButton
                href="/blizhniy/oplata/vacancy-publication"
                className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0aa337] px-7 font-bold text-white transition hover:bg-[#078a2e] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Создать заказ и оплатить
              </TurnstileVerifiedLinkButton>
            )}
          </form>
        </FormPanel>
      </main>
    </>
  );
}
