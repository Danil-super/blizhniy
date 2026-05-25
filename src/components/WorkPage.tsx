"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BriefcaseBusiness,
  ChevronRight,
  CircleUserRound,
  MapPin,
  MessageCircle,
  Phone,
  UserRound,
} from "lucide-react";
import { specialists, vacancies, workRequests } from "@/lib/data";
import type { JobVacancy, SpecialistProfile, WorkRequest } from "@/lib/types";

const chips = ["Все", "Вакансии", "Специалисты", "Краснодар", "Сочи", "Сантехник", "Маникюр", "Юрист"];
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
      className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-full border text-center text-sm font-black leading-4 ${tones[vacancy.logoTone]}`}
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
      className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${
        palettes[specialist.imageSeed] ?? "from-slate-100 to-blue-100"
      } text-3xl font-black shadow-inner`}
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
    blue: "border-[#0875d1] text-[#0875d1] hover:bg-blue-50",
    green: "border-[#0aa337] text-[#0a8f32] hover:bg-emerald-50",
    slate: "border-slate-300 text-slate-700 hover:bg-slate-50",
    violet: "border-violet-400 text-violet-700 hover:bg-violet-50",
  };

  const className = `inline-flex h-9 min-w-36 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition ${toneClass[tone]}`;

  if (!href) {
    return (
      <button className={`${className} cursor-not-allowed opacity-55`} disabled>
        {icon}
        {label}
      </button>
    );
  }

  return (
    <a href={href} className={className}>
      {icon}
      {label}
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
    <div className="grid w-full grid-cols-2 gap-3">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-bold transition ${
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
    <article className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-[112px_1fr_auto] sm:items-center">
      <LogoBadge vacancy={vacancy} />
      <div className="min-w-0">
        <p className="truncate text-sm text-slate-500">{vacancy.organization}</p>
        <h3 className="mt-1 text-xl font-black text-[#060b27]">{vacancy.title}</h3>
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <MapPin className="h-4 w-4" />
          {vacancy.city}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:items-end">
        <p className="text-xl font-black text-[#060b27]">{vacancy.salary}</p>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Link
            href={`/blizhniy/vakansiya/${vacancy.id}`}
            className="inline-flex h-10 min-w-32 items-center justify-center rounded-lg bg-[#0aa337] px-4 text-sm font-bold text-white transition hover:bg-[#078a2e]"
          >
            Откликнуться
          </Link>
          <ContactButton href={phoneHref} icon={<Phone className="h-4 w-4" />} label="Позвонить" tone="green" />
          <ContactButton href={messageHref} icon={<MessageCircle className="h-4 w-4" />} label="Написать" tone="violet" />
        </div>
      </div>
    </article>
  );
}

