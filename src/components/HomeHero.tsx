import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, MapPinned, ShoppingBag, Sparkles, Store, UsersRound } from "lucide-react";

const heroCards = [
  { label: "Объявления", detail: "вещи, дом, авто", icon: ShoppingBag, className: "bg-blue-50 text-[#0875d1]" },
  { label: "Работа", detail: "вакансии и заказы", icon: BriefcaseBusiness, className: "bg-emerald-50 text-[#0a8f32]" },
  { label: "Мастера", detail: "услуги рядом", icon: UsersRound, className: "bg-amber-50 text-amber-700" },
];

export function HomeHero() {
  return (
    <section className="page-container py-6 sm:py-8 lg:py-10">
      <div className="overflow-hidden rounded-[28px] border border-blue-100 bg-[radial-gradient(circle_at_18%_18%,#e7f6ff_0,#ffffff_34%,#f2fff6_100%)] px-4 py-6 shadow-card sm:px-7 sm:py-8 lg:px-10 lg:py-12">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-black uppercase text-[#0a8f32] ring-1 ring-emerald-100">
              <Sparkles className="h-3.5 w-3.5" />
              Краснодарский край
            </div>
            <h1 className="mt-4 max-w-6xl text-3xl font-black leading-tight text-[#060b27] sm:text-5xl xl:whitespace-nowrap xl:text-[56px]">
              <span className="italic">БЛИЖНИЙ</span> — объявления, работа и услуги рядом
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

          <aside className="rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-xl shadow-slate-900/10 backdrop-blur">
            <div className="flex items-center gap-3 rounded-2xl bg-slate-950 p-4 text-white">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                <MapPinned className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase text-white/60">Региональная витрина</p>
                <p className="mt-1 text-lg font-black">Краснодарский край</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {heroCards.map((item) => {
                const Icon = item.icon;

                return (
                  <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.className}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-black text-[#060b27]">{item.label}</p>
                      <p className="text-sm text-slate-500">{item.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
