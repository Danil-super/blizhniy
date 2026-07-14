import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { categoryPageStyle, CategoryHeaderBand } from "@/components/listings/CategoryPageDesign";
import { ListingResultsPanel } from "@/components/listings/ListingResultsPanel";
import type { DemoListing } from "@/components/listings/ListingCard";
import { instrumentSubcategories } from "@/lib/instrument-subcategories";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";

type PageProps = {
  params: Promise<{ subcategorySlug: string }>;
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { subcategorySlug } = await params;
  const subcategory = instrumentSubcategories.find((item) => item.slug === subcategorySlug);

  return {
    title: subcategory ? `${subcategory.name} — Инструменты` : "Инструменты",
    description: subcategory ? `${subcategory.description} Объявления в подкатегории ${subcategory.name}.` : "Объявления раздела Инструменты.",
    alternates: {
      canonical: `/katalog/instrumenty/${subcategorySlug}`,
    },
  };
}

export default async function InstrumentSubcategoryPage({ params }: PageProps) {
  const { subcategorySlug } = await params;
  const subcategoryIndex = instrumentSubcategories.findIndex((item) => item.slug === subcategorySlug);
  const subcategory = instrumentSubcategories[subcategoryIndex];

  if (!subcategory) {
    notFound();
  }

  const listings = shouldShowFallbackContent() ? [instrumentListing(subcategory, subcategoryIndex)] : [];

  return (
    <>
      <SiteHeader />
      <HomeHero />
      <main className="bg-[var(--category-page)] pb-8" style={categoryPageStyle("instrumenty")}>
        <div className="page-container py-3 sm:py-4 lg:py-5">
          <nav className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:text-sm" aria-label="Хлебные крошки">
            <Link href="/katalog" className="hover:text-[#0875d1]">
              Категории
            </Link>
            <span>/</span>
            <Link href="/katalog/instrumenty" className="hover:text-[#0875d1]">
              Инструменты
            </Link>
            <span>/</span>
            <span>{subcategory.name}</span>
          </nav>
          <BackLink fallbackHref="/katalog/instrumenty" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад
          </BackLink>

          <div className="mt-3 grid gap-5">
            <CategoryHeaderBand
              categorySlug="instrumenty"
              createHref={`/razmestit/obyavlenie?category=instrumenty&kind=prodam&subcategory=${subcategory.slug}`}
              description={subcategory.description}
              title={subcategory.name}
            />
            <section id="listings" aria-label="Объявления подкатегории">
              <ListingResultsPanel categorySlug="instrumenty" listings={listings} subcategorySlug={subcategory.slug} />
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
