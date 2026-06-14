import { NextResponse } from "next/server";
import { createStoredListing } from "@/lib/listing-store";
import { createPayment } from "@/lib/payment-provider";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import type { ListingKind, Payment } from "@/lib/types";

type CreateListingBody = {
  address?: string;
  categorySlug?: string;
  city?: string;
  description?: string;
  district?: string;
  kind?: ListingKind;
  lat?: number;
  lng?: number;
  messengerUrl?: string;
  phone?: string;
  price?: string;
  subcategory?: string;
  tariffId?: string;
  title?: string;
};

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

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы создать объявление" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateListingBody | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const title = cleanString(body.title) || "Новое объявление";
  const phone = cleanString(body.phone);
  const messengerUrl = cleanString(body.messengerUrl);

  if (!phone && !messengerUrl) {
    return NextResponse.json({ error: "Укажите телефон или мессенджер для связи" }, { status: 400 });
  }

  try {
    const listing = await createStoredListing({
      address: cleanString(body.address) || undefined,
      categorySlug: cleanString(body.categorySlug) || "dlya-doma-i-dachi",
      city: cleanString(body.city) || "Краснодар",
      description: cleanString(body.description) || undefined,
      district: cleanString(body.district) || undefined,
      kind: cleanKind(body.kind),
      lat: cleanNumber(body.lat),
      lng: cleanNumber(body.lng),
      messengerUrl: messengerUrl || undefined,
      phone: phone || undefined,
      price: cleanString(body.price) || undefined,
      status: body.tariffId ? "pending_payment" : "published",
      subcategory: cleanString(body.subcategory) || undefined,
      title,
      userId: auth.user.id,
    });

    if (!listing?.id) {
      return NextResponse.json({ error: "Не удалось создать объявление в Supabase" }, { status: 500 });
    }

    let payment: Payment | undefined;

    if (body.tariffId) {
      payment = await createPayment({
        tariffId: body.tariffId,
        targetId: listing.id,
        targetTitle: title,
        targetType: "listing",
        userId: auth.user.id,
      });
    }

    return NextResponse.json({ listing, payment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Listing creation failed" }, { status: 400 });
  }
}
