import { region, workRequests as demoWorkRequests } from "@/lib/data";
import { publicMediaUrl } from "@/lib/storage-upload";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { PublicationStatus, WorkRequest } from "@/lib/types";

type WorkRequestStatusRow = {
  id: string;
  published_at?: string | null;
  status: PublicationStatus;
};

type WorkRequestRow = {
  id: string;
  author_id: string;
  title: string;
  description: string;
  specialist_category_id?: string | null;
  region_id: string;
  city_id: string;
  district?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  show_exact_address: boolean;
  budget?: number | string | null;
  photo_path?: string | null;
  contact_phone?: string | null;
  messenger_url?: string | null;
  status: PublicationStatus;
  created_at: string;
  published_at?: string | null;
  cities?: {
    name: string;
    slug: string;
  } | null;
  profiles?: {
    display_name?: string | null;
  } | null;
  specialist_categories?: {
    name: string;
    slug: string;
  } | null;
};

type CityIdRow = { id: string; name: string; region_id?: string | null; slug: string };
type RegionIdRow = { id: string; name: string; slug: string };
type SpecialistCategoryRow = { id: string; name: string; slug: string };

export type CreateStoredWorkRequestInput = {
  address?: string;
  authorId: string;
  budget?: string;
  city: string;
  description?: string;
  district?: string;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
  phone?: string;
  profession?: string;
  status?: PublicationStatus;
  title: string;
};

const workRequestSelect =
  "id,author_id,title,description,specialist_category_id,region_id,city_id,district,address,latitude,longitude,show_exact_address,budget,photo_path,contact_phone,messenger_url,status,created_at,published_at,cities(slug,name),profiles(display_name),specialist_categories(slug,name)";

