import { categories, region } from "@/lib/data";
import { formatBookingPrice } from "@/lib/booking-details";
import { hasMapCoordinates } from "@/lib/map-location";
import { publicMediaUrl } from "@/lib/storage-upload";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { BookingDetails, Listing, ListingKind, PublicationStatus } from "@/lib/types";

type ListingTypeRow = "sell" | "buy" | "free" | "rent";

type ListingImageRow = {
  sort_order?: number | null;
  storage_path: string;
};

type ListingRow = {
  id: string;
  listing_type: ListingTypeRow;
  title: string;
  description: string;
  booking?: BookingDetails | null;
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
  view_count?: number | null;
  created_at: string;
  published_at?: string | null;
  expires_at?: string | null;
  listing_images?: ListingImageRow[] | null;
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
  booking?: BookingDetails;
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
  showExactAddress?: boolean;
  status?: PublicationStatus;
  subcategory?: string;
  title: string;
};

type StoreListingBodyOptions = {
  clearMedia?: boolean;
  preserveMedia?: boolean;
};

function normalizeLookupText(value?: string) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

const listingKindByDbType: Record<ListingTypeRow, ListingKind> = {
  buy: "kuplyu",
  free: "otdam-darom",
  rent: "arenda",
  sell: "prodam",
};

const dbTypeByListingKind: Record<ListingKind, ListingTypeRow> = {
  arenda: "rent",
  kuplyu: "buy",
  "otdam-darom": "free",
  prodam: "sell",
};

const fallbackCategoryByKind: Record<ListingKind, string> = {
  arenda: "nedvizhimost",
  kuplyu: "raznoe",
  "otdam-darom": "raznoe",
  prodam: "raznoe",
};

const listingSelect =
  "id,listing_type,title,description,booking,price,district,address,latitude,longitude,show_exact_address,contact_phone,messenger_url,status,is_paid,created_at,published_at,expires_at,listing_images(storage_path,sort_order),categories(slug,name,parent_id),cities(slug,name),profiles(display_name,email)";
const listingSelectWithViewCount =
  "id,listing_type,title,description,booking,price,district,address,latitude,longitude,show_exact_address,contact_phone,messenger_url,status,is_paid,view_count,created_at,published_at,expires_at,listing_images(storage_path,sort_order),categories(slug,name,parent_id),cities(slug,name),profiles(display_name,email)";

