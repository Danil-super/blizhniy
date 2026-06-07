import type { BookingDetails, ListingKind } from "@/lib/types";

export type DemoPublicationType = "listing" | "vacancy" | "workRequest" | "specialist" | "fairApplication";

export type DemoPublication = {
  id: string;
  type: DemoPublicationType;
  ownerKey?: string;
  ownerName?: string;
  title: string;
  subtitle: string;
  city: string;
  price?: string;
  description?: string;
  images?: string[];
  videos?: string[];
  lat?: number;
  lng?: number;
  address?: string;
  hasMapPoint?: boolean;
  showExactAddress?: boolean;
  phone?: string;
  messengerUrl?: string;
  listingKind?: ListingKind;
  categorySlug?: string;
  subcategorySlug?: string;
  booking?: BookingDetails;
  status: string;
  soldReason?: "platform" | "elsewhere" | "not_actual";
  soldAt?: string;
  createdAt: string;
};

export const demoPublicationsStorageKey = "blizhniy-demo-publications";
export const demoPublicationsUpdatedEvent = "blizhniy-demo-publications-updated";
export const soldPublicationStatus = "Продано";

export const demoPublicationLabels: Record<DemoPublicationType, string> = {
  fairApplication: "Заявка на ярмарку",
  listing: "Объявление",
  specialist: "Анкета специалиста",
  vacancy: "Вакансия",
  workRequest: "Заказ",
};

export function isDemoPublicationSold(item: Pick<DemoPublication, "status">) {
  return item.status.trim().toLowerCase() === soldPublicationStatus.toLowerCase() || item.status.trim().toLowerCase() === "sold";
}

export function isDemoPublicationPubliclyVisible(item: DemoPublication) {
  const status = item.status.trim().toLowerCase();

  return !isDemoPublicationSold(item) && (status === "опубликовано" || status === "published");
}
