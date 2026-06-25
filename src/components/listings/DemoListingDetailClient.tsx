"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Mail, MapPin, MessageCircle, Phone, Video } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { LocationMap } from "@/components/LocationMap";
import { StoredMediaImage, StoredMediaVideo } from "@/components/StoredMedia";
import { DemoPublication, demoPublicationsStorageKey, isDemoPublicationPubliclyVisible, isDemoPublicationSold } from "@/lib/demo-publications";
import { categories } from "@/lib/data";
import { hasMapCoordinates } from "@/lib/map-location";
import { formatPublicationDateTime } from "@/lib/publication-time";
import { sellerDisplayName, sellerProfileHref, sellerProfileKey } from "@/lib/seller-profile";
import { ListingKind, ListingKindBadge, StatusBadge } from "@/components/listings/ListingCard";
import { ListingSellerCard } from "@/components/listings/ListingSellerCard";
import { ListingShareButton } from "@/components/listings/ListingShareButton";
import { BookingCalculator } from "./BookingCalculator";
import { ListingViewTracker } from "./ListingViewTracker";

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

function resolveCategoryName(item: DemoPublication) {
  return categories.find((category) => category.slug === item.categorySlug)?.name ?? "Категория";
}

function hasListingMapPoint(item: DemoPublication) {
  return Boolean(item.showExactAddress) && item.hasMapPoint === true && hasMapCoordinates(item.lat, item.lng);
}

function listingSellerName(item: DemoPublication) {
  return sellerDisplayName(item);
}

function listingSellerKey(item: DemoPublication) {
  return sellerProfileKey(item);
}

function dateSortValue(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function formatSellerDate(value: string) {
  const time = Date.parse(value);

  if (Number.isFinite(time)) {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(time));
  }

  return value;
}

function listingSellerStats(listing: DemoPublication, items: DemoPublication[]) {
  const sellerKey = listingSellerKey(listing);
  const sellerListings = items.filter((item) => item.type === "listing" && listingSellerKey(item) === sellerKey);
  const firstListing = sellerListings
    .filter((item) => Number.isFinite(dateSortValue(item.createdAt)))
    .sort((a, b) => dateSortValue(a.createdAt) - dateSortValue(b.createdAt))[0];

  return {
    listingCount: sellerListings.length || 1,
    soldCount: sellerListings.filter(isDemoPublicationSold).length,
    registeredSince: formatSellerDate(firstListing?.createdAt ?? listing.createdAt),
  };
}

const soldReasonLabels: Record<NonNullable<DemoPublication["soldReason"]>, string> = {
  elsewhere: "продано в другом месте",
  not_actual: "объявление больше не актуально",
  platform: "продано на платформе",
};

type GalleryMedia = {
  kind: "image" | "video";
  src: string;
};

