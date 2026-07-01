"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Gift, Mail, MapPin, ShoppingBag, Tags, Video } from "lucide-react";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { StoredMediaImage, StoredMediaVideo } from "@/components/StoredMedia";
import { demoPublicationsStorageKey, DemoPublication, isDemoPublicationPubliclyVisible } from "@/lib/demo-publications";
import { categories } from "@/lib/data";
import { matchesDemoPublicationFilters, matchesListingScope, type ListingFilterCriteria } from "@/lib/listing-filters";
import { formatPublicationDateTime, publicationTimestamp } from "@/lib/publication-time";
import { ListingKind, ListingKindBadge, StatusBadge } from "@/components/listings/ListingCard";
import { ListingShareButton } from "@/components/listings/ListingShareButton";
import { ListingViewCounter } from "@/components/listings/ListingViewCounter";
import { shouldShowClientFallbackContent } from "@/lib/client-runtime-mode";

type DemoListingFeedProps = {
  categorySlug?: string;
  filters?: ListingFilterCriteria;
  kind?: ListingKind | ListingKind[];
  subcategorySlug?: string;
  variant?: "grid" | "list";
};

const clientFallbackContentEnabled = shouldShowClientFallbackContent();

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLocalOnlyPublication(item: DemoPublication) {
  return !uuidPattern.test(item.id);
}

const kindIcons = {
  prodam: ShoppingBag,
  kuplyu: Tags,
  "otdam-darom": Gift,
  arenda: CalendarDays,
};

function readStoredPublications() {
  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "type" in item));
    }
  } catch {
    return [];
  }

  return [];
}

function slugifySubcategory(name: string) {
  const map: Record<string, string> = {
    "Товары времен СССР": "tovary-vremen-sssr",
    "Картины и живопись": "kartiny-i-zhivopis",
    "Продам недвижимость": "prodam-nedvizhimost",
    "Куплю недвижимость": "kuplyu-nedvizhimost",
    Аренда: "arenda",
    "Коммерческая недвижимость": "kommercheskaya-nedvizhimost",
    "Жилье для путешествия": "zhile-dlya-puteshestviya",
    Смартфоны: "smartfony",
    Ноутбуки: "noutbuki",
    Компьютеры: "kompyutery",
    "Аудио и видео": "audio-i-video",
    "Игровые приставки": "igrovye-pristavki",
    "Продам авто": "prodam-avto",
    "Куплю авто": "kuplyu-avto",
    Мототехника: "mototehnika",
    "Продам бизнес": "prodam-biznes",
    "Куплю бизнес": "kuplyu-biznes",
    Оборудование: "oborudovanie",
    Партнерство: "partnerstvo",
    "Организация и проведение обряда прощания": "organizatsiya-i-provedenie-obryada-proshchaniya",
    "Захоронение и сопутствующие работы": "zahoronenie-i-soputstvuyushchie-raboty",
    Кремация: "krematsiya",
    "Продажа и изготовление похоронных принадлежностей": "prodazha-i-izgotovlenie-pohoronnyh-prinadlezhnostey",
    "Изготовление, установка и демонтаж намогильных сооружений":
      "izgotovlenie-ustanovka-demontazh-namogilnyh-sooruzheniy",
    "Уход за местом захоронения": "uhod-za-mestom-zahoroneniya",
    "Транспортирование останков": "transportirovanie-ostankov",
    "Предпохоронное содержание останков": "predpohoronnoe-soderzhanie-ostankov",
    "Подготовка тела к погребению": "podgotovka-tela-k-pogrebeniyu",
    "Домашние питомцы": "domashnie-pitomtsy",
    "Сельхоз животные": "selhoz-zhivotnye",
    "Экзотические животные": "ekzoticheskie-zhivotnye",
    Парикмахеры: "parikmahery",
    "Маникюр и педикюр": "manikyur-i-pedikyur",
    "Медицинский персонал": "meditsinskiy-personal",
    "Уход на дому": "uhod-na-domu",
    Мебель: "mebel",
    "Мебель для дома и дачи": "mebel-dlya-doma-i-dachi",
    Освещение: "osveshchenie",
    Декор: "dekor",
    "Садовый инвентарь": "sadovyy-inventar",
    "Товары для бани и сауны": "tovary-dlya-bani-i-sauny",
    "Биотуалеты и умывальники": "biotualety-i-umyvalniki",
    Турбазы: "turbazy",
    Гостиницы: "gostinitsy",
    Походы: "pohody",
    Вакансии: "vakansii",
    "Анкеты специалистов": "ankety-spetsialistov",
    "Ремонт квартир": "remont-kvartir",
    Сантехника: "santehnika",
    "Цветы и саженцы": "tsvety-i-sazhentsy",
    "Выкройки и рукоделие": "vykroyki-i-rukodelie",
    Игрушки: "igrushki",
    "Технические игрушки": "tehnicheskie-igrushki",
    "Дидактические игрушки": "didakticheskie-igrushki",
    "Спортивные (спортивно-моторные) игрушки": "sportivnye-sportivno-motornye-igrushki",
    Одежда: "odezhda",
    Обувь: "obuv",
    Аксессуары: "aksessuary",
    Клининг: "klining",
  };

  return map[name] ?? name.toLowerCase().replaceAll(" ", "-");
}

