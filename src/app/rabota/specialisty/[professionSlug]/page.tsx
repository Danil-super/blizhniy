import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { SiteHeader } from "@/components/SiteHeader";
import { SpecialistListCard } from "@/components/SpecialistListCard";
import { ListingPagination } from "@/components/listings/ListingPagination";
import { parseListingPage } from "@/components/listings/ListingPages";
import { professions } from "@/lib/data";
import { listSpecialists } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { listSpecialistsWithStored, listStoredSpecialistProfiles } from "@/lib/specialist-profile-store";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ professionSlug: string }>; searchParams?: Promise<{ page?: string }> };

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { professionSlug } = await params;
  const page = parseListingPage((await searchParams)?.page);
  const profession = professions.find((item) => item.active && item.slug === professionSlug);

  return {
    title: profession ? `Специалисты: ${profession.name}` : "Профессия",
    alternates: { canonical: page > 1 ? `/rabota/specialisty/${professionSlug}?page=${page}` : `/rabota/specialisty/${professionSlug}` },
  };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { professionSlug } = await params;
  const profession = professions.find((item) => item.active && item.slug === professionSlug);

  if (!profession) notFound();
  const page = parseListingPage((await searchParams)?.page);
  const pageSize = 24;
  const skip = (page - 1) * pageSize;
  const matched = [] as Awaited<ReturnType<typeof listStoredSpecialistProfiles>>;
  const batchSize = 100;

  // Filter before slicing so an uncommon profession still appears after the first 100 profiles.
  for (let offset = 0; matched.length <= skip + pageSize; offset += batchSize) {
    const batch = await listStoredSpecialistProfiles(batchSize, offset);
    matched.push(...batch.filter((specialist) => specialist.profession === profession.name));
    if (batch.length < batchSize) break;
  }

  const storedSpecialists = matched.slice(skip, skip + pageSize);
  if (page > 1 && !storedSpecialists.length) notFound();
  const specialists = listSpecialistsWithStored(storedSpecialists, page === 1 && shouldShowFallbackContent() ? listSpecialists() : [])
    .filter((specialist) => specialist.status === "published" && specialist.profession === profession.name).slice(0, pageSize);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <BackLink fallbackHref="/rabota/specialisty">Назад к специалистам</BackLink>
        <h1 className="mt-3 text-2xl font-bold text-[#060b27] sm:text-3xl">{profession ? `Специалисты: ${profession.name}` : "Специалисты"}</h1>
        {profession ? <p className="mt-3 max-w-2xl text-slate-600">Раздел: {profession.parent}</p> : null}
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {specialists.map((specialist) => (
            <SpecialistListCard key={specialist.id} specialist={specialist} />
          ))}
        </div>
        <ListingPagination baseHref={`/rabota/specialisty/${professionSlug}`} hasMore={matched.length > skip + pageSize} page={page} label="Страницы специалистов" />
      </main>
    </>
  );
}
