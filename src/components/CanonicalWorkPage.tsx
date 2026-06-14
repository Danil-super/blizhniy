"use client";

import Link from "next/link";
import { useState } from "react";
import { BriefcaseBusiness, ChevronRight, ClipboardList, MapPin, UserRound } from "lucide-react";
import { specialists as fallbackSpecialists, vacancies as fallbackVacancies, workRequests as fallbackWorkRequests } from "@/lib/data";
import type { JobVacancy, SpecialistProfile, WorkRequest } from "@/lib/types";

const previewLimit = 6;

function SegmentTabs({ activeItem, onChange }: { activeItem: string; onChange: (item: string) => void }) {
  return (
    <div className="grid w-full grid-cols-2 gap-2">
      {["Новые вакансии", "Заказчики"].map((item) => (
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

function VacancyCard({ vacancy }: { vacancy: JobVacancy }) {
  return (
    <Link href={`/vakansiya/${vacancy.id}`} className="group block min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card">
      <p className="truncate text-xs font-semibold text-slate-500">{vacancy.organization}</p>
      <h3 className="mt-1 line-clamp-2 min-h-10 text-sm font-black leading-5 text-[#060b27] transition group-hover:text-[#0875d1]">{vacancy.title}</h3>
      <p className="mt-2 text-base font-black text-[#060b27]">{vacancy.salary}</p>
      <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
        <MapPin className="h-3.5 w-3.5" />
        {vacancy.city}
      </p>
    </Link>
  );
}

function WorkRequestCard({ request }: { request: WorkRequest }) {
  return (
    <Link href="/cabinet/zakazy" className="group block min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card">
      <p className="truncate text-xs font-semibold text-slate-500">{request.author}</p>
      <h3 className="mt-1 line-clamp-2 min-h-10 text-sm font-black leading-5 text-[#060b27] transition group-hover:text-[#0875d1]">{request.title}</h3>
      <p className="mt-2 text-base font-black text-[#060b27]">{request.budget}</p>
      <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
        <MapPin className="h-3.5 w-3.5" />
        {request.city}
      </p>
    </Link>
  );
}

function SpecialistCard({ specialist }: { specialist: SpecialistProfile }) {
  return (
    <Link href={`/specialist/${specialist.id}`} className="group block min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card">
      <p className="text-base font-black text-[#060b27]">{specialist.name}</p>
      <p className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-900 transition group-hover:text-[#0875d1]">{specialist.profession}</p>
      <p className="mt-2 text-base font-black text-[#060b27]">{specialist.price}</p>
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
  const visibleWorkRequests = workRequests.filter((request) => request.status === "published").slice(0, previewLimit);
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
          <h1 className="text-3xl font-black leading-tight text-[#060b27] sm:text-5xl">Работа</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-lg sm:leading-7">Вакансии, заказы и анкеты специалистов на платформе БЛИЖНИЙ.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href="/rabota/vakansii/sozdat" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-black text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e]">
            <BriefcaseBusiness className="h-4 w-4" />
            Разместить вакансию
          </Link>
          <Link href="/rabota/specialisty/anketa" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#0aa337] bg-white px-4 text-sm font-black text-[#0a8f32] transition hover:bg-emerald-50">
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
            <h2 className="flex min-w-0 items-center gap-2 text-xl font-black text-[#060b27] lg:text-2xl">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0aa337] text-white">
                {showingWorkRequests ? <ClipboardList className="h-5 w-5" /> : <BriefcaseBusiness className="h-5 w-5" />}
              </span>
              {showingWorkRequests ? "Заказчики" : "Вакансии"}
            </h2>
            <Link href={showingWorkRequests ? "/cabinet/zakazy" : "/rabota/vakansii"} className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0875d1] sm:text-base">
              {showingWorkRequests ? "Разместить" : "Смотреть все"}
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
            <h2 className="flex min-w-0 items-center gap-2 text-xl font-black text-[#060b27] lg:text-2xl">
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
