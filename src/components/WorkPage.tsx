import Link from "next/link";
import {
  BriefcaseBusiness,
  ChevronRight,
  CircleUserRound,
  Info,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  UserRound,
  Video,
} from "lucide-react";
import { professions, specialists, vacancies } from "@/lib/data";
import type { JobVacancy, SpecialistProfile } from "@/lib/types";

const chips = ["Все", "Вакансии", "Специалисты", "Краснодар", "Сочи", "Сантехник", "Маникюр", "Юрист"];

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

function VacancyCard({ vacancy }: { vacancy: JobVacancy }) {
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
            href={`/vakansiya/${vacancy.id}`}
            className="inline-flex h-10 min-w-32 items-center justify-center rounded-lg bg-[#0aa337] px-4 text-sm font-bold text-white transition hover:bg-[#078a2e]"
          >
            Откликнуться
          </Link>
          {vacancy.phone ? (
            <ContactButton href={`tel:${vacancy.phone}`} icon={<Phone className="h-4 w-4" />} label="Позвонить" tone="green" />
          ) : vacancy.messengerUrl ? (
            <ContactButton href={vacancy.messengerUrl} icon={<MessageCircle className="h-4 w-4" />} label="Написать" tone="violet" />
          ) : (
            <ContactButton href={`/vakansiya/${vacancy.id}`} icon={<Info className="h-4 w-4" />} label="Подробнее" tone="slate" />
          )}
        </div>
      </div>
    </article>
  );
}

