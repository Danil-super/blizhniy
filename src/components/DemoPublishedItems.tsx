"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, FilePenLine, Video } from "lucide-react";
import { StoredMediaImage, StoredMediaVideo } from "@/components/StoredMedia";
import { ListingShareButton } from "@/components/listings/ListingShareButton";
import { demoPublicationLabels, demoPublicationsStorageKey, DemoPublication, DemoPublicationType } from "@/lib/demo-publications";

function readStoredPublications() {
  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "id" in item));
    }
  } catch {
    return [];
  }

  return [];
}

export function DemoPublishedItems({ type }: { type: DemoPublicationType }) {
  const [items, setItems] = useState<DemoPublication[]>([]);

  useEffect(() => {
    function syncItems() {
      setItems(readStoredPublications());
    }

    syncItems();
    window.addEventListener("storage", syncItems);
    window.addEventListener("blizhniy-demo-publications-updated", syncItems);

    return () => {
      window.removeEventListener("storage", syncItems);
      window.removeEventListener("blizhniy-demo-publications-updated", syncItems);
    };
  }, []);

  const visibleItems = useMemo(() => items.filter((item) => item.type === type), [items, type]);

  if (!visibleItems.length) {
    return null;
  }

  return (
    <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 sm:p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#0a8f32] sm:text-base">
        <CheckCircle2 className="h-5 w-5" />
        Создано через админку: {demoPublicationLabels[type]}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {visibleItems.map((item) => (
          <article key={item.id} className="rounded-lg border border-emerald-100 bg-white p-3 shadow-sm">
            <div className="flex items-start gap-3">
              {(item.type === "listing" || item.type === "specialist") && (item.images?.[0] || item.videos?.[0]) ? (
                <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                  {item.images?.[0] ? <StoredMediaImage src={item.images[0]} alt={item.title} className="h-full w-full object-cover" /> : null}
                  {!item.images?.[0] && item.videos?.[0] ? <StoredMediaVideo src={item.videos[0]} className="h-full w-full bg-slate-950 object-cover" muted playsInline preload="metadata" /> : null}
                  {!item.images?.[0] && item.videos?.[0] ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-slate-950/20 text-white">
                      <Video className="h-5 w-5" />
                    </span>
                  ) : null}
                </span>
              ) : null}
              <div className="min-w-0">
                <h3 className="line-clamp-2 text-sm font-black text-[#060b27] sm:text-base">{item.title}</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">{item.subtitle}</p>
              </div>
              <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-[#0a8f32]">
                {item.status}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
              <span>{item.city}</span>
              {item.price ? <span>{item.price}</span> : null}
            </div>
            {item.type === "listing" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/obyavlenie/${item.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Открыть
                </Link>
                <Link href={`/krasnodar/obyavlenie/${item.id}/redaktirovat`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1] transition hover:bg-blue-100">
                  <FilePenLine className="h-3.5 w-3.5" />
                  Редактировать
                </Link>
                <ListingShareButton href={`/obyavlenie/${item.id}`} title={item.title} textBreakpoint="always" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]" />
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
