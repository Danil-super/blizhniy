import Link from "next/link";
import { Bell, ChevronDown, MapPin, Plus, Search, UserRound } from "lucide-react";
import { region } from "@/lib/data";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200/80 bg-white/85 backdrop-blur">
      <div className="page-container flex min-h-24 flex-col gap-4 py-4 lg:flex-row lg:items-center">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="БЛИЖНИЙ, главная">
          <span className="flex h-12 w-12 items-center justify-center" aria-hidden="true">
            <svg className="h-12 w-12" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="10" r="5" fill="#0875D1" />
              <circle cx="36" cy="10" r="5" fill="#0AA337" />
              <path
                d="M28 46C17.5 39.6 9 34.2 9 24.8C9 18.7 13.5 14.4 19.1 14.4C23 14.4 26 16.4 28 19.3C30 16.4 33 14.4 36.9 14.4C42.5 14.4 47 18.7 47 24.8C47 34.2 38.5 39.6 28 46Z"
                stroke="#0AA337"
                strokeWidth="4.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M27.8 45.8C17.4 39.4 9 34 9 24.8C9 18.7 13.5 14.4 19.1 14.4C23.1 14.4 26.1 16.5 28 19.5"
                stroke="#0875D1"
                strokeWidth="4.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M20.5 25.5L28 33L35.5 25.5" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-3xl font-black italic tracking-normal text-[#0a1437]">БЛИЖНИЙ</span>
        </Link>

        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-[250px_minmax(280px,1fr)_auto_auto_auto] lg:ml-8">
          <button className="flex h-14 items-center justify-between rounded-xl border border-slate-300 bg-white px-4 text-left text-slate-700">
            <span className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-slate-500" />
              <span>{region.name}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-slate-500" />
          </button>

          <label className="flex h-14 items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 text-slate-500">
            <Search className="h-6 w-6" />
            <input
              className="w-full border-0 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
              type="search"
              placeholder="Поиск объявлений, вакансий и специалистов"
            />
          </label>

          <button className="icon-button" aria-label="Уведомления">
            <Bell className="h-5 w-5" />
          </button>

          <Link className="icon-button" href="/cabinet" aria-label="Личный кабинет">
            <UserRound className="h-5 w-5" />
          </Link>

          <Link
            href="/blizhniy/sozdat"
            className="inline-flex h-14 items-center justify-center gap-3 rounded-xl bg-[#0aa337] px-7 font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-[#078a2e]"
          >
            <Plus className="h-6 w-6" />
            Разместить
          </Link>
        </div>
      </div>
      <nav className="page-container flex gap-2 overflow-x-auto pb-4 text-sm font-semibold text-slate-700" aria-label="Основная навигация">
        {[
          ["Объявления", "/blizhniy/prodam"],
          ["Работа", "/blizhniy/rabota"],
          ["Специалисты", "/blizhniy/rabota/specialisty"],
          ["Категории", "/blizhniy/kategorii"],
          ["Кабинет", "/cabinet"],
          ["Админка", "/admin"],
        ].map(([label, href]) => (
          <Link key={href} href={href} className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 transition hover:border-blue-200 hover:text-[#0875d1]">
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
