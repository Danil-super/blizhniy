import { region, vacancies as demoVacancies } from "@/lib/data";
import { hasMapCoordinates } from "@/lib/map-location";
import { publicMediaUrl } from "@/lib/storage-upload";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { JobVacancy, PublicationStatus } from "@/lib/types";

type VacancyRow = {
  id: string;
  author_id: string;
  employer_type?: string | null;
  organization_name: string;
  logo_path?: string | null;
  title: string;
  inn?: string | null;
  ogrn?: string | null;
  ogrnip?: string | null;
  contact_person?: string | null;
  website?: string | null;
  specialist_category_id?: string | null;
  region_id: string;
  city_id: string;
  district?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  show_exact_address: boolean;
  description: string;
  requirements?: string | null;
  responsibilities?: string | null;
  conditions?: string | null;
  salary?: number | string | null;
  schedule?: string | null;
  work_format?: string | null;
  contact_phone?: string | null;
  messenger_url?: string | null;
  email?: string | null;
  placement_right_confirmed?: boolean | null;
  status: PublicationStatus;
  is_paid: boolean;
  created_at: string;
  published_at?: string | null;
  expires_at?: string | null;
  vacancy_images?: VacancyImageRow[] | null;
  cities?: {
    name: string;
    slug: string;
  } | null;
  specialist_categories?: {
    name: string;
    slug: string;
  } | null;
};

type VacancyImageRow = {
  sort_order?: number | null;
  storage_path: string;
};

type CityIdRow = { id: string; name: string; region_id?: string | null; slug: string };
type RegionIdRow = { id: string; name: string; slug: string };
type SpecialistCategoryRow = { id: string; name: string; slug: string };

export type CreateStoredVacancyInput = {
  address?: string;
  authorId: string;
  city: string;
  conditions?: string;
  description?: string;
  district?: string;
  email?: string;
  employerType?: string;
  lat?: number;
  lng?: number;
  mediaPaths?: string[];
  messengerUrl?: string;
  inn?: string;
  ogrn?: string;
  ogrnip?: string;
  contactPerson?: string;
  organization: string;
  placementRightConfirmed?: boolean;
  phone?: string;
  profession?: string;
  requirements?: string;
  responsibilities?: string;
  salary?: string;
  schedule?: string;
  status?: PublicationStatus;
  title: string;
  website?: string;
  workFormat?: string;
};

type StoreVacancyBodyOptions = {
  clearMedia?: boolean;
  preserveMedia?: boolean;
};

const vacancySelect =
  "id,author_id,employer_type,organization_name,logo_path,title,inn,ogrn,ogrnip,contact_person,website,specialist_category_id,region_id,city_id,district,address,latitude,longitude,show_exact_address,description,requirements,responsibilities,conditions,salary,schedule,work_format,contact_phone,messenger_url,email,placement_right_confirmed,status,is_paid,created_at,published_at,expires_at,vacancy_images(storage_path,sort_order),cities(slug,name),specialist_categories(slug,name)";

