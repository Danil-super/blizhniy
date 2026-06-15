import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ChevronRight } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { instrumentSubcategories } from "@/lib/instrument-subcategories";

export const metadata: Metadata = {
  title: "Инструменты",
  description: "Подкатегории инструментов на БЛИЖНИЙ: ручной инструмент, электроинструмент, измерительный инструмент, строительный и садовый инструмент.",
  alternates: {
    canonical: "/katalog/instrumenty",
  },
};

export default function InstrumentsCategoryPage() {
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
          <span>Инструменты</span>
        </nav>
        <BackLink fallbackHref="/katalog" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>

        <section className="mt-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black leading-tight text-[#060b27] sm:text-3xl lg:text-4xl">Инструменты</h1>
              <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">
                Раздел для ручного, электрического, измерительного, строительного и садового инструмента, а также средств защиты для ремонта и работ на участке.
              </p>
            </div>
            <Link
              href="/razmestit/obyavlenie?category=instrumenty&kind=prodam"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:px-5 lg:h-12 lg:px-6 lg:text-base"
            >
              Разместить
              <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {instrumentSubcategories.map((subcategory) => (
              <details key={subcategory.slug} className="group min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition open:border-blue-200 sm:p-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                  <span className="block break-words text-sm font-bold leading-5 text-slate-800 [overflow-wrap:anywhere] sm:text-[15px]">{subcategory.name}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-90 group-open:text-[#0875d1]" />
                </summary>
                <p className="mt-2 break-words text-xs font-medium leading-5 text-slate-600 [overflow-wrap:anywhere] sm:text-sm">{subcategory.description}</p>
                <ul className="mt-2 grid gap-1.5 text-xs font-medium leading-5 text-slate-600 sm:text-sm">
                  {subcategory.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0875d1]" />
                      <span className="break-words [overflow-wrap:anywhere]">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link
                    href={`/katalog/instrumenty/${subcategory.slug}`}
                    className="inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-blue-100 px-2 text-xs font-bold text-[#0875d1] transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0664b3] sm:text-sm"
                  >
                    Объявления
                  </Link>
                  <Link
                    href={`/razmestit/obyavlenie?category=instrumenty&kind=prodam&subcategory=${subcategory.slug}`}
                    className="inline-flex h-9 min-w-0 items-center justify-center rounded-lg bg-[#0aa337] px-2 text-xs font-bold text-white transition hover:bg-[#078a2e] sm:text-sm"
                  >
                    Разместить
                  </Link>
                </div>
              </details>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
