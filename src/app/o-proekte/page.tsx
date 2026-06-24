import Link from "next/link";
import { MapPinned, Search, UsersRound } from "lucide-react";
import { BrandName } from "@/components/BrandName";
import { SiteHeader } from "@/components/SiteHeader";

const points = [
  {
    title: "Первый регион запуска",
    icon: MapPinned,
    text: (
      <>
        <BrandName /> начинает работу с Краснодарского края, чтобы отточить сценарии поиска, публикации и связи рядом с пользователем.
      </>
    ),
  },
  {
    title: "Быстрый поиск рядом",
    icon: Search,
    text: "Пользователь видит город, район, категорию и контакты, чтобы быстрее перейти от поиска к договоренности в своем регионе.",
  },
  {
    title: "Региональные витрины",
    icon: UsersRound,
    text: "Архитектура предполагает расширение на другие регионы с отдельными витринами объявлений, специалистов, вакансий и заказов.",
  },
];

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-8 sm:py-12">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">О проекте</p>
            <h1 className="mt-3 text-2xl font-bold leading-tight text-[#060b27] sm:text-4xl">
              <BrandName />: все рядом, регион за регионом
            </h1>
            <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              <BrandName /> запускается с Краснодарского края как первого региона, где жители и организации находят объявления, работу, исполнителей, услуги и частные заказы рядом с собой.
            </p>
            <p className="mt-4 text-base leading-7 text-slate-600">
              Проект не ограничивается одним краем: архитектура предполагает расширение на другие регионы, а региональные витрины позволят отдельно показывать объявления, специалистов, вакансии и заказы по каждому региону.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/" className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-5 text-sm font-bold text-white">
                Открыть платформу
              </Link>
              <Link href="/kak-rabotaet" className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800">
                Как работает
              </Link>
            </div>
          </div>
          <aside className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-card sm:p-6">
            <h2 className="text-xl font-bold text-[#060b27]">Масштабирование</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              Текущая версия показывает первый регион запуска и ключевые пользовательские сценарии. Следующие регионы можно подключать поэтапно, сохраняя идею локальной витрины.
            </p>
          </aside>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {points.map((point) => {
            const Icon = point.icon;

            return (
              <article key={point.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
                <Icon className="h-6 w-6 text-[#0aa337]" />
                <h2 className="mt-4 text-xl font-bold text-[#060b27]">{point.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{point.text}</p>
              </article>
            );
          })}
        </section>
      </main>
    </>
  );
}
