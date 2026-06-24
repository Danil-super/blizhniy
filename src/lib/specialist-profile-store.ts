import { region } from "@/lib/data";
import { publicMediaUrl } from "@/lib/storage-upload";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { PublicationStatus, SpecialistProfile } from "@/lib/types";

type SpecialistProfileRow = {
  id: string;
  user_id: string;
  name: string;
  photo_path?: string | null;
  region_id: string;
  city_id: string;
  district?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  show_exact_address: boolean;
  specialist_category_id?: string | null;
  skills?: string[] | null;
  description?: string | null;
  experience?: string | null;
  price_from?: number | string | null;
  contact_phone?: string | null;
  email?: string | null;
  messenger_url?: string | null;
  video_url?: string | null;
  status: PublicationStatus;
  created_at: string;
  updated_at: string;
  cities?: {
    name: string;
    slug: string;
  } | null;
  specialist_categories?: {
    name: string;
    slug: string;
  } | null;
  profiles?: {
    display_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
};

type ProfileRow = {
  id: string;
  email?: string | null;
  phone?: string | null;
  display_name?: string | null;
};

type CityIdRow = { id: string; name: string; region_id?: string | null; slug: string };
type RegionIdRow = { id: string; name: string; slug: string };
type SpecialistCategoryRow = { id: string; name: string; slug: string };

export type SpecialistProfileInput = {
  address?: string;
  city?: string;
  description?: string;
  email?: string;
  lat?: number;
  lng?: number;
  messengerUrl?: string;
  name?: string;
  phone?: string;
  price?: string;
  profession?: string;
  skills?: string;
  status?: PublicationStatus;
  videoUrl?: string;
};

export type SpecialistProfileCompleteness = {
  complete: boolean;
  missing: string[];
};

const specialistProfileSelect =
  "id,user_id,name,photo_path,region_id,city_id,district,address,latitude,longitude,show_exact_address,specialist_category_id,skills,description,experience,price_from,contact_phone,email,messenger_url,video_url,status,created_at,updated_at,cities(slug,name),specialist_categories(slug,name),profiles(display_name,email,phone)";

function normalizeText(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function priceToNumber(value?: string) {
  const digits = (value ?? "").replace(/[^0-9]/g, "");
  const numeric = digits ? Number(digits) : 0;

  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function formatPrice(value?: number | string | null) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }

  return `${new Intl.NumberFormat("ru-RU").format(numeric).replace(/\u00a0/g, " ")} ₽`;
}

function toNumber(value: SpecialistProfileRow["latitude"]) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function skillsArray(value?: string | string[] | null) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).slice(0, 20);
  }

  return normalizeText(value)
    .split(/[,\n]/)
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 20);
}

function mapSpecialistProfile(row: SpecialistProfileRow): SpecialistProfile {
  const photo = row.photo_path ? publicMediaUrl(row.photo_path) : undefined;

  return {
    id: row.id,
    name: row.name || row.profiles?.display_name || "Пользователь",
    profession: row.specialist_categories?.name ?? "",
    skills: skillsArray(row.skills).join(", "),
    description: row.description ?? undefined,
    city: row.cities?.name ?? "Краснодар",
    district: row.district ?? undefined,
    address: row.address ?? undefined,
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
    hasMapPoint: Boolean(row.latitude && row.longitude),
    showExactAddress: row.show_exact_address,
    price: formatPrice(row.price_from),
    imageSeed: "alex",
    images: photo ? [photo] : undefined,
    phone: row.contact_phone || row.profiles?.phone || undefined,
    email: row.email || row.profiles?.email || undefined,
    messengerUrl: row.messenger_url ?? undefined,
    videoUrl: row.video_url ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    publishedAt: row.status === "published" ? row.updated_at : undefined,
  };
}

