"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BriefcaseBusiness,
  ChevronRight,
  CircleUserRound,
  MapPin,
  UserRound,
} from "lucide-react";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { specialists, vacancies, workRequests } from "@/lib/data";
import type { JobVacancy, SpecialistProfile, WorkRequest } from "@/lib/types";

const demoPhone = "+78610009999";
const supportMessengerUrl = "https://t.me/blizhniy_support";

function LogoBadge({ vacancy }: { vacancy: JobVacancy }) {
  const tones = {
    blue: "border-blue-100 bg-blue-50 text-[#0875d1]",
    violet: "border-violet-100 bg-violet-50 text-violet-600",
    teal: "border-cyan-100 bg-cyan-50 text-cyan-600",
  };

  return (
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border px-1 text-center text-[10px] font-black leading-3 sm:h-16 sm:w-16 sm:text-xs lg:h-20 lg:w-20 lg:text-sm lg:leading-4 ${tones[vacancy.logoTone]}`}
    >
      {vacancy.logoText}
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
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${
        palettes[specialist.imageSeed] ?? "from-slate-100 to-blue-100"
      } text-xl font-black shadow-inner sm:h-16 sm:w-16 sm:text-2xl lg:h-20 lg:w-20 lg:text-3xl`}
      aria-hidden="true"
    >
      {specialist.name.slice(0, 1)}
    </div>
  );
}

function ContactButton({
  href,
  icon,
  label,
  tone = "blue",
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  tone?: "blue" | "green" | "slate" | "violet";
}) {
  const toneClass = {
    blue: "border-blue-200 bg-gradient-to-r from-blue-50 to-white text-[#0875d1] hover:border-[#0875d1] hover:from-white hover:to-blue-50",
    green: "border-transparent bg-gradient-to-r from-[#0875d1] to-[#18a9ff] text-white hover:from-[#0664b3] hover:to-[#0875d1]",
    slate: "border-slate-300 text-slate-700 hover:bg-slate-50",
    violet: "border-blue-200 bg-gradient-to-r from-blue-50 to-white text-[#0875d1] hover:border-[#0875d1] hover:from-white hover:to-blue-50",
  };

  const className = `inline-flex h-10 w-full min-w-0 box-border items-center justify-center gap-1.5 overflow-hidden rounded-lg border px-2 text-xs font-bold leading-tight shadow-sm shadow-blue-50 transition sm:gap-2 sm:px-3 sm:text-sm lg:px-4 ${toneClass[tone]}`;

  if (!href) {
    return (
      <button className={`${className} cursor-not-allowed opacity-55`} disabled>
        {icon}
        <span className="min-w-0 break-words leading-tight [overflow-wrap:anywhere]">{label}</span>
      </button>
    );
  }

  return (
    <a href={href} className={className}>
      {icon}
      <span className="min-w-0 break-words leading-tight [overflow-wrap:anywhere]">{label}</span>
    </a>
  );
}

