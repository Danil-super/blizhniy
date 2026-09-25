import type { Metadata } from "next";
import { CategoryListingsPage, parseListingPage, slugifySubcategory } from "@/components/listings/ListingPages";
import { getPublicCategories } from "@/lib/category-store";

type PageProps = {
  searchParams?: Promise<{ page?: string }>;
  params: Promise<{ categorySlug: string; subcategorySlug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const page = parseListingPage((await searchParams)?.page);
  const { categorySlug, subcategorySlug } = await params;
  const categories = await getPublicCategories();
  const category = categories.find((item) => item.slug === categorySlug);
  const subcategory = category?.children.find((item) => slugifySubcategory(item) === subcategorySlug);

  return {
    title: subcategory ?? "Подкатегория",
    description: `Объявления подкатегории ${subcategory ?? subcategorySlug} на БЛИЖНИЙ.`,
    alternates: {
      canonical: page > 1 ? `/katalog/${categorySlug}/${subcategorySlug}?page=${page}` : `/katalog/${categorySlug}/${subcategorySlug}`,
    },
  };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { categorySlug, subcategorySlug } = await params;

  const page = parseListingPage((await searchParams)?.page);

  return <CategoryListingsPage categorySlug={categorySlug} subcategorySlug={subcategorySlug} page={page} />;
}
