"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BriefcaseBusiness, Camera, Check, CheckCircle2, ChevronDown, ClipboardList, Clock3, CreditCard, FileText, LockKeyhole, Mail, MapPin, Move, Phone, Plus, Search, Settings2, Trash2, UserRound, Video, X } from "lucide-react";
import {
  demoPublicationLabels,
  demoPublicationsStorageKey,
  demoPublicationsUpdatedEvent,
  isDemoPublicationSold,
  soldPublicationStatus,
  unpublishedVacancyStatus,
  type DemoPublication,
  type DemoPublicationType,
} from "@/lib/demo-publications";
import { useAuthState } from "@/components/auth/useAuthState";
import { ListingShareButton } from "@/components/listings/ListingShareButton";
import { ValidatedInput } from "@/components/ValidatedInput";
import { cities } from "@/lib/data";
import {
  type CabinetProfile,
  createDefaultCabinetProfile,
  readCabinetProfile,
  resolveClientUserIdentity,
  type ClientUserIdentity,
  writeCabinetProfile,
} from "@/lib/client-user-profile";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type UserCabinetState = {
  identity: ClientUserIdentity | null;
  profile: CabinetProfile | null;
  items: DemoPublication[];
  loading: boolean;
};

type CabinetListMode = DemoPublicationType | "payment" | "response" | "organization";
type AvatarCropDraft = {
  src: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
};
type AvatarImageSize = {
  width: number;
  height: number;
};
export type CabinetPaymentHistoryItem = {
  amount: string;
  href: string;
  id: string;
  method: string;
  status: string;
  subject: string;
};
export type CabinetResponseItem = {
  href: string;
  id: string;
  paymentHref: string;
  paymentId: string;
  specialistName: string;
  status: string;
  vacancyTitle: string;
};

const sortedCities = [...cities].sort((left, right) => left.name.localeCompare(right.name, "ru"));

const emptyCopy: Record<CabinetListMode, { title: string; text: string; href?: string; action?: string }> = {
  fairApplication: {
    title: "Заявок на ярмарку пока нет",
    text: "Когда вы подадите заявку на участие, здесь появятся статус, оплата и быстрые действия.",
    href: "/yarmarka-masterov/zayavka",
    action: "Подать заявку",
  },
  listing: {
    title: "Объявлений пока нет",
    text: "Создайте первое объявление, чтобы оно появилось в ленте и в этом разделе кабинета.",
    href: "/blizhniy/sozdat/obyavlenie",
    action: "Создать объявление",
  },
  organization: {
    title: "Профиль организации не заполнен",
    text: "Добавьте название, контакты и адрес компании, если планируете размещать вакансии от организации.",
  },
  payment: {
    title: "Оплат пока нет",
    text: "История платежей появится после публикации объявления, вакансии, отклика или заявки на ярмарку.",
  },
  response: {
    title: "Откликов пока нет",
    text: "Когда вы оплатите и отправите отклик на вакансию, он появится здесь со статусом просмотра.",
    href: "/blizhniy/rabota/vakansii",
    action: "Смотреть вакансии",
  },
  specialist: {
    title: "Анкета специалиста еще не создана",
    text: "У пользователя может быть только одна анкета. После сохранения ее можно редактировать из кабинета.",
    href: "/blizhniy/rabota/specialisty/anketa",
    action: "Создать анкету",
  },
  vacancy: {
    title: "Вакансий пока нет",
    text: "Разместите вакансию, чтобы получать отклики специалистов и управлять публикацией.",
    href: "/blizhniy/rabota/vakansii/sozdat",
    action: "Разместить вакансию",
  },
  workRequest: {
    title: "Заказов исполнителям пока нет",
    text: "Опишите задачу для специалиста, и она появится в этом разделе.",
    href: "/blizhniy/rabota/zakazy/sozdat",
    action: "Разместить заказ",
  },
};

function readStoredPublications() {
  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "id" in item));
    }
  } catch {
    return [];
  }

  return [];
}

function writeStoredPublications(items: DemoPublication[]) {
  window.localStorage.setItem(demoPublicationsStorageKey, JSON.stringify(items));
  window.dispatchEvent(new Event(demoPublicationsUpdatedEvent));
}

function useUserCabinetData(): UserCabinetState {
  const [state, setState] = useState<UserCabinetState>({ identity: null, profile: null, items: [], loading: true });

  useEffect(() => {
    let active = true;

    async function sync() {
      const identity = await resolveClientUserIdentity();
      const fallback = createDefaultCabinetProfile(identity);
      const profile = readCabinetProfile(identity.ownerKey, fallback);
      const items = readStoredPublications().filter((item) => item.ownerKey === identity.ownerKey);

      if (active) {
        setState({ identity, profile, items, loading: false });
      }
    }

    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(demoPublicationsUpdatedEvent, sync);
    window.addEventListener("blizhniy-profile-updated", sync);

    return () => {
      active = false;
      window.removeEventListener("storage", sync);
      window.removeEventListener(demoPublicationsUpdatedEvent, sync);
      window.removeEventListener("blizhniy-profile-updated", sync);
    };
  }, []);

  return state;
}

function formatDate(value?: string) {
  if (!value) {
    return "Сегодня";
  }

  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

function toRussianPhoneE164(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length !== 11 || digits[0] !== "7") {
    return "";
  }

  return `+${digits}`;
}

function sanitizePersonName(value: string) {
  return value.replace(/[^\p{L}\s-]/gu, "").replace(/\s{2,}/g, " ").replace(/-{2,}/g, "-").slice(0, 60);
}

function sanitizeCityQuery(value: string) {
  return value.replace(/[^\p{L}\s-]/gu, "").replace(/\s{2,}/g, " ").replace(/-{2,}/g, "-").slice(0, 60);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getAvatarTransform(draft: AvatarCropDraft, imageSize: AvatarImageSize, stageSize: number) {
  const baseScale = Math.max(stageSize / imageSize.width, stageSize / imageSize.height);
  const scale = baseScale * draft.zoom;
  const width = imageSize.width * scale;
  const height = imageSize.height * scale;
  const maxOffsetX = Math.max(0, (width - stageSize) / 2);
  const maxOffsetY = Math.max(0, (height - stageSize) / 2);
  const offsetX = clampNumber(draft.offsetX, -maxOffsetX, maxOffsetX);
  const offsetY = clampNumber(draft.offsetY, -maxOffsetY, maxOffsetY);

  return {
    baseScale,
    height,
    offsetX,
    offsetY,
    scale,
    width,
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось подготовить изображение."));
    image.src = src;
  });
}

async function prepareAvatarImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Выберите изображение в формате PNG, JPG или WebP.");
  }

  return readFileAsDataUrl(file);
}

