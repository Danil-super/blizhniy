import type { Metadata } from "next";
import { demoListings, ListingDetailPage } from "@/components/listings/ListingPages";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = demoListings.find((item) => item.slug === slug);

  return {
    title: listing?.title ?? "Объявление",
    description: listing?.description ?? "Карточка объявления на БЛИЖНИЙ.",
    alternates: {
      canonical: `/blizhniy/obyavlenie/${slug}`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;

  return <ListingDetailPage slug={slug} />;
}
