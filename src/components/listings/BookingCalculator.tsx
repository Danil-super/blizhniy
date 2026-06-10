"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, UsersRound } from "lucide-react";
import {
  BookingNotification,
  BookingRequest,
  bookingNotificationsEventName,
  bookingNotificationsStorageKey,
  bookingRequestsStorageKey,
} from "@/lib/booking-notifications";
import type { BookingDetails } from "@/lib/types";

function toDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0, style: "currency", currency: "RUB" }).format(value);
}

function formatDate(value?: string) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date) : "Не указано";
}

function formatShortDate(value?: string) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date) : "Выбрать";
}

function readJsonArray<T>(key: string): T[] {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayKey() {
  return dateKey(new Date());
}

function maxDateKey(...values: Array<string | undefined>) {
  const sortedValues = values.filter(Boolean).sort();
  return sortedValues[sortedValues.length - 1] ?? todayKey();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addDaysKey(value: string, days: number) {
  const date = toDate(value);
  return date ? dateKey(addDays(date, days)) : "";
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

function monthDays(baseDate: Date) {
  const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const startOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const daysInMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: startOffset }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(baseDate.getFullYear(), baseDate.getMonth(), day));
  }

  return cells;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function resolveStayStartLimit(booking: BookingDetails) {
  return maxDateKey(todayKey(), booking.availableFrom);
}

function resolveStayEndLimit(booking: BookingDetails) {
  return booking.availableTo ? addDaysKey(booking.availableTo, 1) : undefined;
}

function dateIsBookedByRequest(date: Date, requests: BookingRequest[], listingId: string) {
  const key = dateKey(date);

  return requests.some((request) => {
    if (request.listingId !== listingId || (request.status !== "pending" && request.status !== "accepted")) {
      return false;
    }

    if (request.endDate) {
      return nightsBetween(request.startDate, request.endDate).some((night) => dateKey(night) === key);
    }

    return request.startDate === key;
  });
}

function readBookingRequests() {
  return readJsonArray<BookingRequest>(bookingRequestsStorageKey);
}

function resolveFirstAvailableStayStart(booking: BookingDetails, requests: BookingRequest[], listingId: string) {
  const blockedDates = new Set(booking.blockedDates ?? []);
  const startLimit = resolveStayStartLimit(booking);
  const endLimit = booking.availableTo;
  const startDate = toDate(startLimit);

  if (!startDate) {
    return todayKey();
  }

  for (let offset = 0; offset < 370; offset += 1) {
    const candidate = addDays(startDate, offset);
    const key = dateKey(candidate);

    if (endLimit && key > endLimit) {
      return "";
    }

    if (!blockedDates.has(key) && !dateIsBookedByRequest(candidate, requests, listingId)) {
      return key;
    }
  }

  return "";
}

function resolveInitialStayEnd(startDate: string, booking?: BookingDetails) {
  if (!booking || !startDate) {
    return "";
  }

  return addDaysKey(startDate, Math.max(booking.minNights ?? 1, 1));
}

function BookingCalendar({
  booking,
  endDate,
  listingId,
  onDateClick,
  requests,
  selectedDates,
  startDate,
}: {
  booking: BookingDetails;
  endDate: string;
  listingId: string;
  onDateClick: (date: string) => void;
  requests: BookingRequest[];
  selectedDates: Set<string>;
  startDate: string;
}) {
  const blockedDates = new Set(booking.blockedDates ?? []);
  const startLimit = resolveStayStartLimit(booking);
  const endLimit = resolveStayEndLimit(booking);
  const availableFrom = toDate(startLimit);
  const availableTo = toDate(endLimit);
  const [visibleMonth, setVisibleMonth] = useState(availableFrom ?? new Date());
  const cells = monthDays(visibleMonth);
  const previousMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  const selectingEndDate = Boolean(startDate && !endDate);
  const canGoPrevious = monthKey(previousMonth) >= monthKey(availableFrom ?? new Date());

  function shiftMonth(delta: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => shiftMonth(-1)} disabled={!canGoPrevious} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:text-[#0875d1] disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300" aria-label="Предыдущий месяц">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-0 text-center text-sm font-black text-[#060b27] sm:text-base">
          {new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(visibleMonth)}
        </p>
        <button type="button" onClick={() => shiftMonth(1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:text-[#0875d1]" aria-label="Следующий месяц">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-500">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {cells.map((date, index) => {
          if (!date) {
            return <span key={`empty-${index}`} className="aspect-square rounded-lg" />;
          }

          const key = dateKey(date);
          const requested = dateIsBookedByRequest(date, requests, listingId);
          const blocked = blockedDates.has(key) || requested;
          const selected = selectedDates.has(key);
          const edge = key === startDate || key === endDate;
          const afterEndLimit = Boolean(availableTo && date > availableTo);
          const startAfterLastNight = Boolean(!selectingEndDate && booking.availableTo && key > booking.availableTo);
          const outOfRange = Boolean((availableFrom && date < availableFrom) || afterEndLimit || startAfterLastNight);
          const disabled = blocked || outOfRange;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onDateClick(key)}
              disabled={disabled}
              className={`flex aspect-square items-center justify-center rounded-lg text-xs font-black transition ${
                blocked
                  ? "cursor-not-allowed bg-rose-100 text-rose-700 line-through"
                  : edge
                    ? "bg-[#0875d1] text-white"
                    : selected
                      ? "bg-blue-100 text-[#0875d1]"
                    : outOfRange
                      ? "cursor-not-allowed bg-slate-50 text-slate-300"
                      : isWeekend(date)
                        ? "bg-amber-50 text-amber-700 hover:ring-2 hover:ring-amber-200"
                        : "bg-emerald-50 text-[#0a8f32] hover:ring-2 hover:ring-emerald-200"
              }`}
              title={requested ? "Есть активная заявка" : blocked ? "Забронировано" : selected ? "Выбрано" : outOfRange ? "Недоступно" : "Доступно"}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold sm:gap-2 sm:text-xs">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[#0a8f32]">доступно</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">выходной тариф</span>
        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">занято / заявка</span>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[#0875d1]">выбрано</span>
      </div>
    </div>
  );
}

export function BookingCalculator({ booking, listingId = "listing", listingTitle = "Объявление" }: { booking?: BookingDetails; listingId?: string; listingTitle?: string }) {
  const initialStartDate = booking?.mode === "stay" ? resolveFirstAvailableStayStart(booking, [], listingId) : "";
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(resolveInitialStayEnd(initialStartDate, booking));
  const [guests, setGuests] = useState(1);
  const [bookingMessage, setBookingMessage] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [requests, setRequests] = useState<BookingRequest[]>([]);

  useEffect(() => {
    function syncRequests() {
      setRequests(readBookingRequests());
    }

    syncRequests();
    window.addEventListener("storage", syncRequests);
    window.addEventListener(bookingNotificationsEventName, syncRequests);

    return () => {
      window.removeEventListener("storage", syncRequests);
      window.removeEventListener(bookingNotificationsEventName, syncRequests);
    };
  }, []);

  useEffect(() => {
    if (!booking || booking.mode !== "stay") {
      return;
    }

    const firstAvailableStart = resolveFirstAvailableStayStart(booking, requests, listingId);

    if (!startDate || startDate < resolveStayStartLimit(booking) || dateIsBookedByRequest(toDate(startDate) ?? new Date(), requests, listingId)) {
      setStartDate(firstAvailableStart);
      setEndDate(resolveInitialStayEnd(firstAvailableStart, booking));
      return;
    }

    if (!endDate && firstAvailableStart) {
      setEndDate(resolveInitialStayEnd(startDate, booking));
    }
  }, [booking, endDate, listingId, requests, startDate]);

  function createBookingRequest(payload: { endDate?: string; guests: number; startDate?: string; total: number }) {
    setBookingError("");
    setBookingMessage("");

    if (!payload.startDate) {
      setBookingError("Выберите дату бронирования.");
      return false;
    }

    if (payload.startDate < todayKey()) {
      setBookingError("Нельзя забронировать прошедшую дату.");
      return false;
    }

    const activeRequests = readBookingRequests();
    const duplicateRequest = activeRequests.some(
      (request) =>
        request.listingId === listingId &&
        request.startDate === payload.startDate &&
        request.endDate === payload.endDate &&
        (request.status === "pending" || request.status === "accepted"),
    );

    if (duplicateRequest) {
      setBookingError("На эти даты уже есть активная заявка.");
      return false;
    }

    const now = new Date().toISOString();
    const requestId = `booking-${Date.now().toString(36)}`;
    const request: BookingRequest = {
      id: requestId,
      listingId,
      listingTitle,
      startDate: payload.startDate,
      endDate: payload.endDate,
      guests: payload.guests,
      total: payload.total,
      status: "pending",
      createdAt: now,
    };
    const ownerNotification: BookingNotification = {
      id: `booking-notification-owner-${Date.now().toString(36)}`,
      requestId,
      recipient: "owner",
      title: "Новая заявка на бронь",
      message: `Пользователь хочет забронировать "${listingTitle}"${payload.endDate ? ` с ${formatShortDate(payload.startDate)} до ${formatShortDate(payload.endDate)}` : ` на ${formatShortDate(payload.startDate)}`}. Гостей: ${payload.guests}, сумма: ${formatCurrency(payload.total)}.`,
      createdAt: now,
      read: false,
      actionable: true,
    };
    const guestNotification: BookingNotification = {
      id: `booking-notification-guest-${Date.now().toString(36)}`,
      requestId,
      recipient: "guest",
      title: "Заявка отправлена",
      message: `Заявка на бронь "${listingTitle}" отправлена владельцу. Даты: ${formatShortDate(payload.startDate)}${payload.endDate ? ` - ${formatShortDate(payload.endDate)}` : ""}. Ответ придет сюда же.`,
      createdAt: now,
      read: false,
    };
    const requests = readJsonArray<BookingRequest>(bookingRequestsStorageKey);
    const notifications = readJsonArray<BookingNotification>(bookingNotificationsStorageKey);

    window.localStorage.setItem(bookingRequestsStorageKey, JSON.stringify([request, ...requests].slice(0, 50)));
    window.localStorage.setItem(bookingNotificationsStorageKey, JSON.stringify([ownerNotification, guestNotification, ...notifications].slice(0, 80)));
    window.dispatchEvent(new Event(bookingNotificationsEventName));
    return true;
  }

  function handleCalendarDateClick(nextDate: string) {
    const start = toDate(startDate);
    const next = toDate(nextDate);

    setBookingError("");
    setBookingMessage("");

    if (!next) {
      return;
    }

    if (!start || endDate || next <= start) {
      setStartDate(nextDate);
      setEndDate("");
      return;
    }

    setEndDate(nextDate);
  }

  const result = useMemo(() => {
    if (!booking || booking.mode === "tour") {
      return { baseTotal: 0, errors: [] as string[], extraGuestCost: 0, extraGuests: 0, nights: [], selectedDates: new Set<string>(), total: 0 };
    }

    const nights = nightsBetween(startDate, endDate);
    const blockedDates = new Set(booking.blockedDates ?? []);
    const unavailableDates = new Set(
      requests
        .filter((request) => request.listingId === listingId && (request.status === "pending" || request.status === "accepted"))
        .flatMap((request) => (request.endDate ? nightsBetween(request.startDate, request.endDate).map(dateKey) : request.startDate ? [request.startDate] : [])),
    );
    const errors: string[] = [];
    const availableFrom = toDate(resolveStayStartLimit(booking));
    const availableTo = toDate(resolveStayEndLimit(booking));
    const start = toDate(startDate);
    const end = toDate(endDate);

    if (!start || !end || end <= start) {
      errors.push("Выберите корректные даты заезда и выезда.");
    }

    if (booking.minNights && nights.length > 0 && nights.length < booking.minNights) {
      errors.push(`Минимальный срок бронирования: ${booking.minNights} ноч.`);
    }

    if (booking.maxGuests && guests > booking.maxGuests) {
      errors.push(`Максимум гостей: ${booking.maxGuests}.`);
    }

    if (availableFrom && start && start < availableFrom) {
      errors.push("Дата заезда раньше доступного периода.");
    }

    if (startDate && startDate < todayKey()) {
      errors.push("Дата заезда уже прошла.");
    }

    if (availableTo && end && end > availableTo) {
      errors.push("Дата выезда позже доступного периода.");
    }

    if (booking.availableTo && startDate && startDate > booking.availableTo) {
      errors.push("Дата заезда позже последнего доступного дня.");
    }

    if (nights.some((date) => blockedDates.has(dateKey(date)) || unavailableDates.has(dateKey(date)))) {
      errors.push("В выбранном периоде есть занятые дни или активная заявка.");
    }

    const baseTotal = nights.reduce((sum, date) => sum + (isWeekend(date) ? booking.priceWeekend ?? booking.priceWeekday ?? 0 : booking.priceWeekday ?? booking.priceWeekend ?? 0), 0);
    const includedGuests = booking.includedGuests ?? booking.maxGuests ?? guests;
    const extraGuests = Math.max(0, guests - includedGuests);
    const extraGuestCost = extraGuests * nights.length * (booking.extraGuestPrice ?? 0);
    const total = baseTotal + extraGuestCost;

    return { baseTotal, nights, selectedDates: new Set(nights.map(dateKey)), extraGuestCost, extraGuests, total, errors };
  }, [booking, endDate, guests, listingId, requests, startDate]);

  if (!booking) {
    return null;
  }

  if (booking.mode === "tour") {
    const price = booking.pricePerPerson ?? 0;
    const total = price * guests;
    const tooManyGuests = booking.maxGuests && guests > booking.maxGuests;
    const tourDate = booking.tourDate ?? "";
    const tourInPast = Boolean(tourDate && tourDate < todayKey());
    const tourAlreadyRequested = requests.some((request) => request.listingId === listingId && request.startDate === tourDate && (request.status === "pending" || request.status === "accepted"));

    return (
      <section className="min-w-0 rounded-xl border border-blue-200 bg-blue-50/60 p-3 shadow-card sm:p-5">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-black leading-tight text-[#060b27] sm:text-xl">
          <CalendarDays className="h-5 w-5 text-[#0875d1]" />
          Бронирование похода
        </h2>
        <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-white p-3">
            <dt className="font-bold text-slate-500">Дата и время</dt>
            <dd className="mt-1 font-black text-slate-900">{formatDate(booking.tourDate)} {booking.tourTime ? `в ${booking.tourTime}` : ""}</dd>
          </div>
          <div className="rounded-lg bg-white p-3">
            <dt className="font-bold text-slate-500">Продолжительность</dt>
            <dd className="mt-1 font-black text-slate-900">{booking.tourDuration || "Уточняется"}</dd>
          </div>
          <div className="rounded-lg bg-white p-3">
            <dt className="font-bold text-slate-500">Сложность</dt>
            <dd className="mt-1 font-black text-slate-900">{booking.tourDifficulty || "Уточняется"}</dd>
          </div>
          <div className="rounded-lg bg-white p-3">
            <dt className="font-bold text-slate-500">Место сбора</dt>
            <dd className="mt-1 font-black text-slate-900">{booking.tourMeetingPoint || "Уточняется"}</dd>
          </div>
        </dl>
        <label className="mt-4 block min-w-0">
          <span className="text-sm font-bold text-slate-700">Количество участников</span>
          <input value={guests} onChange={(event) => setGuests(Math.max(1, Number(event.target.value) || 1))} type="number" min="1" max={booking.maxGuests} className="mt-2 h-12 w-full min-w-0 rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
        </label>
        <p className="mt-4 text-3xl font-black text-[#060b27]">{price ? formatCurrency(total) : "Стоимость уточняется"}</p>
        {tooManyGuests ? <p className="mt-2 text-sm font-bold text-rose-600">Свободных мест: {booking.maxGuests}</p> : null}
        {tourInPast ? <p className="mt-2 text-sm font-bold text-rose-600">Дата похода уже прошла.</p> : null}
        {tourAlreadyRequested ? <p className="mt-2 text-sm font-bold text-amber-700">На этот поход уже есть активная заявка.</p> : null}
        <button
          type="button"
          disabled={Boolean(tooManyGuests || tourInPast || tourAlreadyRequested || !tourDate)}
          onClick={() => {
            if (createBookingRequest({ guests, total, startDate: booking.tourDate })) {
              setBookingMessage("Заявка отправлена владельцу. Ответ появится в уведомлениях.");
            }
          }}
          className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#0aa337] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Забронировать
        </button>
        {bookingError ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-bold leading-6 text-rose-700">{bookingError}</p> : null}
        {bookingMessage ? <p className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold leading-6 text-[#0a8f32]">{bookingMessage}</p> : null}
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-xl border border-blue-200 bg-blue-50/60 p-3 shadow-card sm:p-5">
      <h2 className="flex min-w-0 items-center gap-2 text-lg font-black leading-tight text-[#060b27] sm:text-xl">
        <CalendarDays className="h-5 w-5 text-[#0875d1]" />
        <span className="min-w-0">Рассчитать бронирование</span>
      </h2>
      <div className="mt-4 grid gap-4">
        <BookingCalendar booking={booking} endDate={endDate} listingId={listingId} onDateClick={handleCalendarDateClick} requests={requests} selectedDates={result.selectedDates} startDate={startDate} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="text-sm font-bold text-slate-700">Заезд</span>
            <button
              type="button"
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              className="mt-2 flex h-12 w-full min-w-0 items-center justify-between rounded-lg border border-slate-300 bg-white px-4 text-left text-base font-semibold text-[#060b27] transition hover:border-blue-200 focus:border-[#0875d1] focus:outline-none"
            >
              <span>{formatShortDate(startDate)}</span>
              <CalendarDays className="h-4 w-4 shrink-0 text-slate-700" />
            </button>
          </label>
          <label className="block min-w-0">
            <span className="text-sm font-bold text-slate-700">Выезд</span>
            <button
              type="button"
              onClick={() => setEndDate("")}
              className="mt-2 flex h-12 w-full min-w-0 items-center justify-between rounded-lg border border-slate-300 bg-white px-4 text-left text-base font-semibold text-[#060b27] transition hover:border-blue-200 focus:border-[#0875d1] focus:outline-none"
            >
              <span>{formatShortDate(endDate)}</span>
              <CalendarDays className="h-4 w-4 shrink-0 text-slate-700" />
            </button>
          </label>
          <label className="block min-w-0 sm:col-span-2">
            <span className="text-sm font-bold text-slate-700">Количество гостей</span>
            <input value={guests} onChange={(event) => setGuests(Math.max(1, Number(event.target.value) || 1))} type="number" min="1" max={booking.maxGuests} className="mt-2 h-12 w-full min-w-0 rounded-lg border border-slate-300 px-4 outline-none focus:border-[#0875d1]" />
          </label>
        </div>
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-white p-3">
          <dt className="font-bold text-slate-500">Будни</dt>
          <dd className="mt-1 font-black text-slate-900">{booking.priceWeekday ? `${formatCurrency(booking.priceWeekday)} / сутки` : "не указано"}</dd>
        </div>
        <div className="rounded-lg bg-white p-3">
          <dt className="font-bold text-slate-500">Выходные</dt>
          <dd className="mt-1 font-black text-slate-900">{booking.priceWeekend ? `${formatCurrency(booking.priceWeekend)} / сутки` : "не указано"}</dd>
        </div>
        <div className="rounded-lg bg-white p-3">
          <dt className="font-bold text-slate-500">Заезд / выезд</dt>
          <dd className="mt-1 font-black text-slate-900">{booking.checkInTime || "заезд"} / {booking.checkOutTime || "выезд"}</dd>
        </div>
        <div className="rounded-lg bg-white p-3">
          <dt className="font-bold text-slate-500">Гостей</dt>
          <dd className="mt-1 font-black text-slate-900">включено {booking.includedGuests ?? "уточняется"}, до {booking.maxGuests ?? "уточняется"}</dd>
        </div>
        <div className="rounded-lg bg-white p-3 sm:col-span-2">
          <dt className="font-bold text-slate-500">Дополнительный гость</dt>
          <dd className="mt-1 font-black text-slate-900">{booking.extraGuestPrice ? `${formatCurrency(booking.extraGuestPrice)} / сутки` : "без доплаты или уточняется"}</dd>
        </div>
      </dl>
      <div className="mt-4 rounded-xl bg-white p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-600">
          <UsersRound className="h-4 w-4 text-[#0875d1]" />
          {result.nights.length} ноч., {guests} гост.
        </p>
        {result.baseTotal ? <p className="mt-2 text-sm font-semibold text-slate-600">Проживание: {formatCurrency(result.baseTotal)}</p> : null}
        {result.extraGuestCost ? (
          <p className="mt-1 text-sm font-semibold text-slate-600">
            Доплата за {result.extraGuests} гост.: {formatCurrency(result.extraGuestCost)}
          </p>
        ) : null}
        <p className="mt-2 text-3xl font-black text-[#060b27]">{result.total ? formatCurrency(result.total) : "Выберите даты"}</p>
        {result.errors.length ? (
          <div className="mt-3 grid gap-1">
            {result.errors.map((error) => (
              <p key={error} className="text-sm font-bold text-rose-600">{error}</p>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        disabled={Boolean(result.errors.length) || !result.total}
        onClick={() => {
          if (createBookingRequest({ endDate, guests, startDate, total: result.total })) {
            setBookingMessage("Заявка отправлена владельцу. Ответ появится в уведомлениях.");
          }
        }}
        className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#0aa337] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Забронировать
      </button>
      {bookingError ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-bold leading-6 text-rose-700">{bookingError}</p> : null}
      {bookingMessage ? <p className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold leading-6 text-[#0a8f32]">{bookingMessage}</p> : null}
      {booking.included ? <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-700"><b>Включено:</b> {booking.included}</p> : null}
      {booking.rules ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700"><b>Правила:</b> {booking.rules}</p> : null}
    </section>
  );
}
