"use client";

import { useMemo, useState } from "react";
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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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

function BookingCalendar({
  booking,
  endDate,
  onDateClick,
  selectedDates,
  startDate,
}: {
  booking: BookingDetails;
  endDate: string;
  onDateClick: (date: string) => void;
  selectedDates: Set<string>;
  startDate: string;
}) {
  const blockedDates = new Set(booking.blockedDates ?? []);
  const availableFrom = toDate(booking.availableFrom);
  const availableTo = toDate(booking.availableTo);
  const [visibleMonth, setVisibleMonth] = useState(availableFrom ?? new Date());
  const cells = monthDays(visibleMonth);

  function shiftMonth(delta: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => shiftMonth(-1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:text-[#0875d1]" aria-label="Предыдущий месяц">
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
          const blocked = blockedDates.has(key);
          const selected = selectedDates.has(key);
          const edge = key === startDate || key === endDate;
          const outOfRange = Boolean((availableFrom && date < availableFrom) || (availableTo && date > availableTo));
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
              title={blocked ? "Забронировано" : selected ? "Выбрано" : outOfRange ? "Недоступно" : "Доступно"}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold sm:gap-2 sm:text-xs">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[#0a8f32]">доступно</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">выходной тариф</span>
        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">занято</span>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[#0875d1]">выбрано</span>
      </div>
    </div>
  );
}

export function BookingCalculator({ booking, listingId = "listing", listingTitle = "Объявление" }: { booking?: BookingDetails; listingId?: string; listingTitle?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(booking?.availableFrom ?? today);
  const [endDate, setEndDate] = useState(booking?.availableFrom ? dateKey(addDays(toDate(booking.availableFrom) ?? new Date(), Math.max(booking.minNights ?? 1, 1))) : "");
  const [guests, setGuests] = useState(1);
  const [bookingMessage, setBookingMessage] = useState("");

  function createBookingRequest(payload: { endDate?: string; guests: number; startDate?: string; total: number }) {
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
      message: `Пользователь хочет забронировать "${listingTitle}". Проверьте даты, гостей и сумму.`,
      createdAt: now,
      read: false,
      actionable: true,
    };
    const guestNotification: BookingNotification = {
      id: `booking-notification-guest-${Date.now().toString(36)}`,
      requestId,
      recipient: "guest",
      title: "Заявка отправлена",
      message: `Заявка на бронь "${listingTitle}" отправлена владельцу. Ответ придет сюда же.`,
      createdAt: now,
      read: false,
    };
    const requests = readJsonArray<BookingRequest>(bookingRequestsStorageKey);
    const notifications = readJsonArray<BookingNotification>(bookingNotificationsStorageKey);

    window.localStorage.setItem(bookingRequestsStorageKey, JSON.stringify([request, ...requests].slice(0, 50)));
    window.localStorage.setItem(bookingNotificationsStorageKey, JSON.stringify([ownerNotification, guestNotification, ...notifications].slice(0, 80)));
    window.dispatchEvent(new Event(bookingNotificationsEventName));
  }

  function handleCalendarDateClick(nextDate: string) {
    const start = toDate(startDate);
    const next = toDate(nextDate);

    if (!start || endDate || !next || next <= start) {
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
    const errors: string[] = [];
    const availableFrom = toDate(booking.availableFrom);
    const availableTo = toDate(booking.availableTo);
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

    if (availableTo && end && end > addDays(availableTo, 1)) {
      errors.push("Дата выезда позже доступного периода.");
    }

    if (nights.some((date) => blockedDates.has(dateKey(date)))) {
      errors.push("В выбранном периоде есть забронированные дни.");
    }

    const baseTotal = nights.reduce((sum, date) => sum + (isWeekend(date) ? booking.priceWeekend ?? booking.priceWeekday ?? 0 : booking.priceWeekday ?? booking.priceWeekend ?? 0), 0);
    const includedGuests = booking.includedGuests ?? booking.maxGuests ?? guests;
    const extraGuests = Math.max(0, guests - includedGuests);
    const extraGuestCost = extraGuests * nights.length * (booking.extraGuestPrice ?? 0);
    const total = baseTotal + extraGuestCost;

    return { baseTotal, nights, selectedDates: new Set(nights.map(dateKey)), extraGuestCost, extraGuests, total, errors };
  }, [booking, endDate, guests, startDate]);

  if (!booking) {
    return null;
  }

  if (booking.mode === "tour") {
    const price = booking.pricePerPerson ?? 0;
    const total = price * guests;
    const tooManyGuests = booking.maxGuests && guests > booking.maxGuests;

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
        <button
          type="button"
          onClick={() => {
            createBookingRequest({ guests, total, startDate: booking.tourDate });
            setBookingMessage("Заявка отправлена владельцу. Ответ появится в уведомлениях.");
          }}
          className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#0aa337] font-bold text-white"
        >
          Забронировать
        </button>
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
        <BookingCalendar booking={booking} endDate={endDate} onDateClick={handleCalendarDateClick} selectedDates={result.selectedDates} startDate={startDate} />
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
          createBookingRequest({ endDate, guests, startDate, total: result.total });
          setBookingMessage("Заявка отправлена владельцу. Ответ появится в уведомлениях.");
        }}
        className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#0aa337] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Забронировать
      </button>
      {bookingMessage ? <p className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold leading-6 text-[#0a8f32]">{bookingMessage}</p> : null}
      {booking.included ? <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-700"><b>Включено:</b> {booking.included}</p> : null}
      {booking.rules ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700"><b>Правила:</b> {booking.rules}</p> : null}
    </section>
  );
}
