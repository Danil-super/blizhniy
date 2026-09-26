import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { SiteHeader } from "@/components/SiteHeader";
import { ListingPagination } from "@/components/listings/ListingPagination";
import { parseListingPage } from "@/components/listings/ListingPages";
import { SpecialistListCard } from "@/components/SpecialistListCard";
import { listSpecialists } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { listSpecialistsWithStored, listStoredSpecialistProfiles } from "@/lib/specialist-profile-store";

type PageProps = { searchParams?: Promise<{ page?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const page = parseListingPage((await searchParams)?.page);
  return {
    alternates: { canonical: page > 1 ? `/rabota/specialisty?page=${page}` : "/rabota/specialisty" },
    title: "Специалисты",
    description: "Каталог исполнителей на БЛИЖНИЙ.",
  };
}

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: PageProps) {
  const page = parseListingPage((await searchParams)?.page);
  const pageSize = 24;
  const storedSpecialists = await listStoredSpecialistProfiles(pageSize + 1, (page - 1) * pageSize);
  if (page > 1 && !storedSpecialists.length) notFound();
  const specialists = listSpecialistsWithStored(storedSpecialists, page === 1 && shouldShowFallbackContent() ? listSpecialists() : [])
    .filter((specialist) => specialist.status === "published").slice(0, pageSize);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <BackLink fallbackHref="/rabota">Назад к работе</BackLink>
        <h1 className="mt-3 text-2xl font-bold text-[#060b27] sm:text-3xl">Все специалисты</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Каталог исполнителей.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {specialists.map((specialist) => (
            <SpecialistListCard key={specialist.id} specialist={specialist} />
          ))}
        </div>
        <ListingPagination baseHref="/rabota/specialisty" hasMore={storedSpecialists.length > pageSize} page={page} label="Страницы специалистов" />
      </main>
    </>
  );
}