function normalizeLookupText(value?: string) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function toNumber(value: VacancyRow["latitude"]) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function salaryToNumber(value?: string) {
  const digits = (value ?? "").replace(/[^0-9]/g, "");
  const amount = digits ? Number(digits) : 0;

  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function formatSalary(value: VacancyRow["salary"]) {
  if (value === null || value === undefined || value === "") {
    return "по договоренности";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "по договоренности";
  }

  return `от ${new Intl.NumberFormat("ru-RU").format(numeric).replace(/\u00a0/g, " ")} ₽`;
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

function cleanMediaPaths(paths?: string[]) {
  if (!Array.isArray(paths)) {
    return [];
  }

  return paths.map((path) => path.trim()).filter((path) => path && path.length <= 500).slice(0, 20);
}

function mediaUrls(row: VacancyRow) {
  const images = [...(row.vacancy_images ?? [])]
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((image) => image.storage_path)
    .filter(Boolean)
    .map(publicMediaUrl);

  if (images.length) {
    return images;
  }

  return row.logo_path ? [publicMediaUrl(row.logo_path)] : undefined;
}

function vacancyWithMediaFallback(vacancy: JobVacancy, mediaPaths?: string[]) {
  const images = cleanMediaPaths(mediaPaths).map(publicMediaUrl);

  if (!images.length || vacancy.images?.length) {
    return vacancy;
  }

  return { ...vacancy, images };
}

async function insertVacancyImages(vacancyId: string, mediaPaths?: string[]) {
  const paths = cleanMediaPaths(mediaPaths);

  if (!paths.length) {
    return;
  }

  await supabaseRest("/rest/v1/vacancy_images", {
    method: "POST",
    prefer: "return=minimal",
    body: paths.map((path, index) => ({
      vacancy_id: vacancyId,
      storage_path: path,
      sort_order: index,
    })),
  });
}

async function replaceVacancyImages(vacancyId: string, mediaPaths?: string[]) {
  const paths = cleanMediaPaths(mediaPaths);

  await supabaseRest(`/rest/v1/vacancy_images?vacancy_id=eq.${encodeURIComponent(vacancyId)}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });

  if (paths.length) {
    await insertVacancyImages(vacancyId, paths);
  }
}

function normalizeEmployerType(value?: string) {
  return value === "ip" || value === "person" || value === "private" ? (value === "private" ? "person" : value) : "organization";
}

function mapVacancy(row: VacancyRow): JobVacancy {
  const publishedAt = row.published_at ?? row.created_at;

  return {
    id: row.id,
    employerType: normalizeEmployerType(row.employer_type ?? undefined),
    organization: row.organization_name,
    inn: row.inn ?? undefined,
    ogrn: row.ogrn ?? undefined,
    ogrnip: row.ogrnip ?? undefined,
    contactPerson: row.contact_person ?? undefined,
    website: row.website ?? undefined,
    title: row.title,
    profession: row.specialist_categories?.name ?? row.title,
    city: row.cities?.name ?? "Краснодар",
    district: row.district ?? undefined,
    address: row.address ?? undefined,
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
    hasMapPoint: Boolean(row.show_exact_address && row.latitude && row.longitude),
    showExactAddress: row.show_exact_address,
    salary: formatSalary(row.salary),
    logoText: row.organization_name.slice(0, 12),
    logoTone: "blue",
    images: mediaUrls(row),
    phone: row.contact_phone ?? undefined,
    email: row.email ?? undefined,
    messengerUrl: row.messenger_url ?? undefined,
    schedule: row.schedule ?? undefined,
    workFormat: row.work_format ?? undefined,
    description: row.description,
    requirements: row.requirements ?? undefined,
    responsibilities: row.responsibilities ?? undefined,
    conditions: row.conditions ?? undefined,
    placementRightConfirmed: Boolean(row.placement_right_confirmed),
    status: row.status,
    createdAt: row.created_at,
    publishedAt: isoDate(publishedAt),
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

function descriptionWithExtra(input: CreateStoredVacancyInput) {
  return input.description?.trim() || "Описание вакансии будет дополнено.";
}

function vacancyMatchesReusableInput(vacancy: JobVacancy, input: CreateStoredVacancyInput) {
  return (
    normalizeLookupText(vacancy.organization) === normalizeLookupText(input.organization) &&
    normalizeLookupText(vacancy.city) === normalizeLookupText(input.city) &&
    normalizeLookupText(vacancy.phone) === normalizeLookupText(input.phone) &&
    normalizeLookupText(vacancy.email) === normalizeLookupText(input.email)
  );
}

async function storedVacancyBody(input: CreateStoredVacancyInput, status: PublicationStatus, options: StoreVacancyBodyOptions = {}) {
  const cityRow = await findCity(input.city);
  const regionId = await findRegionId(cityRow);
  const specialistCategoryId = await findSpecialistCategoryId(input.profession);
  const mediaPaths = cleanMediaPaths(input.mediaPaths);

  if (!cityRow?.id || !regionId) {
    throw new Error("Не удалось определить город для вакансии");
  }

  return {
    address: input.address ?? null,
    author_id: input.authorId,
    city_id: cityRow.id,
    conditions: input.conditions || null,
    contact_phone: input.phone ?? null,
    description: descriptionWithExtra(input),
    district: input.district ?? null,
    email: input.email ?? null,
    employer_type: normalizeEmployerType(input.employerType),
    is_paid: status === "published",
    inn: input.inn || null,
    latitude: input.lat ?? null,
    ...(options.preserveMedia && input.mediaPaths === undefined ? {} : { logo_path: options.clearMedia ? null : mediaPaths[0] ?? null }),
    longitude: input.lng ?? null,
    messenger_url: input.messengerUrl ?? null,
    contact_person: input.contactPerson || null,
    ogrn: input.ogrn || null,
    ogrnip: input.ogrnip || null,
    organization_name: input.organization,
    placement_right_confirmed: Boolean(input.placementRightConfirmed),
    published_at: status === "published" ? new Date().toISOString() : null,
    region_id: regionId,
    requirements: input.requirements || null,
    responsibilities: input.responsibilities || null,
    salary: salaryToNumber(input.salary),
    schedule: input.schedule || null,
    show_exact_address: Boolean(input.address && hasMapCoordinates(input.lat, input.lng)),
    specialist_category_id: specialistCategoryId,
    status,
    title: input.title,
    website: input.website || null,
    work_format: input.workFormat || null,
  };
}

export async function createStoredVacancy(input: CreateStoredVacancyInput) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  const status = input.status ?? "pending_payment";
  const rows = await supabaseRest<VacancyRow[]>(`/rest/v1/vacancies?select=${vacancySelect}`, {
    method: "POST",
    prefer: "return=representation",
    body: await storedVacancyBody(input, status),
  });

  const vacancy = rows[0];

  if (!vacancy) {
    return undefined;
  }

  await insertVacancyImages(vacancy.id, input.mediaPaths);

  return vacancyWithMediaFallback((await getStoredVacancyById(vacancy.id)) ?? mapVacancy(vacancy), input.mediaPaths);
}

export async function findReusableStoredVacancyForPayment(input: CreateStoredVacancyInput) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  const title = input.title.trim();

  if (title.length < 3) {
    return undefined;
  }

  const rows = await supabaseRest<VacancyRow[]>(
    `/rest/v1/vacancies?select=${vacancySelect}&author_id=eq.${encodeURIComponent(input.authorId)}&title=eq.${encodeURIComponent(title)}&status=in.(draft,pending_payment)&order=created_at.desc&limit=20`,
  );

  return rows.map(mapVacancy).find((vacancy) => vacancyMatchesReusableInput(vacancy, input));
}

export async function updateStoredVacancyForUser(vacancyId: string, userId: string, input: CreateStoredVacancyInput) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return undefined;
  }

  const status = input.status ?? "pending_payment";
  const rows = await supabaseRest<VacancyRow[]>(
    `/rest/v1/vacancies?select=${vacancySelect}&id=eq.${encodeURIComponent(vacancyId)}&author_id=eq.${encodeURIComponent(userId)}&status=in.(draft,pending_payment)`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: await storedVacancyBody(input, status),
    },
  );

  if (!rows[0]?.id) {
    return undefined;
  }

  await replaceVacancyImages(vacancyId, input.mediaPaths);

  return vacancyWithMediaFallback((await getStoredVacancyById(vacancyId)) ?? mapVacancy(rows[0]), input.mediaPaths);
}

export async function saveStoredVacancyForUser(
  vacancyId: string,
  userId: string,
  input: CreateStoredVacancyInput,
  options: StoreVacancyBodyOptions = {},
) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return undefined;
  }

  const existingRows = await supabaseRest<Array<Pick<VacancyRow, "id" | "status">>>(
    `/rest/v1/vacancies?select=id,status&id=eq.${encodeURIComponent(vacancyId)}&author_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  const existingVacancy = existingRows[0];

  if (!existingVacancy || existingVacancy.status === "archived" || existingVacancy.status === "expired" || existingVacancy.status === "rejected") {
    return undefined;
  }

  const body = (await storedVacancyBody(input, existingVacancy.status, options)) as Record<string, unknown>;

  if (existingVacancy.status === "published") {
    delete body.published_at;
  }

  const rows = await supabaseRest<VacancyRow[]>(
    `/rest/v1/vacancies?select=${vacancySelect}&id=eq.${encodeURIComponent(vacancyId)}&author_id=eq.${encodeURIComponent(userId)}`,
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
    await replaceVacancyImages(vacancyId, input.mediaPaths);
  }

  return vacancyWithMediaFallback((await getStoredVacancyById(vacancyId)) ?? mapVacancy(rows[0]), input.mediaPaths);
}

export async function getStoredVacancyById(vacancyId: string, options: { publicOnly?: boolean } = {}) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return undefined;
  }

  try {
    const statusFilter = options.publicOnly ? "&status=eq.published" : "";
    const rows = await supabaseRest<VacancyRow[]>(
      `/rest/v1/vacancies?select=${vacancySelect}&id=eq.${encodeURIComponent(vacancyId)}${statusFilter}&limit=1`,
    );

    return rows[0] ? mapVacancy(rows[0]) : undefined;
  } catch (error) {
    console.error("Failed to load vacancy from Supabase", error);
    return undefined;
  }
}

export async function getStoredVacancyForUser(vacancyId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return undefined;
  }

  const rows = await supabaseRest<VacancyRow[]>(
    `/rest/v1/vacancies?select=${vacancySelect}&id=eq.${encodeURIComponent(vacancyId)}&author_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );

  return rows[0] ? mapVacancy(rows[0]) : undefined;
}

export async function listStoredVacancies(limit = 24) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  try {
    const rows = await supabaseRest<VacancyRow[]>(
      `/rest/v1/vacancies?select=${vacancySelect}&status=eq.published&order=published_at.desc.nullslast,created_at.desc&limit=${limit}`,
    );

    return rows.map(mapVacancy);
  } catch (error) {
    console.error("Failed to load vacancies from Supabase", error);
    return [];
  }
}

export async function listStoredVacanciesForAdmin(limit = 200) {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  const rows = await supabaseRest<VacancyRow[]>(
    `/rest/v1/vacancies?select=${vacancySelect}&order=created_at.desc&limit=${limit}`,
  );

  return rows.map(mapVacancy);
}

export async function listStoredVacanciesForUser(userId: string) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  try {
    const rows = await supabaseRest<VacancyRow[]>(
      `/rest/v1/vacancies?select=${vacancySelect}&author_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
    );

    return rows.map(mapVacancy);
  } catch (error) {
    console.error("Failed to load user vacancies from Supabase", error);
    return [];
  }
}

