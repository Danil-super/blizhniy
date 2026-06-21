import type { BookingDetails, ListingKind } from "@/lib/types";

export const rentalCategorySlugs = ["otdyh", "nedvizhimost"];

export const rentalSubcategoryNames: Record<string, string[] | undefined> = {
  otdyh: ["Турбазы", "Гостиницы", "Походы"],
  nedvizhimost: ["Жилье для путешествия", "Коммерческая недвижимость"],
};

export function isRentalCategorySlug(categorySlug: string) {
  return rentalCategorySlugs.includes(categorySlug);
}

export function getRentalSubcategories(categorySlug: string, subcategories: string[]) {
  const allowedNames = rentalSubcategoryNames[categorySlug];

  if (!allowedNames) {
    return [];
  }

  return allowedNames.filter((subcategory) => subcategories.includes(subcategory));
}

function slugifyRentalSubcategory(name: string) {
  const map: Record<string, string> = {
    Гостиницы: "gostinitsy",
    "Жилье для путешествия": "zhile-dlya-puteshestviya",
    "Коммерческая недвижимость": "kommercheskaya-nedvizhimost",
    Походы: "pohody",
    Турбазы: "turbazy",
  };

  return map[name] ?? name.toLowerCase().replaceAll(" ", "-");
}

export function isRentalSubcategorySlug(categorySlug: string, subcategorySlug: string, slugifySubcategory: (name: string) => string = slugifyRentalSubcategory) {
  return Boolean(rentalSubcategoryNames[categorySlug]?.some((name) => slugifySubcategory(name) === subcategorySlug));
}

function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function readRawValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function readPositiveNumber(formData: FormData, name: string) {
  const value = Number(readRawValue(formData, name).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeFutureDate(value: string) {
  const date = value.trim();

  if (!date) {
    return "";
  }

  return date < todayInputValue() ? todayInputValue() : date;
}

function normalizeEndDate(value: string, startDate: string) {
  const date = value.trim();

  if (!date) {
    return "";
  }

  const minDate = startDate || todayInputValue();
  return date < minDate ? minDate : date;
}

function readFutureDateList(formData: FormData, name: string) {
  const today = todayInputValue();

  return readRawValue(formData, name)
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item) && item >= today);
}

export function parseListingBookingFormData(formData: FormData, categorySlug: string, kind: ListingKind): BookingDetails | undefined {
  const subcategorySlug = readRawValue(formData, "subcategory");

  if (kind !== "arenda" || !isRentalSubcategorySlug(categorySlug, subcategorySlug)) {
    return undefined;
  }

  const mode: BookingDetails["mode"] = readRawValue(formData, "bookingMode") === "tour" ? "tour" : "stay";

  if (mode === "tour") {
    return {
      mode,
      pricePerPerson: readPositiveNumber(formData, "bookingPricePerPerson"),
      maxGuests: readPositiveNumber(formData, "bookingMaxGuests"),
      tourDate: normalizeFutureDate(readRawValue(formData, "tourDate")),
      tourTime: readRawValue(formData, "tourTime"),
      tourDuration: readRawValue(formData, "tourDuration"),
      tourDifficulty: readRawValue(formData, "tourDifficulty"),
      tourMeetingPoint: readRawValue(formData, "tourMeetingPoint"),
      included: readRawValue(formData, "bookingIncluded"),
      rules: readRawValue(formData, "bookingRules"),
    };
  }

  const availableFrom = normalizeFutureDate(readRawValue(formData, "bookingAvailableFrom"));

  return {
    mode,
    priceWeekday: readPositiveNumber(formData, "bookingPriceWeekday"),
    priceWeekend: readPositiveNumber(formData, "bookingPriceWeekend"),
    minNights: readPositiveNumber(formData, "bookingMinNights"),
    includedGuests: readPositiveNumber(formData, "bookingIncludedGuests"),
    maxGuests: readPositiveNumber(formData, "bookingMaxGuests"),
    extraGuestPrice: readPositiveNumber(formData, "bookingExtraGuestPrice"),
    availableFrom,
    availableTo: normalizeEndDate(readRawValue(formData, "bookingAvailableTo"), availableFrom),
    blockedDates: readFutureDateList(formData, "bookingBlockedDates"),
    checkInTime: readRawValue(formData, "bookingCheckIn"),
    checkOutTime: readRawValue(formData, "bookingCheckOut"),
    included: readRawValue(formData, "bookingIncluded"),
    rules: readRawValue(formData, "bookingRules"),
  };
}
