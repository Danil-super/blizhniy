"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, X } from "lucide-react";
import bellGif from "../../bell.gif";
import { useAuthState } from "@/components/auth/useAuthState";
import {
  BookingNotification,
  BookingRequest,
  bookingNotificationsEventName,
  bookingNotificationsStorageKey,
  bookingRequestsStorageKey,
} from "@/lib/booking-notifications";
import {
  clearSiteNotifications,
  markSiteNotificationsRead,
  readSiteNotifications,
  siteNotificationsEventName,
  type SiteNotification,
} from "@/lib/site-notifications";
import {
  createDefaultCabinetProfile,
  readCabinetProfile,
  resolveClientUserIdentity,
  type CabinetProfile,
  type ClientUserIdentity,
} from "@/lib/client-user-profile";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

function readJsonArray<T>(key: string): T[] {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!isSupabaseBrowserConfigured()) {
    return {};
  }

  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

function mergeNotifications(localItems: SiteNotification[], serverItems: SiteNotification[]) {
  const byId = new Map<string, SiteNotification>();

  for (const item of [...serverItems, ...localItems]) {
    byId.set(item.id, item);
  }

  return [...byId.values()].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 120);
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

function notificationCategoryLabel(notification: SiteNotification) {
  if (notification.category === "payment") {
    return "Оплата";
  }

  if (notification.category === "publication") {
    return "Публикация";
  }

  if (notification.category === "booking") {
    return "Бронь";
  }

  if (notification.category === "message") {
    return "Сообщение";
  }

  if (notification.category === "security") {
    return "Безопасность";
  }

  return "Система";
}

function notificationToneClassName(notification: SiteNotification) {
  if (notification.tone === "success") {
    return "border-emerald-100 bg-emerald-50/70";
  }

  if (notification.tone === "warning") {
    return "border-amber-100 bg-amber-50/70";
  }

  if (notification.tone === "danger") {
    return "border-rose-100 bg-rose-50/70";
  }

  return notification.read ? "border-slate-100 bg-white" : "border-blue-100 bg-blue-50/70";
}

