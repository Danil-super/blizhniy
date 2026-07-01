import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ArrowRight,
  Baby,
  BriefcaseBusiness,
  Building2,
  Car,
  ChevronRight,
  ClipboardList,
  Gift,
  Hammer,
  HeartPulse,
  Home,
  Leaf,
  MapPin,
  MoreHorizontal,
  PawPrint,
  Search,
  ShieldCheck,
  Shirt,
  Sparkles,
  Sprout,
  Utensils,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { SubcategoryShareButton } from "@/components/listings/SubcategoryShareButton";

type CategoryVisual = {
  accent: string;
  border: string;
  icon: LucideIcon;
  soft: string;
};

type CategoryHeaderBandProps = {
  categorySlug: string;
  createHref: string;
  description?: string;
  title: string;
};

type SubcategoryCardProps = {
  compact?: boolean;
  createHref: string;
  description: string;
  href: string;
  items?: string[];
  spanClassName?: string;
  title: string;
  visualSlug: string;
};

const defaultVisual: CategoryVisual = {
  accent: "#0875d1",
  border: "#bfdbfe",
  icon: Sparkles,
  soft: "#eff6ff",
};

const categoryVisuals: Record<string, CategoryVisual> = {
  biznes: { accent: "#0875d1", border: "#93c5fd", icon: BriefcaseBusiness, soft: "#e9f4ff" },
  "dlya-doma-i-dachi": { accent: "#0aa337", border: "#9be15d", icon: Home, soft: "#edffd8" },
  elektronika: { accent: "#2563eb", border: "#bfdbfe", icon: Search, soft: "#eff6ff" },
  instrumenty: { accent: "#0aa337", border: "#9be15d", icon: Hammer, soft: "#edffd8" },
  "krasota-i-uhod": { accent: "#0aa337", border: "#86efac", icon: HeartPulse, soft: "#ecfdf3" },
  "menyayu-ili-otdam-darom": { accent: "#0aa337", border: "#9be15d", icon: Gift, soft: "#edffd8" },
  nedvizhimost: { accent: "#0875d1", border: "#93c5fd", icon: Building2, soft: "#e9f4ff" },
  "odezhda-obuv-aksessuary": { accent: "#0aa337", border: "#86efac", icon: Shirt, soft: "#ecfdf3" },
  otdyh: { accent: "#0aa337", border: "#9be15d", icon: Sparkles, soft: "#edffd8" },
  posuda: { accent: "#b7791f", border: "#fde68a", icon: Utensils, soft: "#fffbeb" },
  rabota: { accent: "#0875d1", border: "#bfdbfe", icon: BriefcaseBusiness, soft: "#eff6ff" },
  raznoe: { accent: "#0aa337", border: "#9be15d", icon: MoreHorizontal, soft: "#edffd8" },
  "ritualnye-uslugi": { accent: "#52616f", border: "#cbd5e1", icon: ShieldCheck, soft: "#f8fafc" },
  "sad-i-rasteniya": { accent: "#0aa337", border: "#9be15d", icon: Sprout, soft: "#edffd8" },
  transport: { accent: "#0875d1", border: "#93c5fd", icon: Car, soft: "#e9f4ff" },
  "tovary-dlya-detey": { accent: "#0aa337", border: "#86efac", icon: Baby, soft: "#ecfdf3" },
  "uslugi-dlya-doma": { accent: "#0aa337", border: "#9be15d", icon: Wrench, soft: "#edffd8" },
  zhivotnye: { accent: "#0aa337", border: "#9be15d", icon: PawPrint, soft: "#edffd8" },
};

function visualForCategory(slug: string) {
  return categoryVisuals[slug] ?? defaultVisual;
}

function visualStyle(visual: CategoryVisual): CSSProperties {
  return {
    "--category-accent": visual.accent,
    "--category-border": visual.border,
    "--category-soft": visual.soft,
  } as CSSProperties;
}