async function findCity(city?: string) {
  const cityName = normalizeText(city).split(",")[0]?.trim() || "Краснодар";
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
  const name = normalizeText(profession);

  if (!name) {
    return null;
  }

  const rows = await supabaseRest<SpecialistCategoryRow[]>(
    `/rest/v1/specialist_categories?select=id,name,slug&name=ilike.${encodeURIComponent(name)}&limit=1`,
  );

  return rows[0]?.id ?? null;
}

async function ensureProfileRow(userId: string, input: { email?: string; name?: string; phone?: string }) {
  const rows = await supabaseRest<ProfileRow[]>(
    `/rest/v1/profiles?select=id,email,phone,display_name&id=eq.${encodeURIComponent(userId)}&limit=1`,
  ).catch(() => []);

  if (rows[0]) {
    return rows[0];
  }

  const created = await supabaseRest<ProfileRow[]>("/rest/v1/profiles?select=id,email,phone,display_name", {
    method: "POST",
    prefer: "return=representation",
    body: {
      display_name: normalizeText(input.name) || "Пользователь",
      email: normalizeText(input.email).toLowerCase() || null,
      id: userId,
      phone: normalizeText(input.phone) || null,
    },
  });

  return created[0];
}

export function getSpecialistProfileCompleteness(profile?: SpecialistProfile | null): SpecialistProfileCompleteness {
  const missing: string[] = [];

  if (!profile?.name || profile.name.length < 2) missing.push("имя");
  if (!profile?.profession) missing.push("профессия");
  if (!profile?.city) missing.push("город");
  if (!profile?.price) missing.push("стоимость работ");
  if (!profile?.skills || profile.skills.length < 3) missing.push("навыки");
  if (!profile?.description || profile.description.length < 20) missing.push("описание");
  if (!profile?.phone && !profile?.email && !profile?.messengerUrl) missing.push("телефон, email или мессенджер");

  return { complete: missing.length === 0, missing };
}

export async function getStoredSpecialistProfileForUser(user: { email?: string; id: string; name?: string; phone?: string }, options: { createDraft?: boolean } = {}) {
  if (!isSupabaseRestConfigured() || !isUuid(user.id)) {
    return undefined;
  }

  const rows = await supabaseRest<SpecialistProfileRow[]>(
    `/rest/v1/specialist_profiles?select=${specialistProfileSelect}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
  ).catch(() => []);

  if (rows[0]) {
    return mapSpecialistProfile(rows[0]);
  }

  if (!options.createDraft) {
    return undefined;
  }

  await ensureProfileRow(user.id, user);
  const cityRow = await findCity();
  const regionId = await findRegionId(cityRow);

  if (!cityRow?.id || !regionId) {
    throw new Error("Не удалось создать анкету: город не найден.");
  }

  const created = await supabaseRest<SpecialistProfileRow[]>(`/rest/v1/specialist_profiles?select=${specialistProfileSelect}`, {
    method: "POST",
    prefer: "return=representation",
    body: {
      city_id: cityRow.id,
      contact_phone: normalizeText(user.phone) || null,
      email: normalizeText(user.email).toLowerCase() || null,
      name: normalizeText(user.name) || normalizeText(user.email).split("@")[0] || "Пользователь",
      region_id: regionId,
      status: "draft",
      user_id: user.id,
    },
  });

  return created[0] ? mapSpecialistProfile(created[0]) : undefined;
}

export async function upsertStoredSpecialistProfileForUser(user: { email?: string; id: string; name?: string; phone?: string }, input: SpecialistProfileInput) {
  if (!isSupabaseRestConfigured() || !isUuid(user.id)) {
    return undefined;
  }

  await ensureProfileRow(user.id, { email: input.email || user.email, name: input.name || user.name, phone: input.phone || user.phone });
  const current = await getStoredSpecialistProfileForUser(user, { createDraft: true });
  const cityRow = await findCity(input.city || current?.city);
  const regionId = await findRegionId(cityRow);
  const categoryId = await findSpecialistCategoryId(input.profession);

  if (!current?.id || !cityRow?.id || !regionId) {
    throw new Error("Не удалось сохранить анкету.");
  }

  const desiredStatus = input.status ?? current.status;
  const body = {
    address: normalizeText(input.address) || null,
    city_id: cityRow.id,
    contact_phone: normalizeText(input.phone) || null,
    description: normalizeText(input.description) || null,
    email: normalizeText(input.email).toLowerCase() || null,
    latitude: input.lat ?? null,
    longitude: input.lng ?? null,
    messenger_url: normalizeText(input.messengerUrl) || null,
    name: normalizeText(input.name) || current.name,
    price_from: priceToNumber(input.price),
    region_id: regionId,
    show_exact_address: Boolean(input.address && input.lat && input.lng),
    skills: skillsArray(input.skills),
    specialist_category_id: categoryId,
    status: desiredStatus,
    updated_at: new Date().toISOString(),
    video_url: normalizeText(input.videoUrl) || null,
  };
  const previewProfile: SpecialistProfile = {
    ...current,
    address: body.address ?? undefined,
    city: cityRow.name,
    description: body.description ?? undefined,
    email: body.email ?? undefined,
    lat: body.latitude ?? undefined,
    lng: body.longitude ?? undefined,
    messengerUrl: body.messenger_url ?? undefined,
    name: body.name,
    phone: body.contact_phone ?? undefined,
    price: formatPrice(body.price_from),
    profession: normalizeText(input.profession),
    skills: body.skills.join(", "),
    status: desiredStatus,
    videoUrl: body.video_url ?? undefined,
  };

  if (desiredStatus === "published") {
    const completeness = getSpecialistProfileCompleteness(previewProfile);

    if (!completeness.complete) {
      throw new Error(`Для активации заполните: ${completeness.missing.join(", ")}.`);
    }
  }

  const rows = await supabaseRest<SpecialistProfileRow[]>(
    `/rest/v1/specialist_profiles?select=${specialistProfileSelect}&id=eq.${encodeURIComponent(current.id)}&user_id=eq.${encodeURIComponent(user.id)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body,
    },
  );

  return rows[0] ? mapSpecialistProfile(rows[0]) : undefined;
}

