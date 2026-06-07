import { applications, fairApplications, listings, payments, specialists, vacancies, workRequests } from "@/lib/data";
import type { Application, FairApplication, JobVacancy, Listing, Payment, SpecialistProfile, WorkRequest } from "@/lib/types";

type MockStore = {
  applications: Application[];
  fairApplications: FairApplication[];
  listings: Listing[];
  payments: Payment[];
  specialists: SpecialistProfile[];
  currentUserSpecialistId?: string;
  vacancies: JobVacancy[];
  workRequests: WorkRequest[];
};

type CreateFairApplicationInput = {
  participantName: string;
  city: string;
  category: string;
  description: string;
  productPhotos: string[];
  videoUrl?: string;
  phone: string;
  email: string;
  comment?: string;
};

type CreateListingInput = {
  title: string;
  kind: Listing["kind"];
  categorySlug: string;
  subcategory: string;
  city: string;
  district?: string;
  address?: string;
  price?: string;
  booking?: Listing["booking"];
  delivery?: Listing["delivery"];
  description?: string;
  phone?: string;
  messengerUrl?: string;
  lat?: number;
  lng?: number;
  hasMapPoint?: boolean;
};

type CreateVacancyInput = {
  organization: string;
  employerType?: string;
  inn?: string;
  contactPerson?: string;
  website?: string;
  title: string;
  profession: string;
  city: string;
  district?: string;
  address?: string;
  salary?: string;
  phone?: string;
  messengerUrl?: string;
  email?: string;
  schedule?: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  lat?: number;
  lng?: number;
  hasMapPoint?: boolean;
};

type CreateWorkRequestInput = {
  author: string;
  title: string;
  profession: string;
  city: string;
  district?: string;
  address?: string;
  budget?: string;
  phone?: string;
  messengerUrl?: string;
  description?: string;
  lat?: number;
  lng?: number;
};

type CreateSpecialistInput = {
  name: string;
  profession: string;
  city: string;
  district?: string;
  address?: string;
  price?: string;
  phone?: string;
  email?: string;
  messengerUrl?: string;
  skills?: string;
  description?: string;
  images?: string[];
  lat?: number;
  lng?: number;
  hasMapPoint?: boolean;
};

declare global {
  var __blizhniyMockStore: MockStore | undefined;
}

function cloneItems<T extends object>(items: T[]) {
  return items.map((item) => ({ ...item }));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function nowIsoDateTime() {
  return new Date().toISOString();
}

function createFairApplicationId() {
  return `fair-${Date.now().toString(36)}`;
}

function createEntityId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

function safeSlug(value: string, fallback = "publication") {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, "")
    .trim()
    .replace(/\s+/g, "-");

  return slug || fallback;
}

export function getMockStore() {
  globalThis.__blizhniyMockStore ??= {
    applications: cloneItems(applications),
    fairApplications: cloneItems(fairApplications),
    listings: cloneItems(listings),
    payments: cloneItems(payments),
    specialists: cloneItems(specialists),
    vacancies: cloneItems(vacancies),
    workRequests: cloneItems(workRequests),
  };

  return globalThis.__blizhniyMockStore;
}

export function listMockPayments() {
  return getMockStore().payments;
}

export function listFairApplications() {
  return getMockStore().fairApplications;
}

export function listListings() {
  return getMockStore().listings;
}

export function listVacancies() {
  return getMockStore().vacancies;
}

export function listWorkRequests() {
  return getMockStore().workRequests;
}

export function listSpecialists() {
  return getMockStore().specialists;
}

export function getSpecialistById(id: string) {
  return getMockStore().specialists.find((specialist) => specialist.id === id);
}

export function getCurrentUserSpecialist() {
  const store = getMockStore();

  if (!store.currentUserSpecialistId) {
    return undefined;
  }

  return store.specialists.find((specialist) => specialist.id === store.currentUserSpecialistId);
}

export function listApplications() {
  return getMockStore().applications;
}

export function createFairApplication(input: CreateFairApplicationInput) {
  const application: FairApplication = {
    id: createFairApplicationId(),
    participantName: input.participantName,
    city: input.city,
    category: input.category,
    description: input.description,
    productPhotos: input.productPhotos,
    videoUrl: input.videoUrl,
    phone: input.phone,
    email: input.email,
    comment: input.comment,
    status: "pending_payment",
    paymentStatus: "created",
    showExactAddress: false,
    createdAt: todayIsoDate(),
  };

  getMockStore().fairApplications.unshift(application);
  return application;
}

export function createListing(input: CreateListingInput) {
  const listing: Listing = {
    id: createEntityId("listing"),
    slug: `${safeSlug(input.title, "obyavlenie")}-${Date.now().toString(36)}`,
    kind: input.kind,
    categorySlug: input.categorySlug,
    subcategory: input.subcategory,
    author: "Админ",
    title: input.title,
    description: input.description?.trim() || "Описание будет дополнено.",
    city: input.city,
    district: input.district,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    hasMapPoint: Boolean(input.hasMapPoint),
    showExactAddress: false,
    price: input.price?.trim() || "по договоренности",
    booking: input.booking,
    delivery: input.delivery,
    imageTone: "blue",
    phone: input.phone?.trim(),
    messengerUrl: input.messengerUrl?.trim(),
    status: "published",
    paid: true,
    publishedAt: nowIsoDateTime(),
    expiresAt: todayIsoDate(),
  };

  getMockStore().listings.unshift(listing);
  return listing;
}

