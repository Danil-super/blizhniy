import { redirect } from "next/navigation";
import { Buffer } from "node:buffer";
import { AdminDemoPublishButton } from "@/components/AdminDemoPublishButton";
import { DropdownSelect } from "@/components/DropdownSelect";
import { SiteHeader } from "@/components/SiteHeader";
import { TurnstileSubmitButton } from "@/components/TurnstileSubmitButton";
import { Field, FormPanel, PhotoField, TextAreaField } from "@/components/FormPanel";
import { ListingLocationFields } from "@/components/listings/ListingFormControls";
import { professions } from "@/lib/data";
import { hasMapCoordinates } from "@/lib/map-location";
import { getCurrentUserSpecialist, getSpecialistById, updateSpecialist, upsertCurrentUserSpecialist } from "@/lib/mock-store";
import { TURNSTILE_ERROR_MESSAGE, verifyTurnstileFormData } from "@/lib/turnstile";

type PageProps = {
  searchParams?: Promise<{ admin?: string; error?: string; from?: string }>;
};

type ValidatedSpecialistForm = {
  address?: string;
  city: string;
  description?: string;
  email: string;
  hasMapPoint: boolean;
  lat?: number;
  lng?: number;
  messengerUrl: string;
  name: string;
  phone: string;
  price: string;
  profession: string;
  skills: string;
};

const specialistNamePattern = /^[A-Za-zА-Яа-яЁё0-9 .-]{2,15}$/;
const pricePattern = /^[0-9A-Za-zА-Яа-яЁё ₽.,/-]{1,12}$/;
const phonePattern = /^\+7-\([0-9]{3}\)-[0-9]{3}-[0-9]{2}-[0-9]{2}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const messengerPattern = /^(@[A-Za-z0-9_]{5,32}|https?:\/\/[^\s]+)$/;

function normalizeText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").replace(/\s+/g, " ").trim();
}

function validationError(message: string) {
  redirect(`/blizhniy/rabota/specialisty/anketa?error=${encodeURIComponent(message)}`);
}

