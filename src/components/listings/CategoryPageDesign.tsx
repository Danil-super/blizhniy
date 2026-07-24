import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight, ChevronRight, ClipboardList, Leaf, MapPin } from "lucide-react";
import { SubcategoryShareButton } from "@/components/listings/SubcategoryShareButton";

type CategoryVisual = {
  accent: string;
  border: string;
  card: string;
  cardOpen: string;
  page: string;
  primary?: string;
  primaryHover?: string;
  secondary?: string;
  secondaryBorder?: string;
  soft: string;
  title?: string;
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
  accent: "#075f9f",
  border: "#8fc8f4",
  card: "#dcefff",
  cardOpen: "#eaf6ff",
  page: "#eef7ff",
  soft: "#cfeaff",
};

const categoryVisuals: Record<string, CategoryVisual> = {
  biznes: { accent: "#16636b", border: "#72cec5", card: "#cef3ef", cardOpen: "#e2f8f5", page: "#edfbfb", soft: "#b9ece8" },
  "dlya-doma-i-dachi": { accent: "#526a14", border: "#b3cf55", card: "#eaf4bf", cardOpen: "#f3f8d9", page: "#f7fbe9", soft: "#e0ef9f" },
  elektronika: { accent: "#2453a0", border: "#7fa8ee", card: "#d3e3ff", cardOpen: "#e4edff", page: "#eef4ff", soft: "#bcd5ff" },
  instrumenty: { accent: "#2d6577", border: "#7fb7c9", card: "#d0e9f1", cardOpen: "#e2f2f6", page: "#edf8fb", soft: "#b9deea" },
  "krasota-i-uhod": { accent: "#8a3159", border: "#e58ab0", card: "#fbd6e6", cardOpen: "#fde7f0", page: "#fff1f7", soft: "#f8c4da" },
  "menyayu-ili-otdam-darom": { accent: "#2f6f38", border: "#83ca87", card: "#d4efd4", cardOpen: "#e6f7e6", page: "#effaf0", soft: "#bde7be" },
  nedvizhimost: { accent: "#17657a", border: "#6ec6d8", card: "#ccecf2", cardOpen: "#e0f4f7", page: "#edfafd", soft: "#b1e3eb" },
  "odezhda-obuv-aksessuary": { accent: "#873f50", border: "#df94a6", card: "#f6d7de", cardOpen: "#fae8ec", page: "#fff3f5", soft: "#f2c2cd" },
  otdyh: { accent: "#26704a", border: "#75c79d", card: "#ccefdc", cardOpen: "#e0f7ea", page: "#eefbf4", soft: "#afe5c8" },
  posuda: { accent: "#78601a", border: "#d7b94f", card: "#f7e9ad", cardOpen: "#fbf2cf", page: "#fffbea", soft: "#f2dc83" },
  rabota: { accent: "#237142", border: "#75ca94", card: "#ccefd8", cardOpen: "#dff7e8", page: "#eefbf3", soft: "#afe4c2" },
  raznoe: { accent: "#3c6075", border: "#8bb8ce", card: "#d8eaf2", cardOpen: "#e8f3f7", page: "#f0f8fb", soft: "#c5e0eb" },
  "ritualnye-uslugi": {
    accent: "#36545f",
    border: "#9fb1bd",
    card: "#e6eee9",
    cardOpen: "#f1f6f2",
    page: "#f2f7f4",
    primary: "#25313a",
    primaryHover: "#111820",
    secondary: "#25313a",
    secondaryBorder: "#a8b5bd",
    soft: "#d4e2d9",
    title: "#111820",
  },
  "sad-i-rasteniya": {
    accent: "#24752f",
    border: "#7fbd4f",
    card: "#cfeaac",
    cardOpen: "#dff3c7",
    page: "#e7f6dc",
    primary: "#d92d20",
    primaryHover: "#b42318",
    secondary: "#c6251a",
    secondaryBorder: "#e6857d",
    soft: "#b2c887",
    title: "#176b2a",
  },
  transport: { accent: "#1f6182", border: "#75b9d7", card: "#cee9f5", cardOpen: "#e2f3fa", page: "#eef9fd", soft: "#b7deef" },
  "tovary-dlya-detey": { accent: "#92551c", border: "#e4a85f", card: "#f9dfbd", cardOpen: "#fcebd5", page: "#fff6eb", soft: "#f5c98f" },
  "uslugi-dlya-doma": { accent: "#116a70", border: "#68c3c4", card: "#c8eceb", cardOpen: "#dcf5f3", page: "#ecfaf9", soft: "#ace0df" },
  zhivotnye: { accent: "#536716", border: "#b0ca54", card: "#e7f2b9", cardOpen: "#f0f7d3", page: "#f7fbe8", soft: "#d9e991" },
};

