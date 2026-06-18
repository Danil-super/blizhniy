import { NextResponse } from "next/server";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { normalizeVacancyRequisites, validateVacancyRequisites } from "@/lib/vacancy-requisites";
import {
  archiveStoredVacancyForUser,
  deleteStoredVacancyForUser,
  listStoredVacanciesForUser,
  restoreStoredVacancyForUser,
  saveStoredVacancyForUser,
  type CreateStoredVacancyInput,
} from "@/lib/vacancy-store";

type VacancyActionBody = {
  action?: "archive" | "restore";
  address?: string;
  city?: string;
  clearMedia?: boolean;
  conditions?: string;
  contactPerson?: string;
  description?: string;
  email?: string;
  employerType?: string;
  id?: string;
  inn?: string;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
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
  title?: string;
  website?: string;
  workFormat?: string;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanMediaPaths(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((item) => cleanString(item)).filter((item) => item && item.length <= 500).slice(0, 20);
}

const messengerPattern = /^(@[A-Za-z0-9_]{5,32}|https?:\/\/[^\s]+)$/;

function hasValidPhone(value: string) {
  if (!value) {
    return false;
  }

  const digits = value.replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")));
}

function hasValidEmail(value: string) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function hasValidMessenger(value: string) {
  return Boolean(value && messengerPattern.test(value));
}

function salaryDigits(value: string) {
  return value.replace(/\D/g, "");
}

function hasValidSalary(value: string) {
  const digits = salaryDigits(value);
  const amount = Number(digits);

  return Boolean(digits) && digits.length <= 9 && Number.isFinite(amount) && amount > 0;
}

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы открыть вакансии" }, { status: 401 });
  }

  const vacancies = await listStoredVacanciesForUser(auth.user.id);

  return NextResponse.json({ vacancies }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы изменить вакансию" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as VacancyActionBody | null;

  if (!body?.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (!body.action) {
    const title = cleanString(body.title);
    const organization = cleanString(body.organization);
    const description = cleanString(body.description);
    const email = cleanString(body.email);
    const messengerUrl = cleanString(body.messengerUrl);
    const phone = cleanString(body.phone);
    const salary = cleanString(body.salary);
    const requisites = normalizeVacancyRequisites({
      employerType: cleanString(body.employerType),
      inn: cleanString(body.inn),
      ogrn: cleanString(body.ogrn),
      ogrnip: cleanString(body.ogrnip),
    });

    if (title.length < 3 || title.length > 90) {
      return NextResponse.json({ error: "Название вакансии должно быть от 3 до 90 символов" }, { status: 400 });
    }

    if (organization.length < 2) {
      return NextResponse.json({ error: "Укажите работодателя" }, { status: 400 });
    }

    if (description.length < 30) {
      return NextResponse.json({ error: "Описание вакансии должно быть не короче 30 символов" }, { status: 400 });
    }

    const requisitesError = validateVacancyRequisites(requisites, { requireInn: true });

    if (requisitesError) {
      return NextResponse.json({ error: requisitesError }, { status: 400 });
    }

    if (!hasValidSalary(salary)) {
      return NextResponse.json({ error: "Укажите оплату цифрами, например 80000" }, { status: 400 });
    }

    if (body.clearMedia && !cleanMediaPaths(body.mediaPaths)?.length) {
      return NextResponse.json({ error: "У вакансии должно быть фото работодателя или рабочего места" }, { status: 400 });
    }

    if (!phone && !email && !messengerUrl) {
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

    const input: CreateStoredVacancyInput = {
      address: cleanString(body.address) || undefined,
      authorId: auth.user.id,
      city: cleanString(body.city) || "Краснодар",
      conditions: cleanString(body.conditions) || undefined,
      contactPerson: cleanString(body.contactPerson) || undefined,
      description,
      email: email || undefined,
      employerType: requisites.employerType,
      inn: requisites.inn || undefined,
      lat: cleanNumber(body.lat),
      lng: cleanNumber(body.lng),
      mediaPaths: cleanMediaPaths(body.mediaPaths),
      messengerUrl: messengerUrl || undefined,
      ogrn: requisites.ogrn || undefined,
      ogrnip: requisites.ogrnip || undefined,
      organization,
      placementRightConfirmed: Boolean(body.placementRightConfirmed),
      phone: phone || undefined,
      profession: cleanString(body.profession) || title,
      requirements: cleanString(body.requirements) || undefined,
      responsibilities: cleanString(body.responsibilities) || undefined,
      salary: salary || undefined,
      schedule: cleanString(body.schedule) || undefined,
      title,
      website: cleanString(body.website) || undefined,
      workFormat: cleanString(body.workFormat) || undefined,
    };
    const vacancy = await saveStoredVacancyForUser(body.id, auth.user.id, input, {
      clearMedia: Boolean(body.clearMedia),
      preserveMedia: body.mediaPaths === undefined && !body.clearMedia,
    });

    if (!vacancy) {
      return NextResponse.json({ error: "Не удалось сохранить вакансию. Возможно, она снята с публикации или уже удалена." }, { status: 409 });
    }

    return NextResponse.json({ vacancy }, { headers: { "Cache-Control": "no-store" } });
  }

  if (body.action !== "archive" && body.action !== "restore") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const updated =
    body.action === "archive"
      ? await archiveStoredVacancyForUser(body.id, auth.user.id)
      : await restoreStoredVacancyForUser(body.id, auth.user.id);

  if (!updated) {
    return NextResponse.json({ error: "Не удалось изменить вакансию. Обновите страницу и попробуйте снова." }, { status: 409 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы удалить вакансию" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Pick<VacancyActionBody, "id"> | null;

  if (!body?.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const deleted = await deleteStoredVacancyForUser(body.id, auth.user.id);

  if (!deleted) {
    return NextResponse.json({ error: "Не удалось удалить вакансию. Сначала снимите опубликованную вакансию с публикации." }, { status: 409 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
