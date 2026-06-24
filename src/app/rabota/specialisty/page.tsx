import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SpecialistListCard } from "@/components/SpecialistListCard";
import { listSpecialists } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { listSpecialistsWithStored, listStoredSpecialistProfiles } from "@/lib/specialist-profile-store";

export const metadata: Metadata = {
  title: "Специалисты",
  description: "Каталог исполнителей на БЛИЖНИЙ.",
};

export const dynamic = "force-dynamic";

export default async function Page() {
  const storedSpecialists = await listStoredSpecialistProfiles(100);
  const specialists = listSpecialistsWithStored(storedSpecialists, shouldShowFallbackContent() ? listSpecialists() : []).filter((specialist) => specialist.status === "published");

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Link href="/rabota" className="text-sm font-bold text-[#0875d1]">Назад к работе</Link>
        <h1 className="mt-3 text-4xl font-black text-[#060b27]">Все специалисты</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Каталог исполнителей.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {specialists.map((specialist) => (
            <SpecialistListCard key={specialist.id} specialist={specialist} />
          ))}
        </div>
      </main>
    </>
  );
}
