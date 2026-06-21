import { createStoredNotification } from "@/lib/notification-store";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { BookingDetails } from "@/lib/types";
import type { BookingRequest, BookingRequestStatus } from "@/lib/booking-notifications";

type BookingRequestRow = {
  id: string;
  listing_id: string;
  guest_id: string;
  start_date: string;
  end_date?: string | null;
  guests: number;
  total: number | string;
  status: BookingRequestStatus;
  created_at: string;
  listings?: {
    author_id?: string | null;
    title?: string | null;
  } | null;
};

type ListingBookingRow = {
  id: string;
  author_id: string;
  title: string;
  booking?: BookingDetails | null;
  status: string;
};

export type CreateBookingRequestInput = {
  endDate?: string;
  guests: number;
  listingId: string;
  startDate?: string;
  userId: string;
};

function todayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nightsBetween(start?: string, end?: string) {
  const startDate = toDate(start);
  const endDate = toDate(end);

  if (!startDate || !endDate || endDate <= startDate) {
    return [];
  }

  const nights: Date[] = [];
  for (let current = startDate; current < endDate; current = addDays(current, 1)) {
    nights.push(current);
  }

  return nights;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", { currency: "RUB", maximumFractionDigits: 0, style: "currency" }).format(value);
}

function formatShortDate(value?: string) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date) : "дата не выбрана";
}

function mapBookingRequest(row: BookingRequestRow): BookingRequest {
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listings?.title ?? "Объявление",
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
    guests: row.guests,
    total: Number(row.total) || 0,
    status: row.status,
    createdAt: row.created_at,
  };
}

function calculateServerTotal(booking: BookingDetails, input: CreateBookingRequestInput) {
  const guests = Math.max(1, Math.floor(input.guests || 1));

  if (booking.mode === "tour") {
    const startDate = booking.tourDate;

    if (!startDate) {
      throw new Error("Дата похода не указана.");
    }

    if (input.startDate && input.startDate !== startDate) {
      throw new Error("Выберите дату этого похода.");
    }

    if (startDate < todayKey()) {
      throw new Error("Дата похода уже прошла.");
    }

    if (booking.maxGuests && guests > booking.maxGuests) {
      throw new Error(`Максимум участников: ${booking.maxGuests}.`);
    }

    return {
      endDate: undefined,
      guests,
      nights: [startDate],
      startDate,
      total: guests * (booking.pricePerPerson ?? 0),
    };
  }

  const startDate = input.startDate;
  const endDate = input.endDate;
  const nights = nightsBetween(startDate, endDate);

  if (!startDate || !endDate || !nights.length) {
    throw new Error("Выберите корректные даты заезда и выезда.");
  }

  if (startDate < todayKey()) {
    throw new Error("Нельзя забронировать прошедшую дату.");
  }

  if (booking.availableFrom && startDate < booking.availableFrom) {
    throw new Error("Дата заезда раньше доступного периода.");
  }

  const availableTo = toDate(booking.availableTo);

  if (availableTo && endDate > dateKey(addDays(availableTo, 1))) {
    throw new Error("Дата выезда позже доступного периода.");
  }

  if (booking.minNights && nights.length < booking.minNights) {
    throw new Error(`Минимальный срок бронирования: ${booking.minNights} ноч.`);
  }

  if (booking.maxGuests && guests > booking.maxGuests) {
    throw new Error(`Максимум гостей: ${booking.maxGuests}.`);
  }

  const blockedDates = new Set(booking.blockedDates ?? []);

  if (nights.some((date) => blockedDates.has(dateKey(date)))) {
    throw new Error("В выбранном периоде есть занятые дни.");
  }

  const baseTotal = nights.reduce(
    (sum, date) => sum + (isWeekend(date) ? booking.priceWeekend ?? booking.priceWeekday ?? 0 : booking.priceWeekday ?? booking.priceWeekend ?? 0),
    0,
  );
  const includedGuests = booking.includedGuests ?? booking.maxGuests ?? guests;
  const extraGuests = Math.max(0, guests - includedGuests);
  const extraGuestCost = extraGuests * nights.length * (booking.extraGuestPrice ?? 0);

  return {
    endDate,
    guests,
    nights: nights.map(dateKey),
    startDate,
    total: baseTotal + extraGuestCost,
  };
}

async function getListingForBooking(listingId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return undefined;
  }

  const rows = await supabaseRest<ListingBookingRow[]>(
    `/rest/v1/listings?select=id,author_id,title,booking,status&id=eq.${encodeURIComponent(listingId)}&status=eq.published&limit=1`,
  );

  return rows[0];
}