export function createVacancy(input: CreateVacancyInput) {
  const publishedAt = nowIsoDateTime();
  const vacancy: JobVacancy = {
    id: createEntityId("vacancy"),
    employerType: input.employerType,
    organization: input.organization,
    inn: input.inn,
    contactPerson: input.contactPerson,
    website: input.website,
    title: input.title,
    profession: input.profession,
    city: input.city,
    district: input.district,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    hasMapPoint: Boolean(input.hasMapPoint),
    showExactAddress: Boolean(input.hasMapPoint && input.address),
    salary: input.salary?.trim() || "по договоренности",
    logoText: input.organization.slice(0, 12) || "Компания",
    logoTone: "blue",
    phone: input.phone?.trim(),
    messengerUrl: input.messengerUrl?.trim(),
    email: input.email?.trim(),
    schedule: input.schedule?.trim(),
    description: input.description?.trim() || "Описание вакансии будет дополнено.",
    requirements: input.requirements?.trim() || "Уточняется",
    responsibilities: input.responsibilities?.trim() || "Уточняется",
    status: "published",
    createdAt: publishedAt,
    publishedAt,
  };

  getMockStore().vacancies.unshift(vacancy);
  return vacancy;
}

export function createWorkRequest(input: CreateWorkRequestInput) {
  const request: WorkRequest = {
    id: createEntityId("request"),
    author: input.author,
    title: input.title,
    description: input.description?.trim() || "Описание задачи будет дополнено.",
    profession: input.profession,
    city: input.city,
    district: input.district,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    showExactAddress: false,
    budget: input.budget?.trim() || "по договоренности",
    phone: input.phone?.trim(),
    messengerUrl: input.messengerUrl?.trim(),
    status: "published",
    createdAt: todayIsoDate(),
    publishedAt: todayIsoDate(),
  };

  getMockStore().workRequests.unshift(request);
  return request;
}

export function createSpecialist(input: CreateSpecialistInput) {
  const publishedAt = nowIsoDateTime();
  const specialist: SpecialistProfile = {
    id: createEntityId("specialist"),
    name: input.name,
    profession: input.profession,
    skills: input.skills?.trim() || "Навыки уточняются",
    description: input.description?.trim(),
    city: input.city,
    district: input.district,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    hasMapPoint: input.hasMapPoint,
    showExactAddress: false,
    price: input.price?.trim() || "по договоренности",
    imageSeed: "alex",
    images: input.images,
    phone: input.phone?.trim(),
    email: input.email?.trim(),
    messengerUrl: input.messengerUrl?.trim(),
    status: "published",
    createdAt: publishedAt,
    publishedAt,
  };

  getMockStore().specialists.unshift(specialist);
  return specialist;
}

export function updateSpecialist(id: string, input: CreateSpecialistInput) {
  const store = getMockStore();
  const specialist = store.specialists.find((item) => item.id === id);

  if (!specialist) {
    return createSpecialist(input);
  }

  Object.assign(specialist, {
    name: input.name,
    profession: input.profession,
    skills: input.skills?.trim() || "Навыки уточняются",
    description: input.description?.trim(),
    city: input.city,
    district: input.district,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    hasMapPoint: input.hasMapPoint,
    showExactAddress: false,
    price: input.price?.trim() || "по договоренности",
    images: input.images,
    phone: input.phone?.trim(),
    email: input.email?.trim(),
    messengerUrl: input.messengerUrl?.trim(),
    status: "published",
  });

  return specialist;
}

export function upsertCurrentUserSpecialist(input: CreateSpecialistInput) {
  const store = getMockStore();
  const currentSpecialist = getCurrentUserSpecialist();

  if (currentSpecialist) {
    return updateSpecialist(currentSpecialist.id, input);
  }

  const specialist = createSpecialist(input);
  store.currentUserSpecialistId = specialist.id;
  return specialist;
}

export function markPaymentTargetSucceeded(payment: Payment) {
  if (!payment.targetId) {
    return payment.targetType === "application" ? "sent" : "published";
  }

  if (payment.targetType === "fair_application") {
    const application = getMockStore().fairApplications.find((item) => item.id === payment.targetId);

    if (application) {
      application.paymentStatus = "succeeded";
      application.status = "published";
    }

    return "published";
  }

  if (payment.targetType === "vacancy") {
    const vacancy = getMockStore().vacancies.find((item) => item.id === payment.targetId);

    if (vacancy) {
      vacancy.status = "published";
    }

    return "published";
  }

  if (payment.targetType === "application") {
    const application = getMockStore().applications.find((item) => item.id === payment.targetId);

    if (application) {
      application.status = "sent";
    }

    return "sent";
  }

  if (payment.targetType === "ad_marquee") {
    return "published";
  }

  const listing = getMockStore().listings.find((item) => item.id === payment.targetId);

  if (listing) {
    listing.status = "published";
    listing.paid = true;
  }

  return "published";
}
