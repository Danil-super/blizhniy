import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search, UserRound } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { VacancyThumbnail } from "@/components/VacancyMedia";
import { listPublicDemoListings, parseListingPage, toDemoListing } from "@/components/listings/ListingPages";
import { getPublicCategories } from "@/lib/category-store";
import { cities, professions, region } from "@/lib/data";
import { listFairApplications, listSpecialists, listWorkRequests } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { listSpecialistsWithStored, listStoredSpecialistProfiles } from "@/lib/specialist-profile-store";
import { listStoredFairApplications } from "@/lib/fair-application-store";
import { listStoredVacancies, listVacanciesWithStored } from "@/lib/vacancy-store";
import { listStoredWorkRequests } from "@/lib/work-request-store";
import { listStoredListings } from "@/lib/listing-store";
import { isSupabaseRestConfigured } from "@/lib/supabase-rest";

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

async function scanStoredResults<T>(
  readPage: (limit: number, offset: number) => Promise<T[]>,
  matches: (item: T) => boolean,
  toResult: (item: T) => SearchResult,
  add: (result: SearchResult) => void,
  enough: () => boolean,
) {
  const batchSize = 100;

  for (let offset = 0; !enough(); offset += batchSize) {
    const page = await readPage(batchSize, offset);

    for (const item of page) {
      if (matches(item)) add(toResult(item));
      if (enough()) break;
    }

    if (page.length < batchSize) break;
  }
}

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; city?: string; page?: string }> }) {
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 200) ?? "";
  const page = parseListingPage(params.page);
  const pageSize = 24;
  const skip = (page - 1) * pageSize;
  const selectedCity = cities.find((city) => city.slug === params.city);
  const cityName = selectedCity?.name;
  const matchesCity = (value?: string) => !cityName || value === cityName;
  const fallbackEnabled = shouldShowFallbackContent();
  const results: SearchResult[] = [];
  let matchedCount = 0;
  const enough = () => results.length > pageSize;
  const add = (result: SearchResult) => {
    if (matchedCount >= skip && !enough()) results.push(result);
    matchedCount += 1;
  };
  const textMatch = (values: Array<string | undefined>) => !query || includesQuery(values, query);
  const seenListingSlugs = new Set<string>();

  await scanStoredResults(
    async (limit, offset) => (await listStoredListings(limit, { offset })).map(toDemoListing),
    (listing) => listing.status === "published" && matchesCity(listing.city) && textMatch([listing.title, listing.description, listing.city, listing.categoryName, listing.subcategoryName, listing.kind]),
    (listing) => {
      seenListingSlugs.add(listing.slug);
      return {
        title: listing.title,
        description: `${listing.categoryName}, ${listing.city}. ${listing.description}`,
        href: `/obyavlenie/${listing.slug}`,
        type: "Объявление",
      };
    },
    add,
    enough,
  );

  if (fallbackEnabled && !enough()) {
    for (const listing of listPublicDemoListings()) {
      if (seenListingSlugs.has(listing.slug) || !matchesCity(listing.city) || !textMatch([listing.title, listing.description, listing.city, listing.categoryName, listing.subcategoryName, listing.kind])) continue;
      add({ title: listing.title, description: `${listing.categoryName}, ${listing.city}. ${listing.description}`, href: `/obyavlenie/${listing.slug}`, type: "Объявление" });
      if (enough()) break;
    }
  }

  if (!enough()) await scanStoredResults(
    listStoredVacancies,
    (vacancy) => vacancy.status === "published" && matchesCity(vacancy.city) && textMatch([vacancy.title, vacancy.organization, vacancy.profession, vacancy.city, vacancy.description]),
    (vacancy) => ({ title: vacancy.title, description: `${vacancy.organization}, ${vacancy.city}. ${vacancy.salary}`, href: `/vakansiya/${vacancy.id}`, images: vacancy.images, type: "Вакансия" }),
    add,
    enough,
  );

  if (fallbackEnabled && !enough()) {
    for (const vacancy of listVacanciesWithStored([])) {
      if (vacancy.status !== "published" || !matchesCity(vacancy.city) || !textMatch([vacancy.title, vacancy.organization, vacancy.profession, vacancy.city, vacancy.description])) continue;
      add({ title: vacancy.title, description: `${vacancy.organization}, ${vacancy.city}. ${vacancy.salary}`, href: `/vakansiya/${vacancy.id}`, images: vacancy.images, type: "Вакансия" });
      if (enough()) break;
    }
  }

  if (!enough()) await scanStoredResults(
    listStoredWorkRequests,
    (request) => request.status === "published" && matchesCity(request.city) && textMatch([request.title, request.description, request.author, request.profession, request.city]),
    (request) => ({ title: request.title, description: `${request.author}, ${request.city}. ${request.budget}`, href: `/rabota/zakazy/${request.id}`, type: "Заказ" }),
    add,
    enough,
  );

  if (fallbackEnabled && !enough()) {
    for (const request of listWorkRequests()) {
      if (request.status !== "published" || !matchesCity(request.city) || !textMatch([request.title, request.description, request.author, request.profession, request.city])) continue;
      add({ title: request.title, description: `${request.author}, ${request.city}. ${request.budget}`, href: `/rabota/zakazy/${request.id}`, type: "Заказ" });
      if (enough()) break;
    }
  }

  if (!enough()) await scanStoredResults(
    listStoredSpecialistProfiles,
    (specialist) => specialist.status === "published" && matchesCity(specialist.city) && textMatch([specialist.name, specialist.profession, specialist.skills, specialist.city]),
    (specialist) => ({ title: `${specialist.name} - ${specialist.profession}`, description: `${specialist.city}. ${specialist.skills}. ${specialist.price}`, href: `/specialist/${specialist.id}`, type: "Специалист" }),
    add,
    enough,
  );

  if (fallbackEnabled && !enough()) {
    for (const specialist of listSpecialistsWithStored([], listSpecialists())) {
      if (specialist.status !== "published" || !matchesCity(specialist.city) || !textMatch([specialist.name, specialist.profession, specialist.skills, specialist.city])) continue;
      add({ title: `${specialist.name} - ${specialist.profession}`, description: `${specialist.city}. ${specialist.skills}. ${specialist.price}`, href: `/specialist/${specialist.id}`, type: "Специалист" });
      if (enough()) break;
    }
  }

  if (!enough()) await scanStoredResults(
    (limit, offset) => listStoredFairApplications("published", { limit, offset }),
    (application) => application.status === "published" && matchesCity(application.city) && textMatch([application.participantName, application.category, application.description, application.city]),
    (application) => ({ title: application.participantName, description: `${application.category}, ${application.city}. ${application.description}`, href: "/yarmarka-masterov", type: "Ярмарка" }),
    add,
    enough,
  );

  if (fallbackEnabled && isSupabaseRestConfigured() && !enough()) {
    for (const application of listFairApplications()) {
      if (application.status !== "published" || !matchesCity(application.city) || !textMatch([application.participantName, application.category, application.description, application.city])) continue;
      add({ title: application.participantName, description: `${application.category}, ${application.city}. ${application.description}`, href: "/yarmarka-masterov", type: "Ярмарка" });
      if (enough()) break;
    }
  }

  const categories = await getPublicCategories();
  for (const category of categories) {
    if (enough()) break;
    if (!textMatch([category.name, ...category.children])) continue;
    add({ title: category.name, description: category.children.join(", "), href: category.slug === "rabota" ? "/rabota" : category.slug === "yarmarka-masterov" ? "/yarmarka-masterov" : `/katalog/${category.slug}`, type: "Категория" });
  }

  for (const profession of professions) {
    if (enough()) break;
    if (!profession.active || !textMatch([profession.name, profession.parent])) continue;
    add({ title: profession.name, description: profession.parent, href: `/rabota/specialisty/${profession.slug}`, type: "Профессия" });
  }

  const visibleResults = results.slice(0, pageSize);
  const searchHref = (number: number) => {
    const nextParams = new URLSearchParams();
    if (query) nextParams.set("q", query);
    if (selectedCity) nextParams.set("city", selectedCity.slug);
    if (number > 1) nextParams.set("page", String(number));
    return `/poisk${nextParams.size ? `?${nextParams}` : ""}`;
  };

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
            visibleResults.map((result, index) => (
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
        {page > 1 || results.length > pageSize ? (
          <nav aria-label="Страницы результатов" className="mt-6 flex items-center justify-center gap-3">
            {page > 1 ? <Link href={searchHref(page - 1)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#0875d1]">Назад</Link> : null}
            <span className="text-sm font-bold text-slate-700">Страница {page}</span>
            {results.length > pageSize ? <Link href={searchHref(page + 1)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#0875d1]">Далее</Link> : null}
          </nav>
        ) : null}
      </main>
    </>
  );
}