export function NotificationBell() {
  const { state: authState } = useAuthState();
  const [open, setOpen] = useState(false);
  const [siteNotifications, setSiteNotifications] = useState<SiteNotification[]>([]);
  const [bookingNotifications, setBookingNotifications] = useState<BookingNotification[]>([]);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [resolvingServerRequestId, setResolvingServerRequestId] = useState("");
  const [identity, setIdentity] = useState<ClientUserIdentity | null>(null);
  const [profile, setProfile] = useState<CabinetProfile | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const signedOut = authState === "signed-out";
  const unreadCount = siteNotifications.filter((notification) => !notification.read).length + bookingNotifications.filter((notification) => !notification.read).length;
  const sortedSiteNotifications = useMemo(
    () => [...siteNotifications].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [siteNotifications],
  );
  const sortedBookingNotifications = useMemo(
    () => [...bookingNotifications].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [bookingNotifications],
  );

  const syncStoredNotifications = useCallback(() => {
    async function sync() {
      const nextIdentity = await resolveClientUserIdentity();
      const nextProfile = readCabinetProfile(nextIdentity.ownerKey, createDefaultCabinetProfile(nextIdentity));

      setIdentity(nextIdentity);
      setProfile(nextProfile);
      const localNotifications = readSiteNotifications(nextIdentity.ownerKey);
      const serverNotifications = await getAuthHeaders()
        .then((headers) =>
          Object.keys(headers).length
            ? fetch("/api/cabinet/notifications", {
                cache: "no-store",
                headers,
              })
            : null,
        )
        .then(async (response) => {
          if (!response?.ok) {
            return [];
          }

          const payload = (await response.json().catch(() => null)) as { notifications?: SiteNotification[] } | null;
          return payload?.notifications ?? [];
        })
        .catch(() => []);

      setSiteNotifications(mergeNotifications(localNotifications, serverNotifications));
      setRequests(readJsonArray<BookingRequest>(bookingRequestsStorageKey));
      setBookingNotifications(nextProfile.notifyBookings ? readJsonArray<BookingNotification>(bookingNotificationsStorageKey).filter((notification) => notification.recipient === "guest") : []);
    }

    void sync();
  }, []);

  useEffect(() => {
    syncStoredNotifications();

    function handleDocumentClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("storage", syncStoredNotifications);
    window.addEventListener(bookingNotificationsEventName, syncStoredNotifications);
    window.addEventListener(siteNotificationsEventName, syncStoredNotifications);
    window.addEventListener("blizhniy-profile-updated", syncStoredNotifications);
    document.addEventListener("mousedown", handleDocumentClick);

    return () => {
      window.removeEventListener("storage", syncStoredNotifications);
      window.removeEventListener(bookingNotificationsEventName, syncStoredNotifications);
      window.removeEventListener(siteNotificationsEventName, syncStoredNotifications);
      window.removeEventListener("blizhniy-profile-updated", syncStoredNotifications);
      document.removeEventListener("mousedown", handleDocumentClick);
    };
  }, [syncStoredNotifications]);

  function emitUpdate() {
    window.dispatchEvent(new Event(bookingNotificationsEventName));
  }

  function markAllRead() {
    if (identity) {
      markSiteNotificationsRead(identity.ownerKey);
    }

    void getAuthHeaders()
      .then((headers) =>
        Object.keys(headers).length
          ? fetch("/api/cabinet/notifications", {
              method: "PATCH",
              headers,
            })
          : null,
      )
      .finally(() => syncStoredNotifications());

    const next = bookingNotifications.map((notification) => ({ ...notification, read: true }));
    writeJsonArray(bookingNotificationsStorageKey, next);
    setBookingNotifications(next);
    emitUpdate();
  }

  function clearNotifications() {
    if (identity) {
      clearSiteNotifications(identity.ownerKey);
    }

    writeJsonArray(bookingNotificationsStorageKey, []);
    setSiteNotifications([]);
    setBookingNotifications([]);
    emitUpdate();
  }

  function resolveRequest(requestId: string, status: "accepted" | "declined") {
    const now = new Date().toISOString();
    const request = requests.find((item) => item.id === requestId);

    if (!request) {
      return;
    }

    const nextRequests = requests.map((item) => (item.id === requestId ? { ...item, status } : item));
    const nextNotifications = bookingNotifications.map((notification) =>
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
    syncStoredNotifications();
    emitUpdate();
  }

  async function resolveServerRequest(requestId: string, status: "accepted" | "declined") {
    setResolvingServerRequestId(requestId);

    try {
      await fetch("/api/cabinet/bookings", {
        body: JSON.stringify({ requestId, status }),
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        method: "PATCH",
      });
      window.dispatchEvent(new Event(siteNotificationsEventName));
      syncStoredNotifications();
    } finally {
      setResolvingServerRequestId("");
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative inline-flex h-6 w-6 items-center justify-center overflow-visible bg-transparent text-slate-950 transition hover:text-[#0875d1]"
        aria-label="Уведомления"
        aria-expanded={open}
      >
        <Image
          src={bellGif}
          alt=""
          width={34}
          height={34}
          unoptimized
          className="absolute left-1/2 top-1/2 h-[34px] w-[34px] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
          aria-hidden="true"
        />
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
              <p className="text-xs font-semibold text-slate-500">
                {signedOut ? "Войдите, чтобы получать личные события" : "Оплаты, публикации, брони и системные события"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {unreadCount ? (
                <button type="button" onClick={markAllRead} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-[#0875d1] hover:text-[#0664b3]">
                  Прочитать
                </button>
              ) : null}
              {siteNotifications.length || bookingNotifications.length ? (
                <button type="button" onClick={clearNotifications} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:text-rose-700">
                  Очистить
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {signedOut ? (
              <div className="border-b border-slate-100 bg-blue-50/60 px-4 py-4">
                <p className="font-black text-[#060b27]">Уведомления доступны после входа</p>
                <p className="mt-1 text-sm leading-5 text-slate-600">Личные события по оплатам, публикациям и заявкам привязываются к аккаунту. Гость видит только локальные уведомления текущего браузера.</p>
                <Link href="/auth" className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-[#0875d1] px-3 text-xs font-bold text-white">
                  Войти или зарегистрироваться
                </Link>
              </div>
            ) : null}
            {profile ? (
              <div className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold text-slate-500">
                Каналы: {profile.emailNotifications ? "email включен" : "email выключен"}, {profile.pushNotifications ? "push включен" : "push выключен"}
              </div>
            ) : null}
            {sortedSiteNotifications.length ? (
              sortedSiteNotifications.map((notification) => (
                <article key={notification.id} className={`border-b px-4 py-3 ${notificationToneClassName(notification)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-black text-[#060b27]">{notification.title}</p>
                        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                          {notificationCategoryLabel(notification)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-slate-600">{notification.message}</p>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold text-slate-400">{formatDateTime(notification.createdAt)}</span>
                  </div>
                  {notification.bookingRequestId ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={resolvingServerRequestId === notification.bookingRequestId}
                        onClick={() => resolveServerRequest(notification.bookingRequestId!, "accepted")}
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-[#0aa337] text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        <Check className="h-4 w-4" />
                        Принять
                      </button>
                      <button
                        type="button"
                        disabled={resolvingServerRequestId === notification.bookingRequestId}
                        onClick={() => resolveServerRequest(notification.bookingRequestId!, "declined")}
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-white text-xs font-bold text-rose-700 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        <X className="h-4 w-4" />
                        Отклонить
                      </button>
                    </div>
                  ) : notification.actionHref ? (
                    notification.actionHref.startsWith("http") ? (
                      <a href={notification.actionHref} className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-white px-3 text-xs font-bold text-[#0875d1] ring-1 ring-blue-100 transition hover:ring-blue-200">
                        {notification.actionLabel ?? "Открыть"}
                      </a>
                    ) : (
                      <Link href={notification.actionHref} className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-white px-3 text-xs font-bold text-[#0875d1] ring-1 ring-blue-100 transition hover:ring-blue-200">
                        {notification.actionLabel ?? "Открыть"}
                      </Link>
                    )
                  ) : null}
                </article>
              ))
            ) : null}
            {sortedBookingNotifications.length ? (
              sortedBookingNotifications.map((notification) => {
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
            ) : null}
            {!sortedSiteNotifications.length && !sortedBookingNotifications.length ? (
              <div className="px-4 py-8 text-center">
                <p className="font-bold text-slate-700">Уведомлений нет</p>
                <p className="mt-1 text-sm text-slate-500">Новые оплаты, статусы публикаций, брони и системные сообщения появятся здесь.</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
