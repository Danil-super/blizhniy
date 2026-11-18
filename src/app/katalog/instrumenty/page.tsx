import Link from "next/link";
import type { Metadata } from "next";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { CategoryHeaderBand, SubcategoryCard, subcategoryGridClassName } from "@/components/listings/CategoryPageDesign";
import { CatalogSeoContent } from "@/components/listings/CatalogSeoContent";
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
    alternates: { canonical: "/katalog/instrumenty" },
    robots: page > 1 ? { index: false, follow: true } : undefined,
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
      <main data-category-index="" className="bg-[var(--category-page)] pb-8" data-category-colors="instrumenty">
        <div className="page-container py-3 sm:py-4 lg:py-5">
          <nav className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600 sm:text-sm" aria-label="Хлебные крошки">
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
                <p className="text-sm font-semibold text-slate-600">Инструменты для ремонта, стройки и участка</p>
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
            <CatalogSeoContent categoryName="Инструменты" categoryPath="/katalog/instrumenty" description="Раздел с ручным, электрическим, измерительным, строительным и садовым инструментом для ремонта, стройки и участка." relatedSections={instrumentSubcategories.map((subcategory) => ({ href: `/katalog/instrumenty/${subcategory.slug}`, label: subcategory.name }))} />
          </div>
        </div>
      </main>
    </>
  );
}
