import { SiteHeader } from "@/components/SiteHeader";
import { specialists } from "@/lib/data";
import Link from "next/link";

export default function ProfessionSpecialistsPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <h1 className="text-4xl font-black text-[#060b27]">Специалисты по профессии</h1>
        <div className="mt-6 grid gap-4">
          {specialists.map((specialist) => (
            <Link key={specialist.id} href={`/blizhniy/specialist/${specialist.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
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
