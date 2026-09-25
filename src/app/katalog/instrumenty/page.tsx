import Link from "next/link";
import type { Metadata } from "next";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { categoryPageStyle, CategoryHeaderBand, SubcategoryCard, subcategoryGridClassName } from "@/components/listings/CategoryPageDesign";
import { ListingResultsPanel } from "@/components/listings/ListingResultsPanel";
import { ListingPagination } from "@/components/listings/ListingPagination";
import { parseListingPage, toDemoListing } from "@/components/listings/ListingPages";
import { listStoredListingsForCategory } from "@/lib/listing-store";
import type { DemoListing } from "@/components/listings/ListingCard";
import { instrumentSubcategories } from "@/lib/instrument-subcategories";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";

const categoryMetadata: Metadata = {
  title: "Инструменты",
  description: "Подкатегории инструментов на БЛИЖНИЙ: ручной инструмент, электроинструмент, измерительный инструмент, строительный и садовый инструмент.",
  alternates: {
    canonical: "/katalog/instrumenty",
  },
};

export async function generateMetadata({ searchParams }: { searchParams?: Promise<{ page?: string }> }): Promise<Metadata> {
  const page = parseListingPage((await searchParams)?.page);

  return {
    ...categoryMetadata,
    alternates: { canonical: page > 1 ? `/katalog/instrumenty?page=${page}` : "/katalog/instrumenty" },
  };
}

function instrumentListing(subcategory: (typeof instrumentSubcategories)[number], index: number): DemoListing {
  return {
    slug: `instrumenty-${subcategory.slug}`,
    title: subcategory.demoListing.title,
    kind: "prodam",
    categorySlug: "instrumenty",
    categoryName: "Инструменты",
    subcategorySlug: subcategory.slug,
    subcategoryName: subcategory.name,
    city: "Краснодар",
    district: ["Фестивальный", "Центр", "Юбилейный", "Черёмушки", "Гидрострой", "Прикубанский"][index] ?? "Краснодар",
    lat: 45.037 + index * 0.006,
    lng: 38.975 + index * 0.004,
    showExactAddress: false,
    price: subcategory.demoListing.price,
    description: subcategory.demoListing.description,
    phone: `+78610003${String(index + 1).padStart(3, "0")}`,
    messengerUrl: "https://t.me/blizhniy_support",
    status: "published",
    paid: true,
    createdAt: "15 июня 2026",
    publishedAt: "15 июня 2026",
    expiresAt: "15 июля 2026",
    imageTone: index % 2 === 0 ? "blue" : "amber",
  };
}

const demoListings = instrumentSubcategories.map(instrumentListing);

export const dynamic = "force-dynamic";

export default async function InstrumentsCategoryPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const page = parseListingPage((await searchParams)?.page);
  const pageSize = 24;
  const storedListings = await listStoredListingsForCategory("instrumenty", { page, pageSize });
  const listings = [
    ...storedListings.slice(0, pageSize).map(toDemoListing),
    ...(page === 1 && shouldShowFallbackContent() ? demoListings : []),
  ];
  return (
    <>
      <SiteHeader />
      <HomeHero />
      <style>{`
        [data-category-theme="instrumenty"] {
          position: relative;
          min-height: 0 !important;
          aspect-ratio: 1362 / 1155;
          overflow: hidden;
          background-color: #4e3829 !important;
          background-image: none !important;
          background-repeat: no-repeat !important;
          background-size: cover !important;
          background-position: center center !important;
        }

        [data-category-theme="instrumenty"] > div:last-child {
          position: static;
          display: block !important;
          width: 100%;
          max-width: 100%;
          text-shadow: none;
        }

        [data-category-theme="instrumenty"] > div:last-child > div:first-child {
          display: inline-block;
          max-width: 17.5rem;
          padding: 0;
          border: 0;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
        }

        [data-category-theme="instrumenty"] > div:last-child h1,
        [data-category-theme="instrumenty"] > div:last-child p {
          position: relative;
          z-index: 10;
          max-width: none !important;
          color: #fff !important;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9), 0 1px 2px rgba(0, 0, 0, 0.95);
        }

        [data-category-theme="instrumenty"] > div:last-child h1 {
          white-space: nowrap;
        }

        [data-category-theme="instrumenty"] > div:last-child p {
          margin-top: 0.35rem;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child {
          position: absolute;
          left: 1rem;
          right: 1rem;
          bottom: 1rem;
          z-index: 20;
          display: flex;
          flex-flow: row nowrap;
          align-items: center;
          gap: 0.5rem;
          margin-top: 0;
          text-shadow: none;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a {
          flex: 0 0 auto;
          min-height: 40px;
          height: 40px;
          padding-left: 0.65rem;
          padding-right: 0.65rem;
          font-size: 0.75rem;
          white-space: nowrap;
        }


        @media (max-width: 374px) {
          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child {
            left: 0.75rem;
            right: 0.75rem;
            bottom: 0.75rem;
            flex-flow: column nowrap;
            align-items: stretch;
            gap: 0.4rem;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a {
            width: 100%;
            justify-content: center;
          }
        }

        @media (min-width: 768px) {
          [data-category-theme="instrumenty"] {
            min-height: 0 !important;
            aspect-ratio: 8 / 3;
          }

          [data-category-theme="instrumenty"] > div:last-child > div:first-child {
            max-width: 17rem;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child {
            left: 1.25rem;
            right: auto;
            bottom: 1.25rem;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a {
            padding-left: 1rem;
            padding-right: 1rem;
            font-size: 0.875rem;
          }
        }

        @media (min-width: 1024px) {
          [data-category-theme="instrumenty"] > div:last-child > div:first-child {
            max-width: 19rem;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child {
            left: 1.75rem;
            bottom: 1.5rem;
          }
        }
      `}</style>
      <main className="bg-[var(--category-page)] pb-8" style={categoryPageStyle("instrumenty")}>
        <div className="page-container py-3 sm:py-4 lg:py-5">
          <nav className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:text-sm" aria-label="Хлебные крошки">
            <Link href="/katalog" className="hover:text-[#0875d1]">
              Категории
            </Link>
            <span>/</span>
            <span>Инструменты</span>
          </nav>
          <BackLink fallbackHref="/katalog" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад
          </BackLink>

          <div className="mt-3 grid gap-5">
            <CategoryHeaderBand
              categorySlug="instrumenty"
              createHref="/razmestit/obyavlenie?category=instrumenty&kind=prodam"
              description="Выберите подкатегорию, посмотрите предложения рядом или разместите свое объявление."
              title="Инструменты"
            />

            <section aria-label="Подкатегории">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <h2 className="text-lg font-bold leading-tight text-[#060b27]">Подкатегории</h2>
                <p className="text-sm font-semibold text-slate-500">Инструменты для ремонта, стройки и участка</p>
              </div>
              <div className={subcategoryGridClassName(instrumentSubcategories.length)}>
                {instrumentSubcategories.map((subcategory) => (
                  <SubcategoryCard
                    createHref={`/razmestit/obyavlenie?category=instrumenty&kind=prodam&subcategory=${subcategory.slug}`}
                    description={subcategory.description}
                    href={`/katalog/instrumenty/${subcategory.slug}`}
                    items={subcategory.items}
                    key={subcategory.slug}
                    title={subcategory.name}
                    visualSlug="instrumenty"
                  />
                ))}
              </div>
            </section>

            <section id="listings" aria-label="Объявления категории">
              <ListingResultsPanel categorySlug="instrumenty" listings={listings} />
              <ListingPagination baseHref="/katalog/instrumenty" hasMore={storedListings.length > pageSize} page={page} />
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
