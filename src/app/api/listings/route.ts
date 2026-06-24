import { NextResponse } from "next/server";
import { createStoredListing, findReusableStoredListingForPayment, updateStoredListingForUser } from "@/lib/listing-store";
import { createPayment } from "@/lib/payment-provider";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";
import { formatBookingPrice, sanitizeBookingDetails, validateBookingDetailsForPublication } from "@/lib/booking-details";
import { validateMediaStoragePathsForUser } from "@/lib/storage-upload";
import type { CreateStoredListingInput } from "@/lib/listing-store";
import type { BookingDetails, ListingKind } from "@/lib/types";

type CreateListingBody = {
  address?: string;
  booking?: BookingDetails;
  categorySlug?: string;
  city?: string;
  description?: string;
  district?: string;
  email?: string;
  kind?: ListingKind;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
  phone?: string;
  price?: string;
  subcategory?: string;
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

function cleanKind(value: unknown): ListingKind {
  return value === "kuplyu" || value === "otdam-darom" || value === "arenda" ? value : "prodam";
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

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase auth is not configured" }, { status: 503 });
  }

  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json(
      { error: "Для создания объявления на сервере нужно добавить SUPABASE_SERVICE_ROLE_KEY в переменные окружения Vercel." },
      { status: 503 },
    );
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы создать объявление" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateListingBody | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const title = cleanString(body.title);
  const description = cleanString(body.description);
  const phone = cleanString(body.phone);
  const messengerUrl = cleanString(body.messengerUrl);
  const profileEmail = cleanString(auth.user.email);

  if (title.length < 3 || title.length > 120) {
    return NextResponse.json({ error: "Название объявления должно быть от 3 до 120 символов" }, { status: 400 });
  }

  if (description.length > 3000) {
    return NextResponse.json({ error: "Описание объявления слишком длинное" }, { status: 400 });
  }

  if (!phone && !messengerUrl && !profileEmail) {
    return NextResponse.json({ error: "Укажите телефон, email или мессенджер для связи" }, { status: 400 });
  }

  if (phone && !hasValidPhone(phone)) {
    return NextResponse.json({ error: "Введите корректный телефон" }, { status: 400 });
  }

  if (messengerUrl && !hasValidMessenger(messengerUrl)) {
    return NextResponse.json({ error: "Введите @username или ссылку на мессенджер" }, { status: 400 });
  }

  try {
    const kind = cleanKind(body.kind);
    const booking = sanitizeBookingDetails(body.booking);
    const tariffId = cleanString(body.tariffId);
    const rawMediaPaths = cleanMediaPaths(body.mediaPaths);
    const mediaPaths = validateMediaStoragePathsForUser(rawMediaPaths, "listings", auth.user.id);

    if (mediaPaths.length !== rawMediaPaths.length) {
      return NextResponse.json({ error: "Некорректные файлы объявления. Загрузите фото заново." }, { status: 400 });
    }

    if (!tariffId) {
      return NextResponse.json({ error: "Выберите тариф размещения, чтобы перейти к оплате" }, { status: 400 });
    }

    if (kind === "arenda") {
      const bookingErrors = validateBookingDetailsForPublication(booking);

      if (bookingErrors.length) {
        return NextResponse.json({ error: bookingErrors[0] }, { status: 400 });
      }
    }

    const listingInput: CreateStoredListingInput = {
      address: cleanString(body.address) || undefined,
      authorId: auth.user.id,
      booking,
      categorySlug: cleanString(body.categorySlug) || "dlya-doma-i-dachi",
      city: cleanString(body.city) || "Краснодар",
      description: description || undefined,
      district: cleanString(body.district) || undefined,
      kind,
      lat: cleanNumber(body.lat),
      lng: cleanNumber(body.lng),
      mediaPaths,
      messengerUrl: messengerUrl || undefined,
      phone: phone || undefined,
      price: booking ? formatBookingPrice(booking) : cleanString(body.price) || undefined,
      status: "pending_payment",
      subcategory: cleanString(body.subcategory) || undefined,
      title,
    };
    const reusableListing = await findReusableStoredListingForPayment(listingInput);

    const listing = reusableListing
      ? await updateStoredListingForUser(reusableListing.id, auth.user.id, listingInput)
      : await createStoredListing(listingInput);

    if (!listing?.id) {
      return NextResponse.json({ error: "Не удалось создать объявление в Supabase" }, { status: 500 });
    }

    const payment = await createPayment({
      tariffId,
      targetId: listing.id,
      targetTitle: title,
      targetType: "listing",
      userId: auth.user.id,
    });

    return NextResponse.json({ listing, payment }, { status: 201 });
  } catch (error) {
    console.error("Listing publication payment flow failed", {
      error: error instanceof Error ? error.message : String(error),
      tariffId: body.tariffId,
      userId: auth.user.id,
    });

    return NextResponse.json({ error: error instanceof Error ? error.message : "Listing creation failed" }, { status: 400 });
  }
}
