import { isSupabaseRestConfigured, supabaseRest } from "@/lib/supabase-rest";
import type { Listing, ListingKind, PublicationStatus } from "@/lib/types";

type ListingTypeRow = "sell" | "buy" | "exchange" | "free";

type ListingRow = {
  id: string;
  listing_type: ListingTypeRow;
  title: string;
  description: string;
  price?: number | string | null;
  district?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  show_exact_address: boolean;
  contact_phone?: string | null;
  messenger_url?: string | null;
  status: PublicationStatus;
  is_paid: boolean;
  created_at: string;
  published_at?: string | null;
  expires_at?: string | null;
  categories?: {
    name: string;
    parent_id?: string | null;
    slug: string;
  } | null;
  cities?: {
    name: string;
    slug: string;
  } | null;
  profiles?: {
    display_name?: string | null;
    email?: string | null;
  } | null;
};

const listingKindByDbType: Record<ListingTypeRow, ListingKind> = {
  buy: "kuplyu",
  exchange: "menyayu",
  free: "otdam-darom",
  sell: "prodam",
};

const fallbackCategoryByKind: Record<ListingKind, string> = {
  arenda: "nedvizhimost",
  kuplyu: "tovary-i-veshchi",
  menyayu: "tovary-i-veshchi",
  "otdam-darom": "tovary-i-veshchi",
  prodam: "tovary-i-veshchi",
};

function toNumber(value: ListingRow["latitude"]) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatPrice(value: ListingRow["price"]) {
  if (value === null || value === undefined || value === "") {
    return "по договоренности";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "по договоренности";
  }

  return new Intl.NumberFormat("ru-RU").format(numeric).replace(/\u00a0/g, " ") + " ₽";
}

function isoDate(value?: string | null) {
  return value ?? new Date().toISOString();
}

function addDaysIsoDate(value: string, days: number) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    date.setTime(Date.now());
  }

  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function mapListing(row: ListingRow): Listing {
  const kind = listingKindByDbType[row.listing_type] ?? "prodam";
  const categorySlug = row.categories?.slug ?? fallbackCategoryByKind[kind];
  const publishedAt = isoDate(row.published_at ?? row.created_at);

  return {
    id: row.id,
    slug: row.id,
    kind,
    categorySlug,
    subcategory: row.categories?.name ?? "Объявление",
    author: row.profiles?.display_name ?? "Пользователь БЛИЖНИЙ",
    title: row.title,
    description: row.description,
    city: row.cities?.name ?? "Краснодар",
    district: row.district ?? undefined,
    address: row.address ?? undefined,
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
    hasMapPoint: Boolean(row.latitude && row.longitude),
    showExactAddress: row.show_exact_address,
    price: formatPrice(row.price),
    imageTone: "blue",
    phone: row.contact_phone ?? undefined,
    email: row.profiles?.email ?? undefined,
    messengerUrl: row.messenger_url ?? undefined,
    status: row.status,
    paid: row.is_paid,
    publishedAt,
    expiresAt: isoDate(row.expires_at) || addDaysIsoDate(publishedAt, 30),
  };
}

export async function listStoredListings(limit = 24) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  try {
    const rows = await supabaseRest<ListingRow[]>(
      `/rest/v1/listings?select=id,listing_type,title,description,price,district,address,latitude,longitude,show_exact_address,contact_phone,messenger_url,status,is_paid,created_at,published_at,expires_at,categories(slug,name,parent_id),cities(slug,name),profiles(display_name,email)&status=eq.published&order=published_at.desc.nullslast,created_at.desc&limit=${limit}`,
      { useServiceRole: false },
    );

    return rows.map(mapListing);
  } catch (error) {
    console.error("Failed to load listings from Supabase", error);
    return [];
  }
}
