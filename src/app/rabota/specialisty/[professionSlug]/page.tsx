import { BackLink } from "@/components/BackLink";
import { SiteHeader } from "@/components/SiteHeader";
import { SpecialistListCard } from "@/components/SpecialistListCard";
import { professions } from "@/lib/data";
import { listSpecialists } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { listSpecialistsWithStored, listStoredSpecialistProfiles } from "@/lib/specialist-profile-store";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ professionSlug: string }> }) {
  const { professionSlug } = await params;
  const profession = professions.find((item) => item.slug === professionSlug);
  const storedSpecialists = await listStoredSpecialistProfiles(100);
  const specialists = listSpecialistsWithStored(storedSpecialists, shouldShowFallbackContent() ? listSpecialists() : []).filter((specialist) => specialist.status === "published" && (profession ? specialist.profession === profession.name : true));

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
      </main>
    </>
  );
}
