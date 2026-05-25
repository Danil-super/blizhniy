import Link from "next/link";
import { ArrowRight, ShieldCheck, WalletCards } from "lucide-react";
import { CategoryGrid } from "@/components/CategoryGrid";
import { SiteHeader } from "@/components/SiteHeader";
import { cities, tariffs } from "@/lib/data";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="page-container grid gap-10 py-12 lg:grid-cols-[1fr_440px] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Краснодарский край</p>
            <h1 className="mt-3 max-w-4xl text-5xl font-black leading-tight text-[#060b27] sm:text-6xl">
              Объявления, вакансии и специалисты рядом
            </h1>
            <p className="mt-5 max-w-2xl text-xl leading-8 text-slate-600">
              MVP платформы «БЛИЖНИЙ»: ресейл, работа, анкеты исполнителей, региональная структура и подготовка к платным публикациям.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/blizhniy/rabota"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0875d1] px-7 font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-[#0765b2]"
              >
                Открыть раздел работы
                <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                href="/blizhniy/prodam"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-7 font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]"
              >
                Смотреть объявления
              </Link>
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <h2 className="text-2xl font-black text-[#060b27]">Заложено в архитектуру</h2>
            <div className="mt-5 space-y-4">
              <div className="flex gap-3">
                <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-[#0aa337]" />
                <div>
                  <p className="font-bold">Статусы публикаций</p>
                  <p className="text-sm leading-6 text-slate-600">draft, pending_payment, paid, published, archive, expired.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <WalletCards className="mt-1 h-6 w-6 shrink-0 text-[#0875d1]" />
                <div>
                  <p className="font-bold">Mock-платежи</p>
                  <p className="text-sm leading-6 text-slate-600">
                    Тарифы вынесены в данные и SQL-схему: {tariffs.map((tariff) => `${tariff.name} ${tariff.price} ₽`).join(", ")}.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-6 rounded-xl bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-700">Города старта</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{cities.map((city) => city.name).join(", ")}</p>
            </div>
          </aside>
        </section>
        <CategoryGrid />
      </main>
    </>
  );
}
