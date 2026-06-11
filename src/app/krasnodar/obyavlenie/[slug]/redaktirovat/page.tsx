import type { Metadata } from "next";
import { findListingBySlug, ListingFormPage } from "@/components/listings/ListingPages";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = findListingBySlug(slug);

  return {
    title: `Редактирование: ${listing?.title ?? "объявление"}`,
    description: "Форма редактирования объявления с полями статуса и оплаты.",
    alternates: {
      canonical: `/krasnodar/obyavlenie/${slug}/redaktirovat`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;

  return <ListingFormPage slug={slug} />;
}