function normalizeLookupText(value?: string) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function toNumber(value: WorkRequestRow["latitude"]) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function budgetToNumber(value?: string) {
  const digits = (value ?? "").replace(/[^0-9]/g, "");
  const amount = digits ? Number(digits) : 0;

  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function formatBudget(value: WorkRequestRow["budget"]) {
  if (value === null || value === undefined || value === "") {
    return "по договоренности";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "по договоренности";
  }

  return `${new Intl.NumberFormat("ru-RU").format(numeric).replace(/\u00a0/g, " ")} ₽`;
}

function mediaUrls(row: WorkRequestRow) {
  return row.photo_path ? [publicMediaUrl(row.photo_path)] : undefined;
}

function mapWorkRequest(row: WorkRequestRow): WorkRequest {
  const publishedAt = row.published_at ?? row.created_at;

  return {
    id: row.id,
    author: row.profiles?.display_name ?? "Заказчик БЛИЖНИЙ",
    title: row.title,
    description: row.description,
    profession: row.specialist_categories?.name ?? "Заказ исполнителю",
    city: row.cities?.name ?? "Краснодар",
    district: row.district ?? undefined,
    address: row.address ?? undefined,
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
    showExactAddress: row.show_exact_address,
    budget: formatBudget(row.budget),
    images: mediaUrls(row),
    phone: row.contact_phone ?? undefined,
    messengerUrl: row.messenger_url ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    publishedAt: publishedAt ?? undefined,
  };
}

async function findCity(city: string) {
  const cityName = city.split(",")[0]?.trim() || "Краснодар";
  const rows = await supabaseRest<CityIdRow[]>(
    `/rest/v1/cities?select=id,name,slug,region_id&name=eq.${encodeURIComponent(cityName)}&limit=1`,
  );

  if (rows[0]) {
    return rows[0];
  }

  const fallbackRows = await supabaseRest<CityIdRow[]>("/rest/v1/cities?select=id,name,slug,region_id&name=eq.%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%BE%D0%B4%D0%B0%D1%80&limit=1");
  return fallbackRows[0];
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

async function findSpecialistCategoryId(profession?: string) {
  const name = profession?.trim();

  if (!name) {
    return null;
  }

  const rows = await supabaseRest<SpecialistCategoryRow[]>(
    `/rest/v1/specialist_categories?select=id,name,slug&name=ilike.${encodeURIComponent(name)}&limit=1`,
  );

  return rows[0]?.id ?? null;
}

function cleanMediaPaths(paths?: string[]) {
  if (!Array.isArray(paths)) {
    return [];
  }

  return paths.map((path) => path.trim()).filter((path) => path && path.length <= 500).slice(0, 6);
}

function workRequestWithMediaFallback(request: WorkRequest, mediaPaths?: string[]) {
  const images = cleanMediaPaths(mediaPaths).map(publicMediaUrl);

  if (!images.length || request.images?.length) {
    return request;
  }

  return { ...request, images };
}

async function storedWorkRequestBody(input: CreateStoredWorkRequestInput, status: PublicationStatus, publishedAt?: string | null) {
  const cityRow = await findCity(input.city);
  const regionId = await findRegionId(cityRow);
  const specialistCategoryId = await findSpecialistCategoryId(input.profession);
  const mediaPaths = cleanMediaPaths(input.mediaPaths);

  if (!cityRow?.id || !regionId) {
    throw new Error("Не удалось определить город для заказа");
  }

  return {
    address: input.address ?? null,
    author_id: input.authorId,
    budget: budgetToNumber(input.budget),
    city_id: cityRow.id,
    contact_phone: input.phone ?? null,
    description: input.description || "Описание задачи будет дополнено.",
    district: input.district ?? null,
    latitude: input.lat ?? null,
    longitude: input.lng ?? null,
    messenger_url: input.messengerUrl ?? null,
    photo_path: mediaPaths[0] ?? null,
    published_at: status === "published" ? (publishedAt ?? new Date().toISOString()) : null,
    region_id: regionId,
    request_type: "private_request",
    show_exact_address: Boolean(input.address && input.lat && input.lng),
    specialist_category_id: specialistCategoryId,
    status,
    title: input.title,
  };
}

function workRequestMatchesReusableInput(request: WorkRequest, input: CreateStoredWorkRequestInput) {
  return (
    normalizeLookupText(request.city) === normalizeLookupText(input.city) &&
    normalizeLookupText(request.description) === normalizeLookupText(input.description || "Описание задачи будет дополнено.") &&
    normalizeLookupText(request.phone) === normalizeLookupText(input.phone) &&
    normalizeLookupText(request.messengerUrl) === normalizeLookupText(input.messengerUrl)
  );
}

export async function createStoredWorkRequest(input: CreateStoredWorkRequestInput) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  const status = input.status ?? "pending_payment";
  const rows = await supabaseRest<WorkRequestRow[]>(`/rest/v1/work_requests?select=${workRequestSelect}`, {
    method: "POST",
    prefer: "return=representation",
    body: await storedWorkRequestBody(input, status),
  });
  const request = rows[0];

  if (!request) {
    return undefined;
  }

  return workRequestWithMediaFallback((await getStoredWorkRequestById(request.id)) ?? mapWorkRequest(request), input.mediaPaths);
}

export async function findReusableStoredWorkRequestForPayment(input: CreateStoredWorkRequestInput) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  const title = input.title.trim();

  if (title.length < 3) {
    return undefined;
  }

  const rows = await supabaseRest<WorkRequestRow[]>(
    `/rest/v1/work_requests?select=${workRequestSelect}&author_id=eq.${encodeURIComponent(input.authorId)}&title=eq.${encodeURIComponent(title)}&status=in.(draft,pending_payment)&order=created_at.desc&limit=20`,
  );

  return rows.map(mapWorkRequest).find((request) => workRequestMatchesReusableInput(request, input));
}