export async function markStoredVacancyPendingPaymentForUser(vacancyId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return false;
  }

  const rows = await supabaseRest<Array<Pick<VacancyRow, "id">>>(
    `/rest/v1/vacancies?select=id&id=eq.${encodeURIComponent(vacancyId)}&author_id=eq.${encodeURIComponent(userId)}&status=eq.draft`,
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

export async function archiveStoredVacancyForUser(vacancyId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return false;
  }

  const rows = await supabaseRest<Array<Pick<VacancyRow, "id">>>(
    `/rest/v1/vacancies?select=id&id=eq.${encodeURIComponent(vacancyId)}&author_id=eq.${encodeURIComponent(userId)}&status=eq.published`,
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

export async function restoreStoredVacancyForUser(vacancyId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return false;
  }

  const now = new Date().toISOString();
  const rows = await supabaseRest<Array<Pick<VacancyRow, "id">>>(
    `/rest/v1/vacancies?select=id&id=eq.${encodeURIComponent(vacancyId)}&author_id=eq.${encodeURIComponent(userId)}&is_paid=eq.true&status=in.(archived,expired)`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        expires_at: addDaysIsoDate(now, 30),
        published_at: now,
        status: "published",
      },
    },
  );

  return Boolean(rows[0]?.id);
}

export async function deleteStoredVacancyForUser(vacancyId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return false;
  }

  const rows = await supabaseRest<Array<Pick<VacancyRow, "id">>>(
    `/rest/v1/vacancies?select=id&id=eq.${encodeURIComponent(vacancyId)}&author_id=eq.${encodeURIComponent(userId)}&status=in.(draft,archived,expired,rejected)`,
    {
      method: "DELETE",
      prefer: "return=representation",
    },
  );

  return Boolean(rows[0]?.id);
}

export async function markStoredVacancyPaid(vacancyId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return false;
  }

  const now = new Date().toISOString();
  const existingRows = await supabaseRest<Array<Pick<VacancyRow, "id" | "is_paid" | "status">>>(
    `/rest/v1/vacancies?select=id,is_paid,status&id=eq.${encodeURIComponent(vacancyId)}&limit=1`,
  );
  const existingVacancy = existingRows[0];

  if (!existingVacancy) {
    return false;
  }

  if (existingVacancy.status === "published" && existingVacancy.is_paid) {
    return true;
  }

  if (existingVacancy.status === "archived" || existingVacancy.status === "expired" || existingVacancy.status === "rejected") {
    return true;
  }

  const rows = await supabaseRest<Array<Pick<VacancyRow, "id">>>(`/rest/v1/vacancies?select=id&id=eq.${encodeURIComponent(vacancyId)}`, {
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

export function listVacanciesWithStored(storedVacancies: JobVacancy[]) {
  if (!shouldShowFallbackContent()) {
    return storedVacancies;
  }

  const storedIds = new Set(storedVacancies.map((vacancy) => vacancy.id));

  return [...storedVacancies, ...demoVacancies.filter((vacancy) => !storedIds.has(vacancy.id))];
}
