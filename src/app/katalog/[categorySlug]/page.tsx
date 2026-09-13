import type { Metadata } from "next";
import { CategoryListingsPage } from "@/components/listings/ListingPages";
import { getPublicCategories } from "@/lib/category-store";

type PageProps = {
  params: Promise<{ categorySlug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { categorySlug } = await params;
  const categories = await getPublicCategories();
  const category = categories.find((item) => item.slug === categorySlug);

  return {
    title: category?.name ?? "Категория",
    description: `Объявления категории ${category?.name ?? categorySlug} на БЛИЖНИЙ.`,
    alternates: {
      canonical: `/katalog/${categorySlug}`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { categorySlug } = await params;

  return (
    <>
      <CategoryListingsPage categorySlug={categorySlug} />
      {categorySlug === "transport" ? (
        <style>{`
          [data-category-theme="transport"] > div:last-child {
            position: static;
          }

          [data-category-theme="transport"] > div:last-child h1,
          [data-category-theme="transport"] > div:last-child p {
            position: relative;
            z-index: 10;
          }

          [data-category-theme="transport"] > div:last-child > div > div:last-child {
            position: absolute;
            left: 1rem;
            right: 1rem;
            bottom: 0.75rem;
            z-index: 20;
            display: flex;
            flex-flow: row nowrap;
            align-items: center;
            gap: 0.5rem;
            margin-top: 0;
          }

          [data-category-theme="transport"] > div:last-child > div > div:last-child > div:first-child {
            display: none !important;
          }

          [data-category-theme="transport"] > div:last-child > div > div:last-child > div:last-child {
            display: flex !important;
            flex-flow: row nowrap;
            align-items: center;
            gap: 0.5rem;
          }

          [data-category-theme="transport"] > div:last-child > div > div:last-child > div:last-child > a {
            flex: 0 0 auto;
            white-space: nowrap;
          }

          @media (max-width: 639px) {
            [data-category-theme="transport"] > div:last-child > div > div:last-child > div:last-child > a {
              height: 2.25rem;
              padding-left: 0.625rem;
              padding-right: 0.625rem;
              font-size: 0.6875rem;
              line-height: 1;
            }

            [data-category-theme="transport"] > div:last-child > div > div:last-child > div:last-child > a svg {
              display: none !important;
            }
          }

          @media (min-width: 640px) {
            [data-category-theme="transport"] > div:last-child > div > div:last-child {
              left: 1.25rem;
              right: auto;
              bottom: 1rem;
            }
          }

          @media (min-width: 1024px) {
            [data-category-theme="transport"] > div:last-child > div > div:last-child {
              left: 1.75rem;
              bottom: 1.25rem;
            }
          }
        `}</style>
      ) : null}
    </>
  );
}