function SegmentTabs({
  items,
  activeItem,
  activeTone,
  onChange,
}: {
  items: string[];
  activeItem: string;
  activeTone: "green" | "blue";
  onChange: (item: string) => void;
}) {
  const activeClass =
    activeTone === "green"
      ? "border-[#0aa337] bg-emerald-50 text-[#0a8f32]"
      : "border-[#0875d1] bg-blue-50 text-[#0875d1]";

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5 sm:gap-2 lg:gap-3">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`inline-flex h-8 min-w-0 items-center justify-center rounded-lg border px-2 text-center text-[11px] font-bold leading-tight [overflow-wrap:anywhere] transition sm:h-10 sm:text-xs lg:h-11 lg:px-4 lg:text-sm ${
            item === activeItem ? activeClass : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-[#0875d1]"
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function VacancyCard({ vacancy }: { vacancy: JobVacancy }) {
  const phoneHref = `tel:${vacancy.phone ?? demoPhone}`;
  const messageHref = vacancy.messengerUrl ?? `https://wa.me/${(vacancy.phone ?? demoPhone).replace(/\D/g, "")}`;

  return (
    <article className="group relative grid min-w-0 gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-card transition hover:border-blue-200 hover:shadow-lg sm:gap-3 sm:p-3 lg:p-4">
      <Link href={`/blizhniy/vakansiya/${vacancy.id}`} className="absolute inset-0 z-10 rounded-xl" aria-label={`Открыть вакансию ${vacancy.title}`} />
      <div className="flex min-w-0 gap-2 sm:gap-3">
        <LogoBadge vacancy={vacancy} />
        <div className="min-w-0 flex-1">
          <div className="min-w-0">
            <div className="min-w-0">
              <p className="truncate text-[11px] text-slate-500 sm:text-sm">{vacancy.organization}</p>
              <h3 className="mt-0.5 line-clamp-2 text-sm font-black leading-4 text-[#060b27] transition group-hover:text-[#0875d1] sm:text-lg sm:leading-6 lg:mt-1 lg:text-xl">{vacancy.title}</h3>
            </div>
            <p className="mt-1 text-xs font-black text-[#060b27] sm:text-base">{vacancy.salary}</p>
          </div>
          {vacancy.description ? <p className="mt-1 hidden text-xs leading-5 text-slate-600 sm:line-clamp-2 sm:text-sm">{vacancy.description}</p> : null}
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-600 sm:mt-1.5 sm:gap-1.5 sm:text-sm">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {vacancy.city}
          </p>
        </div>
      </div>
      <div className="relative z-20 grid grid-cols-2 items-stretch gap-1.5 sm:gap-2 lg:grid-cols-3">
          <Link href={`/blizhniy/vakansiya/${vacancy.id}`} className="col-span-2 inline-flex h-10 w-full min-w-0 items-center justify-center overflow-hidden rounded-lg border border-transparent bg-[#0aa337] px-2 text-xs font-bold leading-tight text-white shadow-sm shadow-blue-50 transition hover:bg-[#078a2e] sm:px-3 sm:text-sm lg:col-span-1 lg:px-4">
            <span className="sm:hidden">Отклик</span>
            <span className="hidden sm:inline">Откликнуться</span>
          </Link>
          <ContactButton href={phoneHref} icon={<ContactAssetIcon kind="phone" className="h-5 w-5 sm:h-6 sm:w-6" />} label="Позвонить" tone="green" />
          <ContactButton href={messageHref} icon={<ContactAssetIcon kind="message" className="h-5 w-5 sm:h-6 sm:w-6" />} label="Написать" tone="violet" />
      </div>
    </article>
  );
}

function WorkRequestCard({ request }: { request: WorkRequest }) {
  const phoneHref = `tel:${request.phone ?? demoPhone}`;
  const messageHref = request.messengerUrl ?? `https://wa.me/${(request.phone ?? demoPhone).replace(/\D/g, "")}`;

  return (
    <article className="group relative grid min-w-0 gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-card transition hover:border-blue-200 hover:shadow-lg sm:gap-3 sm:p-3 lg:p-4">
      <Link href={`/blizhniy/rabota/zakazy/${request.id}`} className="absolute inset-0 z-10 rounded-xl" aria-label={`Открыть заказ ${request.title}`} />
      <div className="flex min-w-0 gap-2 sm:gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-center text-[10px] font-black leading-3 text-[#0a8f32] sm:h-16 sm:w-16 sm:text-xs lg:h-20 lg:w-20 lg:text-sm lg:leading-4">
          Заказ
        </div>
        <div className="min-w-0 flex-1">
          <div className="min-w-0">
            <div className="min-w-0">
              <p className="truncate text-[11px] text-slate-500 sm:text-sm">{request.author}</p>
              <h3 className="mt-0.5 line-clamp-2 text-sm font-black leading-4 text-[#060b27] transition group-hover:text-[#0875d1] sm:text-lg sm:leading-6 lg:mt-1 lg:text-xl">{request.title}</h3>
            </div>
            <p className="mt-1 text-xs font-black text-[#060b27] sm:text-base">{request.budget}</p>
          </div>
          <p className="mt-1 hidden text-xs leading-5 text-slate-600 sm:line-clamp-2 sm:text-sm">{request.description}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-600 sm:mt-1.5 sm:gap-1.5 sm:text-sm">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {[request.city, request.showExactAddress ? request.address : request.district].filter(Boolean).join(", ")}
          </p>
        </div>
      </div>
      <div className="relative z-20 grid grid-cols-2 gap-1.5 sm:gap-2">
          <ContactButton href={phoneHref} icon={<ContactAssetIcon kind="phone" className="h-5 w-5 sm:h-6 sm:w-6" />} label="Позвонить" tone="green" />
          <ContactButton href={messageHref} icon={<ContactAssetIcon kind="message" className="h-5 w-5 sm:h-6 sm:w-6" />} label="Написать" tone="violet" />
      </div>
    </article>
  );
}

function SpecialistCard({ specialist }: { specialist: SpecialistProfile }) {
  const phoneHref = `tel:${specialist.phone ?? demoPhone}`;
  const messageHref = specialist.messengerUrl ?? supportMessengerUrl;

  return (
    <article className="group relative grid min-w-0 gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-card transition hover:border-blue-200 hover:shadow-lg sm:gap-3 sm:p-3 lg:p-4">
      <Link href={`/blizhniy/specialist/${specialist.id}`} className="absolute inset-0 z-10 rounded-xl" aria-label={`Открыть анкету ${specialist.name}`} />
      <div className="flex min-w-0 gap-2 sm:gap-3">
        <Avatar specialist={specialist} />
        <div className="min-w-0 flex-1">
          <div className="min-w-0">
            <div className="min-w-0">
              <h3 className="text-sm font-black text-[#060b27] sm:text-lg lg:text-xl">{specialist.name}</h3>
              <p className="mt-0.5 line-clamp-2 text-xs font-semibold leading-4 text-[#0875d1] sm:text-sm sm:leading-5">
                {specialist.profession}
              </p>
            </div>
            <p className="mt-1 text-xs font-black text-[#060b27] sm:text-base">{specialist.price}</p>
          </div>
          <p className="mt-1 hidden text-xs leading-5 text-slate-600 sm:line-clamp-2 sm:text-sm">{specialist.skills}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-600 sm:mt-1.5 sm:gap-1.5 sm:text-sm">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {specialist.city}
          </p>
        </div>
      </div>
      <div className="relative z-20 grid grid-cols-2 gap-1.5 sm:gap-2">
          <ContactButton href={phoneHref} icon={<ContactAssetIcon kind="phone" className="h-5 w-5 sm:h-6 sm:w-6" />} label="Позвонить" />
          <ContactButton href={messageHref} icon={<ContactAssetIcon kind="message" className="h-5 w-5 sm:h-6 sm:w-6" />} label="Написать" />
      </div>
    </article>
  );
}

export function WorkPage() {
  const [demandTab, setDemandTab] = useState("Новые вакансии");
  const [supplyTab, setSupplyTab] = useState("Новые специалисты");
  const visibleDemand = demandTab === "Заказчики" ? workRequests : vacancies;
  const visibleSupply = supplyTab === "Исполнители" ? [...specialists].reverse() : specialists;

  return (
    <main className="page-container py-5 sm:py-8 lg:py-10">
      <nav className="mb-4 text-xs text-slate-500 sm:text-sm" aria-label="Хлебные крошки">
        <Link href="/blizhniy" className="hover:text-[#0875d1]">
          Краснодар
        </Link>
        <span className="mx-2">/</span>
        <span>Работа</span>
      </nav>

      <h1 className="text-3xl font-black tracking-normal text-[#060b27] sm:text-4xl lg:text-6xl">Работа</h1>

      <section className="mt-4 grid gap-3 sm:mt-5 lg:grid-cols-2 lg:gap-7">
        <article className="grid min-w-0 gap-2 rounded-xl border border-emerald-200 bg-emerald-50/45 p-3 shadow-card sm:flex sm:items-center sm:gap-4 lg:min-h-32 lg:gap-6 lg:p-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-white text-[#0aa337] shadow-card sm:h-12 sm:w-12 lg:h-24 lg:w-24">
            <BriefcaseBusiness className="h-5 w-5 sm:h-6 sm:w-6 lg:h-12 lg:w-12" />
          </span>
          <div className="min-w-0 flex-1">
            <SegmentTabs
              activeItem={demandTab}
              activeTone="green"
              items={["Новые вакансии", "Заказчики"]}
              onChange={setDemandTab}
            />
          </div>
        </article>

        <article className="grid min-w-0 gap-2 rounded-xl border border-blue-200 bg-blue-50/55 p-3 shadow-card sm:flex sm:items-center sm:gap-4 lg:min-h-32 lg:gap-6 lg:p-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-white text-[#0875d1] shadow-card sm:h-12 sm:w-12 lg:h-24 lg:w-24">
            <CircleUserRound className="h-5 w-5 sm:h-6 sm:w-6 lg:h-12 lg:w-12" />
          </span>
          <div className="min-w-0 flex-1">
            <SegmentTabs
              activeItem={supplyTab}
              activeTone="blue"
              items={["Новые специалисты", "Исполнители"]}
              onChange={setSupplyTab}
            />
          </div>
        </article>
      </section>

      <section className="mt-4 grid gap-2 sm:mt-5 sm:flex sm:flex-wrap sm:gap-3 lg:gap-4">
        <Link
          href="/blizhniy/rabota/vakansii/sozdat"
          className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg bg-[#0aa337] px-2 text-center text-xs font-bold leading-tight text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-10 sm:flex-none sm:px-4 sm:text-sm lg:h-12 lg:gap-3 lg:px-8 lg:text-base"
        >
          <BriefcaseBusiness className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
          Разместить вакансию
        </Link>
        <Link
          href="/blizhniy/rabota/specialisty/anketa"
          className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[#0aa337] bg-white px-2 text-center text-xs font-bold leading-tight text-[#0a8f32] transition hover:bg-emerald-50 sm:h-10 sm:flex-none sm:px-4 sm:text-sm lg:h-12 lg:gap-3 lg:px-8 lg:text-base"
        >
          <UserRound className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
          Создать анкету специалиста
        </Link>
      </section>

      <div className="mt-5 grid gap-6 sm:mt-7 lg:gap-8 xl:grid-cols-2">
        <section>
          <div className="mb-3 sm:mb-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex min-w-0 items-center gap-2 text-lg font-black text-[#060b27] sm:text-xl lg:gap-3 lg:text-2xl">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0aa337] text-white sm:h-9 sm:w-9">
                  <BriefcaseBusiness className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                {demandTab}
              </h2>
              <Link href={demandTab === "Заказчики" ? "/blizhniy/rabota/zakazy/sozdat" : "/blizhniy/rabota/vakansii"} className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0875d1] sm:text-base">
                Смотреть все
                <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-1">
            {visibleDemand.map((item) =>
              demandTab === "Заказчики" ? (
                <WorkRequestCard key={item.id} request={item as WorkRequest} />
              ) : (
                <VacancyCard key={item.id} vacancy={item as JobVacancy} />
              ),
            )}
          </div>
          <Link
            href={demandTab === "Заказчики" ? "/blizhniy/rabota/zakazy/sozdat" : "/blizhniy/rabota/vakansii"}
            className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 text-sm font-bold text-[#0a8f32] transition hover:bg-emerald-100 sm:mt-6 sm:h-14 sm:gap-3 sm:text-base"
          >
            {demandTab === "Заказчики" ? "Разместить заказ" : "Все вакансии"}
            <ChevronRight className="h-5 w-5" />
          </Link>
        </section>

        <section>
          <div className="mb-3 sm:mb-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex min-w-0 items-center gap-2 text-lg font-black text-[#060b27] sm:text-xl lg:gap-3 lg:text-2xl">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0875d1] text-white sm:h-9 sm:w-9">
                  <UserRound className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                {supplyTab}
              </h2>
              <Link href={supplyTab === "Исполнители" ? "/blizhniy/rabota/specialisty/anketa" : "/blizhniy/rabota/specialisty"} className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[#0875d1] sm:text-base">
                Смотреть все
                <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-1">
            {visibleSupply.map((specialist) => (
              <SpecialistCard key={specialist.id} specialist={specialist} />
            ))}
          </div>
          <Link
            href={supplyTab === "Исполнители" ? "/blizhniy/rabota/specialisty/anketa" : "/blizhniy/rabota/specialisty"}
            className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50/75 text-sm font-bold text-[#0875d1] transition hover:bg-blue-100 sm:mt-6 sm:h-14 sm:gap-3 sm:text-base"
          >
            {supplyTab === "Исполнители" ? "Создать анкету исполнителя" : "Все специалисты"}
            <ChevronRight className="h-5 w-5" />
          </Link>
        </section>
      </div>
    </main>
  );
}
