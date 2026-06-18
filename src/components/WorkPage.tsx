"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useState } from "react";
import {
  BriefcaseBusiness,
  ChevronRight,
  Clock3,
  ClipboardList,
  MapPin,
  UserRound,
} from "lucide-react";
import { ListingViewCounter } from "@/components/listings/ListingViewCounter";
import { VacancyGridCard } from "@/components/VacancyGridCard";
import { specialists as fallbackSpecialists, vacancies as fallbackVacancies, workRequests as fallbackWorkRequests } from "@/lib/data";
import { formatPublicationDateTime } from "@/lib/publication-time";
import type { JobVacancy, SpecialistProfile, WorkRequest } from "@/lib/types";

const previewLimit = 6;

function SegmentTabs({
  activeItem,
  items,
  onChange,
}: {
  activeItem: string;
  items: string[];
  onChange: (item: string) => void;
}) {
  return (
    <div className="grid w-full grid-cols-2 gap-2">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`inline-flex h-11 min-w-0 items-center justify-center rounded-xl border px-3 text-center text-sm font-black leading-tight transition sm:h-12 sm:text-base ${
            item === activeItem ? "border-[#0aa337] bg-emerald-50 text-[#0a8f32]" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function Avatar({ specialist }: { specialist: SpecialistProfile }) {
  const palettes: Record<string, string> = {
    alex: "from-blue-200 via-slate-100 to-emerald-200 text-blue-900",
    marina: "from-rose-200 via-white to-violet-200 text-rose-900",
    irina: "from-amber-100 via-white to-blue-200 text-slate-800",
  };

  return (
    <span
      className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${
        palettes[specialist.imageSeed] ?? "from-slate-100 to-blue-100"
      } text-3xl font-black shadow-sm ring-1 ring-white/80 transition group-hover:scale-105`}
      aria-hidden="true"
    >
      {specialist.name.slice(0, 1)}
    </span>
  );
}

const specialistImageTones: Record<string, string> = {
  alex: "from-blue-100 via-white to-emerald-100",
  marina: "from-rose-100 via-white to-violet-100",
  irina: "from-amber-100 via-white to-blue-100",
};

