import Link from "next/link";
import { notFound } from "next/navigation";
import { HomeListingsFeed } from "@/components/HomeListingsFeed";
import { listDemoListings, toDemoListing } from "@/components/listings/ListingPages";
import { listStoredListings } from "@/lib/listing-store";
import { listListings } from "@/lib/mock-store";
import { publicationTimestamp } from "@/lib/publication-time";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import type { ListingKind } from "@/lib/types";

const kindLabels: Record<ListingKind, string> = {
  arenda: "Аренда",
  prodam: "Продам",
  kuplyu: "Куплю",
  "otdam-darom": "Отдам даром",
};

export async function HomeListings({ kind, page = 1 }: { kind?: ListingKind; page?: number }) {
  const pageSize = 24;
  const storedListings = await listStoredListings(pageSize + 1, { kind, offset: (page - 1) * pageSize });

  if (page > 1 && !storedListings.length) notFound();
  const storedCards = storedListings.map((listing) => ({ ...toDemoListing(listing), images: listing.images }));
  const demoListings = page === 1 && shouldShowFallbackContent() ? [...listListings().map(toDemoListing), ...listDemoListings()] : [];
  const allListings = [...storedCards, ...demoListings];
  const uniqueListings = Array.from(new Map(allListings.map((listing) => [listing.slug, listing])).values());
  const title = kind ? kindLabels[kind] : "Свежие объявления";
  const listings = uniqueListings
    .filter((listing) => listing.status === "published")
    .filter((listing) => !kind || listing.kind === kind)
    .sort((left, right) => publicationTimestamp(right.publishedAt) - publicationTimestamp(left.publishedAt));
  const hasMore = storedListings.length > pageSize;
  const visibleListings = listings.slice(0, pageSize);
  const pageHref = (number: number) => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (number > 1) params.set("page", String(number));
    return `/obyavleniya${params.size ? `?${params}` : ""}`;
  };

  return (
    <section className="page-container pb-10">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-[#060b27]">{title}</h2>
        {kind ? (
          <Link href="/obyavleniya" className="text-sm font-bold text-[#0875d1] hover:text-[#0664b3]">
            Показать все
          </Link>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <HomeListingsFeed kind={kind} listings={visibleListings} />
      </div>
      {page > 1 || hasMore ? (
        <nav aria-label="Страницы объявлений" className="mt-6 flex items-center justify-center gap-3">
          {page > 1 ? <Link href={pageHref(page - 1)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#0875d1]">Назад</Link> : null}
          <span className="text-sm font-bold text-slate-700">Страница {page}</span>
          {hasMore ? <Link href={pageHref(page + 1)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#0875d1]">Далее</Link> : null}
        </nav>
      ) : null}
    </section>
  );
}
