import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
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
      <main className="page-container py-2 sm:py-3 lg:py-4">
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

        <section className="mt-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black leading-tight text-[#060b27] sm:text-3xl lg:text-4xl">{subcategory.name}</h1>
              <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">{subcategory.description}</p>
            </div>
            <Link
              href={`/razmestit/obyavlenie?category=posuda&kind=prodam&subcategory=${subcategory.slug}`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:px-5 lg:h-12 lg:px-6 lg:text-base"
            >
              Разместить
              <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </Link>
          </div>

          <ListingResultsPanel categorySlug="posuda" listings={listings} subcategorySlug={subcategory.slug} />
        </section>
      </main>
    </>
  );
}
