import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { vacancies } from "@/lib/data";

export const metadata: Metadata = {
  title: "Вакансии в Краснодаре",
  description: "Каталог вакансий и заказчиков Краснодарского края на БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/rabota/vakansii",
  },
};

export default function VacanciesPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <h1 className="text-4xl font-black text-[#060b27]">Все вакансии</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Каталог вакансий и заказов с быстрым переходом к карточке и оплате отклика.</p>
        <div className="mt-6 grid gap-4">
          {vacancies.map((vacancy) => (
            <Link key={vacancy.id} href={`/blizhniy/vakansiya/${vacancy.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-card">
              <p className="text-sm text-slate-500">{vacancy.organization}</p>
              <h2 className="mt-1 text-xl font-black">{vacancy.title}</h2>
              <p className="mt-2 text-slate-600">
                {vacancy.city} · {vacancy.salary}
              </p>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
