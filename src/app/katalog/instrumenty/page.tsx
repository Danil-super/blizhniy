import Link from "next/link";
import type { Metadata } from "next";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { categoryPageStyle, CategoryHeaderBand, SubcategoryCard, subcategoryGridClassName } from "@/components/listings/CategoryPageDesign";
import { ListingResultsPanel } from "@/components/listings/ListingResultsPanel";
import type { DemoListing } from "@/components/listings/ListingCard";
import { instrumentSubcategories } from "@/lib/instrument-subcategories";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";

export const metadata: Metadata = {
  title: "Инструменты",
  description: "Подкатегории инструментов на БЛИЖНИЙ: ручной инструмент, электроинструмент, измерительный инструмент, строительный и садовый инструмент.",
  alternates: {
    canonical: "/katalog/instrumenty",
  },
};

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

export default function InstrumentsCategoryPage() {
  return (
    <>
      <SiteHeader />
      <HomeHero />
      <style>{`
        [data-category-theme="instrumenty"] {
          min-height: 360px;
          background-image: url('/images/categories/tools-category-hero.jpg') !important;
          background-repeat: no-repeat !important;
          background-size: cover !important;
          background-position: 58% 44% !important;
        }

        [data-category-theme="instrumenty"] > div:last-child {
          position: relative;
          z-index: 10;
          display: block !important;
          max-width: 100% !important;
        }

        [data-category-theme="instrumenty"] h1,
        [data-category-theme="instrumenty"] p {
          color: white !important;
          text-shadow: 0 2px 5px rgba(0,0,0,0.92), 0 0 2px rgba(0,0,0,0.75);
        }

        [data-category-theme="instrumenty"] h1 {
          max-width: 18rem !important;
        }

        [data-category-theme="instrumenty"] p {
          max-width: 32rem !important;
        }

        @media (max-width: 639px) {
          [data-category-theme="instrumenty"] {
            min-height: 420px;
            padding: 1rem !important;
            background-position: 62% center !important;
          }

          [data-category-theme="instrumenty"] h1 {
            max-width: 62% !important;
            font-size: 1.55rem !important;
            line-height: 1.1 !important;
          }

          [data-category-theme="instrumenty"] p {
            max-width: 62% !important;
            font-size: 0.76rem !important;
            line-height: 1.15rem !important;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child {
            position: absolute;
            left: 1rem;
            right: 1rem;
            bottom: 1rem;
            margin-top: 0 !important;
            display: flex !important;
            flex-flow: row wrap !important;
            gap: 0.5rem !important;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a {
            min-height: 2.25rem !important;
            height: 2.25rem !important;
            padding-left: 0.7rem !important;
            padding-right: 0.7rem !important;
            font-size: 0.7rem !important;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a svg {
            display: none !important;
          }
        }

        @media (min-width: 640px) {
          [data-category-theme="instrumenty"] {
            min-height: 390px;
            background-position: 56% 42% !important;
          }

          [data-category-theme="instrumenty"] > div:last-child {
            max-width: 54% !important;
          }
        }

        @media (min-width: 1024px) {
          [data-category-theme="instrumenty"] {
            min-height: 410px;
            background-position: center 44% !important;
          }

          [data-category-theme="instrumenty"] > div:last-child {
            max-width: 44% !important;
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
              description="Раздел для ручного, электрического, измерительного, строительного и садового инструмента, а также средств защиты для ремонта и работ на участке."
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
              <ListingResultsPanel categorySlug="instrumenty" listings={shouldShowFallbackContent() ? demoListings : []} />
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
