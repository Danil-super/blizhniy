import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Search, UserRound } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { listPublicDemoListings } from "@/components/listings/ListingPages";
import { categories, cities, professions, region } from "@/lib/data";
import { listFairApplications, listSpecialists, listVacancies, listWorkRequests } from "@/lib/mock-store";

type SearchResult = {
  title: string;
  description: string;
  href: string;
  type: "Объявление" | "Вакансия" | "Заказ" | "Специалист" | "Категория" | "Профессия" | "Ярмарка";
};

export const dynamic = "force-dynamic";

function normalize(value: string) {
  return value.toLowerCase().trim();
}

function includesQuery(values: Array<string | undefined>, query: string) {
  const normalizedQuery = normalize(query);
  return values.some((value) => normalize(value ?? "").includes(normalizedQuery));
}

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; city?: string }> }) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const selectedCity = cities.find((city) => city.slug === params.city);
  const cityName = selectedCity?.name;
  const matchesCity = (value?: string) => !cityName || value === cityName;

  const listingResults: SearchResult[] = listPublicDemoListings()
    .filter((listing) =>
      matchesCity(listing.city) &&
      (query
        ? includesQuery([listing.title, listing.description, listing.city, listing.categoryName, listing.subcategoryName, listing.kind], query)
        : true),
    )
    .map((listing) => ({
      title: listing.title,
      description: `${listing.categoryName}, ${listing.city}. ${listing.description}`,
      href: `/obyavlenie/${listing.slug}`,
      type: "Объявление",
    }));

  const vacancyResults: SearchResult[] = listVacancies()
    .filter(
      (vacancy) =>
        vacancy.status === "published" &&
        matchesCity(vacancy.city) &&
        (query ? includesQuery([vacancy.title, vacancy.organization, vacancy.profession, vacancy.city, vacancy.description], query) : true),
    )
    .map((vacancy) => ({
      title: vacancy.title,
      description: `${vacancy.organization}, ${vacancy.city}. ${vacancy.salary}`,
      href: `/vakansiya/${vacancy.id}`,
      type: "Вакансия",
    }));

  const specialistResults: SearchResult[] = listSpecialists()
    .filter(
      (specialist) =>
        specialist.status === "published" &&
        matchesCity(specialist.city) && (query ? includesQuery([specialist.name, specialist.profession, specialist.skills, specialist.city], query) : true),
    )
    .map((specialist) => ({
      title: `${specialist.name} - ${specialist.profession}`,
      description: `${specialist.city}. ${specialist.skills}. ${specialist.price}`,
      href: `/specialist/${specialist.id}`,
      type: "Специалист",
    }));

  const workRequestResults: SearchResult[] = listWorkRequests()
    .filter(
      (request) =>
        request.status === "published" &&
        matchesCity(request.city) && (query ? includesQuery([request.title, request.description, request.author, request.profession, request.city], query) : true),
    )
    .map((request) => ({
      title: request.title,
      description: `${request.author}, ${request.city}. ${request.budget}`,
      href: `/krasnodar/rabota/zakazy/${request.id}`,
      type: "Заказ",
    }));

  const fairResults: SearchResult[] = listFairApplications()
    .filter(
      (application) =>
        application.status === "published" &&
        matchesCity(application.city) &&
        (query ? includesQuery([application.participantName, application.category, application.description, application.city], query) : true),
    )
    .map((application) => ({
      title: application.participantName,
      description: `${application.category}, ${application.city}. ${application.description}`,
      href: "/yarmarka-masterov",
      type: "Ярмарка",
    }));

  const categoryResults: SearchResult[] = categories
    .filter((category) => (query ? includesQuery([category.name, ...category.children], query) : true))
    .map((category) => ({
      title: category.name,
      description: category.children.join(", "),
      href: category.slug === "rabota" ? "/krasnodar/rabota" : category.slug === "yarmarka-masterov" ? "/yarmarka-masterov" : `/krasnodar/${category.slug}`,
      type: "Категория",
    }));

  const professionResults: SearchResult[] = professions
    .filter((profession) => (query ? includesQuery([profession.name, profession.parent], query) : true))
    .map((profession) => ({
      title: profession.name,
      description: profession.parent,
      href: `/krasnodar/rabota/specialisty/${profession.slug}`,
      type: "Профессия",
    }));

  const results = [...listingResults, ...vacancyResults, ...workRequestResults, ...specialistResults, ...fairResults, ...categoryResults, ...professionResults].slice(0, 24);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <section>
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Поиск</p>
          <h1 className="mt-3 text-4xl font-black text-[#060b27]">{query ? `Результаты: ${query}` : "Все примеры на площадке"}</h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-600">
            Поиск работает по объявлениям, вакансиям, специалистам, категориям и классификатору профессий.
            Регион выдачи: {cityName ?? region.name}.
          </p>
        </section>

        <section className="mt-8 grid gap-4">
          {results.length ? (
            results.map((result) => (
              <Link
                key={`${result.type}-${result.href}`}
                href={result.href}
                className="group grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-card sm:grid-cols-[48px_1fr_auto] sm:items-center"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">
                  {result.type === "Вакансия" ? (
                    <BriefcaseBusiness className="h-5 w-5" />
                  ) : result.type === "Специалист" ? (
                    <UserRound className="h-5 w-5" />
                  ) : (
                    <Search className="h-5 w-5" />
                  )}
                </span>
                <span>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{result.type}</span>
                  <span className="mt-1 block text-xl font-black text-[#060b27]">{result.title}</span>
                  <span className="mt-2 block leading-6 text-slate-600">{result.description}</span>
                </span>
                <span className="inline-flex items-center gap-2 font-bold text-[#0875d1]">
                  Открыть
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </Link>
            ))
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
              <h2 className="text-2xl font-black text-[#060b27]">Ничего не найдено</h2>
              <p className="mt-3 leading-7 text-slate-600">Попробуйте запросы: сантехник, мебель, Краснодар, маникюр, работа.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
