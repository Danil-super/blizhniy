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
          position: relative;
          min-height: 0 !important;
          height: auto !important;
          aspect-ratio: 4 / 5;
          padding: 0 !important;
          border-color: transparent !important;
          background-color: transparent !important;
          background-image: url('/images/categories/tools-hero-mobile-v4.webp') !important;
          background-repeat: no-repeat !important;
          background-size: contain !important;
          background-position: center center !important;
          box-shadow: none !important;
        }

        [data-category-theme="instrumenty"]::before,
        [data-category-theme="instrumenty"]::after {
          content: none !important;
          display: none !important;
        }

        [data-category-theme="instrumenty"] > div:last-child {
          position: absolute !important;
          inset: 0 !important;
          z-index: 10;
          display: block !important;
          width: 100% !important;
          max-width: none !important;
          min-height: 0 !important;
          pointer-events: none;
        }

        [data-category-theme="instrumenty"] > div:last-child > div {
          position: absolute !important;
          inset: 0 !important;
          min-height: 0 !important;
        }

        [data-category-theme="instrumenty"] h1,
        [data-category-theme="instrumenty"] p {
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          padding: 0 !important;
          margin: -1px !important;
          overflow: hidden !important;
          clip: rect(0, 0, 0, 0) !important;
          white-space: nowrap !important;
          border: 0 !important;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child {
          position: absolute !important;
          inset: 0 !important;
          display: block !important;
          margin: 0 !important;
          pointer-events: none;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a {
          position: absolute !important;
          z-index: 20;
          min-width: 0 !important;
          min-height: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          color: transparent !important;
          opacity: 0.001 !important;
          pointer-events: auto;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a:first-child {
          left: 5.8% !important;
          top: 42.1% !important;
          width: 31.8% !important;
          height: 6.8% !important;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a:last-child {
          left: 5.8% !important;
          top: 49.6% !important;
          width: 31.8% !important;
          height: 6.5% !important;
        }

        @media (min-width: 640px) {
          [data-category-theme="instrumenty"] {
            aspect-ratio: 3 / 2;
            background-image: url('/images/categories/tools-hero-desktop-v4.webp') !important;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a:first-child {
            left: 5.3% !important;
            top: 51.0% !important;
            width: 25.5% !important;
            height: 9.2% !important;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a:last-child {
            left: 5.3% !important;
            top: 61.2% !important;
            width: 25.5% !important;
            height: 9.0% !important;
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
              <ListingResultsPanel categorySlug="instrumenty" listings={shouldShowFallbackContent() ? demoListings : []} />
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
