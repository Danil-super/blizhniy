import { NextResponse } from "next/server";
import { createPayment } from "@/lib/payment-provider";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";
import { validateMediaStoragePathsForUser } from "@/lib/storage-upload";
import {
  createStoredWorkRequest,
  findReusableStoredWorkRequestForPayment,
  updateStoredWorkRequestForUser,
  type CreateStoredWorkRequestInput,
} from "@/lib/work-request-store";
import type { Payment } from "@/lib/types";

type CreateWorkRequestBody = {
  address?: string;
  budget?: string;
  city?: string;
  description?: string;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
  phone?: string;
  placementRightConfirmed?: boolean;
  profession?: string;
  status?: "draft";
  tariffId?: string;
  title?: string;
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

  return value.map((item) => cleanString(item)).filter((item) => item && item.length <= 500).slice(0, 6);
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

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase auth is not configured" }, { status: 503 });
  }

  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Server storage is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы создать заказ" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateWorkRequestBody | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const isDraft = body.status === "draft";
  const title = cleanString(body.title) || (isDraft ? "Черновик заказа" : "");
  const description = cleanString(body.description);
  const phone = cleanString(body.phone);
  const messengerUrl = cleanString(body.messengerUrl);
  const tariffId = cleanString(body.tariffId);
  const rawMediaPaths = cleanMediaPaths(body.mediaPaths);

  if (!isDraft && (title.length < 3 || title.length > 90)) {
    return NextResponse.json({ error: "Название заказа должно быть от 3 до 90 символов" }, { status: 400 });
  }

  if (!isDraft && description.length < 30) {
    return NextResponse.json({ error: "Описание заказа должно быть не короче 30 символов" }, { status: 400 });
  }

  if (description.length > 1800) {
    return NextResponse.json({ error: "Описание заказа слишком длинное" }, { status: 400 });
  }

  if (!isDraft && !phone && !messengerUrl) {
    return NextResponse.json({ error: "Укажите телефон или мессенджер для связи" }, { status: 400 });
  }

  if (phone && !hasValidPhone(phone)) {
    return NextResponse.json({ error: "Введите корректный телефон" }, { status: 400 });
  }

  if (messengerUrl && !hasValidMessenger(messengerUrl)) {
    return NextResponse.json({ error: "Введите @username или ссылку на мессенджер" }, { status: 400 });
  }

  if (!isDraft && !body.placementRightConfirmed) {
    return NextResponse.json({ error: "Подтвердите правила размещения заказа" }, { status: 400 });
  }

  if (!isDraft && !tariffId) {
    return NextResponse.json({ error: "Выберите тариф размещения, чтобы перейти к оплате" }, { status: 400 });
  }

  try {
    const mediaPaths = validateMediaStoragePathsForUser(rawMediaPaths, "work-requests", auth.user.id);

    if (mediaPaths.length !== rawMediaPaths.length) {
      return NextResponse.json({ error: "Некорректные файлы заказа. Загрузите фото заново." }, { status: 400 });
    }

    const workRequestInput: CreateStoredWorkRequestInput = {
      address: cleanString(body.address) || undefined,
      authorId: auth.user.id,
      budget: cleanString(body.budget) || undefined,
      city: cleanString(body.city) || "Краснодар",
      description: description || undefined,
      lat: cleanNumber(body.lat),
      lng: cleanNumber(body.lng),
      mediaPaths,
      messengerUrl: messengerUrl || undefined,
      phone: phone || undefined,
      profession: cleanString(body.profession) || title,
      status: isDraft ? "draft" : "pending_payment",
      title,
    };
    const reusableRequest = tariffId ? await findReusableStoredWorkRequestForPayment(workRequestInput) : undefined;
    const workRequest = reusableRequest
      ? await updateStoredWorkRequestForUser(reusableRequest.id, auth.user.id, workRequestInput)
      : await createStoredWorkRequest(workRequestInput);

    if (!workRequest?.id) {
      return NextResponse.json({ error: "Не удалось создать заказ в Supabase" }, { status: 500 });
    }

    let payment: Payment | undefined;

    if (tariffId) {
      payment = await createPayment({
        tariffId,
        targetId: workRequest.id,
        targetTitle: title,
        targetType: "workRequest",
        userId: auth.user.id,
      });
    }

    return NextResponse.json({ workRequest, payment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Work request creation failed" }, { status: 400 });
  }
}
