import { publicationOpenGraph } from "@/lib/publication-open-graph";
import type { Metadata } from "next";
import { findListingBySlug, ListingDetailPage, toDemoListing } from "@/components/listings/ListingPages";
import { listBookingAvailabilityForListing } from "@/lib/booking-store";
import { getStoredListingById } from "@/lib/listing-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const storedListing = await getStoredListingById(slug, { publicOnly: true });
  const listing = storedListing ? toDemoListing(storedListing) : shouldShowFallbackContent() ? findListingBySlug(slug) : undefined;

  const title = listing?.title ?? "Объявление";
  const description = listing?.description ?? "Карточка объявления на БЛИЖНИЙ.";
  const url = `/obyavlenie/${slug}`;
  return {
    ...(storedListing?.testPublication ? { robots: { index: false, follow: true } } : {}),
    title,
    description,
    openGraph: listing ? publicationOpenGraph(title, description, url, listing.images) : undefined,
    alternates: {
      canonical: url,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const storedListing = await getStoredListingById(slug, { publicOnly: true });
  const bookingRequests = process.env.BLIZHNIY_AUTH_MODE !== 'postgres' && storedListing?.booking ? await listBookingAvailabilityForListing(slug) : [];

  return <ListingDetailPage bookingRequests={bookingRequests} slug={slug} listingOverride={storedListing ? toDemoListing(storedListing) : undefined} />;
}
