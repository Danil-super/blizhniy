"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { LocationMap } from "@/components/LocationMap";
import { DemoPublication, demoPublicationsStorageKey } from "@/lib/demo-publications";
import { categories } from "@/lib/data";
import { formatPublicationDateTime } from "@/lib/publication-time";
import { ListingKind, ListingKindBadge, StatusBadge } from "@/components/listings/ListingCard";
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

function DemoGallery({ images, title }: { images: string[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = images[activeIndex];

  if (!images.length) {
    return (
      <div className="mt-5 flex aspect-[4/3] w-full max-w-3xl items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400 sm:mt-6">
        <Camera className="h-12 w-12 sm:h-16 sm:w-16" />
      </div>
    );
  }

  return (
    <section className="mt-5 w-full max-w-3xl sm:mt-6">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        <img src={activeImage} alt={title} className="h-full w-full object-contain" />
        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => setActiveIndex((index) => (index === 0 ? images.length - 1 : index - 1))}
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-card transition hover:bg-white"
              aria-label="Предыдущее фото"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((index) => (index === images.length - 1 ? 0 : index + 1))}
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-card transition hover:bg-white"
              aria-label="Следующее фото"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <span className="absolute bottom-3 right-3 rounded-full bg-slate-950/70 px-3 py-1 text-xs font-bold text-white">
              {activeIndex + 1} / {images.length}
            </span>
          </>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {images.map((image, index) => (
            <button
              type="button"
              key={`${image.slice(0, 40)}-${index}`}
              onClick={() => setActiveIndex(index)}
              className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 bg-slate-100 transition sm:h-20 sm:w-24 ${
                index === activeIndex ? "border-[#0875d1]" : "border-transparent hover:border-blue-200"
              }`}
              aria-label={`Показать фото ${index + 1}`}
            >
              <img src={image} alt="" className="h-full w-full object-contain" />
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

  const listing = useMemo(() => items.find((item) => item.type === "listing" && item.id === slug), [items, slug]);
  const kind = (listing?.listingKind ?? "prodam") as ListingKind;
  const listingHref = `/blizhniy/obyavlenie/${slug}`;

  if (!listing) {
    return (
      <main className="page-container py-10">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-2xl font-black text-[#060b27]">Объявление не найдено</h1>
          <p className="mt-2 text-slate-600">Созданные в демо объявления доступны в том же браузере, где они были опубликованы.</p>
          <Link href="/blizhniy" className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться в ленту
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container py-6 sm:py-8 lg:py-10">
      <ListingViewTracker listingId={listing.id} />
      <div className="mx-auto grid max-w-[1180px] min-w-0 gap-5 sm:gap-7 lg:grid-cols-[minmax(0,768px)_minmax(320px,380px)] lg:items-start lg:justify-center">
        <section className="min-w-0 lg:max-w-3xl">
          <Link href={`/blizhniy/${kind}`} className="inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            <ArrowLeft className="h-4 w-4" />
            Назад к разделу
          </Link>
          <h1 className="[overflow-wrap:anywhere] mt-3 text-2xl font-black leading-tight text-[#060b27] sm:mt-4 sm:text-4xl lg:text-5xl">{listing.title}</h1>
          <div className="mt-4 flex flex-wrap gap-2">
            <ListingKindBadge kind={kind} />
            <StatusBadge status="published" />
          </div>
          <DemoGallery images={listing.images ?? []} title={listing.title} />
          <div className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-7 sm:p-6">
            <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Описание</h2>
            <p className="mt-3 [overflow-wrap:anywhere] text-base leading-7 text-slate-700 sm:mt-4 sm:text-lg sm:leading-8">{listing.description ?? "Описание будет дополнено."}</p>
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
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
            <p className="[overflow-wrap:anywhere] text-2xl font-black text-[#060b27] sm:text-3xl">{listing.price ?? "по договоренности"}</p>
            <p className="mt-3 flex min-w-0 items-start gap-2 text-slate-600">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#0875d1]" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{listing.city}</span>
            </p>
            <div className="mt-5 grid gap-2 sm:gap-3">
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <a href={`tel:${listing.phone ?? "+78610009999"}`} className="inline-flex h-11 min-w-0 items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#0875d1] to-[#18a9ff] px-3 text-sm font-bold text-white shadow-sm shadow-blue-100 transition hover:from-[#0664b3] hover:to-[#0875d1] sm:h-12 sm:text-base">
                  <ContactAssetIcon kind="phone" />
                  <span className="truncate">Позвонить</span>
                </a>
                <ListingShareButton
                  href={listingHref}
                  title={listing.title}
                  textBreakpoint="always"
                  className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-slate-300 bg-white px-2 text-sm font-bold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] sm:h-12 sm:gap-2 sm:text-base"
                  iconClassName="h-5 w-5 shrink-0"
                />
              </div>
              {listing.messengerUrl ? (
                <a href={listing.messengerUrl} className="inline-flex h-11 min-w-0 items-center justify-center gap-2.5 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3 text-sm font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50 sm:h-12 sm:text-base">
                  <ContactAssetIcon kind="message" />
                  <span className="min-w-0 truncate">Написать сообщение</span>
                </a>
              ) : null}
            </div>
          </div>
          <LocationMap
            location={{
              city: listing.city,
              lat: listing.lat,
              lng: listing.lng,
              showExactAddress: Boolean(listing.showExactAddress),
            }}
            exactLabel="Точный адрес частного лица по умолчанию не показывается"
          />
          {listing.booking ? <BookingCalculator booking={listing.booking} listingId={listing.id} listingTitle={listing.title} /> : null}
        </aside>
      </div>
    </main>
  );
}
