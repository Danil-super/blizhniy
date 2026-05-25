import type { Metadata } from "next";
import { demoListings, ListingFormPage } from "@/components/listings/ListingPages";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = demoListings.find((item) => item.slug === slug);

  return {
    title: `Редактирование: ${listing?.title ?? "объявление"}`,
    description: "Форма редактирования объявления с полями статуса и оплаты.",
    alternates: {
      canonical: `/blizhniy/obyavlenie/${slug}/redaktirovat`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;

  return <ListingFormPage slug={slug} />;
}
