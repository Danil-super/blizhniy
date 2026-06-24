import Link from "next/link";
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

export async function HomeListings({ kind }: { kind?: ListingKind }) {
  const storedListings = await listStoredListings();
  const storedCards = storedListings.map((listing) => ({ ...toDemoListing(listing), images: listing.images }));
  const demoListings = shouldShowFallbackContent() ? [...listListings().map(toDemoListing), ...listDemoListings()] : [];
  const allListings = [...storedCards, ...demoListings];
  const uniqueListings = Array.from(new Map(allListings.map((listing) => [listing.slug, listing])).values());
  const title = kind ? kindLabels[kind] : "Свежие объявления";
  const listings = uniqueListings
    .filter((listing) => listing.status === "published")
    .filter((listing) => !kind || listing.kind === kind)
    .sort((left, right) => publicationTimestamp(right.publishedAt) - publicationTimestamp(left.publishedAt));

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
        <HomeListingsFeed kind={kind} listings={listings} />
      </div>
    </section>
  );
}
