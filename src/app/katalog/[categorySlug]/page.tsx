import type { Metadata } from "next";
import { CategoryListingsPage, parseListingPage } from "@/components/listings/ListingPages";
import { getPublicCategories } from "@/lib/category-store";

type PageProps = {
  searchParams?: Promise<{ page?: string }>;
  params: Promise<{ categorySlug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const page = parseListingPage((await searchParams)?.page);
  const { categorySlug } = await params;
  const categories = await getPublicCategories();
  const category = categories.find((item) => item.slug === categorySlug);

  return {
    title: category?.name ?? "Категория",
    description: `Объявления категории ${category?.name ?? categorySlug} на БЛИЖНИЙ.`,
    alternates: {
      canonical: `/katalog/${categorySlug}`,
    },
    robots: category ? (page > 1 ? { index: false, follow: true } : undefined) : { index: false, follow: false },
  };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { categorySlug } = await params;

  const page = parseListingPage((await searchParams)?.page);

  return <CategoryListingsPage categorySlug={categorySlug} page={page} />;
}