function visualForCategory(slug: string) {
  return categoryVisuals[slug] ?? defaultVisual;
}

function visualStyle(visual: CategoryVisual): CSSProperties {
  return {
    "--category-accent": visual.accent,
    "--category-border": visual.border,
    "--category-card": visual.card,
    "--category-card-open": visual.cardOpen,
    "--category-page": visual.page,
    "--category-primary": visual.primary ?? "#0aa337",
    "--category-primary-hover": visual.primaryHover ?? "#078a2e",
    "--category-secondary": visual.secondary ?? visual.accent,
    "--category-secondary-border": visual.secondaryBorder ?? visual.border,
    "--category-soft": visual.soft,
    "--category-title": visual.title ?? "#060b27",
  } as CSSProperties;
}

export function categoryPageStyle(categorySlug: string): CSSProperties {
  return visualStyle(visualForCategory(categorySlug));
}

export function subcategoryGridClassName(
  itemCount: number,
  { compact = false, maxColumns = 5 }: { compact?: boolean; maxColumns?: 4 | 5 } = {},
) {
  if (compact) {
    return "grid grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-5";
  }

  if (maxColumns === 4) {
    if (itemCount <= 1) {
      return "grid grid-cols-1 gap-2 sm:gap-3";
    }

    if (itemCount <= 2) {
      return "grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3";
    }

    if (itemCount === 3) {
      return "grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3";
    }

    return "grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4";
  }

  if (itemCount <= 1) {
    return "grid grid-cols-1 gap-3";
  }

  if (itemCount === 2) {
    return "grid grid-cols-1 gap-3 sm:grid-cols-2";
  }

  if (itemCount === 3) {
    return "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";
  }

  return "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5";
}

