"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Clock3, MapPin } from "lucide-react";
import { demoPublicationsStorageKey, demoPublicationsUpdatedEvent, isDemoPublicationPubliclyVisible, type DemoPublication } from "@/lib/demo-publications";
import { formatPublicationDateTime } from "@/lib/publication-time";
import type { WorkRequest } from "@/lib/types";

function publicationTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function newestWorkRequests(requests: WorkRequest[]) {
  return [...requests].sort((left, right) => publicationTime(right.publishedAt ?? right.createdAt) - publicationTime(left.publishedAt ?? left.createdAt));
}

function readLocalPublishedWorkRequests() {
  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "id" in item))
      .filter((item) => item.type === "workRequest" && isDemoPublicationPubliclyVisible(item))
      .map((item): WorkRequest => ({
        id: item.id,
        author: item.ownerName ?? "Заказчик БЛИЖНИЙ",
        title: item.title,
        description: item.description ?? "Описание заказа будет дополнено.",
        profession: item.profession ?? item.subtitle ?? "Заказ исполнителю",
        city: item.city,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        showExactAddress: Boolean(item.showExactAddress),
        budget: item.price ?? "по договоренности",
        images: item.images,
        phone: item.phone,
        messengerUrl: item.messengerUrl,
        status: "published",
        createdAt: item.createdAt,
        publishedAt: item.createdAt,
      }));
  } catch {
    return [];
  }
}

function mergeWorkRequests(initialRequests: WorkRequest[], localRequests: WorkRequest[]) {
  const requestsById = new Map<string, WorkRequest>();

  [...initialRequests, ...localRequests].forEach((request) => {
    if (request.status === "published") {
      requestsById.set(request.id, request);
    }
  });

  return newestWorkRequests([...requestsById.values()]);
}

function WorkRequestListCard({ request }: { request: WorkRequest }) {
  const publishedLabel = formatPublicationDateTime(request.publishedAt ?? request.createdAt, "10:00");

  return (
    <Link href={`/rabota/zakazy/${request.id}`} className="group block min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card">
      <p className="truncate text-xs font-semibold text-slate-500">{request.author}</p>
      <h2 className="mt-1 line-clamp-2 min-h-10 text-sm font-black leading-5 text-[#060b27] transition group-hover:text-[#0875d1]">{request.title}</h2>
      <p className="mt-2 text-base font-black text-[#060b27]">{request.budget}</p>
      {publishedLabel ? (
        <p className="mt-2 flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500">
          <Clock3 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{publishedLabel}</span>
        </p>
      ) : null}
      <p className="mt-2 flex min-w-0 items-center gap-1 text-xs text-slate-500">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{request.city}</span>
      </p>
    </Link>
  );
}

export function WorkRequestsIndexClient({ initialRequests }: { initialRequests: WorkRequest[] }) {
  const [localRequests, setLocalRequests] = useState<WorkRequest[]>([]);
  const requests = useMemo(() => mergeWorkRequests(initialRequests, localRequests), [initialRequests, localRequests]);

  useEffect(() => {
    function syncLocalRequests() {
      setLocalRequests(readLocalPublishedWorkRequests());
    }

    syncLocalRequests();
    window.addEventListener("storage", syncLocalRequests);
    window.addEventListener(demoPublicationsUpdatedEvent, syncLocalRequests);

    return () => {
      window.removeEventListener("storage", syncLocalRequests);
      window.removeEventListener(demoPublicationsUpdatedEvent, syncLocalRequests);
    };
  }, []);

  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      {requests.map((request) => (
        <WorkRequestListCard key={request.id} request={request} />
      ))}
    </div>
  );
}
