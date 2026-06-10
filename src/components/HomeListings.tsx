import Link from "next/link";
import { HomeListingsFeed } from "@/components/HomeListingsFeed";
import { listDemoListings, toDemoListing } from "@/components/listings/ListingPages";
import { listListings } from "@/lib/mock-store";
import { publicationTimestamp } from "@/lib/publication-time";

export function HomeListings() {
  const allListings = [...listListings().map(toDemoListing), ...listDemoListings()];
  const uniqueListings = Array.from(new Map(allListings.map((listing) => [listing.slug, listing])).values());
  const listings = uniqueListings
    .filter((listing) => listing.status === "published")
    .sort((left, right) => publicationTimestamp(right.publishedAt) - publicationTimestamp(left.publishedAt));

  return (
    <section className="page-container pb-10">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Свежие объявления</h2>
        <Link href="/blizhniy/prodam" className="text-sm font-bold text-[#0875d1] hover:text-[#0664b3]">
          Смотреть все
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <HomeListingsFeed listings={listings} />
      </div>
    </section>
  );
}
