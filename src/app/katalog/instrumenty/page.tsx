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
          isolation: isolate;
          min-height: 410px;
          padding: 2rem !important;
          background-color: #302820 !important;
          background-image: url('/images/categories/tools.webp') !important;
          background-repeat: no-repeat !important;
          background-size: cover !important;
          background-position: center center !important;
        }

        [data-category-theme="instrumenty"]::before {
          content: none !important;
          display: none !important;
        }

        [data-category-theme="instrumenty"] > div:last-child {
          position: relative;
          z-index: 10;
          display: block !important;
          width: min(520px, 46%) !important;
          max-width: none !important;
        }

        [data-category-theme="instrumenty"] h1,
        [data-category-theme="instrumenty"] p {
          color: white !important;
          text-shadow: 0 2px 7px rgba(0, 0, 0, 0.9), 0 0 3px rgba(0, 0, 0, 0.7);
        }

        [data-category-theme="instrumenty"] h1 {
          max-width: none !important;
          font-size: clamp(2.35rem, 4vw, 3.8rem) !important;
          line-height: 0.98 !important;
          letter-spacing: -0.035em;
        }

        [data-category-theme="instrumenty"] p {
          margin-top: 1.25rem !important;
          max-width: 31rem !important;
          font-size: 1.08rem !important;
          line-height: 1.55 !important;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child {
          margin-top: 1.35rem !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: flex-start !important;
          gap: 0.65rem !important;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a {
          width: auto !important;
          min-width: 0 !important;
          min-height: 3.35rem !important;
          height: 3.35rem !important;
          justify-content: space-between !important;
          border-radius: 0.9rem !important;
          padding-left: 1.15rem !important;
          padding-right: 1.15rem !important;
          font-size: 0.96rem !important;
          box-shadow: 0 8px 18px rgba(0, 0, 0, 0.14) !important;
          white-space: nowrap;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a:first-child {
          width: 14.5rem !important;
          background: #eb2b1d !important;
          color: white !important;
          border-color: #eb2b1d !important;
        }

        [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a:last-child {
          width: 17rem !important;
          background: rgba(255, 255, 255, 0.97) !important;
          color: #c6251a !important;
          border: 2px solid #e77770 !important;
        }

        @media (max-width: 639px) {
          [data-category-theme="instrumenty"] {
            min-height: 405px;
            padding: 1rem !important;
            background-position: 64% center !important;
          }

          [data-category-theme="instrumenty"] > div:last-child {
            width: 74% !important;
            min-height: 373px;
          }

          [data-category-theme="instrumenty"] > div:last-child > div {
            display: flex !important;
            min-height: 373px;
            flex-direction: column !important;
          }

          [data-category-theme="instrumenty"] h1 {
            font-size: 1.65rem !important;
            line-height: 1.02 !important;
          }

          [data-category-theme="instrumenty"] p {
            margin-top: 0.75rem !important;
            max-width: 15rem !important;
            font-size: 0.74rem !important;
            line-height: 1.14rem !important;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child {
            position: static !important;
            width: auto !important;
            margin-top: auto !important;
            gap: 0.45rem !important;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a {
            min-height: 2.6rem !important;
            height: 2.6rem !important;
            padding-left: 0.8rem !important;
            padding-right: 0.8rem !important;
            border-radius: 0.75rem !important;
            font-size: 0.72rem !important;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a:first-child {
            width: 10.5rem !important;
          }

          [data-category-theme="instrumenty"] > div:last-child > div > div:last-child > a:last-child {
            width: 13.5rem !important;
          }
        }

        @media (min-width: 640px) and (max-width: 1023px) {
          [data-category-theme="instrumenty"] {
            min-height: 420px;
            background-position: 60% center !important;
          }

          [data-category-theme="instrumenty"] > div:last-child {
            width: 50% !important;
          }

          [data-category-theme="instrumenty"] h1 {
            font-size: 2.8rem !important;
          }
        }

        @media (min-width: 1024px) {
          [data-category-theme="instrumenty"] {
            min-height: 440px;
            background-position: center center !important;
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
