import type { Metadata } from "next";
import { findListingBySlug, ListingDetailPage, toDemoListing } from "@/components/listings/ListingPages";
import { listActiveBookingRequestsForListing } from "@/lib/booking-store";
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

  return {
    title: listing?.title ?? "Объявление",
    description: listing?.description ?? "Карточка объявления на БЛИЖНИЙ.",
    alternates: {
      canonical: `/obyavlenie/${slug}`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const storedListing = await getStoredListingById(slug, { publicOnly: true });
  const bookingRequests = storedListing?.booking ? await listActiveBookingRequestsForListing(slug) : [];

  return <ListingDetailPage bookingRequests={bookingRequests} slug={slug} listingOverride={storedListing ? toDemoListing(storedListing) : undefined} />;
}
