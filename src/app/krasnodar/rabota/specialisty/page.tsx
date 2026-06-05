import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { listSpecialists } from "@/lib/mock-store";

export const metadata: Metadata = {
  title: "Специалисты в Краснодаре",
  description: "Каталог специалистов и исполнителей Краснодарского края на БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/rabota/specialisty",
  },
};

export const dynamic = "force-dynamic";

export default function SpecialistsPage() {
  const specialists = listSpecialists();

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <h1 className="text-4xl font-black text-[#060b27]">Все специалисты</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Полный каталог будет расширен поиском по классификатору, фильтрами и пагинацией.</p>
        <div className="mt-6 grid gap-4">
          {specialists.map((specialist) => (
            <Link key={specialist.id} href={`/blizhniy/specialist/${specialist.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-card">
              <h2 className="text-xl font-black">{specialist.name}</h2>
              <p className="mt-1 font-semibold text-[#0875d1]">{specialist.profession}</p>
              <p className="mt-2 text-slate-600">
                {specialist.city} · {specialist.price}
              </p>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