function DemoGallery({ media, title }: { media: GalleryMedia[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeMedia = media[activeIndex];

  if (!media.length) {
    return (
      <div className="mx-auto mt-5 flex aspect-square w-full max-w-[640px] items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400 sm:mt-6">
        <Camera className="h-12 w-12 sm:h-16 sm:w-16" />
      </div>
    );
  }

  return (
    <section className="mt-5 w-full sm:mt-6">
      <div className="relative mx-auto flex aspect-square w-full max-w-[640px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {activeMedia?.kind === "video" ? (
          <StoredMediaVideo src={activeMedia.src} className="h-full w-full bg-slate-950 object-contain" controls playsInline preload="metadata" />
        ) : (
          <StoredMediaImage src={activeMedia?.src} alt={title} className="h-full w-full object-contain object-center" />
        )}
        {media.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => setActiveIndex((index) => (index === 0 ? media.length - 1 : index - 1))}
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-card transition hover:bg-white"
              aria-label="Предыдущий файл"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((index) => (index === media.length - 1 ? 0 : index + 1))}
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-card transition hover:bg-white"
              aria-label="Следующий файл"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <span className="absolute bottom-3 right-3 rounded-full bg-slate-950/70 px-3 py-1 text-xs font-bold text-white">
              {activeIndex + 1} / {media.length}
            </span>
          </>
        ) : null}
      </div>
      {media.length > 1 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {media.map((item, index) => (
            <button
              type="button"
              key={`${item.src.slice(0, 40)}-${index}`}
              onClick={() => setActiveIndex(index)}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 bg-slate-100 transition sm:h-20 sm:w-20 ${
                index === activeIndex ? "border-[#0875d1]" : "border-transparent hover:border-blue-200"
              }`}
              aria-label={`Показать файл ${index + 1}`}
            >
              {item.kind === "video" ? (
                <>
                  <StoredMediaVideo src={item.src} className="h-full w-full bg-slate-950 object-cover" muted playsInline preload="metadata" />
                  <span className="absolute inset-0 flex items-center justify-center bg-slate-950/25 text-white">
                    <Video className="h-5 w-5" />
                  </span>
                </>
              ) : (
                <StoredMediaImage src={item.src} alt="" className="h-full w-full object-contain object-center" />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function DemoListingDetailClient({ slug }: { slug: string }) {
  const [items, setItems] = useState<DemoPublication[]>([]);

  useEffect(() => {
    function syncItems() {
      setItems(readStoredPublications());
    }

    syncItems();
    window.addEventListener("storage", syncItems);
    window.addEventListener("blizhniy-demo-publications-updated", syncItems);

    return () => {
      window.removeEventListener("storage", syncItems);
      window.removeEventListener("blizhniy-demo-publications-updated", syncItems);
    };
  }, []);

  const listing = useMemo(() => items.find((item) => item.type === "listing" && item.id === slug && isDemoPublicationPubliclyVisible(item)), [items, slug]);
  const kind = (listing?.listingKind ?? "prodam") as ListingKind;
  const listingHref = `/obyavlenie/${slug}`;
  const hasMapPoint = listing ? hasListingMapPoint(listing) : false;
  const sold = listing ? isDemoPublicationSold(listing) : false;
  const sellerStats = listing ? listingSellerStats(listing, items) : undefined;
  const contactCount = [listing?.phone, listing?.messengerUrl, listing?.email].filter(Boolean).length;
  const actionCount = contactCount + 1;
  const actionGridClass = actionCount >= 4 ? "grid-cols-2 sm:grid-cols-[repeat(4,minmax(104px,1fr))]" : actionCount === 3 ? "grid-cols-2" : actionCount === 2 ? "grid-cols-2" : "grid-cols-1";
  const galleryMedia: GalleryMedia[] = listing
    ? [
        ...(listing.images ?? []).map((src) => ({ kind: "image" as const, src })),
        ...(listing.videos ?? []).map((src) => ({ kind: "video" as const, src })),
      ]
    : [];

  if (!listing) {
    return (
      <main className="page-container py-10">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-xl font-bold text-[#060b27]">Объявление не найдено</h1>
          <p className="mt-2 text-slate-600">Объявление не найдено или больше не опубликовано.</p>
          <BackLink fallbackHref="/" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться в ленту
          </BackLink>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container py-6 sm:py-8 lg:py-10">
      <ListingViewTracker listingId={listing.id} />
      <div className="mx-auto grid max-w-[1180px] min-w-0 gap-5 sm:gap-7 lg:grid-cols-[minmax(0,768px)_minmax(320px,380px)] lg:items-start lg:justify-center">
        <section className="min-w-0 lg:max-w-3xl">
          <BackLink fallbackHref={`/obyavleniya?kind=${kind}`} className="inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад к разделу
          </BackLink>
          <h1 className="[overflow-wrap:anywhere] mt-3 text-xl font-bold leading-tight text-[#060b27] sm:mt-4 sm:text-2xl lg:text-3xl">{listing.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <ListingKindBadge kind={kind} />
            <StatusBadge status={sold ? "sold" : "published"} />
          </div>
          <DemoGallery media={galleryMedia} title={listing.title} />
          <div className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-7 sm:p-6">
            <h2 className="text-lg font-bold text-[#060b27]">Описание</h2>
            <p className="mt-2 [overflow-wrap:anywhere] text-sm leading-6 text-slate-700 sm:mt-3 sm:text-base sm:leading-7">{listing.description ?? "Описание будет дополнено."}</p>
            <dl className="mt-5 grid min-w-0 gap-3 sm:mt-6 sm:grid-cols-2 sm:gap-4">
              <div className="min-w-0 rounded-lg bg-slate-50 p-3 sm:p-4">
                <dt className="text-sm font-bold text-slate-500">Категория</dt>
                <dd className="mt-1 [overflow-wrap:anywhere] font-semibold text-slate-900">{resolveCategoryName(listing)}</dd>
              </div>
              <div className="min-w-0 rounded-lg bg-slate-50 p-3 sm:p-4">
                <dt className="text-sm font-bold text-slate-500">Размещено</dt>
                <dd className="mt-1 [overflow-wrap:anywhere] font-semibold text-slate-900">{formatPublicationDateTime(listing.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
            <p className="[overflow-wrap:anywhere] text-xl font-bold text-[#060b27]">{listing.price ?? "по договоренности"}</p>
            {sold ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-slate-600 ring-1 ring-slate-200">
                    <CheckCircle2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">Объявление продано</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      Контакты продавца скрыты, чтобы ему не звонили по неактуальному товару.
                      {listing.soldReason ? ` Причина: ${soldReasonLabels[listing.soldReason]}.` : ""}
                    </p>
                  </div>
                </div>
                <Link href={`/obyavleniya?kind=${kind}`} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#0875d1] px-3 text-sm font-bold text-white">
                  Смотреть похожие объявления
                </Link>
              </div>
            ) : null}
            {!hasMapPoint ? (
              <p className="mt-3 flex min-w-0 items-start gap-2 text-slate-600">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#0875d1]" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{listing.city}</span>
              </p>
            ) : null}
            {!sold ? (
              <div className="mt-4 grid gap-2">
                <div className={`grid min-w-0 gap-2 ${actionGridClass}`}>
                  {listing.phone ? (
                    <a href={`tel:${listing.phone}`} className={`inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg bg-[#0aa337] px-2 text-xs font-bold text-white shadow-sm shadow-emerald-100 transition hover:bg-[#078a2e] sm:text-sm ${actionCount === 3 ? "col-span-2" : ""}`}>
                      <Phone className="h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">Позвонить</span>
                    </a>
                  ) : null}
                  {listing.email ? (
                    <a href={`mailto:${listing.email}`} className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[#0875d1] bg-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:bg-blue-50 sm:text-sm">
                      <Mail className="h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">Email</span>
                    </a>
                  ) : null}
                  {listing.messengerUrl ? (
                    <a href={listing.messengerUrl} className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[#0875d1] bg-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:bg-blue-50 sm:text-sm">
                      <MessageCircle className="h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">Сообщение</span>
                    </a>
                  ) : null}
                  <ListingShareButton
                    href={listingHref}
                    title={listing.title}
                    textBreakpoint="always"
                    className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] sm:text-sm"
                    iconClassName="h-4 w-4 shrink-0"
                  />
                </div>
              </div>
            ) : null}
          </div>
          <ListingSellerCard
            sellerName={listingSellerName(listing)}
            registeredSince={sellerStats?.registeredSince}
            listingCount={sellerStats?.listingCount}
            soldCount={sellerStats?.soldCount}
            hasContacts={!sold && Boolean(listing.phone || listing.email || listing.messengerUrl)}
            listingTitle={listing.title}
            profileHref={sellerProfileHref(listing)}
          />
          {hasMapPoint ? (
            <LocationMap
              location={{
                city: listing.city,
                address: listing.address,
                lat: listing.lat,
                lng: listing.lng,
                showExactAddress: Boolean(listing.showExactAddress),
              }}
              exactLabel="Точный адрес частного лица по умолчанию не показывается"
            />
          ) : null}
          {listing.booking ? <BookingCalculator booking={listing.booking} listingId={listing.id} listingTitle={listing.title} /> : null}
        </aside>
      </div>
    </main>
  );
}
