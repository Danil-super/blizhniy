import type { DemoPublication } from "@/lib/demo-publications";
import type { ListingKind } from "@/lib/types";

export type SellerListingLike = {
  author?: string;
  ownerKey?: string;
  ownerName?: string;
  phone?: string;
  listingKind?: ListingKind;
  kind?: ListingKind;
};

const sellerNamesByPhone: Record<string, string> = {
  "+78610002001": "Простова Наталья",
  "+78610002002": "Кузнецова Марина",
  "+78610002003": "Павлова Елена",
  "+78610002004": "Иванова Светлана",
  "+78610002005": "Орлова Анна",
  "+78610002006": "Сергеев Дмитрий",
  "+78610002007": "Мельников Андрей",
  "+78610002008": "Соколова Ирина",
  "+78610002009": "Романов Павел",
  "+78610002010": "Федоров Алексей",
  "+78610002011": "Васильева Ольга",
  "+78610002012": "Николаев Игорь",
  "+78610009999": "Команда Ближний",
};

function listingKind(item: SellerListingLike) {
  return item.listingKind ?? item.kind;
}

export function sellerDisplayName(item: SellerListingLike) {
  if (item.ownerName?.trim()) {
    return item.ownerName.trim();
  }

  if (item.author?.trim()) {
    return item.author.trim();
  }

  if (item.phone && sellerNamesByPhone[item.phone]) {
    return sellerNamesByPhone[item.phone];
  }

  if (listingKind(item) === "arenda") {
    return "Владелец объекта";
  }

  if (listingKind(item) === "kuplyu") {
    return "Покупатель";
  }

  return "Частный продавец";
}

export function sellerProfileKey(item: SellerListingLike) {
  return item.ownerKey?.trim() || item.ownerName?.trim() || item.author?.trim() || item.phone || sellerDisplayName(item);
}

export function sellerProfileHref(item: SellerListingLike) {
  return `/prodavets/${encodeURIComponent(sellerProfileKey(item))}`;
}

export function isSameSeller(left: SellerListingLike, rightKey: string) {
  return sellerProfileKey(left) === rightKey;
}

export function sellerInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "П";
}

export function isSellerDemoPublication(item: DemoPublication, sellerKey: string) {
  return item.type === "listing" && isSameSeller(item, sellerKey);
}