function resolveSubcategoryName(item: DemoPublication) {
  const category = categories.find((entry) => entry.slug === item.categorySlug);
  return category?.children.find((child) => slugifySubcategory(child) === item.subcategorySlug) ?? item.subcategorySlug ?? "Раздел";
}

function listingPlaceLabel(item: DemoPublication) {
  if (item.type === "listing" && item.hasMapPoint && item.address) {
    return item.address;
  }

  return item.city;
}

function formatListingDate(value?: string) {
  return formatPublicationDateTime(value).split(",")[0] ?? "";
}

function ListingCardImage({ alt, className = "", src }: { alt: string; className?: string; src: string }) {
  return (
    <StoredMediaImage src={src} alt={alt} className={`absolute inset-0 h-full w-full bg-slate-100 object-cover object-center ${className}`} />
  );
}

export function DemoGridCard({ item }: { item: DemoPublication }) {
  const kind = item.listingKind ?? "prodam";
  const Icon = kindIcons[kind];
  const firstImage = item.images?.[0];
  const firstVideo = item.videos?.[0];
  const href = `/obyavlenie/${item.id}`;

  return (
    <article className="group relative min-w-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-emerald-200 transition hover:-translate-y-0.5 hover:shadow-card">
      <Link href={href} className="block min-w-0">
        <span className="relative isolate flex aspect-[1.18/1] items-center justify-center overflow-hidden bg-slate-100 text-[#0a8f32]">
          {firstImage ? <ListingCardImage src={firstImage} alt={item.title} /> : null}
          {!firstImage && firstVideo ? <StoredMediaVideo src={firstVideo} className="absolute inset-0 h-full w-full bg-slate-950 object-cover object-center" muted playsInline preload="metadata" /> : null}
          {firstImage || firstVideo ? <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-slate-900/5" /> : null}
          {!firstImage && firstVideo ? (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-1 text-[11px] font-bold text-white">
              <Video className="h-3 w-3" />
              Видео
            </span>
          ) : null}
          <span className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-white/75 shadow-sm ring-1 ring-white/80 ${firstImage || firstVideo ? "opacity-0" : ""}`}>
            <Icon className="h-8 w-8" />
          </span>
        </span>
        <span className="block p-2">
          <span className="line-clamp-2 min-h-8 text-[13px] font-bold leading-4 text-slate-900 transition group-hover:text-[#0875d1]">{item.title}</span>
          <span className="mt-0.5 block truncate text-base font-bold leading-5 text-[#060b27]">{item.price ?? "по договоренности"}</span>
          {formatListingDate(item.createdAt) ? (
            <span className="mt-1 flex min-w-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
              <CalendarDays className="h-3 w-3 shrink-0" />
              <span className="truncate">{formatListingDate(item.createdAt)}</span>
            </span>
          ) : null}
          <span className="mt-1 flex items-end justify-between gap-1.5 text-[11px] text-slate-500">
            <span className="flex min-w-0 items-start gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="line-clamp-2 min-w-0 leading-[14px] [overflow-wrap:anywhere]" title={listingPlaceLabel(item)}>{listingPlaceLabel(item)}</span>
            </span>
            <ListingViewCounter listingId={item.id} />
          </span>
        </span>
      </Link>
      <ListingShareButton
        href={href}
        title={item.title}
        textBreakpoint="never"
        className="absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white/95 text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-white hover:text-[#0875d1]"
      />
    </article>
  );
}

function DemoListCard({ item }: { item: DemoPublication }) {
  const kind = item.listingKind ?? "prodam";
  const Icon = kindIcons[kind];
  const firstImage = item.images?.[0];
  const firstVideo = item.videos?.[0];
  const href = `/obyavlenie/${item.id}`;
  const hasSecondaryContact = Boolean(item.messengerUrl || item.email);

  return (
    <article className="group relative grid min-w-0 gap-3 rounded-xl border border-emerald-200 bg-white p-3 shadow-sm transition hover:border-blue-200 hover:shadow-card sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-4 sm:p-4 xl:grid-cols-[140px_minmax(0,1fr)_minmax(280px,auto)]">
      <Link href={href} className="absolute inset-0 z-10 rounded-xl" aria-label={`Открыть объявление ${item.title}`} />
      <div className="flex min-w-0 gap-3 sm:contents">
        <Link
          href={href}
          className="relative z-20 isolate flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-emerald-100 via-white to-blue-100 text-[#0a8f32] sm:h-auto sm:min-h-28 sm:w-auto xl:min-h-32"
        >
          {firstImage ? <ListingCardImage src={firstImage} alt={item.title} /> : null}
          {!firstImage && firstVideo ? <StoredMediaVideo src={firstVideo} className="absolute inset-0 h-full w-full bg-slate-950 object-cover object-center" muted playsInline preload="metadata" /> : null}
          {firstImage || firstVideo ? <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-slate-900/5" /> : null}
          {!firstImage && firstVideo ? (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-1 text-[11px] font-bold text-white">
              <Video className="h-3 w-3" />
              Видео
            </span>
          ) : null}
          {!firstImage && !firstVideo ? <Icon className="h-8 w-8 sm:h-9 sm:w-9 lg:h-12 lg:w-12" /> : null}
        </Link>
        <div className="min-w-0 flex-1 sm:flex sm:flex-col sm:justify-center xl:block">
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            <ListingKindBadge kind={kind} />
            <StatusBadge status="published" />
            <span className="inline-flex h-7 items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-bold text-[#0a8f32] sm:h-8 sm:px-3 sm:text-sm">
              Через админку
            </span>
          </div>
          <h3 className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-[#060b27] transition group-hover:text-[#0875d1] sm:text-base sm:leading-6 lg:text-xl lg:leading-tight">{item.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600 sm:text-sm lg:mt-2 lg:leading-6">{item.description ?? "Описание будет дополнено."}</p>
          <p className="mt-1.5 flex min-w-0 items-start gap-1.5 text-xs text-slate-500 sm:text-sm lg:mt-3 lg:gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]" title={`${listingPlaceLabel(item)}, ${resolveSubcategoryName(item)}`}>{listingPlaceLabel(item)}, {resolveSubcategoryName(item)}</span>
          </p>
        </div>
      </div>
      <div className="grid min-w-0 gap-2 sm:col-span-2 xl:col-span-1 xl:flex xl:flex-col xl:items-end xl:justify-between xl:gap-4">
        <div className="min-w-0 xl:text-right">
          <p className="truncate text-base font-bold text-[#060b27] sm:text-lg lg:text-xl">{item.price ?? "по договоренности"}</p>
        </div>
        <div className="relative z-20 grid min-w-0 grid-cols-2 gap-1.5 sm:gap-2 xl:w-[280px]">
          {item.phone ? (
            <a href={`tel:${item.phone}`} className={`inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50 sm:h-9 sm:px-3 sm:text-sm lg:h-10 lg:px-4 ${hasSecondaryContact ? "col-span-2" : ""}`}>
              <ContactAssetIcon kind="phone" className="h-5 w-5 sm:h-6 sm:w-6" />
              <span className="whitespace-nowrap">Позвонить</span>
            </a>
          ) : null}
          {item.messengerUrl ? (
            <a href={item.messengerUrl} className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50 sm:h-9 sm:px-3 sm:text-sm lg:h-10 lg:px-4">
              <ContactAssetIcon kind="message" className="h-5 w-5 sm:h-6 sm:w-6" />
              <span className="whitespace-nowrap">Написать</span>
            </a>
          ) : null}
          {!item.messengerUrl && item.email ? (
            <a href={`mailto:${item.email}`} className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50 sm:h-9 sm:px-3 sm:text-sm lg:h-10 lg:px-4">
              <Mail className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
              <span className="whitespace-nowrap">Email</span>
            </a>
          ) : null}
          <ListingShareButton
            href={href}
            title={item.title}
            stopPropagation
            textBreakpoint="always"
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] sm:h-9 sm:px-3 sm:text-sm lg:h-10"
          />
        </div>
      </div>
    </article>
  );
}

export function DemoListingFeed({ categorySlug, filters, kind, subcategorySlug, variant = "list" }: DemoListingFeedProps) {
  const [items, setItems] = useState<DemoPublication[]>([]);

  useEffect(() => {
    function syncItems() {
      setItems(clientFallbackContentEnabled ? readStoredPublications() : []);
    }

    syncItems();
    window.addEventListener("storage", syncItems);
    window.addEventListener("blizhniy-demo-publications-updated", syncItems);

    return () => {
      window.removeEventListener("storage", syncItems);
      window.removeEventListener("blizhniy-demo-publications-updated", syncItems);
    };
  }, []);

  const visibleItems = useMemo(
    () =>
      items
        .filter((item) => {
          return (
            isLocalOnlyPublication(item) &&
            isDemoPublicationPubliclyVisible(item) &&
            matchesListingScope(item, { categorySlug, kind, subcategorySlug }) &&
            (!filters || matchesDemoPublicationFilters(item, filters))
          );
        })
        .sort((left, right) => publicationTimestamp(right.createdAt) - publicationTimestamp(left.createdAt)),
    [categorySlug, filters, items, kind, subcategorySlug],
  );

  if (!visibleItems.length) {
    return null;
  }

  if (variant === "grid") {
    return (
      <>
        {visibleItems.map((item) => (
          <DemoGridCard key={item.id} item={item} />
        ))}
      </>
    );
  }

  return (
    <>
      {visibleItems.map((item) => (
        <DemoListCard key={item.id} item={item} />
      ))}
    </>
  );
}
