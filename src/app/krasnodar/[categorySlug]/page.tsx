import type { Metadata } from "next";
import { CategoryListingsPage } from "@/components/listings/ListingPages";
import { categories } from "@/lib/data";

type PageProps = {
  params: Promise<{ categorySlug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { categorySlug } = await params;
  const category = categories.find((item) => item.slug === categorySlug);

  return {
    title: `${category?.name ?? "Категория"} в Краснодаре`,
    description: `Объявления категории ${category?.name ?? categorySlug} в Краснодаре на БЛИЖНИЙ.`,
    alternates: {
      canonical: `/krasnodar/${categorySlug}`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { categorySlug } = await params;

  return <CategoryListingsPage categorySlug={categorySlug} />;
}
