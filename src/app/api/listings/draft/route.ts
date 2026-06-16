import { NextResponse } from "next/server";
import { createStoredListing } from "@/lib/listing-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";
import type { ListingKind } from "@/lib/types";

type CreateDraftListingBody = {
  address?: string;
  categorySlug?: string;
  city?: string;
  description?: string;
  district?: string;
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

  return value.map((item) => cleanString(item)).filter((item) => item && item.length <= 500).slice(0, 10);
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
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы сохранить черновик" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateDraftListingBody | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const title = cleanString(body.title) || "Черновик объявления";
  const description = cleanString(body.description);
  const phone = cleanString(body.phone);
  const messengerUrl = cleanString(body.messengerUrl);

  if (description.length > 3000) {
    return NextResponse.json({ error: "Описание объявления слишком длинное" }, { status: 400 });
  }

  if (phone && !hasValidPhone(phone)) {
    return NextResponse.json({ error: "Введите корректный телефон" }, { status: 400 });
  }

  if (messengerUrl && !hasValidMessenger(messengerUrl)) {
    return NextResponse.json({ error: "Введите @username или ссылку на мессенджер" }, { status: 400 });
  }

  try {
    const listing = await createStoredListing({
      address: cleanString(body.address) || undefined,
      authorId: auth.user.id,
      categorySlug: cleanString(body.categorySlug) || "dlya-doma-i-dachi",
      city: cleanString(body.city) || "Краснодар",
      description: description || undefined,
      district: cleanString(body.district) || undefined,
      kind: cleanKind(body.kind),
      lat: cleanNumber(body.lat),
      lng: cleanNumber(body.lng),
      mediaPaths: cleanMediaPaths(body.mediaPaths),
      messengerUrl: messengerUrl || undefined,
      phone: phone || undefined,
      price: cleanString(body.price) || undefined,
      status: "draft",
      subcategory: cleanString(body.subcategory) || undefined,
      title,
    });

    if (!listing?.id) {
      return NextResponse.json({ error: "Не удалось сохранить черновик" }, { status: 500 });
    }

    return NextResponse.json({ listing }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Draft creation failed" }, { status: 400 });
  }
}
