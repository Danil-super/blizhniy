"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Baby,
  BriefcaseBusiness,
  Building2,
  Car,
  Cog,
  Ellipsis,
  Gift,
  HeartPulse,
  MapPinned,
  PawPrint,
  Shirt,
  Smartphone,
  Sofa,
  Sprout,
  Store,
  TentTree,
  Wrench,
} from "lucide-react";
import {
  categoryDisplayItems,
  categoryDisplayOrderEventName,
  orderCategoryDisplayItems,
  readCategoryDisplayOrder,
} from "@/lib/category-display-order";

function MemorialIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 23V10.5C11 7.5 13.2 5 16 5s5 2.5 5 5.5V23" fill="currentColor" fillOpacity="0.12" />
      <path d="M11 23V10.5C11 7.5 13.2 5 16 5s5 2.5 5 5.5V23" />
      <path d="M8 23h16" />
      <path d="M6 27h20" />
      <path d="M4 30h24" />
      <path d="M14 12.5h4" />
      <path d="M13 17h6" />
      <path d="M13.5 20.5h5" />
    </svg>
  );
}

const categoryTones = {
  blue: {
    card: "from-blue-50 via-white to-white hover:border-blue-200",
    accent: "bg-[#0875d1]",
    icon: "bg-blue-100 text-[#0875d1] ring-blue-200",
    glow: "bg-blue-100",
  },
  green: {
    card: "from-emerald-50 via-white to-white hover:border-emerald-200",
    accent: "bg-[#0a8f32]",
    icon: "bg-emerald-100 text-[#0a8f32] ring-emerald-200",
    glow: "bg-emerald-100",
  },
  amber: {
    card: "from-amber-50 via-white to-white hover:border-amber-200",
    accent: "bg-amber-500",
    icon: "bg-amber-100 text-amber-700 ring-amber-200",
    glow: "bg-amber-100",
  },
  violet: {
    card: "from-violet-50 via-white to-white hover:border-violet-200",
    accent: "bg-violet-500",
    icon: "bg-violet-100 text-violet-700 ring-violet-200",
    glow: "bg-violet-100",
  },
  rose: {
    card: "from-rose-50 via-white to-white hover:border-rose-200",
    accent: "bg-rose-500",
    icon: "bg-rose-100 text-rose-700 ring-rose-200",
    glow: "bg-rose-100",
  },
  cyan: {
    card: "from-cyan-50 via-white to-white hover:border-cyan-200",
    accent: "bg-cyan-500",
    icon: "bg-cyan-100 text-cyan-700 ring-cyan-200",
    glow: "bg-cyan-100",
  },
  slate: {
    card: "from-slate-100 via-white to-white hover:border-slate-300",
    accent: "bg-slate-500",
    icon: "bg-slate-100 text-slate-700 ring-slate-200",
    glow: "bg-slate-100",
  },
};

type CategoryTile = {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tone: keyof typeof categoryTones;
  ageRating?: string;
  iconClassName?: string;
};

const categoryTileVisuals: Record<string, Omit<CategoryTile, "id" | "label" | "href">> = {
  "zhivotnye": { icon: PawPrint, tone: "amber", ageRating: "7+" },
  "sad-i-ogorod": { icon: Sprout, tone: "green" },
  "tovary-dlya-detey": { icon: Baby, tone: "rose", ageRating: "7+" },
  "ritualnye-uslugi": { icon: MemorialIcon, tone: "slate", iconClassName: "h-8 w-8 sm:h-9 sm:w-9 lg:h-10 lg:w-10" },
  "nedvizhimost": { icon: Building2, tone: "green" },
  "rabota": { icon: BriefcaseBusiness, tone: "cyan", ageRating: "14+" },
  "odezhda-obuv-aksessuary": { icon: Shirt, tone: "rose" },
  "hobbi-i-otdyh": { icon: TentTree, tone: "green" },
  "transport": { icon: Car, tone: "blue" },
  "biznes": { icon: Store, tone: "violet" },
  "uslugi": { icon: Wrench, tone: "blue" },
  "elektronika": { icon: Smartphone, tone: "cyan" },
  "dlya-doma-i-dachi": { icon: Sofa, tone: "amber" },
  "zapchasti": { icon: Cog, tone: "slate" },
  "zhile-dlya-puteshestviya": { icon: MapPinned, tone: "green" },
  "krasota-i-zdorove": { icon: HeartPulse, tone: "violet" },
  "obmen-i-darom": { icon: Gift, tone: "green" },
  "raznoe": { icon: Ellipsis, tone: "slate" },
};

const categoryTiles: CategoryTile[] = categoryDisplayItems.map((item) => ({
  ...item,
  ...categoryTileVisuals[item.id],
}));

export function CategoryGrid({ variant = "scroll" }: { variant?: "scroll" | "grid" }) {
  const [displayOrder, setDisplayOrder] = useState<string[] | null>(null);
  const outerClassName = variant === "scroll" ? "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "";
  const gridClassName =
    variant === "scroll"
      ? "grid grid-flow-col grid-rows-2 auto-cols-[132px] gap-2 sm:grid-flow-row sm:grid-rows-none sm:grid-cols-[repeat(auto-fit,minmax(132px,1fr))] sm:auto-cols-auto lg:grid-cols-[repeat(auto-fit,minmax(142px,1fr))]"
      : "grid grid-cols-[repeat(auto-fit,minmax(min(100%,132px),1fr))] gap-2 lg:grid-cols-[repeat(auto-fit,minmax(142px,1fr))]";
  const orderedCategoryTiles = useMemo(() => orderCategoryDisplayItems(categoryTiles, displayOrder), [displayOrder]);

  useEffect(() => {
    const syncOrder = () => setDisplayOrder(readCategoryDisplayOrder());

    syncOrder();
    window.addEventListener("storage", syncOrder);
    window.addEventListener(categoryDisplayOrderEventName, syncOrder);

    return () => {
      window.removeEventListener("storage", syncOrder);
      window.removeEventListener(categoryDisplayOrderEventName, syncOrder);
    };
  }, []);

  return (
    <section className="page-container pb-6 pt-3 sm:pb-8">
      <div className={outerClassName}>
        <div className={gridClassName}>
          {orderedCategoryTiles.map((category) => {
            const Icon = category.icon;
            const tone = categoryTones[category.tone as keyof typeof categoryTones];

            return (
              <div key={`${category.label}-${category.href}`} className={`group relative flex min-h-24 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card sm:min-h-28 sm:p-3 lg:min-h-32 ${tone.card}`}>
                <span className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 ${tone.accent}`} />
                <span className={`pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full opacity-70 blur-sm transition group-hover:scale-110 sm:h-24 sm:w-24 ${tone.glow}`} />
                {category.ageRating ? (
                  <span className="absolute right-2 top-2 z-10 inline-flex h-6 min-w-8 items-center justify-center rounded-full border border-white/80 bg-white/90 px-1.5 text-[11px] font-black text-slate-700 shadow-sm">
                    {category.ageRating}
                  </span>
                ) : null}
                <div className="relative">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl ring-1 shadow-sm transition group-hover:scale-105 sm:h-12 sm:w-12 lg:h-14 lg:w-14 ${tone.icon}`}>
                    <Icon className={category.iconClassName ?? "h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8"} />
                  </span>
                  <Link href={category.href} className="mt-2 line-clamp-3 block break-normal text-xs font-black leading-4 text-slate-950 hyphens-none group-hover:text-[#0875d1] sm:text-[13px] sm:leading-[18px] lg:text-sm lg:leading-5">
                    {category.label}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