async function fetchListingRows(querySuffix: string) {
  try {
    return await supabaseRest<ListingRow[]>(`/rest/v1/listings?select=${listingSelectWithViewCount}${querySuffix}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (!message.includes("view_count")) {
      throw error;
    }

    return supabaseRest<ListingRow[]>(`/rest/v1/listings?select=${listingSelect}${querySuffix}`);
  }
}

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

function mediaUrls(row: ListingRow) {
  return [...(row.listing_images ?? [])]
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((image) => image.storage_path)
    .filter(Boolean)
    .map(publicMediaUrl);
}

function resolveShowExactAddress(input: CreateStoredListingInput) {
  return Boolean((input.showExactAddress || input.address) && hasMapCoordinates(input.lat, input.lng));
}

function normalizeBooking(value: ListingRow["booking"]) {
  return value && typeof value === "object" ? value : undefined;
}

function resolveCategoryInfo(row: ListingRow) {
  const storedCategory = row.categories;

  if (!storedCategory) {
    return { categorySlug: "", subcategory: "Объявление" };
  }

  if (storedCategory.parent_id) {
    const parent = categories.find((category) => category.children.includes(storedCategory.name));

    return {
      categorySlug: parent?.slug ?? storedCategory.slug,
      subcategory: storedCategory.name,
    };
  }

  return {
    categorySlug: storedCategory.slug,
    subcategory: storedCategory.name,
  };
}

function mapListing(row: ListingRow): Listing {
  const booking = normalizeBooking(row.booking);
  const kind = row.listing_type === "rent" || booking ? "arenda" : listingKindByDbType[row.listing_type] ?? "prodam";
  const categoryInfo = resolveCategoryInfo(row);
  const categorySlug = categoryInfo.categorySlug || fallbackCategoryByKind[kind];
  const publishedAt = isoDate(row.published_at ?? row.created_at);

  return {
    id: row.id,
    slug: row.id,
    kind,
    categorySlug,
    subcategory: categoryInfo.subcategory,
    author: row.profiles?.display_name ?? "Пользователь",
    title: row.title,
    description: row.description,
    city: row.cities?.name ?? "Краснодар",
    district: row.district ?? undefined,
    address: row.address ?? undefined,
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
    hasMapPoint: Boolean(row.show_exact_address && row.latitude && row.longitude),
    showExactAddress: row.show_exact_address,
    price: booking ? formatBookingPrice(booking) : formatPrice(row.price),
    images: mediaUrls(row),
    booking,
    imageTone: "blue",
    phone: row.contact_phone ?? undefined,
    email: row.profiles?.email ?? undefined,
    messengerUrl: row.messenger_url ?? undefined,
    status: row.status,
    paid: row.is_paid,
    viewCount: Math.max(0, Math.floor(Number(row.view_count ?? 0) || 0)),
    publishedAt,
    expiresAt: isoDate(row.expires_at) || addDaysIsoDate(publishedAt, 30),
  };
}

async function findCategoryId(categorySlug: string, subcategory?: string) {
  const exactSlugRows = await supabaseRest<CategoryIdRow[]>(
    `/rest/v1/categories?select=id,name,slug&slug=eq.${encodeURIComponent(categorySlug)}&limit=1`,
  );

  if (subcategory) {
    const subcategoryBySlugRows = await supabaseRest<CategoryIdRow[]>(
      `/rest/v1/categories?select=id,name,slug&slug=eq.${encodeURIComponent(subcategory)}&limit=1`,
    );

    if (subcategoryBySlugRows[0]?.id) {
      return subcategoryBySlugRows[0].id;
    }

    const subcategoryByNameRows = await supabaseRest<CategoryIdRow[]>(
      `/rest/v1/categories?select=id,name,slug&name=eq.${encodeURIComponent(subcategory)}&limit=1`,
    );

    if (subcategoryByNameRows[0]?.id) {
      return subcategoryByNameRows[0].id;
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

  return paths.map((path) => path.trim()).filter((path) => path && path.length <= 500).slice(0, 20);
}

function listingWithMediaFallback(listing: Listing, mediaPaths?: string[]) {
  const images = cleanMediaPaths(mediaPaths).map(publicMediaUrl);

  if (!images.length || listing.images?.length) {
    return listing;
  }

  return { ...listing, images };
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

async function replaceListingImages(listingId: string, mediaPaths?: string[]) {
  const paths = cleanMediaPaths(mediaPaths);

  await supabaseRest(`/rest/v1/listing_images?listing_id=eq.${encodeURIComponent(listingId)}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });

  if (paths.length) {
    await insertListingImages(listingId, paths);
  }
}

export async function createStoredListing(input: CreateStoredListingInput) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  const categoryId = await findCategoryId(input.categorySlug, input.subcategory);
  const cityRow = await findCity(input.city);
  const regionId = await findRegionId(cityRow);

  const status = input.status ?? "pending_payment";
  const rows = await supabaseRest<ListingRow[]>(`/rest/v1/listings?select=${listingSelect}`, {
    method: "POST",
    prefer: "return=representation",
    body: {
      address: input.address ?? null,
      author_id: input.authorId,
      category_id: categoryId ?? null,
      city_id: cityRow?.id ?? null,
      contact_phone: input.phone ?? null,
      description: input.description || "Описание будет дополнено.",
      booking: input.booking ?? null,
      district: input.district ?? null,
      is_paid: status === "published",
      latitude: input.lat ?? null,
      listing_type: dbTypeByListingKind[input.kind] ?? "sell",
      longitude: input.lng ?? null,
      messenger_url: input.messengerUrl ?? null,
      price: priceToNumber(input.price),
      published_at: status === "published" ? new Date().toISOString() : null,
      region_id: regionId ?? null,
      show_exact_address: resolveShowExactAddress(input),
      status,
      title: input.title,
    },
  });

  const listing = rows[0];

  if (!listing) {
    return undefined;
  }

  await insertListingImages(listing.id, input.mediaPaths);

  return listingWithMediaFallback((await getStoredListingById(listing.id)) ?? mapListing(listing), input.mediaPaths);
}

