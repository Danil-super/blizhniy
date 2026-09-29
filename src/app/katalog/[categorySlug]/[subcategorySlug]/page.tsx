import type { Metadata } from "next";
import { CategoryListingsPage, parseListingPage, slugifySubcategory } from "@/components/listings/ListingPages";
import { getPublicCategories } from "@/lib/category-store";
import { permanentRedirect } from "next/navigation";

type PageProps = {
  searchParams?: Promise<{ page?: string }>;
  params: Promise<{ categorySlug: string; subcategorySlug: string }>;
};

export const dynamic = "force-dynamic";

function legacySubcategorySlug(name: string) {
  return name.toLowerCase().replaceAll(" ", "-");
}

function decodeSubcategorySlug(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveSubcategory(category: { children: string[] } | undefined, subcategorySlug: string) {
  const subcategory = category?.children.find((item) => slugifySubcategory(item) === subcategorySlug);
  const legacySubcategory = category?.children.find((item) => legacySubcategorySlug(item) === subcategorySlug);

  return {
    subcategory: subcategory ?? legacySubcategory,
    canonicalSlug: legacySubcategory ? slugifySubcategory(legacySubcategory) : subcategorySlug,
  };
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const page = parseListingPage((await searchParams)?.page);
  const { categorySlug, subcategorySlug } = await params;
  const decodedSubcategorySlug = decodeSubcategorySlug(subcategorySlug);
  const categories = await getPublicCategories();
  const category = categories.find((item) => item.slug === categorySlug);
  const { subcategory, canonicalSlug } = resolveSubcategory(category, decodedSubcategorySlug);

  return {
    title: subcategory ?? "Подкатегория",
    description: `Объявления подкатегории ${subcategory ?? subcategorySlug} на БЛИЖНИЙ.`,
    alternates: {
      canonical: `/katalog/${categorySlug}/${canonicalSlug}`,
    },
    robots: subcategory ? (page > 1 ? { index: false, follow: true } : undefined) : { index: false, follow: false },
  };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { categorySlug, subcategorySlug } = await params;
  const decodedSubcategorySlug = decodeSubcategorySlug(subcategorySlug);
  const query = await searchParams;
  const page = parseListingPage(query?.page);
  const categories = await getPublicCategories();
  const category = categories.find((item) => item.slug === categorySlug);
  const { subcategory, canonicalSlug } = resolveSubcategory(category, decodedSubcategorySlug);

  if (subcategory && canonicalSlug !== decodedSubcategorySlug) {
    const pageQuery = query?.page ? `?page=${encodeURIComponent(query.page)}` : "";
    permanentRedirect(`/katalog/${categorySlug}/${canonicalSlug}${pageQuery}`);
  }

  return <CategoryListingsPage categorySlug={categorySlug} subcategorySlug={subcategorySlug} page={page} />;
}
