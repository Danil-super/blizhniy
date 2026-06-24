import Link from "next/link";
import { Gift, PlusCircle, Search, ShoppingBag, Tags } from "lucide-react";
import type { ListingKind } from "@/lib/types";

const listingEntries = [
  {
    href: "/obyavleniya?kind=prodam",
    kind: "prodam",
    title: "Продам",
    description: "Разместить или найти товары рядом",
    icon: ShoppingBag,
    activeTone: "border-blue-300 bg-blue-50 text-[#0875d1] ring-2 ring-blue-100",
    tone: "from-blue-50 via-white to-white text-[#0875d1] hover:border-blue-200",
  },
  {
    href: "/obyavleniya?kind=kuplyu",
    kind: "kuplyu",
    title: "Куплю",
    description: "Посмотреть, что ищут покупатели",
    icon: Tags,
    activeTone: "border-violet-300 bg-violet-50 text-violet-700 ring-2 ring-violet-100",
    tone: "from-violet-50 via-white to-white text-violet-700 hover:border-violet-200",
  },
  {
    href: "/obyavleniya?kind=otdam-darom",
    kind: "otdam-darom",
    title: "Отдам даром",
    description: "Бесплатные объявления рядом",
    icon: Gift,
    activeTone: "border-amber-300 bg-amber-50 text-amber-700 ring-2 ring-amber-100",
    tone: "from-amber-50 via-white to-white text-amber-700 hover:border-amber-200",
  },
] satisfies Array<{
  activeTone: string;
  description: string;
  href: string;
  icon: typeof ShoppingBag;
  kind: Extract<ListingKind, "kuplyu" | "otdam-darom" | "prodam">;
  title: string;
  tone: string;
}>;

export function ListingEntryNav({ activeKind }: { activeKind?: ListingKind }) {
  return (
    <section className="page-container pb-5 pt-2 sm:pb-7 sm:pt-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 lg:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Объявления</p>
            <h2 className="mt-1 text-xl font-black text-[#060b27] sm:text-2xl">Что хотите сделать?</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Выберите тип объявления: продать, купить или отдать бесплатно.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/katalog"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-[#0875d1] sm:h-11 sm:px-5"
            >
              <Search className="h-4 w-4" />
              Все категории
            </Link>
            <Link
              href="/razmestit/obyavlenie"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0aa337] px-4 text-sm font-black text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-11 sm:px-5"
            >
              <PlusCircle className="h-4 w-4" />
              Разместить
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {listingEntries.map((entry) => {
            const Icon = entry.icon;
            const active = activeKind === entry.kind;

            return (
              <Link
                key={entry.href}
                href={entry.href}
                aria-current={active ? "true" : undefined}
                className={`group relative overflow-hidden rounded-xl border bg-gradient-to-br p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card ${
                  active ? entry.activeTone : `border-slate-200 ${entry.tone}`
                }`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 shadow-sm ring-1 ring-white/80">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="mt-3 block text-base font-black text-[#060b27] group-hover:text-current">{entry.title}</span>
                <span className="mt-1 block text-sm leading-5 text-slate-600">{entry.description}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
