import Link from "next/link";
import {
  Baby,
  BriefcaseBusiness,
  Building2,
  Car,
  Cog,
  Flower2,
  Gift,
  HeartPulse,
  MapPinned,
  PawPrint,
  Shirt,
  Smartphone,
  Sofa,
  Store,
  TentTree,
  Wrench,
} from "lucide-react";

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

const categoryTiles = [
  {
    label: "Авто",
    href: "/blizhniy/transport",
    icon: Car,
    tone: "blue",
  },
  {
    label: "Недвижимость",
    href: "/blizhniy/nedvizhimost",
    icon: Building2,
    tone: "green",
  },
  { label: "Работа", href: "/blizhniy/rabota", icon: BriefcaseBusiness, tone: "cyan" },
  { label: "Одежда, обувь, аксессуары", href: "/blizhniy/tovary-i-veshchi", icon: Shirt, tone: "rose" },
  { label: "Хобби и отдых", href: "/blizhniy/otdyh", icon: TentTree, tone: "green" },
  { label: "Животные", href: "/blizhniy/zhivotnye", icon: PawPrint, tone: "amber" },
  {
    label: "Готовый бизнес и оборудование",
    href: "/blizhniy/biznes",
    icon: Store,
    tone: "violet",
  },
  { label: "Услуги", href: "/blizhniy/uslugi-dlya-doma", icon: Wrench, tone: "blue" },
  {
    label: "Электроника",
    href: "/blizhniy/elektronika",
    icon: Smartphone,
    tone: "cyan",
  },
  { label: "Для дома и дачи", href: "/blizhniy/mebel-i-interer", icon: Sofa, tone: "amber" },
  { label: "Запчасти", href: "/blizhniy/transport/zapchasti", icon: Cog, tone: "slate" },
  { label: "Товары для детей", href: "/blizhniy/tovary-i-veshchi", icon: Baby, tone: "rose" },
  { label: "Жилье для путешествия", href: "/blizhniy/nedvizhimost/arenda", icon: MapPinned, tone: "green" },
  { label: "Красота и здоровье", href: "/blizhniy/krasota-i-uhod", icon: HeartPulse, tone: "violet" },
  { label: "Ритуальные услуги", href: "/blizhniy/ritualnye-uslugi", icon: Flower2, tone: "slate" },
  { label: "Меняю и отдам даром", href: "/blizhniy/obmen-i-darom", icon: Gift, tone: "green" },
];

const orderedCategoryTiles = [...categoryTiles].sort((left, right) => left.label.length - right.label.length || left.label.localeCompare(right.label, "ru"));

export function CategoryGrid({ variant = "scroll" }: { variant?: "scroll" | "grid" }) {
  const outerClassName = variant === "scroll" ? "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "";
  const gridClassName =
    variant === "scroll"
      ? "grid grid-flow-col grid-rows-2 auto-cols-[154px] gap-2 sm:grid-flow-row sm:grid-rows-none sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] sm:auto-cols-auto lg:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]"
      : "grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2 sm:gap-3 lg:grid-cols-[repeat(auto-fit,minmax(165px,1fr))]";

  return (
    <section className="page-container pb-6 pt-3 sm:pb-8">
      <div className={outerClassName}>
        <div className={gridClassName}>
          {orderedCategoryTiles.map((category) => {
            const Icon = category.icon;
            const tone = categoryTones[category.tone as keyof typeof categoryTones];

            return (
              <div key={`${category.label}-${category.href}`} className={`group relative flex min-h-32 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card sm:min-h-40 sm:p-4 lg:min-h-44 ${tone.card}`}>
                <span className={`pointer-events-none absolute inset-x-0 top-0 h-1 ${tone.accent}`} />
                <span className={`pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-70 blur-sm transition group-hover:scale-110 sm:h-32 sm:w-32 ${tone.glow}`} />
                <div className="relative">
                  <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ring-1 shadow-sm transition group-hover:scale-105 sm:h-16 sm:w-16 lg:h-[72px] lg:w-[72px] ${tone.icon}`}>
                    <Icon className="h-7 w-7 sm:h-8 sm:w-8 lg:h-9 lg:w-9" />
                  </span>
                  <Link href={category.href} className="mt-3 line-clamp-4 block break-normal text-[13px] font-black leading-5 text-slate-950 hyphens-none group-hover:text-[#0875d1] sm:mt-4 sm:text-sm sm:leading-5 lg:text-[15px]">
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
