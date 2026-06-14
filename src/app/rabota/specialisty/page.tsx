import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { listSpecialists } from "@/lib/mock-store";

export const metadata: Metadata = {
  title: "Специалисты",
  description: "Каталог исполнителей на БЛИЖНИЙ.",
};

export const dynamic = "force-dynamic";

export default function Page() {
  const specialists = listSpecialists().filter((specialist) => specialist.status === "published");

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Link href="/rabota" className="text-sm font-bold text-[#0875d1]">Назад к работе</Link>
        <h1 className="mt-3 text-4xl font-black text-[#060b27]">Все специалисты</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Каталог исполнителей.</p>
        <div className="mt-6 grid gap-4">
          {specialists.map((specialist) => (
            <Link key={specialist.id} href={`/specialist/${specialist.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-card">
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
