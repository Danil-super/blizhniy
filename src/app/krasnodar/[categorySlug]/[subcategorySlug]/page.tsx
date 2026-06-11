import type { Metadata } from "next";
import { CategoryListingsPage, slugifySubcategory } from "@/components/listings/ListingPages";
import { categories } from "@/lib/data";

type PageProps = {
  params: Promise<{ categorySlug: string; subcategorySlug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { categorySlug, subcategorySlug } = await params;
  const category = categories.find((item) => item.slug === categorySlug);
  const subcategory = category?.children.find((item) => slugifySubcategory(item) === subcategorySlug);

  return {
    title: `${subcategory ?? "Подкатегория"} в Краснодаре`,
    description: `Объявления подкатегории ${subcategory ?? subcategorySlug} в Краснодаре на БЛИЖНИЙ.`,
    alternates: {
      canonical: `/krasnodar/${categorySlug}/${subcategorySlug}`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { categorySlug, subcategorySlug } = await params;

  return <CategoryListingsPage categorySlug={categorySlug} subcategorySlug={subcategorySlug} />;
}