export async function getActiveStoredSpecialistProfileForUser(userId: string) {
  const profile = await getStoredSpecialistProfileForUser({ id: userId }, { createDraft: false });

  if (!profile || profile.status !== "published") {
    return undefined;
  }

  return profile;
}

export async function listStoredSpecialistProfiles(limit = 24) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  const rows = await supabaseRest<SpecialistProfileRow[]>(
    `/rest/v1/specialist_profiles?select=${specialistProfileSelect}&status=eq.published&order=updated_at.desc&limit=${limit}`,
  ).catch(() => []);

  return rows.map(mapSpecialistProfile);
}

export async function listStoredSpecialistProfilesForAdmin(limit = 200) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  const rows = await supabaseRest<SpecialistProfileRow[]>(
    `/rest/v1/specialist_profiles?select=${specialistProfileSelect}&order=updated_at.desc&limit=${limit}`,
  ).catch((error) => {
    console.error("Failed to load admin specialist profiles from Supabase", error);
    return [];
  });

  return rows.map(mapSpecialistProfile);
}

export async function getStoredSpecialistProfileById(profileId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(profileId)) {
    return undefined;
  }

  const rows = await supabaseRest<SpecialistProfileRow[]>(
    `/rest/v1/specialist_profiles?select=${specialistProfileSelect}&id=eq.${encodeURIComponent(profileId)}&status=eq.published&limit=1`,
  ).catch(() => []);

  return rows[0] ? mapSpecialistProfile(rows[0]) : undefined;
}

export function listSpecialistsWithStored(storedProfiles: SpecialistProfile[], fallbackProfiles: SpecialistProfile[]) {
  if (!shouldShowFallbackContent()) {
    return storedProfiles;
  }

  if (!storedProfiles.length) {
    return fallbackProfiles;
  }

  const storedIds = new Set(storedProfiles.map((profile) => profile.id));
  return [...storedProfiles, ...fallbackProfiles.filter((profile) => !storedIds.has(profile.id))];
}
