import { fairApplications as demoFairApplications } from "@/lib/data";
import { isSupabaseRestConfigured, supabaseRest } from "@/lib/supabase-rest";
import type { FairApplication, PublicationStatus } from "@/lib/types";

type FairApplicationRow = {
  id: string;
  user_id?: string | null;
  participant_name: string;
  city_id?: string | null;
  fair_category: string;
  description: string;
  video_url?: string | null;
  contact_phone: string;
  email: string;
  comment?: string | null;
  district?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  show_exact_address: boolean;
  status: PublicationStatus;
  payment_status: FairApplication["paymentStatus"];
  created_at: string;
  published_at?: string | null;
};

type FairApplicationImageRow = {
  fair_application_id: string;
  storage_path: string;
  sort_order: number;
};

type CityRow = {
  id: string;
  name: string;
};

export type CreateStoredFairApplicationInput = {
  category: string;
  city: string;
  comment?: string;
  description: string;
  email: string;
  participantName: string;
  phone: string;
  productPhotos: string[];
  userId: string;
  videoUrl?: string;
};

type UpdateFairApplicationStatusOptions = {
  adminContext?: boolean;
};

function toNumber(value: FairApplicationRow["latitude"]) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapFairApplication(row: FairApplicationRow, citiesById = new Map<string, string>(), photos: string[] = []): FairApplication {
  return {
    id: row.id,
    participantName: row.participant_name,
    city: (row.city_id ? citiesById.get(row.city_id) : undefined) ?? "Краснодарский край",
    category: row.fair_category,
    description: row.description,
    productPhotos: photos,
    videoUrl: row.video_url ?? undefined,
    phone: row.contact_phone,
    email: row.email,
    comment: row.comment ?? undefined,
    status: row.status,
    paymentStatus: row.payment_status,
    address: row.address ?? undefined,
    district: row.district ?? undefined,
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
    showExactAddress: row.show_exact_address,
    createdAt: row.created_at.slice(0, 10),
  };
}

async function fetchCitiesById(cityIds: string[]) {
  const uniqueCityIds = Array.from(new Set(cityIds.filter(Boolean)));

  if (!uniqueCityIds.length) {
    return new Map<string, string>();
  }

  const query = encodeURIComponent(`(${uniqueCityIds.join(",")})`);
  const rows = await supabaseRest<CityRow[]>(`/rest/v1/cities?select=id,name&id=in.${query}`);

  return new Map(rows.map((city) => [city.id, city.name]));
}

async function fetchImagesByApplicationId(applicationIds: string[]) {
  const uniqueIds = Array.from(new Set(applicationIds.filter(Boolean)));

  if (!uniqueIds.length) {
    return new Map<string, string[]>();
  }

  const query = encodeURIComponent(`(${uniqueIds.join(",")})`);
  const rows = await supabaseRest<FairApplicationImageRow[]>(
    `/rest/v1/fair_application_images?select=fair_application_id,storage_path,sort_order&fair_application_id=in.${query}&order=sort_order.asc`,
  );
  const imagesByApplication = new Map<string, string[]>();

  for (const row of rows) {
    const images = imagesByApplication.get(row.fair_application_id) ?? [];
    images.push(row.storage_path);
    imagesByApplication.set(row.fair_application_id, images);
  }

  return imagesByApplication;
}

async function mapRows(rows: FairApplicationRow[]) {
  const citiesById = await fetchCitiesById(rows.map((row) => row.city_id ?? ""));
  const imagesByApplication = await fetchImagesByApplicationId(rows.map((row) => row.id));

  return rows.map((row) => mapFairApplication(row, citiesById, imagesByApplication.get(row.id) ?? []));
}

async function findCityId(cityName: string) {
  const normalizedCity = cityName.trim();

  if (!normalizedCity) {
    return null;
  }

  const rows = await supabaseRest<CityRow[]>(
    `/rest/v1/cities?select=id,name&name=ilike.${encodeURIComponent(normalizedCity)}&limit=1`,
  );

  return rows[0]?.id ?? null;
}

export async function listStoredFairApplications(status?: PublicationStatus) {
  if (!isSupabaseRestConfigured()) {
    return demoFairApplications.filter((application) => !status || application.status === status);
  }

  try {
    const statusFilter = status ? `&status=eq.${encodeURIComponent(status)}` : "";
    const rows = await supabaseRest<FairApplicationRow[]>(
      `/rest/v1/fair_applications?select=*&order=created_at.desc${statusFilter}`,
    );

    return mapRows(rows);
  } catch (error) {
    console.error("Failed to load fair applications from Supabase", error);
    return demoFairApplications.filter((application) => !status || application.status === status);
  }
}

export async function listStoredFairApplicationsForUser(userId: string) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  const rows = await supabaseRest<FairApplicationRow[]>(
    `/rest/v1/fair_applications?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
  );

  return mapRows(rows);
}

export async function createStoredFairApplication(input: CreateStoredFairApplicationInput) {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  const cityId = await findCityId(input.city);
  const rows = await supabaseRest<FairApplicationRow[]>("/rest/v1/fair_applications?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
      user_id: input.userId,
      participant_name: input.participantName,
      city_id: cityId,
      fair_category: input.category,
      description: input.description,
      video_url: input.videoUrl || null,
      contact_phone: input.phone,
      email: input.email,
      comment: input.comment || null,
      status: "pending_payment",
      payment_status: "created",
    },
  });
  const application = rows[0];

  if (!application) {
    throw new Error("Не удалось создать заявку");
  }

  if (input.productPhotos.length) {
    await supabaseRest("/rest/v1/fair_application_images", {
      method: "POST",
      prefer: "return=minimal",
      body: input.productPhotos.map((photo, index) => ({
        fair_application_id: application.id,
        storage_path: photo,
        sort_order: index,
      })),
    });
  }

  const citiesById = cityId ? new Map([[cityId, input.city]]) : new Map<string, string>();
  return mapFairApplication(application, citiesById, input.productPhotos);
}

export async function updateStoredFairApplicationStatus(applicationId: string, status: PublicationStatus, options: UpdateFairApplicationStatusOptions = {}) {
  if (!isSupabaseRestConfigured() || !options.adminContext) {
    return false;
  }

  const body: Partial<FairApplicationRow> = {
    status,
  };

  if (status === "published") {
    body.published_at = new Date().toISOString();
  }

  await supabaseRest(`/rest/v1/fair_applications?id=eq.${encodeURIComponent(applicationId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body,
  });

  return true;
}

export async function markStoredFairApplicationPaid(applicationId: string) {
  if (!isSupabaseRestConfigured()) {
    return false;
  }

  await supabaseRest(`/rest/v1/fair_applications?id=eq.${encodeURIComponent(applicationId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      payment_status: "succeeded",
      published_at: new Date().toISOString(),
      status: "published",
    },
  });

  return true;
}
