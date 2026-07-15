import Link from "next/link";
import type { Metadata } from "next";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { categoryPageStyle, CategoryHeaderBand, SubcategoryCard, subcategoryGridClassName } from "@/components/listings/CategoryPageDesign";
import { ListingResultsPanel } from "@/components/listings/ListingResultsPanel";
import type { DemoListing } from "@/components/listings/ListingCard";
import { posudaSubcategories } from "@/lib/posuda-subcategories";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";

export const metadata: Metadata = {
  title: "Посуда",
  description: "Подкатегории посуды на БЛИЖНИЙ: кухонная, столовая, для напитков, хранения, подачи и прочая утварь.",
  alternates: {
    canonical: "/katalog/posuda",
  },
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

const demoListings = posudaSubcategories.map(posudaListing);

export default function PosudaCategoryPage() {
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
            <span>Посуда</span>
          </nav>
          <BackLink fallbackHref="/katalog" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад
          </BackLink>

          <div className="mt-3 grid gap-5">
            <CategoryHeaderBand
              categorySlug="posuda"
              createHref="/razmestit/obyavlenie?category=posuda&kind=prodam"
              description="Раздел для кухонной и столовой посуды, бокалов, кружек, контейнеров, приборов для подачи и полезной кухонной утвари."
              title="Посуда"
            />

            <section aria-label="Подкатегории">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <h2 className="text-lg font-bold leading-tight text-[#060b27]">Подкатегории</h2>
                <p className="text-sm font-semibold text-slate-500">Кухня, сервировка и хранение рядом</p>
              </div>
              <div className={subcategoryGridClassName(posudaSubcategories.length)}>
                {posudaSubcategories.map((subcategory) => (
                  <SubcategoryCard
                    createHref={`/razmestit/obyavlenie?category=posuda&kind=prodam&subcategory=${subcategory.slug}`}
                    description={subcategory.description}
                    href={`/katalog/posuda/${subcategory.slug}`}
                    items={subcategory.items}
                    key={subcategory.slug}
                    title={subcategory.name}
                    visualSlug="posuda"
                  />
                ))}
              </div>
            </section>

            <section id="listings" aria-label="Объявления категории">
              <ListingResultsPanel categorySlug="posuda" listings={shouldShowFallbackContent() ? demoListings : []} />
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
