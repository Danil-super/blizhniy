import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Search, Sparkles, Store } from "lucide-react";

export function HomeHero() {
  return (
    <section className="page-container py-6 sm:py-8 lg:py-10">
      <div className="overflow-hidden rounded-[28px] border border-blue-100 bg-[radial-gradient(circle_at_18%_18%,#e7f6ff_0,#ffffff_34%,#f2fff6_100%)] px-4 py-6 shadow-card sm:px-7 sm:py-8 lg:px-10 lg:py-12">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-black uppercase text-[#0a8f32] ring-1 ring-emerald-100">
              <Sparkles className="h-3.5 w-3.5" />
              Краснодарский край
            </div>
            <h1 className="mt-4 max-w-4xl text-3xl font-black leading-tight text-[#060b27] sm:text-5xl lg:text-6xl">
              БЛИЖНИЙ — объявления, работа и услуги рядом
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              Платформа Краснодарского края для объявлений, вакансий, специалистов, услуг и Ярмарки мастеров.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
              <Link href="/blizhniy/sozdat" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-5 text-sm font-black text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e]">
                Разместить
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/blizhniy/rabota/specialisty" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-5 text-sm font-black text-[#0875d1] transition hover:border-[#0875d1]">
                <BriefcaseBusiness className="h-4 w-4" />
                Найти специалиста
              </Link>
              <Link href="/yarmarka-masterov" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]">
                <Store className="h-4 w-4" />
                Ярмарка мастеров
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/10 sm:p-5">
            <form action="/poisk" method="GET" className="flex h-12 items-center rounded-2xl border-2 border-[#00aaff] bg-white text-slate-500">
              <Search className="ml-4 h-5 w-5 shrink-0" />
              <input
                name="q"
                className="min-w-0 flex-1 border-0 bg-transparent px-3 text-base text-slate-900 outline-none placeholder:text-slate-400"
                placeholder="Что ищем: мебель, мастер, вакансия..."
              />
              <button type="submit" className="hidden h-full items-center rounded-r-[14px] bg-[#00aaff] px-5 text-sm font-black text-white transition hover:bg-[#0796dd] sm:flex">
                Найти
              </button>
            </form>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-bold text-slate-600">
              <span className="rounded-xl bg-blue-50 px-2 py-3 text-[#0875d1]">Объявления</span>
              <span className="rounded-xl bg-emerald-50 px-2 py-3 text-[#0a8f32]">Работа</span>
              <span className="rounded-xl bg-amber-50 px-2 py-3 text-amber-700">Мастера</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
