import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { SiteHeader } from "@/components/SiteHeader";
import { SpecialistListCard } from "@/components/SpecialistListCard";
import { ListingPagination } from "@/components/listings/ListingPagination";
import { parseListingPage } from "@/components/listings/ListingPages";
import { getPublicProfessions } from "@/lib/profession-store";
import { listSpecialists } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { listSpecialistsWithStored, listStoredSpecialistProfiles } from "@/lib/specialist-profile-store";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ professionSlug: string }>; searchParams?: Promise<{ page?: string }> };

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { professionSlug } = await params;
  const page = parseListingPage((await searchParams)?.page);
  const profession = (await getPublicProfessions()).find((item) => item.slug === professionSlug);

  return {
    title: profession ? `Специалисты: ${profession.name}` : "Профессия",
    alternates: { canonical: page > 1 ? `/rabota/specialisty/${professionSlug}?page=${page}` : `/rabota/specialisty/${professionSlug}` },
  };
}

async function legacyProfessionPage(name:string,skip:number,pageSize:number){
  const profession={name};
  const matched = [] as Awaited<ReturnType<typeof listStoredSpecialistProfiles>>;
  const batchSize = 100;

  // Legacy records have names only: filter all batches before slicing.
  for (let offset = 0; matched.length <= skip + pageSize; offset += batchSize) {
    const batch = await listStoredSpecialistProfiles(batchSize, offset);
    matched.push(...batch.filter((specialist) => specialist.profession === profession.name));
    if (batch.length < batchSize) break;
  }

  const storedSpecialists = matched.slice(skip, skip + pageSize);
  return{items:storedSpecialists,hasMore:matched.length > skip + pageSize};
}

export default async function Page({ params, searchParams }: PageProps) {
  const { professionSlug } = await params;
  const profession = (await getPublicProfessions()).find((item) => item.slug === professionSlug);

  if (!profession) notFound();
  const page = parseListingPage((await searchParams)?.page);
  const pageSize = 24;
  const skip = (page - 1) * pageSize;
  const primary=process.env.BLIZHNIY_AUTH_MODE==='postgres';
  let result:Awaited<ReturnType<typeof legacyProfessionPage>>;
  if(primary){
    const {getProductionPublicServiceStore}=await import('@/lib/production-public-service-runtime');
    const store=await getProductionPublicServiceStore();
    result=await store.professionPage(profession.id,pageSize,skip);
  }else result=await legacyProfessionPage(profession.name,skip,pageSize);
  const storedSpecialists=result.items,hasMore=result.hasMore;
  if (page > 1 && !storedSpecialists.length) notFound();
  const specialists = (primary?storedSpecialists:listSpecialistsWithStored(storedSpecialists, page === 1 && shouldShowFallbackContent() ? listSpecialists() : []))
    .filter((specialist) => specialist.status === "published" && (primary?specialist.professionId===profession.id:specialist.profession === profession.name)).slice(0, pageSize);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <BackLink fallbackHref="/rabota/specialisty">Назад к специалистам</BackLink>
        <h1 className="mt-3 text-2xl font-bold text-[#060b27] sm:text-3xl">{profession ? `Специалисты: ${profession.name}` : "Специалисты"}</h1>
        {profession ? <p className="mt-3 max-w-2xl text-slate-600">Раздел: {profession.parent}</p> : null}
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {specialists.length === 0 && <p className="col-span-full text-sm text-slate-600">По этой профессии пока нет анкет.</p>}
          {specialists.map((specialist) => (
            <SpecialistListCard key={specialist.id} specialist={specialist} />
          ))}
        </div>
        <ListingPagination baseHref={`/rabota/specialisty/${professionSlug}`} hasMore={hasMore} page={page} label="Страницы специалистов" />
      </main>
    </>
  );
}
