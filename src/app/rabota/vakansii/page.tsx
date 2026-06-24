import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { VacancyGridCard } from "@/components/VacancyGridCard";
import { listStoredVacancies, listVacanciesWithStored } from "@/lib/vacancy-store";

export const metadata: Metadata = {
  title: "Вакансии",
  description: "Каталог вакансий и заказчиков на БЛИЖНИЙ.",
};

export const dynamic = "force-dynamic";

export default async function Page() {
  const storedVacancies = await listStoredVacancies(100);
  const vacancies = listVacanciesWithStored(storedVacancies).filter((vacancy) => vacancy.status === "published");

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Link href="/rabota" className="text-sm font-bold text-[#0875d1]">Назад к работе</Link>
        <h1 className="mt-3 text-3xl font-bold text-[#060b27]">Все вакансии</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Каталог вакансий и заказов с быстрым переходом к карточке и оплате отклика.</p>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {vacancies.map((vacancy) => (
            <VacancyGridCard key={vacancy.id} vacancy={vacancy} />
          ))}
        </div>
      </main>
    </>
  );
}
