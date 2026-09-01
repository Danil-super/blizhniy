import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search, UserRound } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { VacancyThumbnail } from "@/components/VacancyMedia";
import { listPublicDemoListings, toDemoListing } from "@/components/listings/ListingPages";
import { getPublicCategories } from "@/lib/category-store";
import { cities, professions, region } from "@/lib/data";
import { listFairApplications, listSpecialists, listWorkRequests } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { listSpecialistsWithStored, listStoredSpecialistProfiles } from "@/lib/specialist-profile-store";
import { listStoredFairApplications } from "@/lib/fair-application-store";
import { listStoredVacancies, listVacanciesWithStored } from "@/lib/vacancy-store";
import { listStoredWorkRequests, listWorkRequestsWithStored } from "@/lib/work-request-store";
import { listStoredListings } from "@/lib/listing-store";

type SearchResult = {
  title: string;
  description: string;
  href: string;
  images?: string[];
  type: "Объявление" | "Вакансия" | "Заказ" | "Специалист" | "Категория" | "Профессия" | "Ярмарка";
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Поиск",
  robots: {
    index: false,
    follow: true,
  },
};

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
  const storedVacancies = await listStoredVacancies(100);
  const vacancies = listVacanciesWithStored(storedVacancies);
  const fallbackEnabled = shouldShowFallbackContent();
  const storedListings = (await listStoredListings()).map((listing) => ({ ...toDemoListing(listing), images: listing.images }));
  const publicListings = Array.from(
    new Map([...storedListings, ...(fallbackEnabled ? listPublicDemoListings() : [])].map((listing) => [listing.slug, listing])).values(),
  );
  const storedSpecialists = await listStoredSpecialistProfiles(100);
  const specialists = listSpecialistsWithStored(storedSpecialists, fallbackEnabled ? listSpecialists() : []);
  const storedWorkRequests = await listStoredWorkRequests(100);
  const workRequests = listWorkRequestsWithStored(storedWorkRequests.length ? storedWorkRequests : fallbackEnabled ? listWorkRequests() : []);
  const fairApplications = fallbackEnabled ? listFairApplications() : await listStoredFairApplications("published");
  const categories = await getPublicCategories();

  const listingResults: SearchResult[] = publicListings
    .filter((listing) =>
      listing.status === "published" &&
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

  const vacancyResults: SearchResult[] = vacancies
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
      images: vacancy.images,
      type: "Вакансия",
    }));

  const specialistResults: SearchResult[] = specialists
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

  const workRequestResults: SearchResult[] = workRequests
    .filter(
      (request) =>
        request.status === "published" &&
        matchesCity(request.city) && (query ? includesQuery([request.title, request.description, request.author, request.profession, request.city], query) : true),
    )
    .map((request) => ({
      title: request.title,
      description: `${request.author}, ${request.city}. ${request.budget}`,
      href: `/rabota/zakazy/${request.id}`,
      type: "Заказ",
    }));

  const fairResults: SearchResult[] = fairApplications
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
      href: category.slug === "rabota" ? "/rabota" : category.slug === "yarmarka-masterov" ? "/yarmarka-masterov" : `/katalog/${category.slug}`,
      type: "Категория",
    }));

  const professionResults: SearchResult[] = professions
    .filter((profession) => (query ? includesQuery([profession.name, profession.parent], query) : true))
    .map((profession) => ({
      title: profession.name,
      description: profession.parent,
      href: `/rabota/specialisty/${profession.slug}`,
      type: "Профессия",
    }));

  const results = [...listingResults, ...vacancyResults, ...workRequestResults, ...specialistResults, ...fairResults, ...categoryResults, ...professionResults].slice(0, 24);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-6 sm:py-10">
        <section>
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Поиск</p>
          <h1 className="mt-2 text-2xl font-bold text-[#060b27] sm:mt-3 sm:text-3xl">{query ? `Результаты: ${query}` : "Поиск по площадке"}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">
            Поиск работает по объявлениям, вакансиям, специалистам, категориям и классификатору профессий.
            Регион выдачи: {cityName ?? region.name}.
          </p>
        </section>

        <section className="mt-5 grid gap-2.5 sm:mt-8 sm:gap-4">
          {results.length ? (
            results.map((result, index) => (
              <Link
                key={`${result.type}-${result.href}-${result.title}-${index}`}
                href={result.href}
                className="group grid grid-cols-[40px_minmax(0,1fr)] gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-blue-200 hover:shadow-card sm:grid-cols-[48px_1fr_auto] sm:items-center sm:gap-4 sm:p-5"
              >
                {result.type === "Вакансия" ? (
                  <VacancyThumbnail images={result.images} title={result.title} />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1] sm:h-12 sm:w-12">
                    {result.type === "Специалист" ? (
                      <UserRound className="h-5 w-5" />
                    ) : (
                      <Search className="h-5 w-5" />
                    )}
                  </span>
                )}
                <span>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{result.type}</span>
                  <span className="mt-0.5 block text-base font-bold leading-5 text-[#060b27] sm:mt-1 sm:text-xl sm:leading-normal">{result.title}</span>
                  <span className="mt-1 line-clamp-2 block text-sm leading-5 text-slate-600 sm:mt-2 sm:line-clamp-none sm:text-base sm:leading-6">{result.description}</span>
                </span>
                <span className="col-start-2 inline-flex items-center gap-1.5 text-sm font-bold text-[#0875d1] sm:col-start-auto sm:gap-2 sm:text-base">
                  Открыть
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </Link>
            ))
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
              <h2 className="text-xl font-bold text-[#060b27]">Ничего не найдено</h2>
              <p className="mt-3 leading-7 text-slate-600">Попробуйте запросы: сантехник, мебель, Краснодар, маникюр, работа.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
