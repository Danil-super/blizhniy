import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Grid3X3, Search, Sparkles } from "lucide-react";

function BrandName() {
  return <span className="italic">БЛИЖНИЙ</span>;
}

export function HomeHero() {
  return (
    <section className="page-container py-3 sm:py-6">
      <div className="overflow-hidden rounded-3xl border border-blue-100 bg-[radial-gradient(circle_at_12%_12%,#e7f6ff_0,#ffffff_38%,#f2fff6_100%)] px-4 py-4 shadow-card sm:px-6 sm:py-7 lg:px-8">
        <div className="max-w-5xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-black uppercase text-[#0a8f32] ring-1 ring-emerald-100">
            <Sparkles className="h-3.5 w-3.5" />
            Краснодарский край
          </div>
          <h1 className="mt-3 max-w-5xl text-2xl font-black leading-tight text-[#060b27] sm:mt-4 sm:text-4xl lg:text-5xl xl:text-[52px]">
            <BrandName /> — объявления, работа и услуги рядом
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-lg sm:leading-8">
            Локальная платформа Краснодарского края: товары, услуги, специалисты, вакансии и частные заказы рядом с вами.
          </p>
          <form action="/poisk" method="GET" className="mt-4 flex h-12 max-w-3xl items-center rounded-2xl border border-blue-100 bg-white p-1.5 shadow-sm sm:mt-5 sm:h-14 sm:p-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 px-2 sm:px-3" aria-label="Поиск по объявлениям">
              <Search className="h-4 w-4 shrink-0 text-slate-400 sm:h-5 sm:w-5" />
              <input
                name="q"
                type="search"
                placeholder="Что ищем: мебель, мастер, вакансия..."
                className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 sm:text-base"
              />
            </label>
            <button type="submit" className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl bg-[#0875d1] px-4 text-sm font-black text-white transition hover:bg-[#0664b3] sm:h-10 sm:px-6">
              Найти
            </button>
          </form>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:flex sm:flex-wrap sm:gap-3">
            <Link href="/blizhniy/sozdat" className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-[#0aa337] px-2 text-xs font-black text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:gap-2 sm:px-5 sm:text-sm">
              Разместить
              <ArrowRight className="hidden h-4 w-4 sm:block" />
            </Link>
            <Link href="/blizhniy/kategorii" className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-blue-200 bg-white px-2 text-xs font-black text-[#0875d1] transition hover:border-[#0875d1] sm:h-11 sm:gap-2 sm:px-5 sm:text-sm">
              <Grid3X3 className="h-4 w-4" />
              Каталог
            </Link>
            <Link href="/blizhniy/rabota" className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-xs font-black text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1] sm:h-11 sm:gap-2 sm:px-5 sm:text-sm">
              <BriefcaseBusiness className="h-4 w-4" />
              Работа
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
