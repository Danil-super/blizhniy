import type { BookingDetails, ListingKind } from "@/lib/types";

export type DemoPublicationType = "listing" | "vacancy" | "workRequest" | "specialist" | "fairApplication";

export type DemoPublication = {
  id: string;
  type: DemoPublicationType;
  title: string;
  subtitle: string;
  city: string;
  price?: string;
  description?: string;
  images?: string[];
  lat?: number;
  lng?: number;
  showExactAddress?: boolean;
  phone?: string;
  messengerUrl?: string;
  listingKind?: ListingKind;
  categorySlug?: string;
  subcategorySlug?: string;
  booking?: BookingDetails;
  status: string;
  createdAt: string;
};

export const demoPublicationsStorageKey = "blizhniy-demo-publications";

export const demoPublicationLabels: Record<DemoPublicationType, string> = {
  fairApplication: "Заявка на ярмарку",
  listing: "Объявление",
  specialist: "Анкета специалиста",
  vacancy: "Вакансия",
  workRequest: "Заказ",
};
