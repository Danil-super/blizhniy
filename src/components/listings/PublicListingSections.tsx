import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { SiteHeader } from "@/components/SiteHeader";
import { ListingResultsPanel } from "@/components/listings/ListingResultsPanel";
import { listDemoListings, toDemoListing } from "@/components/listings/ListingPages";
import { ListingKind, ListingKindBadge, type DemoListing } from "@/components/listings/ListingCard";
import { listStoredListings } from "@/lib/listing-store";
import { listListings } from "@/lib/mock-store";
import { publicationTimestamp } from "@/lib/publication-time";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";

const listingKinds: { slug: ListingKind; title: string; description: string }[] = [
  { slug: "prodam", title: "Продам", description: "Вещи, мебель, растения и полезные товары рядом с домом." },
  { slug: "kuplyu", title: "Куплю", description: "Запросы покупателей: что ищут жители Краснодара и края." },
  { slug: "otdam-darom", title: "Отдам даром", description: "Публикации без цены: забрать, передать, пристроить." },
  { slug: "arenda", title: "Аренда", description: "Бронирование турбаз, гостиниц, домов и активного отдыха." },
];

const mainListingKinds = listingKinds.filter((item) => item.slug === "prodam" || item.slug === "kuplyu" || item.slug === "otdam-darom");

function listingKindHref(kind: ListingKind) {
  return `/obyavleniya/${kind}`;
}

function createListingHref(kind: ListingKind) {
  return `/razmestit/obyavlenie?kind=${kind}`;
}

function uniqueListings(listings: DemoListing[]) {
  return Array.from(new Map(listings.map((listing) => [listing.slug, listing])).values());
}

async function listPublicListings(limit = 200) {
  const storedListings = await listStoredListings(limit);
  const fallbackListings = shouldShowFallbackContent() ? [...listListings().map(toDemoListing), ...listDemoListings()] : [];
  const listings = uniqueListings([...storedListings.map(toDemoListing), ...fallbackListings]);

  return listings
    .filter((listing) => listing.status === "published")
    .sort((left, right) => publicationTimestamp(right.publishedAt) - publicationTimestamp(left.publishedAt));
}

function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:text-sm" aria-label="Хлебные крошки">
      <Link href="/obyavleniya" className="hover:text-[#0875d1]">
        Объявления
      </Link>
      {items.map((item, index) => (
        <span key={`${item.href ?? item.label}-${index}`} className="flex items-center gap-2">
          <span>/</span>
          {item.href ? (
            <Link href={item.href} className="hover:text-[#0875d1]">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function ListingKindTabs({ activeKind }: { activeKind: ListingKind }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2 sm:mt-5 lg:mt-6">
      {mainListingKinds.map((item) => (
        <Link
          key={item.slug}
          href={listingKindHref(item.slug)}
          className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition sm:h-9 sm:text-sm lg:h-10 lg:px-4 ${
            item.slug === activeKind
              ? "border-[#0875d1] bg-[#0875d1] text-white"
              : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
          }`}
        >
          {item.title}
        </Link>
      ))}
    </div>
  );
}

export async function PublicListingKindPage({ kind }: { kind: ListingKind }) {
  const current = listingKinds.find((item) => item.slug === kind) ?? listingKinds[0];
  const listings = (await listPublicListings()).filter((listing) => listing.kind === kind);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-6 sm:py-8 lg:py-10">
        <Breadcrumbs items={[{ label: current.title }]} />
        <BackLink fallbackHref="/obyavleniya" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <div className="grid gap-7">
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
              <div>
                <ListingKindBadge kind={kind} />
                <h1 className="mt-3 text-xl font-bold leading-tight text-[#060b27] sm:text-2xl lg:mt-4 lg:text-3xl">{current.title}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7 lg:mt-4 lg:text-lg lg:leading-8">{current.description}</p>
              </div>
              <Link
                href={createListingHref(kind)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:px-5 lg:h-12 lg:px-6 lg:text-base"
              >
                Разместить
                <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </div>
            <ListingKindTabs activeKind={kind} />
            <ListingResultsPanel kind={kind} listings={listings} />
          </section>
        </div>
      </main>
    </>
  );
}

export async function PublicExchangeAndFreePage() {
  const listings = (await listPublicListings()).filter((listing) => listing.kind === "otdam-darom");

  return (
    <>
      <SiteHeader />
      <main className="page-container py-6 sm:py-8 lg:py-10">
        <Breadcrumbs items={[{ label: "Отдам даром" }]} />
        <BackLink fallbackHref="/obyavleniya" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <div className="grid gap-7">
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
              <div>
                <h1 className="text-xl font-bold leading-tight text-[#060b27] sm:text-2xl lg:text-3xl">Отдам даром</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7 lg:mt-4 lg:text-lg lg:leading-8">
                  Раздел бесплатных объявлений рядом с домом.
                </p>
              </div>
              <Link
                href={createListingHref("otdam-darom")}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:px-5 lg:h-12 lg:px-6 lg:text-base"
              >
                Разместить
                <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 sm:mt-5 lg:mt-6">
              <Link
                href="/obyavleniya/otdam-darom"
                className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:h-9 sm:text-sm lg:h-10 lg:px-4"
              >
                Отдам даром
              </Link>
            </div>
            <ListingResultsPanel kind="otdam-darom" listings={listings} />
          </section>
        </div>
      </main>
    </>
  );
}