function listingMatchesReusableInput(listing: Listing, input: CreateStoredListingInput) {
  const inputDescription = normalizeLookupText(input.description || "Описание будет дополнено.");
  const listingDescription = normalizeLookupText(listing.description || "Описание будет дополнено.");
  const inputPhone = normalizeLookupText(input.phone);
  const listingPhone = normalizeLookupText(listing.phone);
  const inputMessenger = normalizeLookupText(input.messengerUrl);
  const listingMessenger = normalizeLookupText(listing.messengerUrl);

  return (
    listing.kind === input.kind &&
    normalizeLookupText(listing.city) === normalizeLookupText(input.city) &&
    priceToNumber(listing.price) === priceToNumber(input.price) &&
    listingDescription === inputDescription &&
    JSON.stringify(listing.booking ?? null) === JSON.stringify(input.booking ?? null) &&
    (!inputPhone || !listingPhone || listingPhone === inputPhone) &&
    (!inputMessenger || !listingMessenger || listingMessenger === inputMessenger)
  );
}

export async function findReusableStoredListingForPayment(input: CreateStoredListingInput) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  const title = input.title.trim();

  if (title.length < 3) {
    return undefined;
  }

  const rows = await supabaseRest<ListingRow[]>(
    `/rest/v1/listings?select=${listingSelect}&author_id=eq.${encodeURIComponent(input.authorId)}&title=eq.${encodeURIComponent(title)}&status=in.(draft,pending_payment)&order=created_at.desc&limit=20`,
  );
  const listings = rows.map(mapListing);

  return listings.find((listing) => listingMatchesReusableInput(listing, input));
}

export async function findReusableStoredDraftListing(input: CreateStoredListingInput) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  const title = input.title.trim();

  if (title.length < 3) {
    return undefined;
  }

  const rows = await supabaseRest<ListingRow[]>(
    `/rest/v1/listings?select=${listingSelect}&author_id=eq.${encodeURIComponent(input.authorId)}&title=eq.${encodeURIComponent(title)}&status=eq.draft&order=created_at.desc&limit=20`,
  );

  return rows.map(mapListing).find((listing) => listingMatchesReusableInput(listing, input));
}

export async function updateStoredListingForUser(listingId: string, userId: string, input: CreateStoredListingInput) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return undefined;
  }

  const categoryId = await findCategoryId(input.categorySlug, input.subcategory);
  const cityRow = await findCity(input.city);
  const regionId = await findRegionId(cityRow);
  const status = input.status ?? "pending_payment";
  const rows = await supabaseRest<ListingRow[]>(
    `/rest/v1/listings?select=${listingSelect}&id=eq.${encodeURIComponent(listingId)}&author_id=eq.${encodeURIComponent(userId)}&status=in.(draft,pending_payment)`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        address: input.address ?? null,
        category_id: categoryId ?? null,
        city_id: cityRow?.id ?? null,
        contact_phone: input.phone ?? null,
        description: input.description || "Описание будет дополнено.",
        booking: input.booking ?? null,
        district: input.district ?? null,
        latitude: input.lat ?? null,
        listing_type: dbTypeByListingKind[input.kind] ?? "sell",
        longitude: input.lng ?? null,
        messenger_url: input.messengerUrl ?? null,
        price: priceToNumber(input.price),
        region_id: regionId ?? null,
        show_exact_address: resolveShowExactAddress(input),
        status,
        title: input.title,
      },
    },
  );

  if (!rows[0]?.id) {
    return undefined;
  }

  await replaceListingImages(listingId, input.mediaPaths);

  return listingWithMediaFallback((await getStoredListingById(listingId)) ?? mapListing(rows[0]), input.mediaPaths);
}

