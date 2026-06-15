import type { Metadata } from "next";
import { findListingBySlug, ListingDetailPage, toDemoListing } from "@/components/listings/ListingPages";
import { getStoredListingById } from "@/lib/listing-store";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const storedListing = await getStoredListingById(slug);
  const listing = storedListing ? toDemoListing(storedListing) : findListingBySlug(slug);

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
  const storedListing = await getStoredListingById(slug);

  return <ListingDetailPage slug={slug} listingOverride={storedListing ? toDemoListing(storedListing) : undefined} />;
}
