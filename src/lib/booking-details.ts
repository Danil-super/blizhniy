import type { BookingDetails } from "@/lib/types";

function formatRubles(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value).replace(/\u00a0/g, " ") + " ₽";
}

function positiveNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function cleanPositiveNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function cleanString(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : undefined;
}

function validDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value?: string) {
  return Boolean(!value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function cleanDate(value: unknown) {
  const date = cleanString(value, 10);
  return date && validDate(date) ? date : undefined;
}

function cleanTime(value: unknown) {
  const time = cleanString(value, 5);
  return time && validTime(time) ? time : undefined;
}

function cleanDateList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => cleanString(item, 10))
    .filter((item): item is string => Boolean(item && validDate(item)))
    .slice(0, 730);
}

export function sanitizeBookingDetails(value: unknown): BookingDetails | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const input = value as Partial<BookingDetails>;
  const mode: BookingDetails["mode"] = input.mode === "tour" ? "tour" : "stay";

  if (mode === "tour") {
    return {
      mode,
      pricePerPerson: cleanPositiveNumber(input.pricePerPerson),
      maxGuests: cleanPositiveNumber(input.maxGuests),
      tourDate: cleanDate(input.tourDate),
      tourTime: cleanTime(input.tourTime),
      tourDuration: cleanString(input.tourDuration),
      tourDifficulty: cleanString(input.tourDifficulty),
      tourMeetingPoint: cleanString(input.tourMeetingPoint),
      included: cleanString(input.included),
      rules: cleanString(input.rules),
    };
  }

  return {
    mode,
    priceWeekday: cleanPositiveNumber(input.priceWeekday),
    priceWeekend: cleanPositiveNumber(input.priceWeekend),
    minNights: cleanPositiveNumber(input.minNights),
    includedGuests: cleanPositiveNumber(input.includedGuests),
    maxGuests: cleanPositiveNumber(input.maxGuests),
    extraGuestPrice: cleanPositiveNumber(input.extraGuestPrice),
    availableFrom: cleanDate(input.availableFrom),
    availableTo: cleanDate(input.availableTo),
    blockedDates: cleanDateList(input.blockedDates),
    checkInTime: cleanTime(input.checkInTime),
    checkOutTime: cleanTime(input.checkOutTime),
    included: cleanString(input.included),
    rules: cleanString(input.rules),
  };
}

export function formatBookingPrice(booking?: BookingDetails) {
  if (!booking) {
    return "";
  }

  if (booking.mode === "tour") {
    const price = positiveNumber(booking.pricePerPerson);
    return price ? `от ${formatRubles(price)}/чел.` : "расчет по заявке";
  }

  const prices = [positiveNumber(booking.priceWeekday), positiveNumber(booking.priceWeekend)].filter(
    (value): value is number => Boolean(value),
  );
  const minPrice = prices.length ? Math.min(...prices) : undefined;

  return minPrice ? `от ${formatRubles(minPrice)}/сутки` : "расчет по датам";
}

export function validateBookingDetailsForPublication(booking?: BookingDetails) {
  const errors: string[] = [];

  if (!booking) {
    return ["Заполните параметры бронирования для аренды."];
  }

  if (booking.mode === "tour") {
    if (!positiveNumber(booking.pricePerPerson)) {
      errors.push("Укажите стоимость участия.");
    }

    if (!positiveNumber(booking.maxGuests)) {
      errors.push("Укажите количество мест.");
    }

    if (!validDate(booking.tourDate)) {
      errors.push("Укажите дату похода.");
    }

    return errors;
  }

  if (!positiveNumber(booking.priceWeekday)) {
    errors.push("Укажите цену за сутки в будни.");
  }

  if (!positiveNumber(booking.priceWeekend)) {
    errors.push("Укажите цену за сутки в выходные.");
  }

  if (!positiveNumber(booking.minNights)) {
    errors.push("Укажите минимальное количество ночей.");
  }

  if (!positiveNumber(booking.includedGuests)) {
    errors.push("Укажите, сколько гостей включено в цену.");
  }

  if (!positiveNumber(booking.maxGuests)) {
    errors.push("Укажите максимальное количество гостей.");
  }

  if (booking.includedGuests && booking.maxGuests && booking.includedGuests > booking.maxGuests) {
    errors.push("Гостей, включенных в цену, не может быть больше максимума гостей.");
  }

  if (booking.availableFrom && !validDate(booking.availableFrom)) {
    errors.push("Укажите корректную дату начала аренды.");
  }

  if (booking.availableTo && !validDate(booking.availableTo)) {
    errors.push("Укажите корректную дату окончания аренды.");
  }

  if (booking.availableFrom && booking.availableTo && booking.availableTo < booking.availableFrom) {
    errors.push("Дата окончания аренды не может быть раньше даты начала.");
  }

  if (!validTime(booking.checkInTime)) {
    errors.push("Укажите корректное время заезда.");
  }

  if (!validTime(booking.checkOutTime)) {
    errors.push("Укажите корректное время выезда.");
  }

  if (booking.blockedDates?.some((date) => !validDate(date))) {
    errors.push("Занятые даты должны быть в формате ГГГГ-ММ-ДД.");
  }

  return errors;
}