export function CategoryHeaderBand({ categorySlug, createHref, description, title }: CategoryHeaderBandProps) {
  const visual = visualForCategory(categorySlug);
  const isGardenCategory = categorySlug === "sad-i-rasteniya";
  const isRitualCategory = categorySlug === "ritualnye-uslugi";
  const isRealEstateCategory = categorySlug === "nedvizhimost";
  const hasImageHero = isGardenCategory || isRitualCategory || isRealEstateCategory;
  const usesRightAlignedHero = isRitualCategory || isRealEstateCategory;
  const categoryInfoItemClassName = hasImageHero
    ? `flex w-fit max-w-full items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-xs font-bold leading-5 text-slate-700 shadow-sm ${
        isGardenCategory ? "lg:min-h-14 lg:w-full lg:px-4 lg:py-3 lg:text-sm" : "lg:min-h-14 lg:w-[420px] lg:px-4 lg:py-3 lg:text-sm"
      }`
    : "flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-xs font-bold leading-5 text-slate-700 shadow-sm";
  const categoryInfo = (
    <div
      className={
        isGardenCategory
          ? "mt-5 grid max-w-[800px] justify-items-start gap-3 sm:grid-cols-2 lg:w-[390px] lg:grid-cols-1"
          : usesRightAlignedHero
            ? "mt-5 grid max-w-[760px] justify-items-start gap-3 sm:grid-cols-2 lg:w-[420px] lg:grid-cols-1"
          : "grid gap-2 rounded-xl bg-white/80 p-3 ring-1 ring-[var(--category-border)]"
      }
    >
      <span className={categoryInfoItemClassName}>
        <MapPin className="h-4 w-4 shrink-0 text-[var(--category-accent)]" />
        Районы, города и предложения рядом
      </span>
      <span className={categoryInfoItemClassName}>
        <Leaf className="h-4 w-4 shrink-0 text-[var(--category-accent)]" />
        Быстрый переход к нужной подкатегории
      </span>
    </div>
  );

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-[var(--category-border)] bg-[var(--category-soft)] px-4 py-5 shadow-[0_12px_32px_rgba(15,23,42,0.06)] sm:px-5 sm:py-6 lg:px-7 lg:py-7 ${
        isGardenCategory ? "lg:min-h-[370px]" : usesRightAlignedHero ? "min-h-[390px] sm:min-h-[410px] lg:min-h-[390px]" : ""
      }`}
      data-category-theme={categorySlug}
      style={visualStyle(visual)}
    >
      {isGardenCategory ? (
        <>
          <Image
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-1/2 hidden h-[120%] w-auto max-w-none -translate-y-1/2 object-contain [mask-image:linear-gradient(to_right,transparent_0%,black_12%,black_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_12%,black_100%)] lg:block xl:h-[180%] min-[1440px]:h-[200%]"
            height={941}
            priority
            sizes="(min-width: 1280px) 500px, 430px"
            src="/images/categories/garden-category-produce.webp"
            width={952}
          />
          <Image
            alt=""
            aria-hidden="true"
            className="object-cover object-center lg:hidden"
            fill
            priority
            sizes="100vw"
            src="/images/categories/garden-category-hero.webp"
          />
        </>
      ) : null}
      {isRitualCategory ? (
        <>
          <Image
            alt=""
            aria-hidden="true"
            className="object-cover object-[45%_center] sm:object-[62%_center] lg:hidden"
            fill
            priority
            sizes="100vw"
            src="/images/categories/ritual-category-hero.webp"
          />
          <Image
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-1/2 hidden h-[118%] w-auto max-w-none -translate-y-1/2 object-contain object-right [mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] lg:block"
            height={941}
            priority
            sizes="(min-width: 1024px) 830px, 0px"
            src="/images/categories/ritual-category-hero.webp"
            width={1672}
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(242,247,244,0.98)_0%,rgba(242,247,244,0.92)_34%,rgba(242,247,244,0.44)_58%,rgba(242,247,244,0.04)_100%)] lg:bg-[linear-gradient(90deg,rgba(242,247,244,0.98)_0%,rgba(242,247,244,0.9)_31%,rgba(242,247,244,0.58)_48%,rgba(242,247,244,0.08)_70%,rgba(242,247,244,0)_100%)]" />
        </>
      ) : null}
      {isRealEstateCategory ? (
        <>
          <Image
            alt=""
            aria-hidden="true"
            className="object-cover object-[64%_center] sm:object-[66%_center] lg:hidden"
            fill
            priority
            sizes="100vw"
            src="/images/categories/real-estate-category-hero.png"
          />
          <Image
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-1/2 hidden h-[136%] w-auto max-w-none -translate-y-1/2 object-contain object-right [mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] lg:block"
            height={941}
            priority
            sizes="(min-width: 1024px) 830px, 0px"
            src="/images/categories/real-estate-category-hero.png"
            width={1672}
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(237,250,253,0.98)_0%,rgba(237,250,253,0.92)_34%,rgba(237,250,253,0.44)_58%,rgba(237,250,253,0.04)_100%)] lg:bg-[linear-gradient(90deg,rgba(237,250,253,0.98)_0%,rgba(237,250,253,0.9)_31%,rgba(237,250,253,0.58)_48%,rgba(237,250,253,0.08)_70%,rgba(237,250,253,0)_100%)]" />
        </>
      ) : null}
      <div
        className={
          hasImageHero
            ? "relative z-10 max-w-full lg:max-w-[800px]"
            : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.34fr)] lg:items-end"
        }
      >
        <div className="min-w-0">
          <h1
            className={`text-2xl font-bold leading-tight text-[var(--category-title)] [overflow-wrap:anywhere] sm:text-3xl lg:text-4xl ${
              isGardenCategory ? "max-w-[49%] sm:max-w-[58%] lg:max-w-2xl" : usesRightAlignedHero ? "max-w-[78%] sm:max-w-[62%] lg:max-w-2xl" : "max-w-4xl"
            }`}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={`mt-3 text-sm font-semibold leading-6 text-slate-700 sm:text-base sm:leading-7 ${
                isGardenCategory ? "max-w-[49%] sm:max-w-[58%] lg:max-w-xl" : usesRightAlignedHero ? "max-w-[78%] sm:max-w-[62%] lg:max-w-xl" : "max-w-4xl"
              }`}
            >
              {description}
            </p>
          ) : null}
          <div className={`${hasImageHero ? "mt-4 flex-col items-start sm:flex-row" : "mt-5 flex-wrap"} flex gap-2`}>
            <Link
              href={createHref}
              className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--category-primary)] font-bold text-white shadow-lg shadow-black/10 transition hover:bg-[var(--category-primary-hover)] ${
                hasImageHero ? "h-10 px-3 text-xs sm:px-4 sm:text-sm" : "h-11 px-4 text-sm"
              }`}
            >
              Разместить
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#listings"
              className={`inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--category-secondary-border)] bg-white font-bold text-[var(--category-secondary)] transition hover:bg-white/80 ${
                hasImageHero ? "h-10 px-3 text-xs sm:px-4 sm:text-sm" : "h-11 px-4 text-sm"
              }`}
            >
              Смотреть объявления
              <ClipboardList className="h-4 w-4" />
            </a>
          </div>
          {hasImageHero ? categoryInfo : null}
        </div>

        {!hasImageHero ? categoryInfo : null}
      </div>
    </section>
  );
}

