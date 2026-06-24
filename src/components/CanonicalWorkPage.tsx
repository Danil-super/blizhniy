"use client";

import Link from "next/link";
import { useState } from "react";
import { BriefcaseBusiness, ChevronRight, ClipboardList, Clock3, MapPin, UserRound } from "lucide-react";
import { BrandName } from "@/components/BrandName";
import { VacancyCardMedia } from "@/components/VacancyMedia";
import { specialists as fallbackSpecialists, vacancies as fallbackVacancies, workRequests as fallbackWorkRequests } from "@/lib/data";
import { formatPublicationDateTime } from "@/lib/publication-time";
import type { JobVacancy, SpecialistProfile, WorkRequest } from "@/lib/types";

const previewLimit = 6;

function publicationTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function newestWorkRequests(requests: WorkRequest[]) {
  return [...requests].sort((left, right) => publicationTime(right.publishedAt ?? right.createdAt) - publicationTime(left.publishedAt ?? left.createdAt));
}

function formatPublicationDate(value?: string) {
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

function SegmentTabs({ activeItem, onChange }: { activeItem: string; onChange: (item: string) => void }) {
  return (
    <div className="grid w-full grid-cols-2 gap-2">
      {["Новые вакансии", "Заказчики"].map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`inline-flex h-11 min-w-0 items-center justify-center rounded-xl border px-3 text-center text-sm font-bold leading-tight transition sm:h-12 sm:text-base ${
            item === activeItem ? "border-[#0aa337] bg-emerald-50 text-[#0a8f32]" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function VacancyCard({ vacancy }: { vacancy: JobVacancy }) {
  const publishedLabel = formatPublicationDate(vacancy.publishedAt ?? vacancy.createdAt);

  return (
    <Link href={`/vakansiya/${vacancy.id}`} className="group block min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-card">
      <VacancyCardMedia images={vacancy.images} title={vacancy.title}>
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/75 px-1 text-center text-xs font-bold leading-4 shadow-sm ring-1 ring-white/80 transition group-hover:scale-105">
          {vacancy.logoText}
        </span>
        <span className="absolute -bottom-8 -right-6 h-24 w-24 rounded-full bg-white/35" />
      </VacancyCardMedia>
      <span className="block p-4">
        <span className="block truncate text-xs font-semibold text-slate-500">{vacancy.organization}</span>
        <span className="mt-1 block line-clamp-2 min-h-10 text-sm font-bold leading-5 text-[#060b27] transition group-hover:text-[#0875d1]">{vacancy.title}</span>
        <span className="mt-2 block text-base font-bold text-[#060b27]">{vacancy.salary}</span>
        {publishedLabel ? (
          <span className="mt-2 flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500">
            <Clock3 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{publishedLabel}</span>
          </span>
        ) : null}
        <span className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          {vacancy.city}
        </span>
      </span>
    </Link>
  );
}

function WorkRequestCard({ request }: { request: WorkRequest }) {
  const publishedLabel = formatPublicationDateTime(request.publishedAt ?? request.createdAt, "10:00");

  return (
    <Link href={`/rabota/zakazy/${request.id}`} className="group block min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card">
      <p className="truncate text-xs font-semibold text-slate-500">{request.author}</p>
      <h3 className="mt-1 line-clamp-2 min-h-10 text-sm font-bold leading-5 text-[#060b27] transition group-hover:text-[#0875d1]">{request.title}</h3>
      <p className="mt-2 text-base font-bold text-[#060b27]">{request.budget}</p>
      {publishedLabel ? (
        <p className="mt-2 flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500">
          <Clock3 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{publishedLabel}</span>
        </p>
      ) : null}
      <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
        <MapPin className="h-3.5 w-3.5" />
        {request.city}
      </p>
    </Link>
  );
}

function SpecialistCard({ specialist }: { specialist: SpecialistProfile }) {
  const publishedLabel = formatPublicationDate(specialist.publishedAt ?? specialist.createdAt);

  return (
    <Link href={`/specialist/${specialist.id}`} className="group block min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card">
      <p className="text-base font-bold text-[#060b27]">{specialist.name}</p>
      <p className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-900 transition group-hover:text-[#0875d1]">{specialist.profession}</p>
      <p className="mt-2 text-base font-bold text-[#060b27]">{specialist.price}</p>
      {publishedLabel ? (
        <p className="mt-2 flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500">
          <Clock3 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{publishedLabel}</span>
        </p>
      ) : null}
      <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
        <MapPin className="h-3.5 w-3.5" />
        {specialist.city}
      </p>
    </Link>
  );
}

export function CanonicalWorkPage({
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
  const visibleWorkRequests = newestWorkRequests(workRequests.filter((request) => request.status === "published")).slice(0, previewLimit);
  const visibleSpecialists = specialists.filter((specialist) => specialist.status === "published").slice(0, previewLimit);
  const showingWorkRequests = demandTab === "Заказчики";

  return (
    <main className="page-container py-6 sm:py-8 lg:py-10">
      <nav className="mb-4 text-xs text-slate-500 sm:text-sm" aria-label="Хлебные крошки">
        <Link href="/" className="hover:text-[#0875d1]">Главная</Link>
        <span className="mx-2">/</span>
        <span>Работа</span>
      </nav>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold leading-tight text-[#060b27] sm:text-4xl">Работа</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-lg sm:leading-7">Вакансии, заказы и анкеты специалистов на платформе <BrandName />.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/rabota/vakansii/sozdat" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e]">
            <BriefcaseBusiness className="h-4 w-4" />
            Разместить вакансию
          </Link>
          <Link href="/rabota/zakazy/sozdat" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e]">
            <ClipboardList className="h-4 w-4" />
            Разместить заказ
          </Link>
          <Link href="/rabota/specialisty/anketa" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#0aa337] bg-white px-4 text-sm font-bold text-[#0a8f32] transition hover:bg-emerald-50">
            <UserRound className="h-4 w-4" />
            Создать анкету
          </Link>
        </div>
      </div>

      <section className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,34rem)_minmax(0,34rem)] lg:items-start lg:justify-between">
        <SegmentTabs activeItem={demandTab} onChange={setDemandTab} />
      </section>

      <div className="mt-6 grid gap-8 xl:grid-cols-2">
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-xl font-bold text-[#060b27] lg:text-xl">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0aa337] text-white">
                {showingWorkRequests ? <ClipboardList className="h-5 w-5" /> : <BriefcaseBusiness className="h-5 w-5" />}
              </span>
              {showingWorkRequests ? "Заказчики" : "Вакансии"}
            </h2>
            <Link href={showingWorkRequests ? "/rabota/zakazy" : "/rabota/vakansii"} className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0875d1] sm:text-base">
              Смотреть все
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 xl:grid-cols-2">
            {showingWorkRequests
              ? visibleWorkRequests.map((request) => <WorkRequestCard key={request.id} request={request} />)
              : visibleVacancies.map((vacancy) => <VacancyCard key={vacancy.id} vacancy={vacancy} />)}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-xl font-bold text-[#060b27] lg:text-xl">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0875d1] text-white">
                <UserRound className="h-5 w-5" />
              </span>
              Специалисты
            </h2>
            <Link href="/rabota/specialisty" className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0875d1] sm:text-base">
              Смотреть все
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 xl:grid-cols-2">
            {visibleSpecialists.map((specialist) => <SpecialistCard key={specialist.id} specialist={specialist} />)}
          </div>
        </section>
      </div>
    </main>
  );
}
