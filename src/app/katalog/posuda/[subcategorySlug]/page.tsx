import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { categoryPageStyle, CategoryHeaderBand } from "@/components/listings/CategoryPageDesign";
import { ListingResultsPanel } from "@/components/listings/ListingResultsPanel";
import type { DemoListing } from "@/components/listings/ListingCard";
import { posudaSubcategories } from "@/lib/posuda-subcategories";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";

type PageProps = {
  params: Promise<{ subcategorySlug: string }>;
};

function posudaListing(subcategory: (typeof posudaSubcategories)[number], index: number): DemoListing {
  return {
    slug: `posuda-${subcategory.slug}`,
    title: subcategory.demoListing.title,
    kind: "prodam",
    categorySlug: "posuda",
    categoryName: "Посуда",
    subcategorySlug: subcategory.slug,
    subcategoryName: subcategory.name,
    city: "Краснодар",
    district: ["Центр", "Фестивальный", "Юбилейный", "Черёмушки", "Гидрострой", "Прикубанский"][index] ?? "Краснодар",
    lat: 45.037 + index * 0.006,
    lng: 38.975 + index * 0.004,
    showExactAddress: false,
    price: subcategory.demoListing.price,
    description: subcategory.demoListing.description,
    phone: `+78610004${String(index + 1).padStart(3, "0")}`,
    messengerUrl: "https://t.me/blizhniy_support",
    status: "published",
    paid: true,
    createdAt: "15 июня 2026",
    publishedAt: "15 июня 2026",
    expiresAt: "15 июля 2026",
    imageTone: index % 2 === 0 ? "amber" : "rose",
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { subcategorySlug } = await params;
  const subcategory = posudaSubcategories.find((item) => item.slug === subcategorySlug);

  return {
    title: subcategory ? `${subcategory.name} — Посуда` : "Посуда",
    description: subcategory ? `${subcategory.description} Объявления в подкатегории ${subcategory.name}.` : "Объявления раздела Посуда.",
    alternates: {
      canonical: `/katalog/posuda/${subcategorySlug}`,
    },
  };
}

export default async function PosudaSubcategoryPage({ params }: PageProps) {
  const { subcategorySlug } = await params;
  const subcategoryIndex = posudaSubcategories.findIndex((item) => item.slug === subcategorySlug);
  const subcategory = posudaSubcategories[subcategoryIndex];

  if (!subcategory) {
    notFound();
  }

  const listings = shouldShowFallbackContent() ? [posudaListing(subcategory, subcategoryIndex)] : [];

  return (
    <>
      <SiteHeader />
      <HomeHero />
      <main className="bg-[var(--category-page)] pb-8" style={categoryPageStyle("posuda")}>
        <div className="page-container py-3 sm:py-4 lg:py-5">
          <nav className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:text-sm" aria-label="Хлебные крошки">
            <Link href="/katalog" className="hover:text-[#0875d1]">
              Категории
            </Link>
            <span>/</span>
            <Link href="/katalog/posuda" className="hover:text-[#0875d1]">
              Посуда
            </Link>
            <span>/</span>
            <span>{subcategory.name}</span>
          </nav>
          <BackLink fallbackHref="/katalog/posuda" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад
          </BackLink>

          <div className="mt-3 grid gap-5">
            <CategoryHeaderBand
              categorySlug="posuda"
              createHref={`/razmestit/obyavlenie?category=posuda&kind=prodam&subcategory=${subcategory.slug}`}
              description={subcategory.description}
              title={subcategory.name}
            />
            <section id="listings" aria-label="Объявления подкатегории">
              <ListingResultsPanel categorySlug="posuda" listings={listings} subcategorySlug={subcategory.slug} />
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