function WorkRequestCard({ request }: { request: WorkRequest }) {
  const publishedLabel = formatPublicationDateTime(request.publishedAt ?? request.createdAt, "10:00");

  return (
    <Link
      href={`/rabota/zakazy/${request.id}`}
      className="group block min-w-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-card"
      aria-label={`Открыть заказ ${request.title}`}
    >
      <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-100 via-white to-lime-100">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/75 text-[#0a8f32] shadow-sm ring-1 ring-white/80 transition group-hover:scale-105">
          <ClipboardList className="h-8 w-8" />
        </span>
        <span className="absolute -bottom-8 -right-6 h-24 w-24 rounded-full bg-white/35" />
      </span>
      <span className="block p-3">
        <span className="block truncate text-[11px] text-slate-500 sm:text-xs">{request.author}</span>
        <span className="mt-1 block truncate text-base font-black text-[#060b27]">{request.budget}</span>
        <span className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-900 transition group-hover:text-[#0875d1]">
          {request.title}
        </span>
        <span className="mt-1 hidden text-xs leading-5 text-slate-600 sm:line-clamp-2">{request.description}</span>
        {publishedLabel ? (
          <span className="mt-1 flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500">
            <Clock3 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{publishedLabel}</span>
          </span>
        ) : null}
        <span className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="flex min-w-0 items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{request.city}</span>
          </span>
          <ListingViewCounter listingId={`work-request-${request.id}`} />
        </span>
      </span>
    </Link>
  );
}

function SpecialistCard({ specialist }: { specialist: SpecialistProfile }) {
  const publishedLabel = formatPublicationDateTime(specialist.publishedAt ?? specialist.createdAt, "11:00");
  const firstImage = specialist.images?.[0];

  return (
    <Link
      href={`/specialist/${specialist.id}`}
      className="group block min-w-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-card"
      aria-label={`Открыть анкету ${specialist.name}`}
    >
      <span className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br ${specialistImageTones[specialist.imageSeed] ?? "from-slate-100 via-white to-blue-100"}`}>
        {firstImage ? (
          <img src={firstImage} alt={specialist.name} className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
        ) : (
          <>
            <Avatar specialist={specialist} />
            <span className="absolute -bottom-8 -right-6 h-24 w-24 rounded-full bg-white/35" />
          </>
        )}
      </span>
      <span className="block p-3">
        <span className="block truncate text-base font-black text-[#060b27]">{specialist.price}</span>
        <span className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-900 transition group-hover:text-[#0875d1]">
          {specialist.name} · {specialist.profession}
        </span>
        <span className="mt-1 hidden text-xs leading-5 text-slate-600 sm:line-clamp-2">{specialist.skills}</span>
        {publishedLabel ? (
          <span className="mt-1 flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500">
            <Clock3 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{publishedLabel}</span>
          </span>
        ) : null}
        <span className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="flex min-w-0 items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{specialist.city}</span>
          </span>
          <ListingViewCounter listingId={`work-specialist-${specialist.id}`} />
        </span>
      </span>
    </Link>
  );
}

export function WorkPage({
  specialists = fallbackSpecialists,
  vacancies = fallbackVacancies,
  workRequests = fallbackWorkRequests,
}: {
  specialists?: SpecialistProfile[];
  vacancies?: JobVacancy[];
  workRequests?: WorkRequest[];
}) {
  const [demandTab, setDemandTab] = useState("Новые вакансии");
  const visibleVacancies = vacancies.filter((vacancy) => vacancy.status === "published").slice(0, previewLimit);
  const visibleWorkRequests = workRequests.filter((request) => request.status === "published").slice(0, previewLimit);
  const visibleSpecialists = specialists.filter((specialist) => specialist.status === "published").slice(0, previewLimit);
  const showingWorkRequests = demandTab === "Заказчики";

  return (
    <main className="page-container py-2 sm:py-3 lg:py-4">
      <nav className="mb-2 text-xs text-slate-500 sm:text-sm" aria-label="Хлебные крошки">
        <Link href="/" className="hover:text-[#0875d1]">
          Краснодар
        </Link>
        <span className="mx-2">/</span>
        <span>Работа</span>
      </nav>

      <h1 className="text-2xl font-black leading-tight tracking-normal text-[#060b27] sm:text-3xl lg:text-4xl">Работа</h1>

      <section className="mt-4 grid gap-3 sm:mt-5 lg:grid-cols-[minmax(0,34rem)_minmax(0,34rem)] lg:items-start lg:justify-between">
        <SegmentTabs activeItem={demandTab} items={["Новые вакансии", "Заказчики"]} onChange={setDemandTab} />
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
          <Link
            href="/rabota/vakansii/sozdat"
            className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl bg-[#0aa337] px-3 text-center text-xs font-bold leading-tight text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-12 sm:px-4 sm:text-sm lg:gap-2"
          >
            <BriefcaseBusiness className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <span className="min-w-0 [overflow-wrap:anywhere]">Разместить вакансию</span>
          </Link>
          <Link
            href="/rabota/specialisty/anketa"
            className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-[#0aa337] bg-white px-3 text-center text-xs font-bold leading-tight text-[#0a8f32] transition hover:bg-emerald-50 sm:h-12 sm:px-4 sm:text-sm lg:gap-2"
          >
            <UserRound className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <span className="min-w-0 [overflow-wrap:anywhere]">Создать анкету специалиста</span>
          </Link>
        </div>
      </section>

      <div className="mt-4 grid gap-6 sm:mt-6 lg:gap-8 xl:grid-cols-2">
        <section>
          <div className="mb-3 sm:mb-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex min-w-0 items-center gap-2 text-lg font-black text-[#060b27] sm:text-xl lg:gap-3 lg:text-2xl">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0aa337] text-white sm:h-9 sm:w-9">
                  <BriefcaseBusiness className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                {showingWorkRequests ? "Заказчики" : "Вакансии"}
              </h2>
              <Link href={showingWorkRequests ? "/cabinet/zakazy" : "/rabota/vakansii"} className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0875d1] sm:text-base">
                {showingWorkRequests ? "Разместить" : "Смотреть все"}
                <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 xl:grid-cols-2">
            {showingWorkRequests
              ? visibleWorkRequests.map((request) => <WorkRequestCard key={request.id} request={request} />)
              : visibleVacancies.map((vacancy) => <VacancyGridCard key={vacancy.id} vacancy={vacancy} />)}
          </div>
        </section>

        <section>
          <div className="mb-3 sm:mb-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex min-w-0 items-center gap-2 text-lg font-black text-[#060b27] sm:text-xl lg:gap-3 lg:text-2xl">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0875d1] text-white sm:h-9 sm:w-9">
                  <UserRound className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                Специалисты
              </h2>
              <Link href="/rabota/specialisty" className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0875d1] sm:text-base">
                Смотреть все
                <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 xl:grid-cols-2">
            {visibleSpecialists.map((specialist) => (
              <SpecialistCard key={specialist.id} specialist={specialist} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
