import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkRequestsIndexClient } from "@/components/WorkRequestsIndexClient";
import type { WorkRequest } from "@/lib/types";
import { listWorkRequests } from "@/lib/mock-store";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { listStoredWorkRequests, listWorkRequestsWithStored } from "@/lib/work-request-store";

export const metadata: Metadata = {
  title: "Заказчики",
  description: "Свежие заказы для специалистов и исполнителей на БЛИЖНИЙ.",
};

export const dynamic = "force-dynamic";

function publicationTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function newestWorkRequests(requests: WorkRequest[]) {
  return [...requests].sort((left, right) => publicationTime(right.publishedAt ?? right.createdAt) - publicationTime(left.publishedAt ?? left.createdAt));
}

export default async function Page() {
  const storedWorkRequests = await listStoredWorkRequests(1000);
  const requests = newestWorkRequests(
    listWorkRequestsWithStored(storedWorkRequests.length ? storedWorkRequests : shouldShowFallbackContent() ? listWorkRequests() : []).filter((request) => request.status === "published"),
  );

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <Link href="/rabota" className="text-sm font-bold text-[#0875d1]">Назад к работе</Link>
        <h1 className="mt-3 text-4xl font-black text-[#060b27]">Заказчики</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Свежие заказы от жителей и компаний для специалистов рядом.</p>
        <WorkRequestsIndexClient initialRequests={requests} />
      </main>
    </>
  );
}