export function CategoryHeaderBand({
  categorySlug,
  createHref,
  description,
  title,
}: CategoryHeaderBandProps) {
  const visual = visualForCategory(categorySlug);

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-[var(--category-border)] bg-[var(--category-soft)] px-4 py-5 shadow-md shadow-emerald-100/60 sm:px-5 sm:py-6 lg:px-7 lg:py-7"
      style={visualStyle(visual)}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.34fr)] lg:items-end">
        <div className="min-w-0">
          <h1 className="max-w-4xl [overflow-wrap:anywhere] text-2xl font-bold leading-tight text-[#060b27] sm:text-3xl lg:text-4xl">{title}</h1>
          {description ? <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-700 sm:text-base sm:leading-7">{description}</p> : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href={createHref}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0aa337] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e]"
            >
              Разместить
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#listings"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--category-border)] bg-white px-4 text-sm font-bold text-[var(--category-accent)] transition hover:bg-white/80"
            >
              Смотреть объявления
              <ClipboardList className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div className="grid gap-2 rounded-xl bg-white/80 p-3 ring-1 ring-[var(--category-border)]">
          <span className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold leading-5 text-slate-700 shadow-sm">
            <MapPin className="h-4 w-4 shrink-0 text-[var(--category-accent)]" />
            Районы, города и предложения рядом
          </span>
          <span className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold leading-5 text-slate-700 shadow-sm">
            <Leaf className="h-4 w-4 shrink-0 text-[var(--category-accent)]" />
            Быстрый переход к нужной подкатегории
          </span>
        </div>
      </div>
    </section>
  );
}

export function SubcategoryCard({ compact = false, createHref, description, href, items = [], spanClassName = "", title, visualSlug }: SubcategoryCardProps) {
  const visual = visualForCategory(visualSlug);
  const actionButtonClassName = `${compact ? "h-8 px-1 text-[11px] sm:h-9 sm:px-1.5 sm:text-xs" : "h-10 px-1.5 text-xs sm:px-2 sm:text-sm"} inline-flex min-w-0 items-center justify-center rounded-lg border font-bold leading-none transition`;

  return (
    <details
      className={`group min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--category-border)] hover:shadow-md open:border-[var(--category-border)] ${spanClassName}`}
      style={visualStyle(visual)}
    >
      <summary className={`flex cursor-pointer list-none items-center justify-between marker:hidden [&::-webkit-details-marker]:hidden ${compact ? "min-h-12 gap-2 p-2.5" : "min-h-14 gap-3 p-3"}`}>
        <span className={`min-w-0 self-center break-words font-bold text-[#142315] [overflow-wrap:anywhere] ${compact ? "text-xs leading-4 sm:text-[15px] sm:leading-5" : "text-sm leading-5 sm:text-[15px]"}`}>
          {title}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-90 group-open:text-[var(--category-accent)]" />
      </summary>

      <div className={`border-t border-slate-100 ${compact ? "px-2.5 pb-2.5" : "px-3 pb-3"}`}>
        <p className={`break-words font-medium text-slate-700 [overflow-wrap:anywhere] ${compact ? "mt-2 text-xs leading-5 sm:text-sm sm:leading-6" : "mt-3 text-sm leading-6"}`}>{description}</p>
        {items.length ? (
          <ul className={`${compact ? "mt-2" : "mt-3"} grid gap-1.5 text-xs font-semibold leading-5 text-slate-600 sm:text-sm`}>
            {items.slice(0, 6).map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--category-accent)]" />
                <span className="break-words [overflow-wrap:anywhere]">{item}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className={`${compact ? "mt-2 gap-1" : "mt-3 gap-1.5"} grid grid-cols-3`}>
          <Link
            href={href}
            className={`${actionButtonClassName} border-[var(--category-border)] bg-white text-[var(--category-accent)] hover:bg-[var(--category-soft)]`}
            aria-label={`Открыть объявления: ${title}`}
            title="Объявления"
          >
            <span className="min-w-0 whitespace-nowrap">Объявления</span>
          </Link>
          <Link
            href={createHref}
            className={`${actionButtonClassName} border-[#0aa337] bg-[#0aa337] text-white hover:bg-[#078a2e]`}
            aria-label={`Разместить объявление: ${title}`}
            title="Разместить"
          >
            <span className="min-w-0 whitespace-nowrap">Разместить</span>
          </Link>
          <SubcategoryShareButton
            className={`${actionButtonClassName} border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1]`}
            href={href}
            label="Поделиться"
            title={title}
          />
        </div>
      </div>
    </details>
  );
}
