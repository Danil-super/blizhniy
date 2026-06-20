import { NextResponse } from "next/server";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isUuid } from "@/lib/supabase-rest";
import { deleteStoredWorkRequestForUser, updateStoredWorkRequestForUser, type CreateStoredWorkRequestInput } from "@/lib/work-request-store";

type WorkRequestBody = {
  budget?: string;
  city?: string;
  description?: string;
  id?: string;
  mediaPaths?: string[];
  messengerUrl?: string;
  phone?: string;
  profession?: string;
  title?: string;
};

const messengerPattern = /^(@[A-Za-z0-9_]{5,32}|https?:\/\/[^\s]+)$/;

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanMediaPaths(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
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

export async function PATCH(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы изменить заказ" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as WorkRequestBody | null;
  const requestId = body?.id?.trim();

  if (!body || !requestId || !isUuid(requestId)) {
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  }

  const title = cleanString(body.title);
  const description = cleanString(body.description);
  const phone = cleanString(body.phone);
  const messengerUrl = cleanString(body.messengerUrl);

  if (title.length < 3 || title.length > 90) {
    return NextResponse.json({ error: "Название заказа должно быть от 3 до 90 символов" }, { status: 400 });
  }

  if (description.length < 30 || description.length > 1800) {
    return NextResponse.json({ error: "Описание заказа должно быть от 30 до 1800 символов" }, { status: 400 });
  }

  if (!phone && !messengerUrl) {
    return NextResponse.json({ error: "Укажите телефон или мессенджер для связи" }, { status: 400 });
  }

  if (phone && !hasValidPhone(phone)) {
    return NextResponse.json({ error: "Введите корректный телефон" }, { status: 400 });
  }

  if (messengerUrl && !hasValidMessenger(messengerUrl)) {
    return NextResponse.json({ error: "Введите @username или ссылку на мессенджер" }, { status: 400 });
  }

  const input: CreateStoredWorkRequestInput = {
    authorId: auth.user.id,
    budget: cleanString(body.budget) || undefined,
    city: cleanString(body.city) || "Краснодар",
    description,
    mediaPaths: cleanMediaPaths(body.mediaPaths),
    messengerUrl: messengerUrl || undefined,
    phone: phone || undefined,
    profession: cleanString(body.profession) || title,
    title,
  };
  const workRequest = await updateStoredWorkRequestForUser(requestId, auth.user.id, input);

  if (!workRequest) {
    return NextResponse.json({ error: "Заказ не найден или его нельзя изменить" }, { status: 404 });
  }

  return NextResponse.json({ workRequest });
}

export async function DELETE(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы удалить заказ" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as WorkRequestBody | null;
  const requestId = body?.id?.trim();

  if (!requestId || !isUuid(requestId)) {
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  }

  const deleted = await deleteStoredWorkRequestForUser(requestId, auth.user.id);

  return NextResponse.json({ deleted });
}
