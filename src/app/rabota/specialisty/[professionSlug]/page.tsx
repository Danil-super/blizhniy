import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { professions } from "@/lib/data";
import { listSpecialists } from "@/lib/mock-store";
import { listSpecialistsWithStored, listStoredSpecialistProfiles } from "@/lib/specialist-profile-store";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ professionSlug: string }> }) {
  const { professionSlug } = await params;
  const profession = professions.find((item) => item.slug === professionSlug);
  const storedSpecialists = await listStoredSpecialistProfiles(100);
  const specialists = listSpecialistsWithStored(storedSpecialists, listSpecialists()).filter((specialist) => specialist.status === "published" && (profession ? specialist.profession === profession.name : true));

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Link href="/rabota/specialisty" className="text-sm font-bold text-[#0875d1]">Назад к специалистам</Link>
        <h1 className="mt-3 text-4xl font-black text-[#060b27]">{profession ? `Специалисты: ${profession.name}` : "Специалисты"}</h1>
        {profession ? <p className="mt-3 max-w-2xl text-slate-600">Раздел: {profession.parent}</p> : null}
        <div className="mt-6 grid gap-4">
          {specialists.map((specialist) => (
            <Link key={specialist.id} href={`/specialist/${specialist.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">{specialist.name}</h2>
              <p className="font-semibold text-[#0875d1]">{specialist.profession}</p>
              <p className="text-slate-600">{specialist.city} · {specialist.price}</p>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