async function storedListingBody(input: CreateStoredListingInput, status: PublicationStatus, options: StoreListingBodyOptions = {}) {
  const categoryId = await findCategoryId(input.categorySlug, input.subcategory);
  const cityRow = await findCity(input.city);
  const regionId = await findRegionId(cityRow);

  return {
    address: input.address ?? null,
    category_id: categoryId ?? null,
    city_id: cityRow?.id ?? null,
    contact_phone: input.phone ?? null,
    description: input.description || "Описание будет дополнено.",
    ...(input.booking === undefined ? {} : { booking: input.booking }),
    district: input.district ?? null,
    latitude: input.lat ?? null,
    listing_type: dbTypeByListingKind[input.kind] ?? "sell",
    longitude: input.lng ?? null,
    messenger_url: input.messengerUrl ?? null,
    price: priceToNumber(input.price),
    ...(options.preserveMedia && input.mediaPaths === undefined ? {} : {}),
    region_id: regionId ?? null,
    show_exact_address: resolveShowExactAddress(input),
    status,
    title: input.title,
  };
}

export async function saveStoredListingForUser(
  listingId: string,
  userId: string,
  input: CreateStoredListingInput,
  options: StoreListingBodyOptions = {},
) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return undefined;
  }

  const existingRows = await supabaseRest<Array<Pick<ListingRow, "id" | "published_at" | "status">>>(
    `/rest/v1/listings?select=id,published_at,status&id=eq.${encodeURIComponent(listingId)}&author_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  const existingListing = existingRows[0];

  if (
    !existingListing ||
    existingListing.status === "archived" ||
    existingListing.status === "sold" ||
    existingListing.status === "expired" ||
    existingListing.status === "rejected"
  ) {
    return undefined;
  }

  const status = existingListing.status;
  const body = await storedListingBody(input, status, options);
  const rows = await supabaseRest<ListingRow[]>(
    `/rest/v1/listings?select=${listingSelect}&id=eq.${encodeURIComponent(listingId)}&author_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body,
    },
  );

  if (!rows[0]?.id) {
    return undefined;
  }

  if (options.clearMedia || input.mediaPaths !== undefined) {
    await replaceListingImages(listingId, input.mediaPaths);
  }

  return listingWithMediaFallback((await getStoredListingById(listingId)) ?? mapListing(rows[0]), input.mediaPaths);
}

export async function markStoredListingPaid(listingId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return false;
  }

  const now = new Date().toISOString();
  const existingRows = await supabaseRest<Array<Pick<ListingRow, "id" | "is_paid" | "status">>>(
    `/rest/v1/listings?select=id,is_paid,status&id=eq.${encodeURIComponent(listingId)}&limit=1`,
  );
  const existingListing = existingRows[0];

  if (!existingListing) {
    return false;
  }

  if (existingListing.status === "published" && existingListing.is_paid) {
    return true;
  }

  if (
    existingListing.status === "archived" ||
    existingListing.status === "sold" ||
    existingListing.status === "expired" ||
    existingListing.status === "rejected"
  ) {
    return true;
  }

  const rows = await supabaseRest<Array<Pick<ListingRow, "id">>>(`/rest/v1/listings?select=id&id=eq.${encodeURIComponent(listingId)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      expires_at: addDaysIsoDate(now, 30),
      is_paid: true,
      published_at: now,
      status: "published",
    },
  });

  return Boolean(rows[0]?.id);
}

export async function getStoredListingById(listingId: string, options: { publicOnly?: boolean } = {}) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return undefined;
  }

  try {
    const statusFilter = options.publicOnly ? "&status=eq.published" : "";
    const rows = await fetchListingRows(`&id=eq.${encodeURIComponent(listingId)}${statusFilter}&limit=1`);

    return rows[0] ? mapListing(rows[0]) : undefined;
  } catch (error) {
    console.error("Failed to load listing from Supabase", error);
    return undefined;
  }
}

export async function getStoredListingForUser(listingId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return undefined;
  }

  const rows = await fetchListingRows(`&id=eq.${encodeURIComponent(listingId)}&author_id=eq.${encodeURIComponent(userId)}&limit=1`);

  return rows[0] ? mapListing(rows[0]) : undefined;
}

export async function recordStoredListingView(listingId: string, viewerKey: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return undefined;
  }

  const normalizedViewerKey = viewerKey.trim().slice(0, 160);

  if (!normalizedViewerKey) {
    return undefined;
  }

  const result = await supabaseRest<number | Array<{ record_listing_view: number }> | { record_listing_view?: number }>("/rest/v1/rpc/record_listing_view", {
    method: "POST",
    body: {
      p_listing_id: listingId,
      p_viewer_key: normalizedViewerKey,
    },
  });

  const value = Number(Array.isArray(result) ? result[0]?.record_listing_view : typeof result === "object" ? result?.record_listing_view : result);

  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export async function listStoredListings(limit = 24) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  try {
    const rows = await fetchListingRows(`&status=eq.published&order=published_at.desc.nullslast,created_at.desc&limit=${limit}`);

    return rows.map(mapListing);
  } catch (error) {
    console.error("Failed to load listings from Supabase", error);
    return [];
  }
}

export async function listStoredListingsForAdmin(limit = 200) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  try {
    const rows = await fetchListingRows(`&order=created_at.desc&limit=${limit}`);

    return rows.map(mapListing);
  } catch (error) {
    console.error("Failed to load admin listings from Supabase", error);
    return [];
  }
}

export async function listStoredListingsForUser(userId: string) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  try {
    const rows = await fetchListingRows(`&author_id=eq.${encodeURIComponent(userId)}&status=neq.archived&order=created_at.desc`);

    return rows.map(mapListing);
  } catch (error) {
    console.error("Failed to load user listings from Supabase", error);
    return [];
  }
}

export async function archiveStoredListingForUser(listingId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return false;
  }

  const rows = await supabaseRest<Array<Pick<ListingRow, "id">>>(
    `/rest/v1/listings?select=id&id=eq.${encodeURIComponent(listingId)}&author_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        published_at: null,
        status: "archived",
      },
    },
  );

  return Boolean(rows[0]?.id);
}

