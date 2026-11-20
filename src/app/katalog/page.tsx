import type { Metadata } from "next";
import { BackLink } from "@/components/BackLink";
import { CategoryGrid } from "@/components/CategoryGrid";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { Breadcrumbs } from "@/components/listings/Breadcrumbs";

export const metadata: Metadata = {
  title: "Каталог категорий",
  description: "Каталог категорий и подкатегорий объявлений на платформе БЛИЖНИЙ.",
  alternates: {
    canonical: "/katalog",
  },
};

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main>
        <HomeHero />
        <section className="page-container py-2 sm:py-3 lg:py-4">
          <Breadcrumbs items={[{ label: "Категории" }]} />
          <BackLink fallbackHref="/" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад
          </BackLink>
          <h1 className="mt-3 text-xl font-bold leading-tight text-[#060b27] sm:text-2xl lg:text-3xl">Категории объявлений</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7 lg:mt-4 lg:text-lg lg:leading-8">
            Первый уровень каталога и подкатегории отображаются плитками. Структура готова для расширения по городам и регионам.
          </p>
        </section>
        <CategoryGrid variant="grid" />
      </main>
    </>
  );
}
