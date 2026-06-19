import { NextResponse } from "next/server";
import {
  archiveStoredListingForUser,
  listStoredListingsForUser,
  markStoredListingSoldForUser,
  restoreStoredListingForUser,
  saveStoredListingForUser,
} from "@/lib/listing-store";
import { confirmPayment } from "@/lib/payment-provider";
import { listStoredPaymentsForUser, markStoredPaymentTargetSucceeded, updateStoredPayment } from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import type { Payment } from "@/lib/types";
import type { CreateStoredListingInput } from "@/lib/listing-store";
import type { ListingKind } from "@/lib/types";

type ListingActionBody = {
  action?: string;
  address?: string;
  categorySlug?: string;
  city?: string;
  clearMedia?: boolean;
  description?: string;
  district?: string;
  id?: string;
  kind?: ListingKind;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
  phone?: string;
  price?: string;
  subcategory?: string;
  title?: string;
};

function isTestYooKassaMode() {
  return process.env.YOOKASSA_SECRET_KEY?.trim().startsWith("test_") ?? false;
}

const messengerPattern = /^(@[A-Za-z0-9_]{5,32}|https?:\/\/[^\s]+)$/;

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanKind(value: unknown): ListingKind {
  return value === "kuplyu" || value === "menyayu" || value === "otdam-darom" || value === "arenda" ? value : "prodam";
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

async function forceSucceededTestPayment(payment: Payment) {
  const paidPayment: Payment = {
    ...payment,
    paidAt: payment.paidAt ?? new Date().toISOString().slice(0, 10),
    status: "succeeded",
  };

  await markStoredPaymentTargetSucceeded(paidPayment);
  await updateStoredPayment(paidPayment);
}

async function syncPendingListingPayments(userId: string) {
  const payments = await listStoredPaymentsForUser(userId);
  const pendingListingPayments = payments.filter(
    (payment) => payment.targetType === "listing" && payment.provider === "yookassa" && (payment.status === "created" || payment.status === "pending"),
  );
  const succeededListingPayments = payments.filter((payment) => payment.targetType === "listing" && payment.status === "succeeded");

  await Promise.allSettled([
    ...pendingListingPayments.map(async (payment) => {
      const result = await confirmPayment(payment, { trustSuccessfulReturn: true });

      if (isTestYooKassaMode() && result.payment.status !== "succeeded") {
        await forceSucceededTestPayment(result.payment);
      }
    }),
    ...succeededListingPayments.map((payment) => markStoredPaymentTargetSucceeded(payment)),
  ]);
}

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы открыть объявления" }, { status: 401 });
  }

  await syncPendingListingPayments(auth.user.id);
  const listings = await listStoredListingsForUser(auth.user.id);

  return NextResponse.json({ listings }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы удалить объявление" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as { id?: string } | null;
  const listingId = payload?.id?.trim();

  if (!listingId) {
    return NextResponse.json({ error: "listing id is required" }, { status: 400 });
  }

  const archived = await archiveStoredListingForUser(listingId, auth.user.id);

  if (!archived) {
    return NextResponse.json({ error: "Объявление не найдено или уже удалено" }, { status: 404 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы изменить объявление" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as ListingActionBody | null;
  const listingId = payload?.id?.trim();
  const action = payload?.action?.trim();

  if (!payload || !listingId) {
    return NextResponse.json({ error: "listing id is required" }, { status: 400 });
  }

  try {
    if (!action) {
      const title = cleanString(payload.title);
      const description = cleanString(payload.description);
      const phone = cleanString(payload.phone);
      const messengerUrl = cleanString(payload.messengerUrl);

      if (title.length < 3 || title.length > 120) {
        return NextResponse.json({ error: "Название объявления должно быть от 3 до 120 символов" }, { status: 400 });
      }

      if (description.length > 3000) {
        return NextResponse.json({ error: "Описание объявления слишком длинное" }, { status: 400 });
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

      const listingInput: CreateStoredListingInput = {
        address: cleanString(payload.address) || undefined,
        authorId: auth.user.id,
        categorySlug: cleanString(payload.categorySlug) || "dlya-doma-i-dachi",
        city: cleanString(payload.city) || "Краснодар",
        description: description || undefined,
        district: cleanString(payload.district) || undefined,
        kind: cleanKind(payload.kind),
        lat: cleanNumber(payload.lat),
        lng: cleanNumber(payload.lng),
        mediaPaths: cleanMediaPaths(payload.mediaPaths),
        messengerUrl: messengerUrl || undefined,
        phone: phone || undefined,
        price: cleanString(payload.price) || undefined,
        subcategory: cleanString(payload.subcategory) || undefined,
        title,
      };
      const listing = await saveStoredListingForUser(listingId, auth.user.id, listingInput, {
        clearMedia: Boolean(payload.clearMedia),
        preserveMedia: payload.mediaPaths === undefined && !payload.clearMedia,
      });

      if (!listing) {
        return NextResponse.json({ error: "Не удалось сохранить объявление. Возможно, оно снято с публикации или уже удалено." }, { status: 409 });
      }

      return NextResponse.json({ listing }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "sold") {
      const updated = await markStoredListingSoldForUser(listingId, auth.user.id);

      if (!updated) {
        return NextResponse.json({ error: "Объявление не найдено или уже снято с публикации" }, { status: 404 });
      }

      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "restore") {
      const updated = await restoreStoredListingForUser(listingId, auth.user.id);

      if (!updated) {
        return NextResponse.json({ error: "Объявление не найдено или его нужно оплатить перед публикацией" }, { status: 404 });
      }

      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось изменить объявление." }, { status: 500 });
  }

  return NextResponse.json({ error: "Unsupported listing action" }, { status: 400 });
}