export async function listActiveBookingRequestsForListing(listingId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(listingId)) {
    return [];
  }

  const rows = await supabaseRest<BookingRequestRow[]>(
    `/rest/v1/booking_requests?select=id,listing_id,guest_id,start_date,end_date,guests,total,status,created_at,listings(title)&listing_id=eq.${encodeURIComponent(listingId)}&status=in.(pending,accepted)&order=start_date.asc`,
  ).catch(() => []);

  return rows.map(mapBookingRequest);
}

export async function createStoredBookingRequest(input: CreateBookingRequestInput) {
  const listing = await getListingForBooking(input.listingId);

  if (!listing?.booking) {
    throw new Error("Бронирование для объявления недоступно.");
  }

  if (listing.author_id === input.userId) {
    throw new Error("Нельзя забронировать собственное объявление.");
  }

  const calculated = calculateServerTotal(listing.booking, input);
  const activeRequests = await listActiveBookingRequestsForListing(input.listingId);
  const selectedDates = new Set(calculated.nights);
  const hasOverlap = activeRequests.some((request) => {
    const requestDates = request.endDate ? nightsBetween(request.startDate, request.endDate).map(dateKey) : request.startDate ? [request.startDate] : [];
    return requestDates.some((date) => selectedDates.has(date));
  });

  if (hasOverlap) {
    throw new Error("На эти даты уже есть активная заявка.");
  }

  const rows = await supabaseRest<BookingRequestRow[]>("/rest/v1/booking_requests?select=id,listing_id,guest_id,start_date,end_date,guests,total,status,created_at,listings(title)", {
    method: "POST",
    prefer: "return=representation",
    body: {
      end_date: calculated.endDate ?? null,
      guest_id: input.userId,
      guests: calculated.guests,
      listing_id: input.listingId,
      start_date: calculated.startDate,
      total: calculated.total,
    },
  });
  const request = rows[0] ? mapBookingRequest(rows[0]) : undefined;

  if (!request) {
    throw new Error("Не удалось создать заявку на бронь.");
  }

  const dateText = calculated.endDate
    ? `с ${formatShortDate(calculated.startDate)} до ${formatShortDate(calculated.endDate)}`
    : `на ${formatShortDate(calculated.startDate)}`;

  await Promise.allSettled([
    createStoredNotification({
      body: `Пользователь хочет забронировать "${listing.title}" ${dateText}. Гостей: ${calculated.guests}, сумма: ${formatCurrency(calculated.total)}.`,
      event: `booking_request:${request.id}`,
      subject: "Новая заявка на бронь",
      userId: listing.author_id,
    }),
    createStoredNotification({
      body: `Заявка на бронь "${listing.title}" ${dateText} отправлена владельцу.`,
      event: `booking_request_sent:${request.id}`,
      subject: "Заявка отправлена",
      userId: input.userId,
    }),
  ]);

  return request;
}

export async function updateStoredBookingRequestStatus(input: { requestId: string; status: "accepted" | "declined"; userId: string }) {
  if (!isSupabaseRestConfigured() || !isUuid(input.requestId)) {
    return undefined;
  }

  const rows = await supabaseRest<BookingRequestRow[]>(
    `/rest/v1/booking_requests?select=id,listing_id,guest_id,start_date,end_date,guests,total,status,created_at,listings(author_id,title)&id=eq.${encodeURIComponent(input.requestId)}&limit=1`,
  );
  const row = rows[0];

  if (!row || row.listings?.author_id !== input.userId) {
    return undefined;
  }

  const updatedRows = await supabaseRest<BookingRequestRow[]>(`/rest/v1/booking_requests?select=id,listing_id,guest_id,start_date,end_date,guests,total,status,created_at,listings(title)&id=eq.${encodeURIComponent(input.requestId)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      status: input.status,
      updated_at: new Date().toISOString(),
    },
  });
  const request = updatedRows[0] ? mapBookingRequest(updatedRows[0]) : undefined;

  if (!request) {
    return undefined;
  }

  await Promise.allSettled([
    supabaseRest(`/rest/v1/notifications?event=eq.${encodeURIComponent(`booking_request:${input.requestId}`)}&user_id=eq.${encodeURIComponent(input.userId)}&sent_at=is.null`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        sent_at: new Date().toISOString(),
      },
    }),
    createStoredNotification({
      body:
        input.status === "accepted"
          ? `Владелец подтвердил бронь "${request.listingTitle}". Свяжитесь с владельцем, чтобы согласовать детали.`
          : `Владелец отклонил бронь "${request.listingTitle}". Выберите другие даты или напишите владельцу.`,
      event: `booking_response:${request.id}`,
      subject: input.status === "accepted" ? "Бронь подтверждена" : "Бронь отклонена",
      userId: row.guest_id,
    }),
  ]);

  return request;
}
