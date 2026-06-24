"use client";

import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { ListingShareButton } from "@/components/listings/ListingShareButton";
import { ListingViewCounter } from "@/components/listings/ListingViewCounter";
import { StoredMediaImage } from "@/components/StoredMedia";
import type { JobVacancy } from "@/lib/types";

function formatVacancyDate(value?: string) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function vacancyPlaceLabel(vacancy: JobVacancy) {
  if (vacancy.showExactAddress && vacancy.address) {
    return [vacancy.city, vacancy.address].filter(Boolean).join(", ");
  }

  return vacancy.district ? [vacancy.city, vacancy.district].join(", ") : vacancy.city;
}

export function VacancyGridCard({ vacancy }: { vacancy: JobVacancy }) {
  const href = `/vakansiya/${vacancy.id}`;
  const image = vacancy.images?.[0];
  const dateLabel = formatVacancyDate(vacancy.publishedAt ?? vacancy.createdAt);
  const placeLabel = vacancyPlaceLabel(vacancy);

  return (
    <article className="group relative min-w-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-card">
      <Link href={href} className="block min-w-0" aria-label={`Открыть вакансию ${vacancy.title}`}>
        <span className="relative flex aspect-[1.18/1] items-center justify-center overflow-hidden bg-slate-100">
          {image ? (
            <StoredMediaImage src={image} alt={vacancy.title} className="h-full w-full bg-slate-100 object-contain transition duration-300 group-hover:scale-[1.02]" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/80 px-1 text-center text-[11px] font-bold leading-4 text-[#0875d1] shadow-sm ring-1 ring-white/80">
              {vacancy.logoText}
            </span>
          )}
          {image ? <span className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-950/20 to-transparent" /> : <span className="absolute -bottom-8 -right-6 h-24 w-24 rounded-full bg-white/35" />}
        </span>
        <span className="block p-2">
          <span className="line-clamp-2 min-h-8 text-[13px] font-bold leading-4 text-slate-900 transition group-hover:text-[#0875d1]">
            {vacancy.title}
          </span>
          <span className="mt-0.5 block truncate text-base font-bold leading-5 text-[#060b27]">{vacancy.salary}</span>
          <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">{vacancy.organization}</span>
          {dateLabel ? (
            <span className="mt-1 flex min-w-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
              <CalendarDays className="h-3 w-3 shrink-0" />
              <span className="truncate">{dateLabel}</span>
            </span>
          ) : null}
          <span className="mt-1 flex items-end justify-between gap-1.5 text-[11px] text-slate-500">
            <span className="flex min-w-0 items-start gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="line-clamp-2 min-w-0 leading-[14px] [overflow-wrap:anywhere]" title={placeLabel}>
                {placeLabel}
              </span>
            </span>
            <ListingViewCounter listingId={`work-vacancy-${vacancy.id}`} />
          </span>
        </span>
      </Link>
      <ListingShareButton
        href={href}
        title={vacancy.title}
        textBreakpoint="never"
        className="absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white/95 text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-white hover:text-[#0875d1]"
      />
    </article>
  );
}
