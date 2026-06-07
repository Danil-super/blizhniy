import { redirect } from "next/navigation";
import { AdminDemoPublishButton } from "@/components/AdminDemoPublishButton";
import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";
import { VacancyEmployerFields } from "@/components/VacancyEmployerFields";
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
      messengerUrl: String(formData.get("messengerUrl") ?? "").trim() || undefined,
      email: String(formData.get("email") ?? "").trim() || undefined,
      schedule: String(formData.get("schedule") ?? "").trim() || undefined,
      description: String(formData.get("description") ?? "").trim() || undefined,
      requirements: String(formData.get("requirements") ?? "").trim() || undefined,
      responsibilities: String(formData.get("responsibilities") ?? "").trim() || undefined,
      employerType: String(formData.get("employerType") ?? "").trim() || undefined,
      inn: String(formData.get("inn") ?? "").trim() || undefined,
      contactPerson: String(formData.get("contactPerson") ?? "").trim() || undefined,
      website: String(formData.get("website") ?? "").trim() || undefined,
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
            <VacancyEmployerFields>
              <div className="vacancy-fields-grid">
                <div className="vacancy-organization-field">
                  <Field name="organization" label="Название работодателя" placeholder="ООО РемДом или Иван Иванов" required />
                </div>
                <div className="vacancy-title-field">
                  <Field name="title" label="Вакансия" placeholder="Сантехник" required />
                </div>
                <div className="vacancy-salary-field">
                  <Field name="salary" label="Зарплата / стоимость" placeholder="от 80 000 ₽" required />
                </div>
                <div className="vacancy-schedule-field">
                  <Field name="schedule" label="График" placeholder="5/2" />
                </div>
                <div className="vacancy-phone-field">
                  <Field name="phone" label="Телефон" placeholder="+7..." required />
                </div>
                <div className="vacancy-email-field">
                  <Field name="email" label="Email" type="email" placeholder="hr@example.ru" />
                </div>
                <Field name="employmentType" label="Занятость" placeholder="Полная, частичная, подработка" />
                <Field name="experience" label="Опыт" placeholder="Без опыта / от 1 года" />
                <Field name="paymentPeriod" label="Выплаты" placeholder="Еженедельно, 2 раза в месяц" />
              </div>
              <PhotoField label="Фото работодателя или рабочего места" description="Обязательное фото: логотип, фасад, рабочее место или реальное фото работодателя. Так соискатели понимают, кто размещает вакансию." required />
              <ListingLocationFields className="vacancy-location-fields" addressLegend="Адрес вакансии" defaultCity="Краснодар" inlineControls />
              <TextAreaField name="description" label="Описание вакансии" placeholder="Коротко расскажите о работе, формате, условиях и команде." required />
              <TextAreaField name="requirements" label="Требования" placeholder="Опыт, документы, навыки, график готовности." />
              <TextAreaField name="responsibilities" label="Обязанности" placeholder="Что нужно делать каждый день." />
              <TextAreaField name="conditions" label="Условия" placeholder="Оформление, выплаты, питание, инструмент, обучение, проживание." />
              <div className="flex flex-wrap gap-3">
                <AdminDemoPublishButton
                  publicationType="vacancy"
                  returnHref="/cabinet/vakansii"
                  label="Сохранить черновик"
                  status="Черновик"
                  requireCaptcha={false}
                  validateForm={false}
                  buttonClassName="inline-flex h-12 w-fit items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 font-bold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-wait disabled:bg-slate-100"
                />
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
              </div>
            </VacancyEmployerFields>
          </form>
        </FormPanel>
      </main>
    </>
  );
}
