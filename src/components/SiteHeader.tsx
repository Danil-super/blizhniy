import Link from "next/link";
import { Bell, ChevronDown, MapPin, Plus, Search } from "lucide-react";
import { region } from "@/lib/data";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200/80 bg-white/85 backdrop-blur">
      <div className="page-container flex min-h-24 flex-col gap-4 py-4 lg:flex-row lg:items-center">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="БЛИЖНИЙ, главная">
          <span className="relative h-12 w-12 rounded-2xl border border-emerald-100 bg-white">
            <span className="absolute left-2 top-3 h-4 w-4 rounded-full bg-[#0875d1]" />
            <span className="absolute right-2 top-3 h-4 w-4 rounded-full bg-[#0aa337]" />
            <span className="absolute bottom-2 left-1/2 h-6 w-9 -translate-x-1/2 rounded-b-2xl border-4 border-[#0aa337] border-t-0" />
            <span className="absolute bottom-3 left-2 h-6 w-5 rotate-45 rounded-b-xl border-4 border-[#0875d1] border-r-0 border-t-0" />
          </span>
          <span className="text-3xl font-black tracking-normal text-[#0a1437]">БЛИЖНИЙ</span>
        </Link>

        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-[250px_minmax(280px,1fr)_auto_auto] lg:ml-8">
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
              placeholder="Поиск вакансий и специалистов"
            />
          </label>

          <button className="icon-button" aria-label="Уведомления">
            <Bell className="h-5 w-5" />
          </button>

          <Link
            href="/krasnodar/sozdat"
            className="inline-flex h-14 items-center justify-center gap-3 rounded-xl bg-[#0aa337] px-7 font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-[#078a2e]"
          >
            <Plus className="h-6 w-6" />
            Разместить
          </Link>
        </div>
      </div>
    </header>
  );
}
