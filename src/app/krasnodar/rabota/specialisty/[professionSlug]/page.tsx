import { SiteHeader } from "@/components/SiteHeader";
import { professions } from "@/lib/data";
import { listSpecialists } from "@/lib/mock-store";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProfessionSpecialistsPage({ params }: { params: Promise<{ professionSlug: string }> }) {
  const { professionSlug } = await params;
  const profession = professions.find((item) => item.slug === professionSlug);
  const specialists = listSpecialists().filter((specialist) => specialist.status === "published" && (profession ? specialist.profession === profession.name : true));

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <h1 className="text-4xl font-black text-[#060b27]">{profession ? `Специалисты: ${profession.name}` : "Специалисты по профессии"}</h1>
        {profession ? <p className="mt-3 max-w-2xl text-slate-600">Раздел: {profession.parent}. Здесь отображаются анкеты, созданные с этой профессией в классификаторе.</p> : null}
        <div className="mt-6 grid gap-4">
          {specialists.length ? (
            specialists.map((specialist) => (
              <Link key={specialist.id} href={`/blizhniy/specialist/${specialist.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-black">{specialist.name}</h2>
                <p className="font-semibold text-[#0875d1]">{specialist.profession}</p>
                <p className="text-slate-600">{specialist.city} · {specialist.price}</p>
              </Link>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm font-semibold text-slate-600">В этой профессии пока нет анкет.</div>
          )}
        </div>
      </main>
    </>
  );
}
