"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock3, FileText, MapPin, PackageCheck, ShieldCheck } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { StoredMediaImage } from "@/components/StoredMedia";
import {
  demoPublicationsStorageKey,
  isDemoPublicationExpired,
  isDemoPublicationSold,
  type DemoPublication,
} from "@/lib/demo-publications";
import { formatPublicationDateTime, publicationTimestamp } from "@/lib/publication-time";
import { isSellerDemoPublication, sellerDisplayName, sellerInitial } from "@/lib/seller-profile";

export type SellerProfileListing = {
  categoryName: string;
  city: string;
  createdAt: string;
  href: string;
  id: string;
  image?: string;
  price?: string;
  sellerName: string;
  status: string;
  title: string;
};

type SellerProfileClientProps = {
  initialListings: SellerProfileListing[];
  sellerKey: string;
};

const clientFallbackContentEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT === "true";

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

function storedProfileListing(item: DemoPublication): SellerProfileListing {
  return {
    categoryName: item.subtitle,
    city: item.city,
    createdAt: item.soldAt ?? item.createdAt,
    href: `/obyavlenie/${item.id}`,
    id: item.id,
    image: item.images?.[0],
    price: item.price,
    sellerName: sellerDisplayName(item),
    status: isDemoPublicationExpired(item) ? "Истек срок" : item.status,
    title: item.title,
  };
}

function isSoldStatus(status: string) {
  return isDemoPublicationSold({ status }) || status === "sold";
}

function isActiveStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  return normalized === "опубликовано" || normalized === "published";
}

function sellerSince(listings: SellerProfileListing[]) {
  const first = [...listings].sort((left, right) => publicationTimestamp(left.createdAt) - publicationTimestamp(right.createdAt))[0];
  return first ? formatPublicationDateTime(first.createdAt).replace(/,\s*\d{2}:\d{2}$/, "") : "недавно";
}

function uniqueListings(listings: SellerProfileListing[]) {
  return Array.from(new Map(listings.map((item) => [item.id, item])).values());
}

function ListingTile({ item }: { item: SellerProfileListing }) {
  const sold = isSoldStatus(item.status);

  return (
    <article className={`group relative min-w-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-card ${sold ? "ring-slate-300" : "ring-slate-200"}`}>
      <Link href={item.href} className="block min-w-0">
        <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-blue-50 text-[#0875d1]">
          {item.image ? <StoredMediaImage src={item.image} alt={item.title} className="absolute inset-0 h-full w-full bg-white object-contain" /> : null}
          {!item.image ? (
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/75 shadow-sm ring-1 ring-white/80 transition group-hover:scale-105">
              <FileText className="h-10 w-10" />
            </span>
          ) : null}
          {sold ? <span className="absolute inset-0 bg-white/55" /> : null}
          <span className={`absolute left-2 top-2 inline-flex h-7 items-center rounded-full border px-3 text-xs font-bold ${sold ? "border-slate-300 bg-slate-100 text-slate-700" : "border-emerald-200 bg-emerald-50 text-[#0a8f32]"}`}>
            {sold ? "Продано" : "Опубликовано"}
          </span>
        </span>
        <span className="block p-3">
          <span className="block truncate text-base font-bold text-[#060b27]">{item.price ?? "по договоренности"}</span>
          <span className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-900 transition group-hover:text-[#0875d1]">{item.title}</span>
          <span className="mt-1 flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500">
            <Clock3 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{formatPublicationDateTime(item.createdAt)}</span>
          </span>
          <span className="mt-2 flex min-w-0 items-center gap-1 text-xs text-slate-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{item.city}</span>
          </span>
        </span>
      </Link>
    </article>
  );
}

function ListingsSection({ emptyText, items, title }: { emptyText: string; items: SellerProfileListing[]; title: string }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold text-[#060b27]">{title}</h2>
      {items.length ? (
        <div className="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {items.map((item) => (
            <ListingTile key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm font-semibold text-slate-500">{emptyText}</div>
      )}
    </section>
  );
}

export function SellerProfileClient({ initialListings, sellerKey }: SellerProfileClientProps) {
  const [storedListings, setStoredListings] = useState<SellerProfileListing[]>([]);

  useEffect(() => {
    function syncItems() {
      setStoredListings(clientFallbackContentEnabled ? readStoredPublications().filter((item) => isSellerDemoPublication(item, sellerKey)).map(storedProfileListing) : []);
    }

    syncItems();
    window.addEventListener("storage", syncItems);
    window.addEventListener("blizhniy-demo-publications-updated", syncItems);

    return () => {
      window.removeEventListener("storage", syncItems);
      window.removeEventListener("blizhniy-demo-publications-updated", syncItems);
    };
  }, [sellerKey]);

  const listings = useMemo(
    () => uniqueListings([...storedListings, ...initialListings]).sort((left, right) => publicationTimestamp(right.createdAt) - publicationTimestamp(left.createdAt)),
    [initialListings, storedListings],
  );
  const sellerName = listings[0]?.sellerName ?? "Продавец";
  const soldListings = listings.filter((item) => isSoldStatus(item.status));
  const activeListings = listings.filter((item) => !isSoldStatus(item.status) && isActiveStatus(item.status));

  return (
    <main className="page-container py-6 sm:py-8 lg:py-10">
      <BackLink fallbackHref="/" className="inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
        Назад к объявлениям
      </BackLink>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xl font-bold text-[#0875d1]">
              {sellerInitial(sellerName)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-slate-400">Профиль продавца</p>
              <h1 className="mt-1 [overflow-wrap:anywhere] text-2xl font-bold leading-tight text-[#060b27] sm:text-3xl">{sellerName}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Здесь собраны объявления продавца и история завершённых продаж на платформе.</p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase text-slate-400">На платформе</p>
            <p className="mt-1 text-sm font-bold text-[#060b27]">с {sellerSince(listings)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase text-slate-400">Активные</p>
            <p className="mt-1 text-sm font-bold text-[#060b27]">{activeListings.length}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase text-slate-400">Продано</p>
            <p className="mt-1 text-sm font-bold text-[#060b27]">{soldListings.length}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase text-slate-400">Всего</p>
            <p className="mt-1 text-sm font-bold text-[#060b27]">{listings.length}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0875d1]" />
            <span>Перед оплатой договоритесь о встрече и проверьте товар лично.</span>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0875d1]" />
            <span>Проданные товары остаются в профиле как история активности продавца.</span>
          </div>
        </div>
      </section>

      <ListingsSection title="Активные объявления" items={activeListings} emptyText="У продавца сейчас нет активных объявлений." />
      <ListingsSection title="Проданные товары" items={soldListings} emptyText="Проданных товаров пока нет." />
    </main>
  );
}
