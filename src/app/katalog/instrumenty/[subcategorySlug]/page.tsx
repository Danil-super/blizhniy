import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, MapPin, MessageCircle, ShieldCheck } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { instrumentSubcategories } from "@/lib/instrument-subcategories";

type PageProps = {
  params: Promise<{ subcategorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { subcategorySlug } = await params;
  const subcategory = instrumentSubcategories.find((item) => item.slug === subcategorySlug);

  return {
    title: subcategory ? `${subcategory.name} — Инструменты` : "Инструменты",
    description: subcategory ? `${subcategory.description} Тестовое объявление в подкатегории ${subcategory.name}.` : "Объявления раздела Инструменты.",
    alternates: {
      canonical: `/katalog/instrumenty/${subcategorySlug}`,
    },
  };
}

export default async function InstrumentSubcategoryPage({ params }: PageProps) {
  const { subcategorySlug } = await params;
  const subcategory = instrumentSubcategories.find((item) => item.slug === subcategorySlug);

  if (!subcategory) {
    notFound();
  }

  const listing = subcategory.demoListing;

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
          <Link href="/katalog/instrumenty" className="hover:text-[#0875d1]">
            Инструменты
          </Link>
          <span>/</span>
          <span>{subcategory.name}</span>
        </nav>
        <BackLink fallbackHref="/katalog/instrumenty" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>

        <section className="mt-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black leading-tight text-[#060b27] sm:text-3xl lg:text-4xl">{subcategory.name}</h1>
              <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">{subcategory.description}</p>
            </div>
            <Link
              href={`/razmestit/obyavlenie?category=instrumenty&kind=prodam&subcategory=${subcategory.slug}`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:px-5 lg:h-12 lg:px-6 lg:text-base"
            >
              Разместить
              <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </Link>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex min-h-44 items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 p-6">
                <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white text-4xl shadow-sm ring-1 ring-slate-100">🛠️</div>
              </div>
              <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-[#0875d1]">Тестовое объявление</span>
                    <h2 className="mt-3 text-xl font-black leading-tight text-[#060b27] sm:text-2xl">{listing.title}</h2>
                  </div>
                  <p className="rounded-xl bg-emerald-50 px-3 py-2 text-lg font-black text-[#0a8f32]">{listing.price}</p>
                </div>
                <p className="mt-3 text-sm font-medium leading-6 text-slate-600 sm:text-base">{listing.description}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-sm font-bold text-slate-600">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-3 py-1">
                    <MapPin className="h-4 w-4 text-[#0875d1]" />
                    Краснодар
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-3 py-1">
                    <ShieldCheck className="h-4 w-4 text-[#0a8f32]" />
                    Опубликовано
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-3 py-1">
                    <MessageCircle className="h-4 w-4 text-[#0875d1]" />
                    Связь в объявлении
                  </span>
                </div>
              </div>
            </article>

            <aside className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 shadow-sm">
              <h2 className="text-lg font-black text-[#060b27]">Что входит в подкатегорию</h2>
              <ul className="mt-3 grid gap-2 text-sm font-semibold leading-6 text-slate-700">
                {subcategory.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0875d1]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>
      </main>
    </>
  );
}