function parseCoordinate(formData: FormData, name: string) {
  const rawValue = String(formData.get(name) ?? "").trim();

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function readCity(formData: FormData) {
  const value = String(formData.get("city") ?? "").trim();
  return value.split(",")[0]?.trim() || "Краснодар";
}

function hasSelectedMapPoint(formData: FormData) {
  return String(formData.get("locationMode") ?? "") === "exact" && String(formData.get("mapPointSelected") ?? "") === "1";
}

function validateSpecialistForm(formData: FormData, activeProfessions: string[]): ValidatedSpecialistForm {
  const name = normalizeText(formData, "name");
  const profession = normalizeText(formData, "profession");
  const city = readCity(formData);
  const price = normalizeText(formData, "price");
  const phone = normalizeText(formData, "phone");
  const email = normalizeText(formData, "email");
  const messengerUrl = normalizeText(formData, "messengerUrl");
  const skills = normalizeText(formData, "skills");
  const description = normalizeText(formData, "description");
  const hasMapPoint = hasSelectedMapPoint(formData);
  const lat = hasMapPoint ? parseCoordinate(formData, "lat") : undefined;
  const lng = hasMapPoint ? parseCoordinate(formData, "lng") : undefined;
  const address = hasMapPoint ? normalizeText(formData, "address") : undefined;

  if (!specialistNamePattern.test(name)) {
    validationError("Имя или название профиля: от 2 до 15 символов, только буквы, цифры, пробел, точка или дефис.");
  }

  if (!activeProfessions.includes(profession)) {
    validationError("Выберите профессию из классификатора.");
  }

  if (!city || city.length > 80) {
    validationError("Укажите город и регион, максимум 80 символов.");
  }

  if (!pricePattern.test(price)) {
    validationError("Стоимость работ: от 1 до 12 символов.");
  }

  if (!phonePattern.test(phone)) {
    validationError("Телефон должен быть в формате +7-(999)-999-99-99.");
  }

  if (email.length > 64 || !emailPattern.test(email)) {
    validationError("Email должен быть корректным и не длиннее 64 символов.");
  }

  if (messengerUrl.length > 64 || !messengerPattern.test(messengerUrl)) {
    validationError("Telegram / WhatsApp: укажите @username или ссылку, максимум 64 символа.");
  }

  if (skills.length < 3 || skills.length > 120) {
    validationError("Навыки: от 3 до 120 символов.");
  }

  if (description.length > 500) {
    validationError("Описание: максимум 500 символов.");
  }

  if (String(formData.get("locationMode") ?? "") === "exact" && (!address || !hasMapCoordinates(lat, lng))) {
    validationError("Для точного адреса поставьте метку на карте.");
  }

  return {
    address,
    city,
    description: description || undefined,
    email,
    hasMapPoint,
    lat,
    lng,
    messengerUrl,
    name,
    phone,
    price,
    profession,
    skills,
  };
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

    if (!specialistId) {
      const captchaVerified = await verifyTurnstileFormData(formData);

      if (!captchaVerified) {
        redirect(`/blizhniy/rabota/specialisty/anketa?error=${encodeURIComponent(TURNSTILE_ERROR_MESSAGE)}`);
      }
    }

    const validated = validateSpecialistForm(formData, professionOptions.map((profession) => profession.value));
    const specialistInput = {
      name: validated.name,
      profession: validated.profession,
      city: validated.city,
      district: undefined,
      address: validated.address,
      price: validated.price,
      phone: validated.phone,
      email: validated.email,
      messengerUrl: validated.messengerUrl,
      skills: validated.skills,
      description: validated.description,
      images: await readPhotoDataUrls(formData),
      lat: validated.lat,
      lng: validated.lng,
      hasMapPoint: validated.hasMapPoint,
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
          {params?.error ? <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{params.error}</p> : null}
          <form action={publishSpecialistWithoutPaymentAction} className="responsive-form-panel grid gap-4">
          <div className="responsive-field-grid specialist-primary-field-grid">
            {selectedSpecialist ? <input type="hidden" name="specialistId" value={selectedSpecialist.id} /> : null}
            <div className="specialist-primary-name">
              <Field
                name="name"
                label="Имя / название профиля"
                placeholder="Александр"
                defaultValue={selectedSpecialist?.name}
                minLength={2}
                maxLength={15}
                pattern={specialistNamePattern.source}
                required
                title="От 2 до 15 символов: буквы, цифры, пробел, точка или дефис."
              />
            </div>
            <label className="specialist-primary-profession grid min-w-0 gap-1.5 text-xs font-bold leading-4 text-slate-700 sm:gap-2 sm:text-sm">
              <span className="line-clamp-2">Профессия из классификатора</span>
              <DropdownSelect name="profession" defaultValue={selectedSpecialist?.profession} placeholder="Выбрать" options={professionOptions} required />
            </label>
            <div className="specialist-primary-price">
              <Field
                name="price"
                label="Стоимость работ"
                placeholder="от 1 500 ₽"
                defaultValue={selectedSpecialist?.price}
                maxLength={12}
                pattern={pricePattern.source}
                required
                title="До 12 символов, например: от 1500 ₽."
              />
            </div>
            <div className="specialist-primary-phone">
              <Field name="phone" label="Телефон" placeholder="+7-(999)-999-99-99" defaultValue={selectedSpecialist?.phone} required />
            </div>
            <div className="specialist-primary-email">
              <Field name="email" label="Email" type="email" placeholder="name@example.ru" defaultValue={selectedSpecialist?.email} maxLength={64} required />
            </div>
            <div className="specialist-primary-messenger">
              <Field name="messengerUrl" label="Telegram / WhatsApp" placeholder="@username или ссылка" defaultValue={selectedSpecialist?.messengerUrl} maxLength={64} required />
            </div>
          </div>
          <ListingLocationFields
            addressLegend="Адрес специалиста"
            cityFieldName="city"
            defaultAddress={selectedSpecialist?.address}
            defaultCity={selectedSpecialist?.city}
            defaultLat={(selectedSpecialist?.hasMapPoint ?? true) && hasMapCoordinates(selectedSpecialist?.lat, selectedSpecialist?.lng) ? selectedSpecialist?.lat : undefined}
            defaultLng={(selectedSpecialist?.hasMapPoint ?? true) && hasMapCoordinates(selectedSpecialist?.lat, selectedSpecialist?.lng) ? selectedSpecialist?.lng : undefined}
            inlineControls
          />
          <PhotoField defaultPhotos={selectedSpecialist?.images} label="Фото специалиста и работ" description="Добавьте портфолио, фото выполненных работ или рабочей зоны. В демо файлы выбираются локально, без загрузки на сервер." />
          <TextAreaField name="skills" label="Навыки" placeholder="Монтаж, ремонт, замена" defaultValue={selectedSpecialist?.skills} minLength={3} maxLength={120} required />
          <TextAreaField name="description" label="О себе и опыт работы" placeholder="Расскажите об опыте, подходе к работе, гарантиях и условиях выезда" defaultValue={selectedSpecialist?.description} maxLength={500} />
          {adminMode ? (
            <AdminDemoPublishButton publicationType="specialist" returnHref="/cabinet/specialist" label="Сохранить анкету" />
          ) : !selectedSpecialist ? (
            <TurnstileSubmitButton label="Сохранить анкету" />
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
