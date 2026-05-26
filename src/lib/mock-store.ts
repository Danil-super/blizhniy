import { applications, fairApplications, listings, payments, specialists, vacancies, workRequests } from "@/lib/data";
import type { Application, FairApplication, JobVacancy, Listing, Payment, SpecialistProfile, WorkRequest } from "@/lib/types";

type MockStore = {
  applications: Application[];
  fairApplications: FairApplication[];
  listings: Listing[];
  payments: Payment[];
  specialists: SpecialistProfile[];
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

declare global {
  var __blizhniyMockStore: MockStore | undefined;
}

function cloneItems<T extends object>(items: T[]) {
  return items.map((item) => ({ ...item }));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function createFairApplicationId() {
  return `fair-${Date.now().toString(36)}`;
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

  const listing = getMockStore().listings.find((item) => item.id === payment.targetId);

  if (listing) {
    listing.status = "published";
    listing.paid = true;
  }

  return "published";
}
