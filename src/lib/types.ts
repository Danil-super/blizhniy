export type PublicationStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "published"
  | "archived"
  | "expired"
  | "rejected";

export type City = {
  slug: string;
  name: string;
  regionSlug: string;
};

export type Category = {
  slug: string;
  name: string;
  children: string[];
};

export type ListingKind = "prodam" | "kuplyu" | "menyayu" | "otdam-darom";

export type Listing = {
  id: string;
  slug: string;
  kind: ListingKind;
  categorySlug: string;
  subcategory: string;
  author: string;
  title: string;
  description: string;
  city: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
  showExactAddress: boolean;
  price?: string;
  imageTone: "emerald" | "blue" | "amber" | "rose" | "slate";
  phone?: string;
  messengerUrl?: string;
  status: PublicationStatus;
  paid: boolean;
  publishedAt: string;
  expiresAt: string;
};

export type JobVacancy = {
  id: string;
  organization: string;
  title: string;
  profession: string;
  city: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
  showExactAddress: boolean;
  salary: string;
  logoText: string;
  logoTone: "blue" | "violet" | "teal";
  phone?: string;
  messengerUrl?: string;
  email?: string;
  schedule?: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  status: PublicationStatus;
};

export type WorkRequest = {
  id: string;
  author: string;
  title: string;
  description: string;
  profession: string;
  city: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
  showExactAddress: boolean;
  budget: string;
  phone?: string;
  messengerUrl?: string;
  status: PublicationStatus;
  createdAt: string;
  publishedAt?: string;
};

export type SpecialistProfile = {
  id: string;
  name: string;
  profession: string;
  skills: string;
  city: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
  showExactAddress: boolean;
  price: string;
  imageSeed: string;
  phone?: string;
  messengerUrl?: string;
  videoUrl?: string;
  status: PublicationStatus;
};

export type Profession = {
  parent: string;
  name: string;
  slug: string;
  active: boolean;
};

export type Tariff = {
  id: string;
  name: string;
  action: "listing_publication" | "vacancy_publication" | "job_response" | "fair_participation" | "ad_marquee";
  price: number;
  durationDays: number | null;
  active: boolean;
};

export type Payment = {
  id: string;
  targetType: "listing" | "vacancy" | "application" | "fair_application" | "ad_marquee";
  targetId?: string;
  targetTitle: string;
  tariffId: string;
  amount: number;
  status: "created" | "pending" | "succeeded" | "failed";
  provider: "mock";
  createdAt: string;
  paidAt?: string;
};

export type FairApplication = {
  id: string;
  participantName: string;
  city: string;
  category: string;
  description: string;
  productPhotos: string[];
  videoUrl?: string;
  phone: string;
  email: string;
  comment?: string;
  status: PublicationStatus;
  paymentStatus: "created" | "pending" | "succeeded" | "failed";
  address?: string;
  district?: string;
  lat?: number;
  lng?: number;
  showExactAddress: boolean;
  createdAt: string;
};

export type Application = {
  id: string;
  vacancyTitle: string;
  specialistName: string;
  status: "pending_payment" | "paid" | "sent";
  paymentId: string;
};

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  phone: string;
  roleLabel: string;
  blocked: boolean;
};