export async function markStoredListingPendingPaymentForUser(listingId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return false;
  }

  const rows = await supabaseRest<Array<Pick<ListingRow, "id">>>(
    `/rest/v1/listings?select=id&id=eq.${encodeURIComponent(listingId)}&author_id=eq.${encodeURIComponent(userId)}&status=eq.draft`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        status: "pending_payment",
      },
    },
  );

  return Boolean(rows[0]?.id);
}

export async function markStoredListingSoldForUser(listingId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return false;
  }

  async function patchListingStatus(status: "expired" | "sold") {
    return supabaseRest<Array<Pick<ListingRow, "id">>>(
      `/rest/v1/listings?select=id&id=eq.${encodeURIComponent(listingId)}&author_id=eq.${encodeURIComponent(userId)}&status=eq.published`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: {
          ...(status === "expired" ? { expires_at: new Date().toISOString() } : {}),
          published_at: null,
          status,
        },
      },
    );
  }

  let rows: Array<Pick<ListingRow, "id">>;

  try {
    rows = await patchListingStatus("sold");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (!message.includes("publication_status") || !message.includes("sold")) {
      throw error;
    }

    rows = await patchListingStatus("expired");
  }

  return Boolean(rows[0]?.id);
}

export async function restoreStoredListingForUser(listingId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return false;
  }

  const now = new Date().toISOString();
  const restoreBody = {
    expires_at: addDaysIsoDate(now, 30),
    is_paid: true,
    published_at: now,
    status: "published",
  };

  async function patchRestorableListing(statusFilter: string) {
    return supabaseRest<Array<Pick<ListingRow, "id">>>(
      `/rest/v1/listings?select=id&id=eq.${encodeURIComponent(listingId)}&author_id=eq.${encodeURIComponent(userId)}&is_paid=eq.true&${statusFilter}`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: restoreBody,
      },
    );
  }

  let rows: Array<Pick<ListingRow, "id">> = [];

  try {
    rows = await patchRestorableListing("status=eq.sold");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (!message.includes("publication_status") || !message.includes("sold")) {
      throw error;
    }
  }

  if (!rows[0]?.id) {
    rows = await patchRestorableListing("status=in.(archived,expired)");
  }

  return Boolean(rows[0]?.id);
}