function SpecialistCard({ specialist }: { specialist: SpecialistProfile }) {
  return (
    <article className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-[112px_1fr_auto] sm:items-center">
      <Avatar specialist={specialist} />
      <div className="min-w-0">
        <h3 className="text-xl font-black text-[#060b27]">{specialist.name}</h3>
        <Link href={`/specialist/${specialist.id}`} className="mt-1 block font-semibold text-[#0875d1]">
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
          <ContactButton href={specialist.phone ? `tel:${specialist.phone}` : undefined} icon={<Phone className="h-4 w-4" />} label="Позвонить" />
          <ContactButton
            href={specialist.videoUrl ?? specialist.messengerUrl}
            icon={specialist.videoUrl ? <Video className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
            label={specialist.videoUrl ? "Видеозвонок" : "Написать"}
          />
        </div>
      </div>
    </article>
  );
}

export function WorkPage() {
  return (
    <main className="page-container py-8 sm:py-10">
      <nav className="mb-5 text-sm text-slate-500" aria-label="Хлебные крошки">
        <Link href="/krasnodar" className="hover:text-[#0875d1]">
          Краснодар
        </Link>
        <span className="mx-2">/</span>
        <span>Работа</span>
      </nav>

      <h1 className="text-5xl font-black tracking-normal text-[#060b27] sm:text-6xl">Работа</h1>

      <section className="mt-6 grid gap-7 lg:grid-cols-2">
        <Link
          href="/krasnodar/rabota/vakansii"
          className="group flex min-h-32 items-center gap-6 rounded-2xl border border-emerald-200 bg-emerald-50/45 p-6 shadow-card transition hover:-translate-y-0.5 hover:border-emerald-300"
        >
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-white text-[#0aa337] shadow-card">
            <BriefcaseBusiness className="h-12 w-12" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-2xl font-black text-[#060b27]">Я ищу работу</span>
            <span className="mt-2 block text-lg text-slate-700">Вакансии от компаний и заказчиков</span>
          </span>
          <ChevronRight className="h-10 w-10 text-[#0aa337] transition group-hover:translate-x-1" />
        </Link>

        <Link
          href="/krasnodar/rabota/specialisty"
          className="group flex min-h-32 items-center gap-6 rounded-2xl border border-blue-200 bg-blue-50/55 p-6 shadow-card transition hover:-translate-y-0.5 hover:border-blue-300"
        >
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-white text-[#0875d1] shadow-card">
            <CircleUserRound className="h-12 w-12" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-2xl font-black text-[#060b27]">Я ищу специалиста</span>
            <span className="mt-2 block text-lg text-slate-700">Анкеты исполнителей и мастеров</span>
          </span>
          <ChevronRight className="h-10 w-10 text-[#0875d1] transition group-hover:translate-x-1" />
        </Link>
      </section>

      <section className="mt-6 flex flex-wrap gap-4">
        <Link
          href="/krasnodar/rabota/vakansii/sozdat"
          className="inline-flex h-12 items-center justify-center gap-3 rounded-lg bg-[#0aa337] px-8 font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e]"
        >
          <BriefcaseBusiness className="h-5 w-5" />
          Разместить вакансию
        </Link>
        <Link
          href="/krasnodar/rabota/specialisty/anketa"
          className="inline-flex h-12 items-center justify-center gap-3 rounded-lg border border-[#0aa337] bg-white px-8 font-bold text-[#0a8f32] transition hover:bg-emerald-50"
        >
          <UserRound className="h-5 w-5" />
          Создать анкету специалиста
        </Link>
      </section>

      <section className="mt-9 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          {chips.map((chip, index) => (
            <button
              className={`h-9 rounded-full border px-5 text-sm font-semibold transition ${
                index === 0
                  ? "border-[#0875d1] bg-[#0875d1] text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#0875d1]"
              }`}
              key={chip}
            >
              {chip}
            </button>
          ))}
        </div>
      </section>

      <div className="mt-7 grid gap-8 xl:grid-cols-2">
        <section>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-3 text-2xl font-black text-[#060b27]">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0aa337] text-white">
                <BriefcaseBusiness className="h-5 w-5" />
              </span>
              Новые вакансии / Заказчики
            </h2>
            <Link href="/krasnodar/rabota/vakansii" className="flex items-center gap-1 font-semibold text-[#0875d1]">
              Смотреть все
              <ChevronRight className="h-5 w-5" />
            </Link>
          </div>
          <div className="space-y-4">
            {vacancies.map((vacancy) => (
              <VacancyCard key={vacancy.id} vacancy={vacancy} />
            ))}
          </div>
          <Link
            href="/krasnodar/rabota/vakansii"
            className="mt-6 flex h-14 items-center justify-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 font-bold text-[#0a8f32] transition hover:bg-emerald-100"
          >
            Все вакансии
            <ChevronRight className="h-5 w-5" />
          </Link>
        </section>

        <section>
          <div className="mb-5 rounded-xl border border-blue-200 bg-white shadow-card">
            <label className="block px-4 pt-3 text-sm font-semibold text-slate-700" htmlFor="profession-search">
              Классификатор специалистов
            </label>
            <div className="mx-4 mt-2 flex h-12 items-center gap-3 rounded-lg border border-[#0875d1] px-3 text-slate-500">
              <Search className="h-5 w-5" />
              <input
                id="profession-search"
                list="profession-options"
                className="w-full border-0 bg-transparent outline-none placeholder:text-slate-400"
                placeholder="Начните вводить: юрист, швея, сварщик..."
              />
              <datalist id="profession-options">
                {professions.map((profession) => (
                  <option key={profession.slug} value={profession.name} />
                ))}
              </datalist>
            </div>
            <div className="px-4 py-3">
              {professions.slice(0, 3).map((profession) => (
                <Link key={profession.slug} href={`/krasnodar/rabota/specialisty/${profession.slug}`} className="block py-1 text-slate-700 hover:text-[#0875d1]">
                  {profession.name}
                </Link>
              ))}
              <Link href="/krasnodar/rabota/specialisty/klassifikator" className="mt-2 block font-semibold text-[#0875d1]">
                Показать все специальности
              </Link>
            </div>
          </div>

          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-3 text-2xl font-black text-[#060b27]">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0875d1] text-white">
                <UserRound className="h-5 w-5" />
              </span>
              Новые специалисты / Исполнители
            </h2>
            <Link href="/krasnodar/rabota/specialisty" className="flex items-center gap-1 font-semibold text-[#0875d1]">
              Смотреть все
              <ChevronRight className="h-5 w-5" />
            </Link>
          </div>
          <div className="space-y-4">
            {specialists.map((specialist) => (
              <SpecialistCard key={specialist.id} specialist={specialist} />
            ))}
          </div>
          <Link
            href="/krasnodar/rabota/specialisty"
            className="mt-6 flex h-14 items-center justify-center gap-3 rounded-xl border border-blue-200 bg-blue-50/75 font-bold text-[#0875d1] transition hover:bg-blue-100"
          >
            Все специалисты
            <ChevronRight className="h-5 w-5" />
          </Link>
        </section>
      </div>
    </main>
  );
}
