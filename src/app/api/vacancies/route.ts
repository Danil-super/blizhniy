import { NextResponse } from "next/server";
import { createPayment } from "@/lib/payment-provider";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";
import { normalizeVacancyRequisites, validateVacancyRequisites } from "@/lib/vacancy-requisites";
import {
  createStoredVacancy,
  findReusableStoredVacancyForPayment,
  updateStoredVacancyForUser,
  type CreateStoredVacancyInput,
} from "@/lib/vacancy-store";
import type { Payment } from "@/lib/types";

type CreateVacancyBody = {
  address?: string;
  city?: string;
  conditions?: string;
  contactPerson?: string;
  description?: string;
  email?: string;
  employerType?: string;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
  inn?: string;
  ogrn?: string;
  ogrnip?: string;
  organization?: string;
  placementRightConfirmed?: boolean;
  phone?: string;
  profession?: string;
  requirements?: string;
  responsibilities?: string;
  salary?: string;
  schedule?: string;
  status?: "draft";
  tariffId?: string;
  title?: string;
  website?: string;
  workFormat?: string;
};

const messengerPattern = /^(@[A-Za-z0-9_]{5,32}|https?:\/\/[^\s]+)$/;

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanMediaPaths(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => cleanString(item)).filter((item) => item && item.length <= 500).slice(0, 20);
}

function hasValidPhone(value: string) {
  if (!value) {
    return false;
  }

  const digits = value.replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")));
}

function hasValidMessenger(value: string) {
  return Boolean(value && messengerPattern.test(value));
}

function hasValidEmail(value: string) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function salaryDigits(value: string) {
  return value.replace(/\D/g, "");
}

function hasValidSalary(value: string) {
  const digits = salaryDigits(value);
  const amount = Number(digits);

  return Boolean(digits) && digits.length <= 9 && Number.isFinite(amount) && amount > 0;
}

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase auth is not configured" }, { status: 503 });
  }

  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Server storage is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы создать вакансию" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateVacancyBody | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const isDraft = body.status === "draft";
  const title = cleanString(body.title) || (isDraft ? "Черновик вакансии" : "");
  const organization = cleanString(body.organization);
  const city = cleanString(body.city) || "Краснодар";
  const description = cleanString(body.description);
  const phone = cleanString(body.phone);
  const email = cleanString(body.email);
  const requisites = normalizeVacancyRequisites({
    employerType: cleanString(body.employerType),
    inn: cleanString(body.inn),
    ogrn: cleanString(body.ogrn),
    ogrnip: cleanString(body.ogrnip),
  });
  const messengerUrl = cleanString(body.messengerUrl);
  const salary = cleanString(body.salary);

  if (!isDraft && (title.length < 3 || title.length > 90)) {
    return NextResponse.json({ error: "Название вакансии должно быть от 3 до 90 символов" }, { status: 400 });
  }

  if (!isDraft && organization.length < 2) {
    return NextResponse.json({ error: "Укажите работодателя" }, { status: 400 });
  }

  const requisitesError = validateVacancyRequisites(requisites, { requireInn: !isDraft });

  if (requisitesError) {
    return NextResponse.json({ error: requisitesError }, { status: 400 });
  }

  if (!isDraft && description.length < 30) {
    return NextResponse.json({ error: "Описание вакансии должно быть не короче 30 символов" }, { status: 400 });
  }

  if (!isDraft && !hasValidSalary(salary)) {
    return NextResponse.json({ error: "Укажите оплату цифрами, например 80000" }, { status: 400 });
  }

  if (!isDraft && !cleanMediaPaths(body.mediaPaths).length) {
    return NextResponse.json({ error: "Добавьте фото работодателя или рабочего места" }, { status: 400 });
  }

  if (description.length > 3000) {
    return NextResponse.json({ error: "Описание вакансии слишком длинное" }, { status: 400 });
  }

  if (!isDraft && !phone && !email && !messengerUrl) {
    return NextResponse.json({ error: "Укажите телефон, email или мессенджер для связи" }, { status: 400 });
  }

  if (phone && !hasValidPhone(phone)) {
    return NextResponse.json({ error: "Введите корректный телефон" }, { status: 400 });
  }

  if (email && !hasValidEmail(email)) {
    return NextResponse.json({ error: "Введите корректный email" }, { status: 400 });
  }

  if (messengerUrl && !hasValidMessenger(messengerUrl)) {
    return NextResponse.json({ error: "Введите @username или ссылку на мессенджер" }, { status: 400 });
  }

  try {
    const vacancyInput: CreateStoredVacancyInput = {
      address: cleanString(body.address) || undefined,
      authorId: auth.user.id,
      city,
      conditions: cleanString(body.conditions) || undefined,
      contactPerson: cleanString(body.contactPerson) || undefined,
      description: description || undefined,
      email: email || undefined,
      employerType: requisites.employerType,
      inn: requisites.inn || undefined,
      ogrn: requisites.ogrn || undefined,
      ogrnip: requisites.ogrnip || undefined,
      lat: cleanNumber(body.lat),
      lng: cleanNumber(body.lng),
      mediaPaths: cleanMediaPaths(body.mediaPaths),
      messengerUrl: messengerUrl || undefined,
      organization: organization || "Работодатель",
      placementRightConfirmed: Boolean(body.placementRightConfirmed),
      phone: phone || undefined,
      profession: cleanString(body.profession) || title,
      requirements: cleanString(body.requirements) || undefined,
      responsibilities: cleanString(body.responsibilities) || undefined,
      salary: salary || undefined,
      schedule: cleanString(body.schedule) || undefined,
      status: isDraft ? "draft" : body.tariffId ? "pending_payment" : "published",
      title,
      website: cleanString(body.website) || undefined,
      workFormat: cleanString(body.workFormat) || undefined,
    };
    const reusableVacancy = body.tariffId ? await findReusableStoredVacancyForPayment(vacancyInput) : undefined;
    const vacancy = reusableVacancy
      ? await updateStoredVacancyForUser(reusableVacancy.id, auth.user.id, vacancyInput)
      : await createStoredVacancy(vacancyInput);

    if (!vacancy?.id) {
      return NextResponse.json({ error: "Не удалось создать вакансию в Supabase" }, { status: 500 });
    }

    let payment: Payment | undefined;

    if (body.tariffId) {
      payment = await createPayment({
        tariffId: body.tariffId,
        targetId: vacancy.id,
        targetTitle: title,
        targetType: "vacancy",
        userId: auth.user.id,
      });
    }

    return NextResponse.json({ vacancy, payment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Vacancy creation failed" }, { status: 400 });
  }
}
