import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { SiteHeader } from "@/components/SiteHeader";
import { ListingPagination } from "@/components/listings/ListingPagination";
import { parseListingPage } from "@/components/listings/ListingPages";
import { WorkRequestsIndexClient } from "@/components/WorkRequestsIndexClient";
import type { WorkRequest } from "@/lib/types";
import { listWorkRequests } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { listStoredWorkRequests, listWorkRequestsWithStored } from "@/lib/work-request-store";

type PageProps = { searchParams?: Promise<{ page?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const page = parseListingPage((await searchParams)?.page);
  return {
    title: "Заказчики",
    description: "Свежие заказы для специалистов и исполнителей на БЛИЖНИЙ.",
    alternates: { canonical: page > 1 ? `/rabota/zakazy?page=${page}` : "/rabota/zakazy" },
  };
}

export const dynamic = "force-dynamic";

function publicationTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function newestWorkRequests(requests: WorkRequest[]) {
  return [...requests].sort((left, right) => publicationTime(right.publishedAt ?? right.createdAt) - publicationTime(left.publishedAt ?? left.createdAt));
}

export default async function Page({ searchParams }: PageProps) {
  const page = parseListingPage((await searchParams)?.page);
  const pageSize = 24;
  const storedWorkRequests = await listStoredWorkRequests(pageSize + 1, (page - 1) * pageSize);
  if (page > 1 && !storedWorkRequests.length) notFound();
  const requests = newestWorkRequests(
    listWorkRequestsWithStored(storedWorkRequests.length ? storedWorkRequests : page === 1 && shouldShowFallbackContent() ? listWorkRequests() : []).filter((request) => request.status === "published"),
  ).slice(0, pageSize);

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <BackLink fallbackHref="/rabota">Назад к работе</BackLink>
        <h1 className="mt-3 text-2xl font-bold text-[#060b27] sm:text-3xl">Заказчики</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Свежие заказы от жителей и компаний для специалистов рядом.</p>
        <WorkRequestsIndexClient initialRequests={requests} />
        <ListingPagination baseHref="/rabota/zakazy" hasMore={storedWorkRequests.length > pageSize} page={page} label="Страницы заказов" />
      </main>
    </>
  );
}