async function cropAvatarImage(draft: AvatarCropDraft, imageSize: AvatarImageSize, stageSize: number) {
  const image = await loadImage(draft.src);
  const transform = getAvatarTransform(draft, imageSize, stageSize);
  const sourceX = (transform.width / 2 - stageSize / 2 - transform.offsetX) / transform.scale;
  const sourceY = (transform.height / 2 - stageSize / 2 - transform.offsetY) / transform.scale;
  const sourceSize = stageSize / transform.scale;
  const outputSize = 512;
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;

  const context = canvas.getContext("2d");

  if (!context) {
    return draft.src;
  }

  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function compressAvatarImage(dataUrl: string) {
  const image = await loadImage(dataUrl);
  const maxSide = 720;
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    return dataUrl;
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function CitySearchSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredCities = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return sortedCities;
    }

    return sortedCities.filter((city) => {
      const normalizedName = city.name.toLowerCase();
      return normalizedName.startsWith(normalizedQuery) || normalizedName.includes(normalizedQuery);
    });
  }, [query]);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  function selectCity(cityName: string) {
    onChange(cityName);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
        className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm font-normal text-slate-950 outline-none transition hover:bg-slate-50 focus:border-[#0875d1] focus:ring-2 focus:ring-blue-100 sm:text-base"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={`min-w-0 break-words [overflow-wrap:anywhere] ${value ? "" : "text-slate-400"}`}>{value || "Выберите город"}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      <input type="hidden" name="city" value={sortedCities.some((city) => city.name === value) ? value : ""} required />
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10" role="listbox">
          <div className="mb-2 flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-slate-500 focus-within:border-[#0875d1]">
            <Search className="h-4 w-4 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(sanitizeCityQuery(event.target.value))}
              className="min-w-0 flex-1 border-0 bg-transparent px-2 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
              placeholder="Введите город"
              autoComplete="off"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filteredCities.length ? (
              filteredCities.map((city) => {
                const active = city.name === value;

                return (
                  <button
                    key={city.slug}
                    type="button"
                    onClick={() => selectCity(city.name)}
                    className={`flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-semibold transition ${
                      active ? "bg-blue-50 text-[#0875d1]" : "text-slate-700 hover:bg-slate-50 hover:text-[#0875d1]"
                    }`}
                    role="option"
                    aria-selected={active}
                  >
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{city.name}</span>
                    {active ? <span className="h-2 w-2 shrink-0 rounded-full bg-[#0875d1]" /> : null}
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-3 text-sm font-semibold text-slate-500">Город не найден</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getItemHref(item: DemoPublication) {
  if (item.type === "listing") {
    return `/blizhniy/obyavlenie/${item.id}`;
  }

  if (item.type === "vacancy") {
    return `/blizhniy/vakansiya/${item.id}`;
  }

  if (item.type === "workRequest") {
    return `/blizhniy/rabota/zakazy/${item.id}`;
  }

  if (item.type === "specialist") {
    return `/blizhniy/specialist/${item.id}`;
  }

  return "/yarmarka-masterov";
}

function getEditHref(item: DemoPublication) {
  if (item.type === "listing") {
    return `/blizhniy/obyavlenie/${item.id}/redaktirovat`;
  }

  if (item.type === "specialist") {
    return `/blizhniy/rabota/specialisty/anketa?from=${item.id}`;
  }

  if (item.type === "vacancy") {
    return `/blizhniy/rabota/vakansii/${item.id}/redaktirovat`;
  }

  if (item.type === "workRequest") {
    return `/blizhniy/rabota/zakazy/${item.id}/redaktirovat`;
  }

  return "/yarmarka-masterov/zayavka";
}

type SoldReason = NonNullable<DemoPublication["soldReason"]>;

const soldReasonLabels: Record<SoldReason, string> = {
  elsewhere: "Продано в другом месте",
  not_actual: "Больше не актуально",
  platform: "Продано через БЛИЖНИЙ",
};

type VacancyFilter = "all" | "published" | "draft" | "unpublished";

const vacancyFilterLabels: Record<VacancyFilter, string> = {
  all: "Все",
  draft: "Черновики",
  published: "Опубликованные",
  unpublished: "Снятые",
};

function normalizePublicationStatus(status: string) {
  return status.trim().toLowerCase();
}

function canMarkListingSold(item: DemoPublication) {
  return item.type === "listing" && !isDemoPublicationSold(item) && normalizePublicationStatus(item.status) !== "черновик";
}

function isDraftPublication(item: DemoPublication) {
  return normalizePublicationStatus(item.status) === "черновик";
}

function isPublishedPublication(item: DemoPublication) {
  const status = normalizePublicationStatus(item.status);

  return status === "опубликовано" || status === "published";
}

function isUnpublishedVacancy(item: DemoPublication) {
  const status = normalizePublicationStatus(item.status);

  return item.type === "vacancy" && (status === normalizePublicationStatus(unpublishedVacancyStatus) || status === "archived");
}

function canUnpublishVacancy(item: DemoPublication) {
  return item.type === "vacancy" && isPublishedPublication(item);
}

function canRestoreVacancy(item: DemoPublication) {
  return item.type === "vacancy" && isUnpublishedVacancy(item);
}

function canDeletePublication(item: DemoPublication) {
  return isDraftPublication(item) || isUnpublishedVacancy(item);
}

function markListingSold(itemId: string, reason: SoldReason) {
  const nextItems = readStoredPublications().map((item) =>
    item.id === itemId && item.type === "listing"
      ? {
          ...item,
          soldAt: new Date().toISOString(),
          soldReason: reason,
          status: soldPublicationStatus,
        }
      : item,
  );

  writeStoredPublications(nextItems);
}

function unpublishVacancy(itemId: string) {
  const nextItems = readStoredPublications().map((item) =>
    item.id === itemId && item.type === "vacancy"
      ? {
          ...item,
          status: unpublishedVacancyStatus,
        }
      : item,
  );

  writeStoredPublications(nextItems);
}

function restoreVacancy(itemId: string) {
  const nextItems = readStoredPublications().map((item) =>
    item.id === itemId && item.type === "vacancy"
      ? {
          ...item,
          status: "Опубликовано",
        }
      : item,
  );

  writeStoredPublications(nextItems);
}

function deletePublication(itemId: string) {
  writeStoredPublications(readStoredPublications().filter((item) => item.id !== itemId || !canDeletePublication(item)));
}

function restoreSoldListing(itemId: string) {
  const nextItems = readStoredPublications().map((item) => {
    if (item.id !== itemId || item.type !== "listing") {
      return item;
    }

    const restoredItem = { ...item };
    delete restoredItem.soldAt;
    delete restoredItem.soldReason;

    return {
      ...restoredItem,
      status: "Опубликовано",
    };
  });

  writeStoredPublications(nextItems);
}

function EmptyState({ mode }: { mode: CabinetListMode }) {
  const copy = emptyCopy[mode];

  return (
    <section className="flex h-full min-h-[13.5rem] flex-col justify-center rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center shadow-card sm:min-h-56 sm:p-5">
      <div>
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[#0875d1]">
          <Plus className="h-5 w-5" />
        </div>
        <h2 className="mt-3 text-lg font-black text-[#060b27] sm:text-xl">{copy.title}</h2>
        <p className="mx-auto mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">{copy.text}</p>
      </div>
      <div className="mt-4 min-h-10">
        {copy.href && copy.action ? (
          <Link href={copy.href} className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white">
            {copy.action}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function StatusPill({ children }: { children: string }) {
  const status = normalizePublicationStatus(children);
  const tone = isDemoPublicationSold({ status: children })
    ? "border-slate-300 bg-slate-100 text-slate-700"
    : status === normalizePublicationStatus(unpublishedVacancyStatus) || status === "archived"
      ? "border-slate-300 bg-slate-50 text-slate-600"
      : status === "черновик" || status.includes("оплат")
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-[#0a8f32]";

  return <span className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-bold ${tone}`}>{children}</span>;
}

function PaymentStatusPill({ status }: { status: string }) {
  const normalizedStatus = status.trim().toLowerCase();
  const tone =
    normalizedStatus === "succeeded"
      ? "border-emerald-200 bg-emerald-50 text-[#0a8f32]"
      : normalizedStatus === "failed"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
  const label = normalizedStatus === "succeeded" ? "Оплачено" : normalizedStatus === "failed" ? "Ошибка" : "Ожидает оплаты";

  return <span className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-bold ${tone}`}>{label}</span>;
}

function ResponseStatusPill({ status }: { status: string }) {
  const normalizedStatus = status.trim().toLowerCase();
  const tone =
    normalizedStatus === "sent"
      ? "border-emerald-200 bg-emerald-50 text-[#0a8f32]"
      : normalizedStatus === "paid"
        ? "border-blue-200 bg-blue-50 text-[#0875d1]"
        : "border-amber-200 bg-amber-50 text-amber-700";
  const label = normalizedStatus === "sent" ? "Отправлен" : normalizedStatus === "paid" ? "Оплачен" : "Ждет оплаты";

  return <span className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-bold ${tone}`}>{label}</span>;
}

function PublicationList({ items, mode }: { items: DemoPublication[]; mode: DemoPublicationType }) {
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [sellingItemId, setSellingItemId] = useState<string | null>(null);
  const [unpublishingItemId, setUnpublishingItemId] = useState<string | null>(null);
  const [vacancyFilter, setVacancyFilter] = useState<VacancyFilter>("all");
  const vacancyCounts = useMemo(
    () => ({
      all: items.length,
      draft: items.filter(isDraftPublication).length,
      published: items.filter((item) => item.type === "vacancy" && isPublishedPublication(item)).length,
      unpublished: items.filter(isUnpublishedVacancy).length,
    }),
    [items],
  );
  const visibleItems = useMemo(() => {
    if (mode !== "vacancy" || vacancyFilter === "all") {
      return items;
    }

    if (vacancyFilter === "draft") {
      return items.filter(isDraftPublication);
    }

    if (vacancyFilter === "published") {
      return items.filter((item) => item.type === "vacancy" && isPublishedPublication(item));
    }

    return items.filter(isUnpublishedVacancy);
  }, [items, mode, vacancyFilter]);

  if (!items.length) {
    return <EmptyState mode={mode} />;
  }

  return (
    <section className="grid min-w-0 gap-3">
      {mode === "vacancy" ? (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <h2 className="text-lg font-black text-[#060b27]">Выбор вакансии</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">У работодателя может быть несколько вакансий: управляйте каждой отдельно по статусу.</p>
            </div>
            <Link href="/blizhniy/rabota/vakansii/sozdat" className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white sm:w-auto">
              Разместить еще
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {(Object.keys(vacancyFilterLabels) as VacancyFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setVacancyFilter(filter)}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition ${
                  vacancyFilter === filter ? "border-blue-200 bg-blue-50 text-[#0875d1]" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
                }`}
              >
                <span>{vacancyFilterLabels[filter]}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{vacancyCounts[filter]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {visibleItems.length ? (
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
      {visibleItems.map((item) => {
        const draft = isDraftPublication(item);
        const confirmDelete = deletingItemId === item.id;
        const sold = item.type === "listing" && isDemoPublicationSold(item);
        const confirmSold = sellingItemId === item.id;
        const confirmUnpublish = unpublishingItemId === item.id;
        const unpublishedVacancy = isUnpublishedVacancy(item);
        const showOpenAction = true;
        const showEditAction = item.type !== "fairApplication";
        const hasFullWidthAction = canDeletePublication(item) || canMarkListingSold(item) || sold || canUnpublishVacancy(item) || canRestoreVacancy(item);
        const actionGridClassName = showEditAction || hasFullWidthAction ? "grid-cols-2" : "grid-cols-1";
        const fullWidthActionClassName = hasFullWidthAction ? "col-span-2" : "";

        return (
        <article key={item.id} className={`group relative min-w-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-card ${sold || unpublishedVacancy ? "ring-slate-300" : "ring-slate-200"}`}>
          <Link href={getItemHref(item)} className="block min-w-0" aria-label={`Открыть ${item.title}`}>
          <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-blue-50 text-[#0875d1]">
            {item.images?.[0] ? <img src={item.images[0]} alt={item.title} className="absolute inset-0 h-full w-full bg-white object-cover transition duration-300 group-hover:scale-[1.03]" /> : null}
            {!item.images?.[0] && item.videos?.[0] ? <video src={item.videos[0]} className="absolute inset-0 h-full w-full bg-slate-950 object-cover transition duration-300 group-hover:scale-[1.03]" muted playsInline preload="metadata" /> : null}
            {!item.images?.[0] && !item.videos?.[0] ? (
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/75 shadow-sm ring-1 ring-white/80 transition group-hover:scale-105">
                <FileText className="h-12 w-12" />
              </span>
            ) : null}
            {sold || unpublishedVacancy ? <span className="absolute inset-0 bg-white/50" /> : null}
            <span className="absolute left-2 top-2 flex max-w-[calc(100%-3.5rem)] flex-wrap gap-1">
              <StatusPill>{item.status}</StatusPill>
              <span className="inline-flex h-6 items-center rounded-full bg-white/95 px-2 text-[11px] font-bold text-slate-600 shadow-sm sm:h-7 sm:text-xs">{demoPublicationLabels[item.type]}</span>
            </span>
            {!item.images?.[0] && item.videos?.[0] ? (
              <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-1 text-[11px] font-bold text-white">
                <Video className="h-3 w-3" />
                Видео
              </span>
            ) : null}
          </span>
          <span className="block p-3">
            <span className="block truncate text-base font-black text-[#060b27]">{item.price ?? item.subtitle}</span>
            <span className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-900 transition group-hover:text-[#0875d1]">{item.title}</span>
            <span className="mt-1 flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500">
              <Clock3 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{sold && item.soldAt ? `Продано ${formatDate(item.soldAt)}` : formatDate(item.createdAt)}</span>
            </span>
            <span className="mt-2 flex min-w-0 items-center gap-1 text-xs text-slate-500">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.city}</span>
            </span>
          </span>
          </Link>
          {item.type === "listing" ? (
            <ListingShareButton href={getItemHref(item)} title={item.title} textBreakpoint="never" className="absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white/95 text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-white hover:text-[#0875d1]" />
          ) : null}
          {confirmSold ? (
            <div className="relative z-20 mx-3 mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
              <p className="text-xs font-bold text-amber-900">Почему снимаем объявление?</p>
              <div className="mt-2 grid gap-1.5">
                {(Object.keys(soldReasonLabels) as SoldReason[]).map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => {
                      markListingSold(item.id, reason);
                      setSellingItemId(null);
                    }}
                    className="inline-flex min-h-8 items-center justify-center rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-800 ring-1 ring-amber-200 transition hover:text-[#0875d1]"
                  >
                    {soldReasonLabels[reason]}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setSellingItemId(null)} className="mt-2 h-8 w-full rounded-md text-xs font-bold text-slate-500 transition hover:bg-white">
                Отмена
              </button>
            </div>
          ) : null}
          {confirmUnpublish ? (
            <div className="relative z-20 mx-3 mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
              <p className="text-xs font-bold text-amber-900">Снять вакансию с публикации?</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">Она пропадет из активных, но останется в кабинете. После этого ее можно удалить.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    unpublishVacancy(item.id);
                    setUnpublishingItemId(null);
                  }}
                  className="inline-flex h-8 items-center justify-center rounded-md bg-amber-600 px-2 text-xs font-bold text-white transition hover:bg-amber-700"
                >
                  Снять
                </button>
                <button type="button" onClick={() => setUnpublishingItemId(null)} className="h-8 rounded-md bg-white text-xs font-bold text-slate-600 ring-1 ring-amber-200 transition hover:text-[#0875d1]">
                  Отмена
                </button>
              </div>
            </div>
          ) : null}
          {confirmDelete ? (
            <div className="relative z-20 mx-3 mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2">
              <p className="text-xs font-bold text-rose-900">{item.type === "vacancy" ? "Удалить вакансию?" : "Удалить черновик?"}</p>
              <p className="mt-1 text-xs leading-5 text-rose-700">
                {item.type === "vacancy" ? "Удалять можно только черновик или вакансию, уже снятую с публикации." : "Черновик исчезнет из кабинета. Опубликованные объявления это действие не затрагивает."}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    deletePublication(item.id);
                    setDeletingItemId(null);
                  }}
                  className="inline-flex h-8 items-center justify-center rounded-md bg-rose-600 px-2 text-xs font-bold text-white transition hover:bg-rose-700"
                >
                  Удалить
                </button>
                <button type="button" onClick={() => setDeletingItemId(null)} className="h-8 rounded-md bg-white text-xs font-bold text-slate-600 ring-1 ring-rose-200 transition hover:text-[#0875d1]">
                  Отмена
                </button>
              </div>
            </div>
          ) : null}
          <div className={`grid gap-2 px-3 pb-3 ${actionGridClassName}`}>
            {showOpenAction ? (
              <Link href={getItemHref(item)} className="relative z-20 inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-sm font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]">
                Открыть
              </Link>
            ) : null}
            {showEditAction ? (
              <Link href={getEditHref(item)} className="relative z-20 inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-2 text-sm font-bold text-[#0875d1] transition hover:border-[#0875d1] hover:bg-white">
                Изменить
              </Link>
            ) : null}
            {draft ? (
              <button
                type="button"
                onClick={() => {
                  setSellingItemId(null);
                  setUnpublishingItemId(null);
                  setDeletingItemId((current) => (current === item.id ? null : item.id));
                }}
                className={`relative z-20 inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2 text-sm font-bold text-rose-700 transition hover:border-rose-400 hover:bg-white ${fullWidthActionClassName}`}
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                {item.type === "vacancy" ? "Удалить вакансию" : "Удалить черновик"}
              </button>
            ) : null}
            {canMarkListingSold(item) ? (
              <button
                type="button"
                onClick={() => {
                  setDeletingItemId(null);
                  setUnpublishingItemId(null);
                  setSellingItemId((current) => (current === item.id ? null : item.id));
                }}
                className={`relative z-20 inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-sm font-bold text-[#0a8f32] transition hover:border-[#0a8f32] hover:bg-white ${fullWidthActionClassName}`}
              >
                Продано / снять
              </button>
            ) : sold ? (
              <button
                type="button"
                onClick={() => restoreSoldListing(item.id)}
                className={`relative z-20 inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] ${fullWidthActionClassName}`}
              >
                Вернуть в публикацию
              </button>
            ) : canUnpublishVacancy(item) ? (
              <button
                type="button"
                onClick={() => {
                  setDeletingItemId(null);
                  setSellingItemId(null);
                  setUnpublishingItemId((current) => (current === item.id ? null : item.id));
                }}
                className={`relative z-20 inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-2 text-sm font-bold text-amber-700 transition hover:border-amber-400 hover:bg-white ${fullWidthActionClassName}`}
              >
                Снять с публикации
              </button>
            ) : canRestoreVacancy(item) ? (
              <>
                <button
                  type="button"
                  onClick={() => restoreVacancy(item.id)}
                  className={`relative z-20 inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-sm font-bold text-[#0a8f32] transition hover:border-[#0a8f32] hover:bg-white ${fullWidthActionClassName}`}
                >
                  Вернуть в публикацию
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSellingItemId(null);
                    setUnpublishingItemId(null);
                    setDeletingItemId((current) => (current === item.id ? null : item.id));
                  }}
                  className={`relative z-20 col-span-2 inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2 text-sm font-bold text-rose-700 transition hover:border-rose-400 hover:bg-white`}
                >
                  <Trash2 className="h-4 w-4 shrink-0" />
                  Удалить вакансию
                </button>
              </>
            ) : null}
          </div>
        </article>
        );
      })}
        </div>
      ) : (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center shadow-card">
          <h2 className="text-lg font-black text-[#060b27]">В этом статусе вакансий нет</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Переключите фильтр или разместите новую вакансию.</p>
        </section>
      )}
    </section>
  );
}

function MiniMetric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-bold text-slate-500">{label}</p>
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">{icon}</span>
      </div>
      <p className="mt-4 text-3xl font-black text-[#060b27]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
    </article>
  );
}

function AvatarEditor({
  profile,
  onChange,
  onError,
}: {
  profile: CabinetProfile;
  onChange: (profile: CabinetProfile) => void;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [cropDraft, setCropDraft] = useState<AvatarCropDraft | null>(null);
  const [cropImageSize, setCropImageSize] = useState<AvatarImageSize | null>(null);
  const [stageSize, setStageSize] = useState(320);
  const [dragStart, setDragStart] = useState<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cropDraft || !stageRef.current) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setStageSize(Math.round(entry.contentRect.width));
    });

    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [cropDraft]);

  async function handleAvatarFile(file?: File) {
    if (!file) {
      return;
    }

    setLoading(true);
    onError("");

    try {
      const src = await prepareAvatarImage(file);
      const image = await loadImage(src);

      setCropDraft({ src, zoom: 1, offsetX: 0, offsetY: 0 });
      setCropImageSize({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось загрузить аватарку.");
    } finally {
      setLoading(false);
    }
  }

  function updateAvatarPatch(patch: Partial<CabinetProfile>) {
    onChange({ ...profile, ...patch });
  }

  function updateCropDraft(patch: Partial<AvatarCropDraft>) {
    if (!cropDraft || !cropImageSize) {
      return;
    }

    const nextDraft = { ...cropDraft, ...patch };
    const transform = getAvatarTransform(nextDraft, cropImageSize, stageSize);

    setCropDraft({
      ...nextDraft,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
    });
  }

  function handleCropPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!cropDraft) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: cropDraft.offsetX,
      offsetY: cropDraft.offsetY,
    });
  }

  function handleCropPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) {
      return;
    }

    updateCropDraft({
      offsetX: dragStart.offsetX + event.clientX - dragStart.startX,
      offsetY: dragStart.offsetY + event.clientY - dragStart.startY,
    });
  }

  function handleCropPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStart?.pointerId === event.pointerId) {
      setDragStart(null);
    }
  }

  async function applyCrop() {
    if (!cropDraft || !cropImageSize) {
      return;
    }

    setLoading(true);
    onError("");

    try {
      const cropped = await cropAvatarImage(cropDraft, cropImageSize, stageSize);
      const avatarDataUrl = await compressAvatarImage(cropped);
      onChange({ ...profile, avatarDataUrl, avatarZoom: 1, avatarPositionX: 50, avatarPositionY: 50 });
      setCropDraft(null);
      setCropImageSize(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось применить аватарку.");
    } finally {
      setLoading(false);
    }
  }

  const cropTransform = cropDraft && cropImageSize ? getAvatarTransform(cropDraft, cropImageSize, stageSize) : null;

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
        <div className="flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-blue-100 bg-white text-4xl font-black text-[#0875d1] shadow-sm sm:h-28 sm:w-28 sm:text-5xl">
            {profile.avatarDataUrl ? (
              <img src={profile.avatarDataUrl} alt="Аватарка" className="h-full w-full object-cover" />
            ) : (
              profile.name.slice(0, 1).toUpperCase()
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-black text-[#060b27]">Аватарка</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">Выберите фото, затем выделите область аватарки в отдельном окне.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white transition hover:bg-[#0664b3]">
                <Camera className="h-4 w-4" />
                {loading ? "Готовим..." : "Выбрать"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(event) => handleAvatarFile(event.target.files?.[0])} />
              </label>
              <button
                type="button"
                onClick={() => updateAvatarPatch({ avatarDataUrl: "", avatarZoom: 1, avatarPositionX: 50, avatarPositionY: 50 })}
                disabled={!profile.avatarDataUrl}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-red-200 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Trash2 className="h-4 w-4" />
                Удалить
              </button>
            </div>
          </div>
        </div>
      </div>

      {cropDraft && cropImageSize && cropTransform ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4">
          <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-[#060b27]">Выберите область аватарки</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">Перетащите фото внутри круга и настройте масштаб.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCropDraft(null);
                  setCropImageSize(null);
                }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500"
                aria-label="Закрыть редактор аватарки"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid justify-items-center">
              <div
                ref={stageRef}
                className="relative aspect-square w-full max-w-80 touch-none select-none overflow-hidden rounded-2xl bg-slate-950"
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerUp}
                onPointerCancel={handleCropPointerUp}
              >
                <img
                  src={cropDraft.src}
                  alt="Фото для аватарки"
                  draggable={false}
                  className="absolute max-w-none select-none"
                  style={{
                    height: `${cropTransform.height}px`,
                    left: `${stageSize / 2 + cropTransform.offsetX - cropTransform.width / 2}px`,
                    top: `${stageSize / 2 + cropTransform.offsetY - cropTransform.height / 2}px`,
                    width: `${cropTransform.width}px`,
                  }}
                />
                <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white shadow-[0_0_0_999px_rgba(2,6,23,0.45)]" />
                <div className="pointer-events-none absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950/60 px-3 py-1 text-xs font-bold text-white">
                  <Move className="h-3.5 w-3.5" />
                  Перетащите фото
                </div>
              </div>
            </div>

            <label className="mt-5 grid gap-2 text-sm font-bold text-slate-700">
              Масштаб
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={cropDraft.zoom}
                onChange={(event) => updateCropDraft({ zoom: clampNumber(Number(event.target.value), 1, 3) })}
                className="accent-[#0875d1]"
              />
            </label>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={applyCrop}
                disabled={loading}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {loading ? "Применяем..." : "Применить"}
              </button>
              <button
                type="button"
                onClick={() => updateCropDraft({ offsetX: 0, offsetY: 0, zoom: 1 })}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]"
              >
                Сбросить
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SettingsPanel({ identity, profile, onClose }: { identity: ClientUserIdentity; profile: CabinetProfile; onClose: () => void }) {
  const [form, setForm] = useState(profile);
  const [verificationCode, setVerificationCode] = useState("");
  const [phoneVerificationOpen, setPhoneVerificationOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [sendingPhoneCode, setSendingPhoneCode] = useState(false);
  const [verifyingPhone, setVerifyingPhone] = useState(false);
  const phoneIsVerified = Boolean(form.phone && form.phoneVerified && form.verifiedPhone === form.phone);
  const phoneCanBeVerified = Boolean(toRussianPhoneE164(form.phone));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const settingsForm = event.currentTarget;

    if (!settingsForm.reportValidity()) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const nextProfile = {
        ...form,
        name: sanitizePersonName(form.name).trim(),
        phone: form.phone.trim(),
        email: form.email.trim().toLowerCase(),
        city: form.city.trim(),
      };

      if (!sortedCities.some((city) => city.name === nextProfile.city)) {
        throw new Error("Выберите город из списка.");
      }

      try {
        const supabase = getSupabaseBrowserClient();
        const updates: Parameters<typeof supabase.auth.updateUser>[0] = {
          data: {
            display_name: nextProfile.name,
            phone: nextProfile.phone,
            phone_verified: nextProfile.phoneVerified,
            city: nextProfile.city,
          },
        };

        if (nextProfile.email && nextProfile.email !== identity.email) {
          updates.email = nextProfile.email;
        }

        await supabase.auth.updateUser(updates);
      } catch {
        // The local demo profile still saves when Supabase settings are unavailable locally.
      }

      writeCabinetProfile(identity.ownerKey, nextProfile);
      setForm(nextProfile);
      setMessage("Настройки сохранены.");
      window.setTimeout(onClose, 450);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStartPhoneVerification() {
    const phone = form.phone.trim();
    const e164Phone = toRussianPhoneE164(phone);

    if (!e164Phone) {
      setMessage("Введите телефон в формате +7-(999)-999-99-99.");
      return;
    }

    setSendingPhoneCode(true);
    setMessage("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ phone: e164Phone });

      if (error) {
        throw error;
      }

      setVerificationCode("");
      setPhoneVerificationOpen(true);
      setMessage("Отправили SMS-код. Введите 6 цифр из сообщения.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отправить SMS-код. Проверьте настройки Phone/SMS в Supabase.");
    } finally {
      setSendingPhoneCode(false);
    }
  }

  async function handleVerifyPhoneCode() {
    const phone = form.phone.trim();
    const e164Phone = toRussianPhoneE164(phone);
    const token = verificationCode.replace(/\D/g, "");

    if (!e164Phone) {
      setMessage("Введите телефон в формате +7-(999)-999-99-99.");
      return;
    }

    if (token.length !== 6) {
      setMessage("Код подтверждения должен состоять из 6 цифр.");
      return;
    }

    setVerifyingPhone(true);
    setMessage("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.verifyOtp({ phone: e164Phone, token, type: "phone_change" });

      if (error) {
        throw error;
      }

      const nextProfile = {
        ...form,
        phone,
        phoneVerified: true,
        verifiedPhone: phone,
      };

      setForm(nextProfile);
      writeCabinetProfile(identity.ownerKey, nextProfile);
      setVerificationCode("");
      setPhoneVerificationOpen(false);
      setMessage("Телефон подтвержден и сохранен.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось подтвердить телефон.");
    } finally {
      setVerifyingPhone(false);
    }
  }

  async function handlePasswordReset() {
    const email = form.email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage("Чтобы сменить пароль, сначала укажите корректный email.");
      return;
    }

    setSendingReset(true);
    setMessage("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?type=recovery`,
      });

      if (error) {
        throw error;
      }

      setMessage("Отправили письмо для смены пароля. Откройте ссылку из письма и задайте новый пароль.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отправить письмо для смены пароля.");
    } finally {
      setSendingReset(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-blue-100 bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-[#060b27]">Настройки аккаунта</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Публичное имя, контакты, email для входа и уведомления кабинета.</p>
        </div>
        <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">
          Закрыть
        </button>
      </div>
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
        <AvatarEditor profile={form} onChange={setForm} onError={setMessage} />
        <div className="grid grid-cols-2 items-start gap-x-3 gap-y-3 sm:gap-x-4 sm:gap-y-4">
          <label className="grid min-w-0 gap-1.5 text-sm font-bold text-slate-700">
            <span className="leading-4">Имя</span>
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: sanitizePersonName(event.target.value) })}
              minLength={2}
              maxLength={60}
              pattern="^[\p{L}][\p{L}\s-]{1,59}$"
              title="Имя может содержать только буквы, пробелы и дефис. Длина от 2 до 60 символов."
              required
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-bold text-slate-700">
            <span className="flex min-h-4 items-center justify-between gap-2 leading-4">
              <span>Телефон</span>
              <span className={`truncate text-[11px] font-black ${phoneIsVerified ? "text-[#0a8f32]" : "text-amber-700"}`}>
                {!form.phone ? "не указан" : phoneIsVerified ? "подтвержден" : "не подтвержден"}
              </span>
            </span>
            <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] gap-2">
              <ValidatedInput
                className="h-11 min-w-0 rounded-lg border border-slate-300 px-2 text-sm font-normal outline-none focus:border-[#0875d1] sm:px-3 sm:text-base"
                value={form.phone}
                onChange={(event) =>
                  setForm({
                    ...form,
                    phone: event.target.value,
                    phoneVerified: form.verifiedPhone === event.target.value ? form.phoneVerified : false,
                  })
                }
                placeholder="+7..."
                validation="phone"
              />
              <button
                type="button"
                onClick={phoneIsVerified ? undefined : handleStartPhoneVerification}
                disabled={phoneIsVerified || sendingPhoneCode || !phoneCanBeVerified}
                className={phoneIsVerified ? "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-[#0a8f32]" : "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-[#0875d1] transition hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-45"}
                title={phoneIsVerified ? "Телефон подтвержден" : "Подтвердить номер"}
                aria-label={phoneIsVerified ? "Телефон подтвержден" : "Подтвердить номер"}
              >
                <Check className="h-5 w-5" />
              </button>
            </div>
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-bold text-slate-700">
            <span className="leading-4">Email</span>
            <ValidatedInput
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="mail@example.ru"
              validation="email"
              required
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-bold text-slate-700">
            <span className="leading-4">Город</span>
            <CitySearchSelect value={form.city} onChange={(city) => setForm({ ...form, city })} />
          </label>
        </div>
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-black text-[#060b27]">Смена пароля</h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">Для безопасности пароль меняется через письмо на подтвержденный email.</p>
            </div>
            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={sendingReset}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-amber-300 bg-white px-4 text-sm font-bold text-amber-800 transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sendingReset ? "Отправляем..." : "Отправить письмо"}
            </button>
          </div>
        </section>
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
          {[
            ["notifyBookings", "Брони и заказы"],
            ["notifyMessages", "Сообщения"],
            ["notifyPayments", "Оплаты"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(form[key as keyof CabinetProfile])}
                onChange={(event) => setForm({ ...form, [key]: event.target.checked })}
                className="h-4 w-4 accent-[#0875d1]"
              />
              {label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-5 text-sm font-bold text-white disabled:bg-slate-300">
            {saving ? "Сохраняем..." : "Сохранить настройки"}
          </button>
          {message ? <p className="text-sm font-semibold text-slate-600">{message}</p> : null}
        </div>
        {phoneVerificationOpen ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
            <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-black text-[#060b27]">Подтверждение телефона</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Введите 6 цифр из SMS, отправленного на номер {form.phone}.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPhoneVerificationOpen(false)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-xl font-bold text-slate-500"
                  aria-label="Закрыть окно подтверждения"
                >
                  ×
                </button>
              </div>
              <label className="mt-5 grid gap-2 text-sm font-bold text-slate-700">
                Код из SMS
                <input
                  className="h-12 rounded-lg border border-slate-300 bg-white px-4 text-center text-lg font-black tracking-[0.35em] outline-none focus:border-[#0875d1]"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                />
              </label>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleVerifyPhoneCode}
                  disabled={verifyingPhone}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {verifyingPhone ? "Проверяем..." : "Подтвердить"}
                </button>
                <button
                  type="button"
                  onClick={handleStartPhoneVerification}
                  disabled={sendingPhoneCode}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-blue-200 bg-white px-4 text-sm font-bold text-[#0875d1] transition hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sendingPhoneCode ? "Отправляем..." : "Отправить еще раз"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </form>
    </section>
  );
}

export function CabinetProfileBar() {
  const { state: authState } = useAuthState();
  const { identity, profile, loading } = useUserCabinetData();
  const [open, setOpen] = useState(false);

  if (authState !== "signed-in" && authState !== "admin") {
    return null;
  }

  if (loading || !identity || !profile) {
    return null;
  }

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:mt-5 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-lg font-black text-[#0875d1]">
            {profile.avatarDataUrl ? (
              <img
                src={profile.avatarDataUrl}
                alt={`Аватар ${profile.name}`}
                className="h-full w-full object-cover"
                style={{
                  objectPosition: `${profile.avatarPositionX}% ${profile.avatarPositionY}%`,
                  transform: `scale(${profile.avatarZoom})`,
                  transformOrigin: `${profile.avatarPositionX}% ${profile.avatarPositionY}%`,
                }}
              />
            ) : (
              profile.name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold uppercase text-[#0aa337]">Пользователь</p>
            <h2 className="truncate text-2xl font-black text-[#060b27]">{profile.name}</h2>
            <p className="truncate text-sm text-slate-500">{profile.email || "Email не указан"}</p>
            {profile.phone ? (
              <p className={profile.phoneVerified && profile.verifiedPhone === profile.phone ? "mt-1 text-xs font-bold text-[#0a8f32]" : "mt-1 text-xs font-bold text-amber-700"}>
                {profile.phone} · {profile.phoneVerified && profile.verifiedPhone === profile.phone ? "подтвержден" : "не подтвержден"}
              </p>
            ) : null}
          </div>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]">
          <Settings2 className="h-4 w-4" />
          Настройки
        </button>
      </div>
      {open ? <SettingsPanel identity={identity} profile={profile} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

export function CabinetOverviewClient({ paymentsCount = 0, paymentsTotal = 0 }: { paymentsCount?: number; paymentsTotal?: number }) {
  const { profile, items, loading } = useUserCabinetData();
  const listings = items.filter((item) => item.type === "listing");
  const vacancies = items.filter((item) => item.type === "vacancy");
  const orders = items.filter((item) => item.type === "workRequest");

  if (loading || !profile) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">Загружаем кабинет...</div>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MiniMetric icon={<FileText className="h-5 w-5" />} label="Объявления" value={String(listings.length)} detail="Ваши публикации в каталоге." />
        <MiniMetric icon={<BriefcaseBusiness className="h-5 w-5" />} label="Вакансии" value={String(vacancies.length)} detail="Вакансии вашей организации." />
        <MiniMetric icon={<ClipboardList className="h-5 w-5" />} label="Заказы" value={String(orders.length)} detail="Задачи для исполнителей." />
        <MiniMetric icon={<CreditCard className="h-5 w-5" />} label="Оплаты" value={`${paymentsTotal} ₽`} detail={`${paymentsCount} платежей в истории.`} />
      </div>
      <div className="mt-8 grid min-w-0 items-stretch gap-8">
        <section className="grid min-h-0 min-w-0 grid-rows-[auto_1fr]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-black text-[#060b27]">Последние оплаты</h2>
            <Link href="/cabinet/oplata" className="text-sm font-bold text-[#0875d1]">
              История
            </Link>
          </div>
          {paymentsCount ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
              <p className="text-sm leading-6 text-slate-600">Всего платежей: <span className="font-black text-[#060b27]">{paymentsCount}</span></p>
              <p className="mt-1 text-sm leading-6 text-slate-600">Сумма оплат и заказов: <span className="font-black text-[#060b27]">{paymentsTotal} ₽</span></p>
            </div>
          ) : (
            <EmptyState mode="payment" />
          )}
        </section>
      </div>
    </>
  );
}

export function CabinetPublicationsClient({ type }: { type: DemoPublicationType }) {
  const { items, loading } = useUserCabinetData();
  const visibleItems = useMemo(() => items.filter((item) => item.type === type), [items, type]);

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">Загружаем раздел...</div>;
  }

  return <PublicationList items={visibleItems} mode={type} />;
}

export function CabinetResponsesClient({ responses = [] }: { responses?: CabinetResponseItem[] }) {
  if (!responses.length) {
    return <EmptyState mode="response" />;
  }

  return (
    <section className="grid gap-3">
      {responses.map((response) => (
        <article key={response.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ResponseStatusPill status={response.status} />
              <span className="text-xs font-bold text-slate-500">Платеж {response.paymentId}</span>
            </div>
            <h3 className="mt-2 truncate text-lg font-black text-[#060b27]">{response.vacancyTitle}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">Отклик от: <span className="font-bold text-slate-800">{response.specialistName}</span></p>
          </div>
          <div className="grid gap-2 sm:justify-items-end">
            <Link href={response.href} className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]">
              Открыть вакансию
            </Link>
            <Link href={response.paymentHref} className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white transition hover:bg-[#0664b3]">
              {response.status === "sent" ? "Открыть оплату" : "Оплатить отклик"}
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}

export function CabinetPaymentsHistoryClient({ payments = [] }: { payments?: CabinetPaymentHistoryItem[] }) {
  if (!payments.length) {
    return <EmptyState mode="payment" />;
  }

  return (
    <section className="grid gap-3">
      {payments.map((payment) => (
        <article key={payment.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <PaymentStatusPill status={payment.status} />
              <span className="text-xs font-bold text-slate-500">{payment.method}</span>
            </div>
            <h3 className="mt-2 truncate text-lg font-black text-[#060b27]">{payment.subject}</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">Платеж {payment.id}</p>
          </div>
          <div className="grid gap-2 sm:justify-items-end">
            <p className="text-2xl font-black text-[#0875d1]">{payment.amount}</p>
            <Link href={payment.href} className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-[#0875d1] transition hover:border-[#0875d1] hover:bg-white">
              Открыть
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}

export function CabinetOrganizationClient() {
  const { identity, profile, loading } = useUserCabinetData();
  const [form, setForm] = useState<CabinetProfile | null>(profile);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setForm(profile);
  }, [profile]);

  if (loading || !identity || !profile || !form) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">Загружаем профиль...</div>;
  }

  const completedFields = [form.organizationName, form.organizationInn, form.organizationAddress, form.organizationDescription].filter((value) => value.trim()).length;
  const completionLabel = completedFields >= 3 ? "Заполнен" : completedFields > 0 ? "Нужно дополнить" : "Не заполнен";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identity || !form) {
      return;
    }

    const organizationName = form.organizationName.trim();
    const organizationInn = form.organizationInn.replace(/\D/g, "");
    const organizationOgrn = form.organizationOgrn.replace(/\D/g, "");

    if (!organizationName) {
      setMessage("Укажите название организации или ИП.");
      return;
    }

    if (organizationInn && organizationInn.length !== 10 && organizationInn.length !== 12) {
      setMessage("ИНН должен содержать 10 цифр для организации или 12 цифр для ИП.");
      return;
    }

    if (organizationOgrn && organizationOgrn.length !== 13 && organizationOgrn.length !== 15) {
      setMessage("ОГРН должен содержать 13 цифр, ОГРНИП — 15 цифр.");
      return;
    }

    const nextProfile: CabinetProfile = {
      ...form,
      organizationName: organizationName.slice(0, 120),
      organizationInn,
      organizationOgrn,
      organizationAddress: form.organizationAddress.trim().slice(0, 160),
      organizationWebsite: form.organizationWebsite.trim().slice(0, 120),
      organizationDescription: form.organizationDescription.trim().slice(0, 500),
    };

    writeCabinetProfile(identity.ownerKey, nextProfile);
    setForm(nextProfile);
    setMessage("Профиль организации сохранен.");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-[#060b27]">{form.organizationName || "Профиль организации"}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Заполните данные работодателя один раз, чтобы при размещении вакансий было понятно, от чьего имени публикуется предложение.
          </p>
        </div>
        <StatusPill>{completionLabel}</StatusPill>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Город</p>
          <p className="mt-2 font-black text-[#060b27]">{profile.city}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Телефон</p>
          <p className="mt-2 font-black text-[#060b27]">{profile.phone || "Не указан"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Email</p>
          <p className="mt-2 break-words font-black text-[#060b27]">{profile.email || "Не указан"}</p>
        </div>
      </div>
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            Название организации или ИП
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.organizationName}
              onChange={(event) => setForm({ ...form, organizationName: event.target.value.slice(0, 120) })}
              placeholder="ООО РемДом"
              minLength={2}
              maxLength={120}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            Сайт или профиль
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.organizationWebsite}
              onChange={(event) => setForm({ ...form, organizationWebsite: event.target.value.slice(0, 120) })}
              placeholder="https://example.ru"
              maxLength={120}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            ИНН
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.organizationInn}
              onChange={(event) => setForm({ ...form, organizationInn: event.target.value.replace(/\D/g, "").slice(0, 12) })}
              placeholder="10 или 12 цифр"
              inputMode="numeric"
              maxLength={12}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            ОГРН / ОГРНИП
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.organizationOgrn}
              onChange={(event) => setForm({ ...form, organizationOgrn: event.target.value.replace(/\D/g, "").slice(0, 15) })}
              placeholder="13 или 15 цифр"
              inputMode="numeric"
              maxLength={15}
            />
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          Адрес
          <input
            className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
            value={form.organizationAddress}
            onChange={(event) => setForm({ ...form, organizationAddress: event.target.value.slice(0, 160) })}
            placeholder="Краснодар, ул. Красная, 1"
            maxLength={160}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          Краткое описание
          <textarea
            className="min-h-28 resize-y rounded-lg border border-slate-300 px-3 py-2 font-normal outline-none focus:border-[#0875d1]"
            value={form.organizationDescription}
            onChange={(event) => setForm({ ...form, organizationDescription: event.target.value.slice(0, 500) })}
            placeholder="Чем занимается компания, кого обычно нанимаете, важные условия для соискателей."
            maxLength={500}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-5 text-sm font-bold text-white transition hover:bg-[#0664b3]">
            Сохранить профиль организации
          </button>
          {message ? <p className="text-sm font-semibold text-slate-600">{message}</p> : null}
        </div>
      </form>
    </section>
  );
}

export function CabinetSpecialistClient({ initialSpecialist }: { initialSpecialist?: DemoPublication }) {
  const { items, loading } = useUserCabinetData();
  const storedSpecialists = items.filter((item) => item.type === "specialist");
  const specialists = initialSpecialist && !storedSpecialists.some((item) => item.id === initialSpecialist.id) ? [...storedSpecialists, initialSpecialist] : storedSpecialists;
  const sortedSpecialists = [...specialists].sort((left, right) => {
    const leftDraft = isDraftPublication(left);
    const rightDraft = isDraftPublication(right);

    if (leftDraft !== rightDraft) {
      return leftDraft ? 1 : -1;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

  if (loading && !initialSpecialist) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">Загружаем анкету...</div>;
  }

  if (!sortedSpecialists.length) {
    return <EmptyState mode="specialist" />;
  }

  return <PublicationList items={sortedSpecialists} mode="specialist" />;
}

export function CabinetCapabilities() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <UserRound className="h-5 w-5 text-[#0875d1]" />
        <h3 className="mt-3 font-black text-[#060b27]">Профиль</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Имя, телефон, email и город хранятся в настройках.</p>
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <LockKeyhole className="h-5 w-5 text-[#0875d1]" />
        <h3 className="mt-3 font-black text-[#060b27]">Безопасность</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Пароль меняется только через защищенную ссылку из письма.</p>
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <Bell className="h-5 w-5 text-[#0875d1]" />
        <h3 className="mt-3 font-black text-[#060b27]">Уведомления</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Можно включить или выключить события по броням, оплатам и сообщениям.</p>
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <CheckCircle2 className="h-5 w-5 text-[#0875d1]" />
        <h3 className="mt-3 font-black text-[#060b27]">Публикации</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Новые пользователи начинают с нулевых счетчиков и понятных действий.</p>
      </article>
    </section>
  );
}

export function CabinetContactsHint() {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <Phone className="mt-0.5 h-5 w-5 shrink-0 text-[#0aa337]" />
        <p className="text-sm leading-6 text-slate-600">Телефон из настроек можно подставлять в объявления и вакансии только после SMS-подтверждения.</p>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <Mail className="mt-0.5 h-5 w-5 shrink-0 text-[#0875d1]" />
        <p className="text-sm leading-6 text-slate-600">Email используется для входа, платежных уведомлений и восстановления доступа.</p>
      </div>
    </div>
  );
}