export function SubcategoryCard({ compact = false, createHref, description, href, items = [], spanClassName = "", title, visualSlug }: SubcategoryCardProps) {
  const visual = visualForCategory(visualSlug);
  const actionButtonClassName = `${
    compact
      ? "h-8 px-1 text-[11px] sm:h-9 sm:px-1.5 sm:text-xs lg:px-0.5 lg:text-[10px] xl:px-1.5 xl:text-xs"
      : "h-10 px-1 text-[11px] sm:px-1.5 sm:text-xs lg:px-0.5 lg:text-[10px] xl:px-1.5 xl:text-xs"
  } inline-flex min-w-0 items-center justify-center rounded-lg border font-bold leading-none transition`;

  return (
    <details
      className={`group min-w-0 overflow-hidden rounded-xl border border-[var(--category-border)] bg-[var(--category-card)] shadow-sm transition-colors duration-200 hover:bg-[var(--category-card-open)] hover:shadow-md open:bg-[var(--category-card-open)] ${spanClassName}`}
      style={visualStyle(visual)}
    >
      <summary className={`flex cursor-pointer list-none items-center justify-between marker:hidden [&::-webkit-details-marker]:hidden ${compact ? "min-h-12 gap-2 p-2.5" : "min-h-14 gap-3 p-3"}`}>
        <span className={`min-w-0 self-center break-words font-bold text-[#142315] [overflow-wrap:anywhere] ${compact ? "text-xs leading-4 sm:text-[15px] sm:leading-5" : "text-sm leading-5 sm:text-[15px]"}`}>
          {title}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-90 group-open:text-[var(--category-accent)]" />
      </summary>

      <div className={`border-t border-[var(--category-border)] ${compact ? "px-2.5 pb-2.5" : "px-3 pb-3"}`}>
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
            className={`${actionButtonClassName} border-[#ef8c84] bg-white text-[#c6251a] hover:bg-[#fff1f0]`}
            aria-label={`Открыть объявления: ${title}`}
            title="Объявления"
          >
            <span className="min-w-0 whitespace-nowrap">Объявления</span>
          </Link>
          <Link
            href={createHref}
            className={`${actionButtonClassName} border-[#d92d20] bg-[#d92d20] text-white hover:border-[#b42318] hover:bg-[#b42318]`}
            aria-label={`Разместить объявление: ${title}`}
            title="Разместить"
          >
            <span className="min-w-0 whitespace-nowrap">Разместить</span>
          </Link>
          <SubcategoryShareButton
            className={`${actionButtonClassName} border-[#ef8c84] bg-white text-[#c6251a] hover:bg-[#fff1f0]`}
            href={href}
            label="Поделиться"
            title={title}
          />
        </div>
      </div>
    </details>
  );
}
