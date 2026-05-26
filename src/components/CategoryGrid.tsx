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
  blue: "bg-blue-50 text-[#0875d1] ring-blue-100",
  green: "bg-emerald-50 text-[#0a8f32] ring-emerald-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  violet: "bg-violet-50 text-violet-700 ring-violet-100",
  rose: "bg-rose-50 text-rose-700 ring-rose-100",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
};

const categoryTiles = [
  {
    label: "Авто",
    href: "/blizhniy/transport",
    icon: Car,
    tone: "blue",
    quickLinks: [
      { label: "Продам", href: "/blizhniy/transport/prodam-avto" },
      { label: "Куплю", href: "/blizhniy/transport/kuplyu-avto" },
    ],
  },
  {
    label: "Недвижимость",
    href: "/blizhniy/nedvizhimost",
    icon: Building2,
    tone: "green",
    quickLinks: [
      { label: "Продам", href: "/blizhniy/nedvizhimost/prodam-nedvizhimost" },
      { label: "Куплю", href: "/blizhniy/nedvizhimost/kuplyu-nedvizhimost" },
    ],
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
    quickLinks: [
      { label: "Продам", href: "/blizhniy/biznes/prodam-biznes" },
      { label: "Куплю", href: "/blizhniy/biznes/kuplyu-biznes" },
    ],
  },
  { label: "Услуги", href: "/blizhniy/uslugi-dlya-doma", icon: Wrench, tone: "blue" },
  { label: "Электроника", href: "/blizhniy/kategorii", icon: Smartphone, tone: "cyan" },
  { label: "Для дома и дачи", href: "/blizhniy/mebel-i-interer", icon: Sofa, tone: "amber" },
  { label: "Запчасти", href: "/blizhniy/transport/zapchasti", icon: Cog, tone: "slate" },
  { label: "Товары для детей", href: "/blizhniy/tovary-i-veshchi", icon: Baby, tone: "rose" },
  { label: "Жилье для путешествия", href: "/blizhniy/nedvizhimost/arenda", icon: MapPinned, tone: "green" },
  { label: "Красота и здоровье", href: "/blizhniy/krasota-i-uhod", icon: HeartPulse, tone: "violet" },
  { label: "Ритуальные услуги", href: "/blizhniy/ritualnye-uslugi", icon: Flower2, tone: "slate" },
  { label: "Меняю и отдам даром", href: "/blizhniy/obmen-i-darom", icon: Gift, tone: "green" },
];

export function CategoryGrid({ variant = "scroll" }: { variant?: "scroll" | "grid" }) {
  const outerClassName = variant === "scroll" ? "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "";
  const gridClassName =
    variant === "scroll"
      ? "grid grid-flow-col grid-rows-2 auto-cols-[160px] gap-2 sm:grid-flow-row sm:grid-rows-none sm:grid-cols-3 sm:auto-cols-auto md:grid-cols-4 lg:grid-cols-7"
      : "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7";

  return (
    <section className="page-container pb-6 pt-3 sm:pb-8">
      <div className={outerClassName}>
        <div className={gridClassName}>
          {categoryTiles.map((category) => {
            const Icon = category.icon;
            const tone = categoryTones[category.tone as keyof typeof categoryTones];

            return (
              <div key={`${category.label}-${category.href}`} className="group flex min-h-32 flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-card sm:min-h-36">
                <div>
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 ${tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <Link href={category.href} className="mt-3 line-clamp-2 block text-sm font-black leading-5 text-slate-950 [overflow-wrap:anywhere] group-hover:text-[#0875d1]">
                    {category.label}
                  </Link>
                </div>
                {category.quickLinks ? (
                  <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
                    {category.quickLinks.slice(0, 3).map((link) => (
                      <Link key={link.href} href={link.href} className="min-w-0 rounded-full bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-blue-50 hover:text-[#0875d1]">
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