function WorkRequestCard({ request }: { request: WorkRequest }) {
  const phoneHref = `tel:${request.phone ?? demoPhone}`;
  const messageHref = request.messengerUrl ?? `https://wa.me/${(request.phone ?? demoPhone).replace(/\D/g, "")}`;

  return (
    <article className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-[112px_1fr_auto] sm:items-center">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-center text-sm font-black leading-4 text-[#0a8f32]">
        Заказ
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm text-slate-500">{request.author}</p>
        <h3 className="mt-1 text-xl font-black text-[#060b27]">{request.title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{request.description}</p>
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <MapPin className="h-4 w-4" />
          {[request.city, request.showExactAddress ? request.address : request.district].filter(Boolean).join(", ")}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:items-end">
        <p className="text-xl font-black text-[#060b27]">{request.budget}</p>
        <div className="flex flex-wrap gap-2 sm:flex-col">
          <ContactButton href={phoneHref} icon={<Phone className="h-4 w-4" />} label="Позвонить" tone="green" />
          <ContactButton href={messageHref} icon={<MessageCircle className="h-4 w-4" />} label="Написать" tone="violet" />
        </div>
      </div>
    </article>
  );
}

function SpecialistCard({ specialist }: { specialist: SpecialistProfile }) {
  const phoneHref = `tel:${specialist.phone ?? demoPhone}`;
  const messageHref = specialist.messengerUrl ?? supportMessengerUrl;

  return (
    <article className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-[112px_1fr_auto] sm:items-center">
      <Avatar specialist={specialist} />
      <div className="min-w-0">
        <h3 className="text-xl font-black text-[#060b27]">{specialist.name}</h3>
        <Link href={`/blizhniy/specialist/${specialist.id}`} className="mt-1 block font-semibold text-[#0875d1]">
          {specialist.profession}
        </Link>
        <p className="mt-2 text-sm text-slate-600">{specialist.skills}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
          <MapPin className="h-4 w-4" />
          {specialist.city}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:items-end">
        <p className="text-xl font-black text-[#060b27]">{specialist.price}</p>
        <div className="flex flex-wrap gap-2 sm:flex-col">
          <ContactButton href={phoneHref} icon={<Phone className="h-4 w-4" />} label="Позвонить" />
          <ContactButton href={messageHref} icon={<MessageCircle className="h-4 w-4" />} label="Написать" />
        </div>
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
    <main className="page-container py-8 sm:py-10">
      <nav className="mb-5 text-sm text-slate-500" aria-label="Хлебные крошки">
        <Link href="/blizhniy" className="hover:text-[#0875d1]">
          Краснодар
        </Link>
        <span className="mx-2">/</span>
        <span>Работа</span>
      </nav>

      <h1 className="text-5xl font-black tracking-normal text-[#060b27] sm:text-6xl">Работа</h1>

      <section className="mt-6 grid gap-7 lg:grid-cols-2">
        <article className="flex min-h-32 items-center gap-6 rounded-2xl border border-emerald-200 bg-emerald-50/45 p-6 shadow-card">
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-white text-[#0aa337] shadow-card">
            <BriefcaseBusiness className="h-12 w-12" />
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

        <article className="flex min-h-32 items-center gap-6 rounded-2xl border border-blue-200 bg-blue-50/55 p-6 shadow-card">
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-white text-[#0875d1] shadow-card">
            <CircleUserRound className="h-12 w-12" />
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

      <section className="mt-6 flex flex-wrap gap-4">
        <Link
          href="/blizhniy/rabota/vakansii/sozdat"
          className="inline-flex h-12 items-center justify-center gap-3 rounded-lg bg-[#0aa337] px-8 font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e]"
        >
          <BriefcaseBusiness className="h-5 w-5" />
          Разместить вакансию
        </Link>
        <Link
          href="/blizhniy/rabota/specialisty/anketa"
          className="inline-flex h-12 items-center justify-center gap-3 rounded-lg border border-[#0aa337] bg-white px-8 font-bold text-[#0a8f32] transition hover:bg-emerald-50"
        >
          <UserRound className="h-5 w-5" />
          Создать анкету специалиста
        </Link>
      </section>

      <section className="mt-9 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {chips.map((chip, index) => (
            <Link
              href={index === 0 ? "/blizhniy/rabota" : `/poisk?q=${encodeURIComponent(chip)}`}
              className={`inline-flex h-9 items-center justify-center rounded-full border px-5 text-sm font-semibold transition ${
                index === 0
                  ? "border-[#0875d1] bg-[#0875d1] text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
              }`}
              key={chip}
            >
              {chip}
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-7 grid gap-8 xl:grid-cols-2">
        <section>
          <div className="mb-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="flex items-center gap-3 text-2xl font-black text-[#060b27]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0aa337] text-white">
                  <BriefcaseBusiness className="h-5 w-5" />
                </span>
                {demandTab}
              </h2>
              <Link href={demandTab === "Заказчики" ? "/blizhniy/rabota/vakansii/sozdat" : "/blizhniy/rabota/vakansii"} className="flex items-center gap-1 font-semibold text-[#0875d1]">
                Смотреть все
                <ChevronRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
          <div className="space-y-4">
            {visibleDemand.map((item) =>
              demandTab === "Заказчики" ? (
                <WorkRequestCard key={item.id} request={item as WorkRequest} />
              ) : (
                <VacancyCard key={item.id} vacancy={item as JobVacancy} />
              ),
            )}
          </div>
          <Link
            href={demandTab === "Заказчики" ? "/blizhniy/rabota/vakansii/sozdat" : "/blizhniy/rabota/vakansii"}
            className="mt-6 flex h-14 items-center justify-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 font-bold text-[#0a8f32] transition hover:bg-emerald-100"
          >
            {demandTab === "Заказчики" ? "Разместить заказ" : "Все вакансии"}
            <ChevronRight className="h-5 w-5" />
          </Link>
        </section>

        <section>
          <div className="mb-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="flex items-center gap-3 text-2xl font-black text-[#060b27]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0875d1] text-white">
                  <UserRound className="h-5 w-5" />
                </span>
                {supplyTab}
              </h2>
              <Link href={supplyTab === "Исполнители" ? "/blizhniy/rabota/specialisty/anketa" : "/blizhniy/rabota/specialisty"} className="flex items-center gap-1 font-semibold text-[#0875d1]">
                Смотреть все
                <ChevronRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
          <div className="space-y-4">
            {visibleSupply.map((specialist) => (
              <SpecialistCard key={specialist.id} specialist={specialist} />
            ))}
          </div>
          <Link
            href={supplyTab === "Исполнители" ? "/blizhniy/rabota/specialisty/anketa" : "/blizhniy/rabota/specialisty"}
            className="mt-6 flex h-14 items-center justify-center gap-3 rounded-xl border border-blue-200 bg-blue-50/75 font-bold text-[#0875d1] transition hover:bg-blue-100"
          >
            {supplyTab === "Исполнители" ? "Создать анкету исполнителя" : "Все специалисты"}
            <ChevronRight className="h-5 w-5" />
          </Link>
        </section>
      </div>
    </main>
  );
}
