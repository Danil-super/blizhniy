"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, X } from "lucide-react";
import bellGif from "../../bell.gif";
import {
  BookingNotification,
  BookingRequest,
  bookingNotificationsEventName,
  bookingNotificationsStorageKey,
  bookingRequestsStorageKey,
} from "@/lib/booking-notifications";

function readJsonArray<T>(key: string): T[] {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(key: string, items: T[]) {
  window.localStorage.setItem(key, JSON.stringify(items));
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<BookingNotification[]>([]);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const sortedNotifications = useMemo(
    () => [...notifications].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [notifications],
  );

  function sync() {
    setNotifications(readJsonArray<BookingNotification>(bookingNotificationsStorageKey));
    setRequests(readJsonArray<BookingRequest>(bookingRequestsStorageKey));
  }

  useEffect(() => {
    sync();

    function handleDocumentClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("storage", sync);
    window.addEventListener(bookingNotificationsEventName, sync);
    document.addEventListener("mousedown", handleDocumentClick);

    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(bookingNotificationsEventName, sync);
      document.removeEventListener("mousedown", handleDocumentClick);
    };
  }, []);

  function emitUpdate() {
    window.dispatchEvent(new Event(bookingNotificationsEventName));
  }

  function markAllRead() {
    const next = notifications.map((notification) => ({ ...notification, read: true }));
    writeJsonArray(bookingNotificationsStorageKey, next);
    setNotifications(next);
    emitUpdate();
  }

  function clearNotifications() {
    writeJsonArray(bookingNotificationsStorageKey, []);
    writeJsonArray(bookingRequestsStorageKey, []);
    setNotifications([]);
    setRequests([]);
    emitUpdate();
  }

  function resolveRequest(requestId: string, status: "accepted" | "declined") {
    const now = new Date().toISOString();
    const request = requests.find((item) => item.id === requestId);

    if (!request) {
      return;
    }

    const nextRequests = requests.map((item) => (item.id === requestId ? { ...item, status } : item));
    const nextNotifications = notifications.map((notification) =>
      notification.requestId === requestId && notification.recipient === "owner"
        ? { ...notification, actionable: false, read: true }
        : notification,
    );
    const guestNotification: BookingNotification = {
      id: `booking-notification-${Date.now().toString(36)}`,
      requestId,
      recipient: "guest",
      title: status === "accepted" ? "Бронь подтверждена" : "Бронь отклонена",
      message:
        status === "accepted"
          ? `Владелец подтвердил бронь "${request.listingTitle}". Следующий шаг - связаться с владельцем или перейти к оплате.`
          : `Владелец отклонил бронь "${request.listingTitle}". Выберите другие даты или напишите владельцу.`,
      createdAt: now,
      read: false,
    };

    writeJsonArray(bookingRequestsStorageKey, nextRequests);
    writeJsonArray(bookingNotificationsStorageKey, [guestNotification, ...nextNotifications].slice(0, 80));
    sync();
    emitUpdate();
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative inline-flex h-9 w-6 items-center justify-center bg-transparent text-slate-950 transition hover:text-[#0875d1]"
        aria-label="Уведомления"
        aria-expanded={open}
      >
        <Image src={bellGif} alt="" width={24} height={24} unoptimized className="h-6 w-6 shrink-0 object-contain" aria-hidden="true" />
        {unreadCount ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed right-3 top-12 z-[100] w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 md:absolute md:right-0 md:top-[calc(100%+8px)]">
          <div className="grid gap-3 border-b border-slate-100 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div>
              <p className="font-black text-[#060b27]">Уведомления</p>
              <p className="text-xs font-semibold text-slate-500">Брони и ответы по заявкам</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {unreadCount ? (
                <button type="button" onClick={markAllRead} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-[#0875d1] hover:text-[#0664b3]">
                  Прочитать
                </button>
              ) : null}
              {notifications.length ? (
                <button type="button" onClick={clearNotifications} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:text-rose-700">
                  Очистить
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {sortedNotifications.length ? (
              sortedNotifications.map((notification) => {
                const request = notification.requestId ? requests.find((item) => item.id === notification.requestId) : undefined;
                const actionable = notification.actionable && request?.status === "pending";

                return (
                  <article key={notification.id} className={`border-b border-slate-100 px-4 py-3 ${notification.read ? "bg-white" : "bg-blue-50/60"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black text-[#060b27]">{notification.title}</p>
                        <p className="mt-1 text-sm leading-5 text-slate-600">{notification.message}</p>
                      </div>
                      <span className="shrink-0 text-[11px] font-bold text-slate-400">{formatDateTime(notification.createdAt)}</span>
                    </div>
                    {request ? (
                      <div className="mt-2 rounded-lg bg-white p-2 text-xs font-semibold leading-5 text-slate-600 ring-1 ring-slate-100">
                        {request.startDate && request.endDate ? `${request.startDate} - ${request.endDate}, ` : null}
                        {request.guests} гост., {request.total ? `${request.total.toLocaleString("ru-RU")} ₽` : "сумма уточняется"}
                      </div>
                    ) : null}
                    {actionable ? (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => resolveRequest(notification.requestId!, "accepted")} className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-[#0aa337] text-xs font-bold text-white">
                          <Check className="h-4 w-4" />
                          Принять
                        </button>
                        <button type="button" onClick={() => resolveRequest(notification.requestId!, "declined")} className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-white text-xs font-bold text-rose-700">
                          <X className="h-4 w-4" />
                          Отклонить
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <div className="px-4 py-8 text-center">
                <p className="font-bold text-slate-700">Уведомлений нет</p>
                <p className="mt-1 text-sm text-slate-500">Новые брони, ответы владельца и системные сообщения появятся здесь.</p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
