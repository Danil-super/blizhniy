import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { listDemoListings, toDemoListing } from "@/components/listings/ListingPages";
import { SellerProfileClient, type SellerProfileListing } from "@/components/listings/SellerProfileClient";
import { listStoredListings } from "@/lib/listing-store";
import { listListings } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { isSameSeller, sellerDisplayName } from "@/lib/seller-profile";

type PageProps = {
  params: Promise<{ sellerKey: string }>;
};

function decodeSellerKey(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function getSellerListings(sellerKey: string): Promise<SellerProfileListing[]> {
  const storedListings = (await listStoredListings(200)).map(toDemoListing);
  const fallbackListings = shouldShowFallbackContent() ? [...listDemoListings(), ...listListings().map(toDemoListing)] : [];

  return [...storedListings, ...fallbackListings]
    .filter((listing) => isSameSeller(listing, sellerKey))
    .map((listing) => ({
      categoryName: listing.categoryName,
      city: listing.city,
      createdAt: listing.publishedAt,
      href: `/obyavlenie/${listing.slug}`,
      id: listing.viewId ?? listing.slug,
      price: listing.price,
      sellerName: sellerDisplayName(listing),
      status: listing.status,
      title: listing.title,
    }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sellerKey } = await params;
  const decodedKey = decodeSellerKey(sellerKey);
  const listing = (await getSellerListings(decodedKey))[0];
  const sellerName = listing?.sellerName ?? "Продавец";

  return {
    title: `${sellerName} - профиль продавца`,
    description: `Объявления продавца ${sellerName} на БЛИЖНИЙ.`,
    alternates: {
      canonical: `/prodavets/${encodeURIComponent(decodedKey)}`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { sellerKey } = await params;
  const decodedKey = decodeSellerKey(sellerKey);

  return (
    <>
      <SiteHeader />
      <SellerProfileClient sellerKey={decodedKey} initialListings={await getSellerListings(decodedKey)} />
    </>
  );
}
