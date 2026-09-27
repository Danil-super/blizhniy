import { NextResponse } from "next/server";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isUuid } from "@/lib/supabase-rest";
import {
  archiveStoredWorkRequestForUser,
  deleteStoredWorkRequestForUser,
  getStoredWorkRequestForUser,
  listStoredWorkRequestsForUser,
  restoreStoredWorkRequestForUser,
  updateStoredWorkRequestForUser,
  type CreateStoredWorkRequestInput,
} from "@/lib/work-request-store";

type WorkRequestBody = {
  action?: "archive" | "restore";
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

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);
  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы увидеть свои заказы" }, { status: 401 });
  }

  try {
    const workRequests = await listStoredWorkRequestsForUser(auth.user.id);
    return NextResponse.json({ workRequests }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load owner work requests", error);
    return NextResponse.json({ error: "Не удалось загрузить заказы" }, { status: 503 });
  }
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
  const requestId = cleanString(body?.id);

  if (!body || !requestId || !isUuid(requestId)) {
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  }

  if (body.action !== undefined) {
    if (body.action !== "archive" && body.action !== "restore") {
      return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
    }

    try {
      const owned = await getStoredWorkRequestForUser(requestId, auth.user.id);
      if (!owned) {
        return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
      }

      if (body.action === "archive" && owned.status !== "published" && owned.status !== "archived") {
        return NextResponse.json({ error: "Архивировать можно только опубликованный заказ" }, { status: 409 });
      }
      if (body.action === "restore" && owned.status !== "archived") {
        return NextResponse.json({ error: "Восстановить можно только архивный заказ" }, { status: 409 });
      }

      const workRequest = body.action === "archive"
        ? await archiveStoredWorkRequestForUser(requestId, auth.user.id)
        : await restoreStoredWorkRequestForUser(requestId, auth.user.id);
      if (!workRequest) {
        return NextResponse.json({ error: "Заказ не изменён: срок публикации истёк, оплата не найдена или статус изменился" }, { status: 409 });
      }
      return NextResponse.json({ workRequest });
    } catch (error) {
      console.error("Failed to change owner work request status", error);
      return NextResponse.json({ error: "Не удалось изменить статус заказа" }, { status: 503 });
    }
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
  const requestId = cleanString(body?.id);

  if (!requestId || !isUuid(requestId)) {
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  }

  const deleted = await deleteStoredWorkRequestForUser(requestId, auth.user.id);

  if (!deleted) {
    return NextResponse.json({ error: "Заказ не найден или уже удалён", deleted: false }, { status: 404 });
  }

  return NextResponse.json({ deleted });
}
