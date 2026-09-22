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
      {categorySlug === "elektronika" ? (
        <style>{`
          [data-category-theme="elektronika"] {
            background: #8d6c70 !important;
          }

          [data-category-theme="elektronika"] > div:not(:last-child) {
            display: none !important;
          }

          [data-category-theme="elektronika"] > img {
            opacity: 1 !important;
            filter: none !important;
            mask-image: none !important;
            -webkit-mask-image: none !important;
          }

          @media (max-width: 1023px) {
            [data-category-theme="elektronika"] {
              min-height: 320px !important;
              padding: 1rem !important;
            }

            [data-category-theme="elektronika"] > img:first-of-type {
              object-fit: cover !important;
              object-position: 100% 50% !important;
            }

            [data-category-theme="elektronika"] > div:last-child {
              width: 56% !important;
              max-width: 230px !important;
            }

            [data-category-theme="elektronika"] > div:last-child h1 {
              max-width: 100% !important;
              color: #ffffff !important;
              font-size: 1.35rem !important;
              line-height: 1.1 !important;
              text-shadow: 0 2px 8px rgba(0,0,0,0.92), 0 1px 2px rgba(0,0,0,0.95) !important;
            }

            [data-category-theme="elektronika"] > div:last-child p {
              max-width: 100% !important;
              margin-top: 0.55rem !important;
              color: #ffffff !important;
              font-size: 0.72rem !important;
              line-height: 1.05rem !important;
              text-shadow: 0 2px 7px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,1) !important;
            }

            [data-category-theme="elektronika"] > div:last-child > div > div:last-child {
              margin-top: 0.8rem !important;
              gap: 0.45rem !important;
            }

            [data-category-theme="elektronika"] > div:last-child > div > div:last-child a {
              min-height: 2.25rem !important;
              height: 2.25rem !important;
              max-width: 100% !important;
              padding-left: 0.65rem !important;
              padding-right: 0.65rem !important;
              font-size: 0.68rem !important;
              white-space: nowrap !important;
            }

            [data-category-theme="elektronika"] > div:last-child > div > div:last-child a svg {
              width: 0.85rem !important;
              height: 0.85rem !important;
            }
          }

          @media (min-width: 640px) and (max-width: 1023px) {
            [data-category-theme="elektronika"] {
              min-height: 360px !important;
              padding: 1.25rem !important;
            }

            [data-category-theme="elektronika"] > div:last-child {
              width: 48% !important;
              max-width: 330px !important;
            }

            [data-category-theme="elektronika"] > div:last-child h1 {
              font-size: 1.75rem !important;
            }

            [data-category-theme="elektronika"] > div:last-child p {
              font-size: 0.85rem !important;
              line-height: 1.25rem !important;
            }
          }

          @media (min-width: 1024px) {
            [data-category-theme="elektronika"] > div:last-child h1,
            [data-category-theme="elektronika"] > div:last-child p {
              color: #ffffff !important;
              text-shadow: 0 2px 7px rgba(0,0,0,0.72) !important;
            }

            [data-category-theme="elektronika"] > img:nth-of-type(2) {
              position: absolute !important;
              top: 0 !important;
              right: 1rem !important;
              bottom: 0 !important;
              left: auto !important;
              display: block !important;
              width: 72% !important;
              height: 100% !important;
              max-width: none !important;
              transform: none !important;
              object-fit: contain !important;
              object-position: right center !important;
            }
          }
        `}</style>
      ) : null}
    </>
  );
}