export async function updateStoredWorkRequestForUser(requestId: string, userId: string, input: CreateStoredWorkRequestInput) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return undefined;
  }

  const existingRows = await supabaseRest<WorkRequestRow[]>(
    `/rest/v1/work_requests?select=${workRequestSelect}&id=eq.${encodeURIComponent(requestId)}&author_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  const existingRequest = existingRows[0];

  if (!existingRequest) {
    return undefined;
  }

  const status = input.status ?? existingRequest.status ?? "pending_payment";
  const body = await storedWorkRequestBody(input, status, existingRequest.published_at);

  if (input.address === undefined && input.lat === undefined && input.lng === undefined) {
    body.address = existingRequest.address ?? null;
    body.latitude = toNumber(existingRequest.latitude) ?? null;
    body.longitude = toNumber(existingRequest.longitude) ?? null;
    body.show_exact_address = existingRequest.show_exact_address;
  }

  if (input.district === undefined) {
    body.district = existingRequest.district ?? null;
  }

  const rows = await supabaseRest<WorkRequestRow[]>(
    `/rest/v1/work_requests?select=${workRequestSelect}&id=eq.${encodeURIComponent(requestId)}&author_id=eq.${encodeURIComponent(userId)}&status=in.(draft,pending_payment,published)`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body,
    },
  );

  if (!rows[0]?.id) {
    return undefined;
  }

  return workRequestWithMediaFallback((await getStoredWorkRequestById(requestId)) ?? mapWorkRequest(rows[0]), input.mediaPaths);
}

export async function getStoredWorkRequestById(requestId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return undefined;
  }

  try {
    const rows = await supabaseRest<WorkRequestRow[]>(
      `/rest/v1/work_requests?select=${workRequestSelect}&id=eq.${encodeURIComponent(requestId)}&limit=1`,
    );

    return rows[0] ? mapWorkRequest(rows[0]) : undefined;
  } catch (error) {
    console.error("Failed to load work request from Supabase", error);
    return undefined;
  }
}

export async function listStoredWorkRequests(limit = 24) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  try {
    const rows = await supabaseRest<WorkRequestRow[]>(
      `/rest/v1/work_requests?select=${workRequestSelect}&status=eq.published&order=published_at.desc.nullslast,created_at.desc&limit=${limit}`,
    );

    return rows.map(mapWorkRequest);
  } catch (error) {
    console.error("Failed to load work requests from Supabase", error);
    return [];
  }
}

export function listWorkRequestsWithStored(storedRequests: WorkRequest[]) {
  if (!storedRequests.length) {
    return demoWorkRequests;
  }

  const storedIds = new Set(storedRequests.map((request) => request.id));

  return [...storedRequests, ...demoWorkRequests.filter((request) => !storedIds.has(request.id))];
}

export async function getStoredWorkRequestForUser(requestId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return undefined;
  }

  const rows = await supabaseRest<WorkRequestStatusRow[]>(
    `/rest/v1/work_requests?select=id,status,published_at&id=eq.${encodeURIComponent(requestId)}&author_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );

  return rows[0];
}

export async function markStoredWorkRequestPendingPaymentForUser(requestId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return false;
  }

  const rows = await supabaseRest<Array<Pick<WorkRequestStatusRow, "id">>>(
    `/rest/v1/work_requests?select=id&id=eq.${encodeURIComponent(requestId)}&author_id=eq.${encodeURIComponent(userId)}&status=eq.draft`,
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

export async function markStoredWorkRequestPaid(requestId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return false;
  }

  const now = new Date().toISOString();
  const existingRows = await supabaseRest<WorkRequestStatusRow[]>(
    `/rest/v1/work_requests?select=id,status,published_at&id=eq.${encodeURIComponent(requestId)}&limit=1`,
  );
  const existingRequest = existingRows[0];

  if (!existingRequest) {
    return false;
  }

  if (existingRequest.status === "published") {
    return true;
  }

  if (existingRequest.status === "archived" || existingRequest.status === "expired" || existingRequest.status === "rejected") {
    return true;
  }

  const rows = await supabaseRest<Array<Pick<WorkRequestStatusRow, "id">>>(
    `/rest/v1/work_requests?select=id&id=eq.${encodeURIComponent(requestId)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        published_at: now,
        status: "published",
      },
    },
  );

  return Boolean(rows[0]?.id);
}

export async function deleteStoredWorkRequestForUser(requestId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(requestId)) {
    return false;
  }

  const rows = await supabaseRest<Array<Pick<WorkRequestStatusRow, "id">>>(
    `/rest/v1/work_requests?select=id&id=eq.${encodeURIComponent(requestId)}&author_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      prefer: "return=representation",
    },
  );

  return Boolean(rows[0]?.id);
}
