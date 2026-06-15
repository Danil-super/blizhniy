import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BadgePlus, ChevronRight, ClipboardList, MapPin, ShieldCheck } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { SubcategoryShareButton } from "@/components/listings/SubcategoryShareButton";
import { posudaSubcategories } from "@/lib/posuda-subcategories";

export const metadata: Metadata = {
  title: "Посуда",
  description: "Подкатегории посуды на БЛИЖНИЙ: кухонная, столовая, для напитков, хранения, подачи и прочая утварь.",
  alternates: {
    canonical: "/katalog/posuda",
  },
};

export default function PosudaCategoryPage() {
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
          <span>Посуда</span>
        </nav>
        <BackLink fallbackHref="/katalog" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>

        <section className="mt-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black leading-tight text-[#060b27] sm:text-3xl lg:text-4xl">Посуда</h1>
              <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">
                Раздел для кухонной и столовой посуды, бокалов, кружек, контейнеров, приборов для подачи и полезной кухонной утвари.
              </p>
            </div>
            <Link
              href="/razmestit/obyavlenie?category=posuda&kind=prodam"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:px-5 lg:h-12 lg:px-6 lg:text-base"
            >
              Разместить
              <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {posudaSubcategories.map((subcategory) => {
              const href = `/katalog/posuda/${subcategory.slug}`;
              const createHref = `/razmestit/obyavlenie?category=posuda&kind=prodam&subcategory=${subcategory.slug}`;

              return (
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
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Link
                      href={href}
                      className="inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-blue-100 text-[#0875d1] transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0664b3]"
                      aria-label={`Открыть объявления: ${subcategory.name}`}
                      title="Объявления"
                    >
                      <ClipboardList className="h-5 w-5 shrink-0" />
                    </Link>
                    <Link
                      href={createHref}
                      className="inline-flex h-9 min-w-0 items-center justify-center rounded-lg bg-[#0aa337] text-white transition hover:bg-[#078a2e]"
                      aria-label={`Разместить объявление: ${subcategory.name}`}
                      title="Разместить"
                    >
                      <BadgePlus className="h-5 w-5 shrink-0" />
                    </Link>
                    <SubcategoryShareButton href={href} title={subcategory.name} />
                  </div>
                </details>
              );
            })}
          </div>

          <section className="mt-7">
            <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Тестовые объявления</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {posudaSubcategories.map((subcategory) => (
                <Link
                  key={subcategory.slug}
                  href={`/katalog/posuda/${subcategory.slug}`}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-card"
                >
                  <div className="flex min-h-24 items-center justify-center bg-gradient-to-br from-amber-50 via-white to-blue-50 p-4 text-4xl">🍽️</div>
                  <div className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-[#0875d1]">{subcategory.name}</span>
                      <span className="rounded-lg bg-emerald-50 px-2 py-1 text-sm font-black text-[#0a8f32]">{subcategory.demoListing.price}</span>
                    </div>
                    <h3 className="mt-3 text-base font-black leading-5 text-[#060b27] group-hover:text-[#0875d1]">{subcategory.demoListing.title}</h3>
                    <p className="mt-2 line-clamp-2 text-sm font-medium leading-6 text-slate-600">{subcategory.demoListing.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1">
                        <MapPin className="h-3.5 w-3.5 text-[#0875d1]" />
                        Краснодар
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-[#0a8f32]" />
                        Опубликовано
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </section>
      </main>
    </>
  );
}
