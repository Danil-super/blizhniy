import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { SiteHeader } from "@/components/SiteHeader";
import { ListingPagination } from "@/components/listings/ListingPagination";
import { parseListingPage } from "@/components/listings/ListingPages";
import { VacancyGridCard } from "@/components/VacancyGridCard";
import { listStoredVacancies, listVacanciesWithStored } from "@/lib/vacancy-store";

type PageProps = { searchParams?: Promise<{ page?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const page = parseListingPage((await searchParams)?.page);
  return {
    alternates: { canonical: page > 1 ? `/rabota/vakansii?page=${page}` : "/rabota/vakansii" },
    title: "Вакансии",
    description: "Каталог вакансий и заказчиков на БЛИЖНИЙ.",
  };
}

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: PageProps) {
  const page = parseListingPage((await searchParams)?.page);
  const pageSize = 24;
  const storedVacancies = await listStoredVacancies(pageSize + 1, (page - 1) * pageSize);
  if (page > 1 && !storedVacancies.length) notFound();
  const vacancies = (page === 1 ? listVacanciesWithStored(storedVacancies) : storedVacancies)
    .filter((vacancy) => vacancy.status === "published").slice(0, pageSize);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <BackLink fallbackHref="/rabota">Назад к работе</BackLink>
        <h1 className="mt-3 text-2xl font-bold text-[#060b27] sm:text-3xl">Все вакансии</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Каталог вакансий и заказов с быстрым переходом к карточке и оплате отклика.</p>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {vacancies.map((vacancy) => (
            <VacancyGridCard key={vacancy.id} vacancy={vacancy} />
          ))}
        </div>
        <ListingPagination baseHref="/rabota/vakansii" hasMore={storedVacancies.length > pageSize} page={page} label="Страницы вакансий" />
      </main>
    </>
  );
}
