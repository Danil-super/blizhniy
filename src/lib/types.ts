export type PublicationStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "published"
  | "sold"
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

export type ListingKind = "prodam" | "kuplyu" | "menyayu" | "otdam-darom" | "arenda";

export type BookingDetails = {
  mode: "stay" | "tour";
  priceWeekday?: number;
  priceWeekend?: number;
  pricePerPerson?: number;
  minNights?: number;
  includedGuests?: number;
  maxGuests?: number;
  extraGuestPrice?: number;
  availableFrom?: string;
  availableTo?: string;
  blockedDates?: string[];
  checkInTime?: string;
  checkOutTime?: string;
  included?: string;
  rules?: string;
  tourDate?: string;
  tourTime?: string;
  tourDuration?: string;
  tourDifficulty?: string;
  tourMeetingPoint?: string;
};

export type DeliveryServiceId = "cdek" | "boxberry" | "russian-post" | "yandex-delivery" | "other";

export type DeliveryOptions = {
  enabled: boolean;
  services: DeliveryServiceId[];
  payer: "buyer" | "seller" | "split";
  originCity?: string;
  packageWeightGram?: number;
  packageLengthCm?: number;
  packageWidthCm?: number;
  packageHeightCm?: number;
  handlingDays?: number;
  comment?: string;
};

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
  hasMapPoint?: boolean;
  showExactAddress: boolean;
  price?: string;
  booking?: BookingDetails;
  delivery?: DeliveryOptions;
  imageTone: "emerald" | "blue" | "amber" | "rose" | "slate";
  phone?: string;
  email?: string;
  messengerUrl?: string;
  status: PublicationStatus;
  paid: boolean;
  publishedAt: string;
  expiresAt: string;
};

export type JobVacancy = {
  id: string;
  employerType?: "organization" | "ip" | "person" | string;
  organization: string;
  inn?: string;
  ogrn?: string;
  ogrnip?: string;
  contactPerson?: string;
  website?: string;
  title: string;
  profession: string;
  city: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
  hasMapPoint?: boolean;
  showExactAddress: boolean;
  salary: string;
  logoText: string;
  logoTone: "blue" | "violet" | "teal";
  images?: string[];
  phone?: string;
  messengerUrl?: string;
  email?: string;
  schedule?: string;
  workFormat?: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
  conditions?: string;
  placementRightConfirmed?: boolean;
  status: PublicationStatus;
  createdAt?: string;
  publishedAt?: string;
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
  description?: string;
  city: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
  hasMapPoint?: boolean;
  showExactAddress: boolean;
  price: string;
  imageSeed: string;
  images?: string[];
  phone?: string;
  email?: string;
  messengerUrl?: string;
  videoUrl?: string;
  status: PublicationStatus;
  createdAt?: string;
  publishedAt?: string;
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
  action: "listing_publication" | "vacancy_publication" | "specialist_publication" | "job_response" | "fair_participation" | "ad_marquee";
  price: number;
  durationDays: number | null;
  active: boolean;
};

export type Payment = {
  id: string;
  targetType: "listing" | "vacancy" | "specialist" | "application" | "fair_application" | "ad_marquee";
  targetId?: string;
  targetTitle: string;
  tariffId: string;
  amount: number;
  status: "created" | "pending" | "succeeded" | "failed";
  provider: "mock" | "yookassa";
  providerPaymentId?: string;
  confirmationUrl?: string;
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
