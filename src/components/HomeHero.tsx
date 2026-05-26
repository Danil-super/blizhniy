import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Sparkles, Store } from "lucide-react";

export function HomeHero() {
  return (
    <section className="page-container py-6 sm:py-8 lg:py-10">
      <div className="overflow-hidden rounded-[28px] border border-blue-100 bg-[radial-gradient(circle_at_18%_18%,#e7f6ff_0,#ffffff_34%,#f2fff6_100%)] px-4 py-6 shadow-card sm:px-7 sm:py-8 lg:px-10 lg:py-12">
        <div className="max-w-5xl">
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
      </div>
    </section>
  );
}
