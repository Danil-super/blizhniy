import { redirect } from "next/navigation";
import { Buffer } from "node:buffer";
import { AdminDemoPublishButton } from "@/components/AdminDemoPublishButton";
import { DropdownSelect } from "@/components/DropdownSelect";
import { SiteHeader } from "@/components/SiteHeader";
import { YandexMapPicker } from "@/components/YandexMapPicker";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";
import { professions } from "@/lib/data";
import { getCurrentUserSpecialist, getSpecialistById, updateSpecialist, upsertCurrentUserSpecialist } from "@/lib/mock-store";

type PageProps = {
  searchParams?: Promise<{ admin?: string; from?: string }>;
};

function parseCoordinate(formData: FormData, name: string) {
  const value = Number(String(formData.get(name) ?? "").replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

async function readPhotoDataUrls(formData: FormData) {
  const existingPhotos = formData
    .getAll("existingPhotos")
    .map((value) => String(value))
    .filter(Boolean);
  const files = formData
    .getAll("photos")
    .filter((file): file is File => file instanceof File && file.size > 0 && file.type.startsWith("image/"))
    .slice(0, 12 - existingPhotos.length);
  const uploadedPhotos = await Promise.all(
    files.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      return `data:${file.type};base64,${buffer.toString("base64")}`;
    })
  );

  return [...existingPhotos, ...uploadedPhotos].slice(0, 12);
}

export default async function SpecialistProfileFormPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  const adminMode = params?.admin === "1";
  const selectedSpecialist = params?.from ? getSpecialistById(params.from) : getCurrentUserSpecialist();
  const professionOptions = professions
    .filter((profession) => profession.active)
    .map((profession) => ({
      value: profession.name,
      label: `${profession.name} · ${profession.parent}`,
    }));

  async function publishSpecialistWithoutPaymentAction(formData: FormData) {
    "use server";

    const specialistId = String(formData.get("specialistId") ?? "").trim();
    const specialistInput = {
      name: String(formData.get("name") ?? "").trim() || "Новый специалист",
      profession: String(formData.get("profession") ?? "").trim() || "Специалист",
      city: String(formData.get("city") ?? "").trim() || "Краснодар",
      district: undefined,
      address: String(formData.get("address") ?? "").trim() || undefined,
      price: String(formData.get("price") ?? "").trim() || undefined,
      phone: String(formData.get("phone") ?? "").trim() || undefined,
      email: String(formData.get("email") ?? "").trim() || undefined,
      messengerUrl: String(formData.get("messengerUrl") ?? "").trim() || undefined,
      skills: String(formData.get("skills") ?? "").trim() || undefined,
      description: String(formData.get("description") ?? "").trim() || undefined,
      images: await readPhotoDataUrls(formData),
      lat: parseCoordinate(formData, "lat"),
      lng: parseCoordinate(formData, "lng"),
    };

    if (specialistId) {
      updateSpecialist(specialistId, specialistInput);
    } else {
      upsertCurrentUserSpecialist(specialistInput);
    }

    redirect("/cabinet/specialist");
  }

  return (
    <>
      <SiteHeader />
      <main className="page-container specialist-form-container py-5 sm:py-10">
        <FormPanel
          title={selectedSpecialist ? "Редактировать анкету специалиста" : "Анкета специалиста"}
          description="Создание и редактирование анкеты исполнителя. Анкета появляется в каталоге специалистов без оплаты, отклики на вакансии оплачиваются отдельно."
        >
          <form action={publishSpecialistWithoutPaymentAction} className="responsive-form-panel grid gap-4">
          <div className="responsive-field-grid">
            {selectedSpecialist ? <input type="hidden" name="specialistId" value={selectedSpecialist.id} /> : null}
            <input type="hidden" name="city" value={selectedSpecialist?.city ?? "Краснодар"} />
            <Field name="name" label="Имя / название профиля" placeholder="Александр" defaultValue={selectedSpecialist?.name} />
            <label className="grid min-w-0 gap-1.5 text-xs font-bold leading-4 text-slate-700 sm:gap-2 sm:text-sm">
              <span className="line-clamp-2">Профессия из классификатора</span>
              <DropdownSelect name="profession" defaultValue={selectedSpecialist?.profession} placeholder="Выбрать" options={professionOptions} />
            </label>
            <Field name="price" label="Стоимость работ" placeholder="от 1 500 ₽" defaultValue={selectedSpecialist?.price} />
            <Field name="phone" label="Телефон" placeholder="+7-(999)-999-99-99" defaultValue={selectedSpecialist?.phone} />
            <Field name="email" label="Email" type="email" placeholder="name@example.ru" defaultValue={selectedSpecialist?.email} />
            <Field name="messengerUrl" label="Telegram / WhatsApp" placeholder="https://..." defaultValue={selectedSpecialist?.messengerUrl} />
          </div>
          <YandexMapPicker defaultAddress={selectedSpecialist?.address} defaultLat={selectedSpecialist?.lat} defaultLng={selectedSpecialist?.lng} />
          <PhotoField defaultPhotos={selectedSpecialist?.images} label="Фото специалиста и работ" description="Добавьте портфолио, фото выполненных работ или рабочей зоны. В демо файлы выбираются локально, без загрузки на сервер." />
          <TextAreaField name="skills" label="Навыки" placeholder="Монтаж, ремонт, замена" defaultValue={selectedSpecialist?.skills} />
          <TextAreaField name="description" label="О себе и опыт работы" placeholder="Расскажите об опыте, подходе к работе, гарантиях и условиях выезда" defaultValue={selectedSpecialist?.description} />
          {adminMode ? (
            <AdminDemoPublishButton publicationType="specialist" returnHref="/cabinet/specialist" label="Сохранить анкету" />
          ) : (
            <button type="submit" className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#0875d1] px-5 text-sm font-bold text-white sm:h-12 sm:w-fit sm:px-7 sm:text-base">
              Сохранить анкету
            </button>
          )}
          </form>
        </FormPanel>
      </main>
    </>
  );
}
