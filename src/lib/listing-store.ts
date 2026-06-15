import { region } from "@/lib/data";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
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

type CategoryIdRow = { id: string; name: string; slug: string };
type CityIdRow = { id: string; name: string; region_id?: string | null; slug: string };
type RegionIdRow = { id: string; name: string; slug: string };

export type CreateStoredListingInput = {
  address?: string;
  authorId: string;
  categorySlug: string;
  city: string;
  description?: string;
  district?: string;
  kind: ListingKind;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
  phone?: string;
  price?: string;
  status?: PublicationStatus;
  subcategory?: string;
  title: string;
};

const listingKindByDbType: Record<ListingTypeRow, ListingKind> = {
  buy: "kuplyu",
  exchange: "menyayu",
  free: "otdam-darom",
  sell: "prodam",
};

const dbTypeByListingKind: Record<ListingKind, ListingTypeRow> = {
  arenda: "sell",
  kuplyu: "buy",
  menyayu: "exchange",
  "otdam-darom": "free",
  prodam: "sell",
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

function priceToNumber(value?: string) {
  const digits = (value ?? "").replace(/[^0-9]/g, "");
  const amount = digits ? Number(digits) : 0;

  return Number.isFinite(amount) && amount > 0 ? amount : null;
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

async function findCategoryId(categorySlug: string, subcategory?: string) {
  const exactSlugRows = await supabaseRest<CategoryIdRow[]>(
    `/rest/v1/categories?select=id,name,slug&slug=eq.${encodeURIComponent(categorySlug)}&limit=1`,
  );

  if (subcategory) {
    const subcategoryRows = await supabaseRest<CategoryIdRow[]>(
      `/rest/v1/categories?select=id,name,slug&name=eq.${encodeURIComponent(subcategory)}&limit=1`,
    );

    if (subcategoryRows[0]?.id) {
      return subcategoryRows[0].id;
    }
  }

  return exactSlugRows[0]?.id;
}

async function findCity(city: string) {
  const cityName = city.split(",")[0]?.trim() || "Краснодар";
  const rows = await supabaseRest<CityIdRow[]>(
    `/rest/v1/cities?select=id,name,slug,region_id&name=eq.${encodeURIComponent(cityName)}&limit=1`,
  );

  return rows[0];
}

async function findRegionId(cityRow?: CityIdRow) {
  if (cityRow?.region_id) {
    return cityRow.region_id;
  }

  const rows = await supabaseRest<RegionIdRow[]>(
    `/rest/v1/regions?select=id,name,slug&slug=eq.${encodeURIComponent(region.slug)}&limit=1`,
  );

  return rows[0]?.id;
}

function cleanMediaPaths(paths?: string[]) {
  if (!Array.isArray(paths)) {
    return [];
  }

  return paths.map((path) => path.trim()).filter((path) => path && path.length <= 500).slice(0, 10);
}

async function insertListingImages(listingId: string, mediaPaths?: string[]) {
  const paths = cleanMediaPaths(mediaPaths);

  if (!paths.length) {
    return;
  }

  await supabaseRest("/rest/v1/listing_images", {
    method: "POST",
    prefer: "return=minimal",
    body: paths.map((path, index) => ({
      listing_id: listingId,
      storage_path: path,
      sort_order: index,
    })),
  });
}

export async function createStoredListing(input: CreateStoredListingInput) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  const categoryId = await findCategoryId(input.categorySlug, input.subcategory);
  const cityRow = await findCity(input.city);
  const regionId = await findRegionId(cityRow);

  const status = input.status ?? "pending_payment";
  const rows = await supabaseRest<ListingRow[]>("/rest/v1/listings?select=*,categories(slug,name,parent_id),cities(slug,name),profiles(display_name,email)", {
    method: "POST",
    prefer: "return=representation",
    body: {
      address: input.address ?? null,
      author_id: input.authorId,
      category_id: categoryId ?? null,
      city_id: cityRow?.id ?? null,
      contact_phone: input.phone ?? null,
      description: input.description || "Описание будет дополнено.",
      district: input.district ?? null,
      is_paid: status === "published",
      latitude: input.lat ?? null,
      listing_type: dbTypeByListingKind[input.kind] ?? "sell",
      longitude: input.lng ?? null,
      messenger_url: input.messengerUrl ?? null,
      price: priceToNumber(input.price),
      published_at: status === "published" ? new Date().toISOString() : null,
      region_id: regionId ?? null,
      show_exact_address: Boolean(input.address && input.lat && input.lng),
      status,
      title: input.title,
    },
  });

  const listing = rows[0];

  if (!listing) {
    return undefined;
  }

  await insertListingImages(listing.id, input.mediaPaths);

  return mapListing(listing);
}

export async function markStoredListingPaid(listingId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return false;
  }

  const now = new Date().toISOString();

  await supabaseRest(`/rest/v1/listings?id=eq.${encodeURIComponent(listingId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      expires_at: addDaysIsoDate(now, 30),
      is_paid: true,
      published_at: now,
      status: "published",
    },
  });

  return true;
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
