import type { BookingRequest } from "./booking-notifications";

export type BookingAvailability = Pick<BookingRequest, "listingId" | "startDate" | "endDate" | "guests" | "status">;

export const MAX_BOOKING_NIGHTS = 30;
export const MAX_BOOKING_LEAD_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseBookingDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : undefined;
}

export function bookingDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function bookingTodayKey(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Moscow",
    year: "numeric",
  }).format(now);
}

export function addBookingDays(value: string, days: number) {
  const date = parseBookingDate(value);
  return date ? bookingDateKey(new Date(date.getTime() + days * DAY_MS)) : undefined;
}

export function bookingNightsCount(start?: string, end?: string) {
  const startDate = parseBookingDate(start);
  const endDate = parseBookingDate(end);
  return startDate && endDate ? Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) : undefined;
}

export function remainingTourSeats(maxGuests: number, tourDate: string, requests: BookingAvailability[], listingId: string) {
  const occupied = requests
    .filter((request) => request.listingId === listingId && request.startDate === tourDate && request.status === "accepted")
    .reduce((sum, request) => sum + request.guests, 0);

  return Math.max(0, maxGuests - occupied);
}

export function isStayPeriodUnavailable(start: string, end: string, requests: BookingAvailability[], listingId: string) {
  return requests.some((request) => {
    if (!request.startDate || request.listingId !== listingId || (request.status !== "pending" && request.status !== "accepted")) {
      return false;
    }

    const requestEnd = request.endDate ?? addBookingDays(request.startDate, 1);
    return Boolean(requestEnd && start < requestEnd && request.startDate < end);
  });
}
