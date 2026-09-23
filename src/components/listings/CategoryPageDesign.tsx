import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight, ChevronRight, ClipboardList } from "lucide-react";
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
  const isKidsCategory = categorySlug === "tovary-dlya-detey";
  const isAnimalsCategory = categorySlug === "zhivotnye";
  const isBeautyCategory = categorySlug === "krasota-i-uhod";
  const isTransportCategory = categorySlug === "transport";
  const isToolsCategory = categorySlug === "instrumenty";
  const isDishesCategory = categorySlug === "posuda";
  const hasCompactHero = isKidsCategory || isDishesCategory;
  const isBusinessCategory = categorySlug === "biznes";
  const isElectronicsCategory = categorySlug === "elektronika";
  const isHomeAndDachaCategory = categorySlug === "dlya-doma-i-dachi";
  const isExchangeOrFreeCategory = categorySlug === "menyayu-ili-otdam-darom";
  const hasImageHero = isGardenCategory || isRitualCategory || isRealEstateCategory || isKidsCategory || isAnimalsCategory || isBeautyCategory || isTransportCategory || isToolsCategory || isDishesCategory || isBusinessCategory || isElectronicsCategory || isHomeAndDachaCategory || isExchangeOrFreeCategory;
  const usesRightAlignedHero = isRitualCategory || isRealEstateCategory || isKidsCategory || isAnimalsCategory || isBeautyCategory || isTransportCategory || isToolsCategory || isDishesCategory || isBusinessCategory || isElectronicsCategory || isHomeAndDachaCategory || isExchangeOrFreeCategory;
  const heroActionSizeClassName = hasCompactHero ? "min-h-10 min-w-0 max-w-full px-2 py-2 text-xs leading-4 [text-shadow:none] md:h-10 md:px-4 md:text-sm" : isTransportCategory ? "h-9 min-w-0 max-w-full px-2 text-[11px] leading-4 sm:h-10 sm:px-3 sm:text-xs" : isBusinessCategory ? "h-9 min-w-0 max-w-full px-2 text-[11px] leading-4 sm:h-10 sm:px-4 sm:text-sm" : hasImageHero ? "h-10 min-w-0 max-w-full px-3 text-xs sm:px-4 sm:text-sm" : "h-11 px-4 text-sm";
  const createAction = () => (
    <Link
      href={createHref}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[#d92d20] font-bold text-white shadow-sm shadow-black/10 transition hover:bg-[#b42318] ${heroActionSizeClassName}`}
    >
      Разместить
      <ArrowRight className={hasCompactHero ? "hidden h-4 w-4 shrink-0 md:block" : isTransportCategory || isBusinessCategory ? "hidden h-4 w-4 shrink-0 sm:block" : "h-4 w-4"} />
    </Link>
  );
  const listingsAction = () => (
    <a
      href="#listings"
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-[#ef8c84] bg-white font-bold text-[#c6251a] transition hover:bg-[#fff1f0] ${heroActionSizeClassName}`}
    >
      Смотреть объявления
      <ClipboardList className={hasCompactHero ? "hidden h-4 w-4 shrink-0 md:block" : isTransportCategory || isBusinessCategory ? "hidden h-4 w-4 shrink-0 sm:block" : "h-4 w-4"} />
    </a>
  );
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-[var(--category-border)] ${hasCompactHero ? "bg-white" : "bg-[var(--category-soft)]"} px-4 py-5 shadow-[0_12px_32px_rgba(15,23,42,0.06)] sm:px-5 sm:py-6 lg:px-7 lg:py-7 ${hasImageHero ? "pb-28 sm:pb-20 lg:pb-24" : ""} ${
        isGardenCategory
          ? "lg:min-h-[370px]"
          : isDishesCategory
            ? "aspect-[1089/1444] min-h-[360px] sm:aspect-[3/1] sm:min-h-[220px]"
          : isTransportCategory
            ? "aspect-[1122/760] min-h-0 md:aspect-[1983/593] md:min-h-0"
          : isBusinessCategory
            ? "aspect-[1672/1200] min-h-0 md:aspect-[3/1] md:min-h-0"
          : isRitualCategory
            ? "min-h-[330px] sm:min-h-[410px] lg:aspect-[3/1] lg:min-h-0"
          : isAnimalsCategory
            ? "min-h-[330px] sm:min-h-[410px] lg:aspect-[3/1] lg:min-h-0"
          : isBeautyCategory
            ? "aspect-[1069/1471] min-h-0 sm:aspect-[3/2] sm:min-h-[350px] lg:aspect-[8/3] lg:min-h-0"
          : hasCompactHero
            ? "min-h-[280px] md:min-h-[320px]"
            : usesRightAlignedHero
              ? "min-h-[330px] sm:min-h-[410px] lg:min-h-[390px]"
              : ""
      }`}
      data-category-theme={categorySlug}
      data-image-hero={hasImageHero ? "true" : undefined}
      style={visualStyle(visual)}
    >
      {hasImageHero ? (
        <style>{`
          @media (max-width: 639px) {
            [data-image-hero="true"] [data-hero-copy],
            [data-image-hero="true"] [data-hero-actions] {
              min-width: 0;
              max-width: 100%;
            }

            [data-image-hero="true"] [data-hero-actions] > a,
            [data-image-hero="true"] [data-hero-actions] > div,
            [data-image-hero="true"] [data-hero-actions] > div > a {
              min-width: 0;
              max-width: 100%;
            }
          }

          @media (min-width: 1024px) {
            [data-category-theme="zhivotnye"] h1,
            [data-category-theme="zhivotnye"] p {
              color: #fff !important;
              text-shadow: 0 2px 8px rgba(8, 27, 22, 0.96), 0 1px 2px rgba(8, 27, 22, 0.96);
            }
          }
        `}</style>
      ) : null}
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
        <picture className="pointer-events-none absolute inset-0" aria-hidden="true">
          <source media="(min-width: 1024px)" srcSet="/images/categories/ritual-category-hero-desktop-v2.webp" />
          {/* Keep the existing mobile memorial photo; the desktop crop preserves its full scene. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="h-full w-full object-cover object-[45%_center] sm:object-[62%_center] lg:object-center"
            fetchPriority="high"
            height={941}
            src="/images/categories/ritual-category-hero.webp"
            width={1672}
          />
        </picture>
      ) : null}
      {isKidsCategory ? (
        <picture className="pointer-events-none absolute bottom-4 right-2 top-4 w-[44%] md:right-4 md:w-[60%]" aria-hidden="true">
          <source media="(min-width: 768px)" srcSet="/images/categories/kids-category-hero-desktop-v5.webp" />
          {/* Native picture selects one composition before loading and keeps the full image visible. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="h-full w-full object-contain object-right"
            fetchPriority="high"
            height={1254}
            src="/images/categories/kids-category-hero-mobile-v5.webp"
            width={1254}
          />
        </picture>
      ) : null}
      {isAnimalsCategory ? (
        <picture className="pointer-events-none absolute inset-0" aria-hidden="true">
          <source media="(min-width: 1024px)" srcSet="/images/categories/animals-category-hero-desktop-v2.webp" />
          {/* Keep the mobile animal scene intact; desktop uses the same composition in a wide 3:1 frame. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="h-full w-full object-cover object-[76%_center] lg:object-center"
            fetchPriority="high"
            height={941}
            src="/images/categories/animals-category-hero.png"
            width={1672}
          />
        </picture>
      ) : null}
      {isBeautyCategory ? (
        <picture className="pointer-events-none absolute inset-0" aria-hidden="true">
          <source media="(min-width: 1024px)" srcSet="/images/categories/beauty-health-category-hero-desktop-v1.webp" />
          {/* Each layout gets a photo composed for its own aspect ratio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="h-full w-full object-cover object-center"
            fetchPriority="high"
            height={1471}
            src="/images/categories/beauty-health-category-hero-v2.webp"
            width={1069}
          />
        </picture>
      ) : null}
      {isToolsCategory ? (
        <picture className="pointer-events-none absolute inset-0" aria-hidden="true">
          <source media="(min-width: 768px)" srcSet="/images/categories/tools-category-hero-desktop-v1.webp" />
          {/* Preserve the mobile cabinet; the desktop photo is composed for a wide banner. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="h-full w-full object-cover object-center"
            fetchPriority="high"
            height={1155}
            src="/images/categories/tools-category-hero-clean-v3.webp"
            width={1362}
          />
        </picture>
      ) : null}
      {isTransportCategory ? (
        <picture className="pointer-events-none absolute inset-0" aria-hidden="true">
          <source media="(min-width: 768px)" srcSet="/images/categories/transport-category-hero-desktop-v4.webp" />
          {/* Each breakpoint receives a composition where every vehicle stays in frame. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="h-full w-full object-cover object-center"
            fetchPriority="high"
            height={760}
            src="/images/categories/transport-category-hero-mobile-v5.webp"
            width={1122}
          />
        </picture>
      ) : null}
      {isDishesCategory ? (
        <>
          <picture className="pointer-events-none absolute inset-0" aria-hidden="true">
            <source media="(min-width: 640px)" srcSet="/images/categories/dishes-category-hero-desktop-v2.webp" />
            {/* Preserve the original photo; match the banner ratio to avoid cropping. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              className="h-full w-full object-cover object-center"
              fetchPriority="high"
              height={1444}
              src="/images/categories/dishes-category-hero-mobile-v2.webp"
              width={1089}
            />
          </picture>
        </>
      ) : null}
      {isBusinessCategory ? (
        <picture className="pointer-events-none absolute inset-0" aria-hidden="true">
          {/* One clear photo across the whole banner: no fade, mask or white transition. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="h-full w-full object-cover object-[58%_center] sm:object-center"
            fetchPriority="high"
            height={941}
            src="/images/categories/business-category-hero-v2.webp"
            width={1672}
          />
        </picture>
      ) : null}
      {isElectronicsCategory ? (
        <>
          <Image
            alt=""
            aria-hidden="true"
            className="object-cover object-[76%_center] lg:hidden"
            fill
            priority
            sizes="100vw"
            src="/images/categories/electronics-category-hero.png"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.92)_0%,rgba(255,255,255,0.72)_46%,rgba(255,255,255,0.08)_82%)] lg:hidden" />
          <Image
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-1/2 hidden h-[136%] w-auto max-w-none -translate-y-1/2 object-contain object-right [mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] lg:block"
            height={941}
            priority
            sizes="(min-width: 1024px) 830px, 0px"
            src="/images/categories/electronics-category-hero.png"
            width={1672}
          />
          <div className="absolute inset-0 hidden lg:block lg:bg-[linear-gradient(90deg,rgba(238,244,255,0.98)_0%,rgba(238,244,255,0.9)_31%,rgba(238,244,255,0.58)_48%,rgba(238,244,255,0.08)_70%,rgba(238,244,255,0)_100%)]" />
        </>
      ) : null}
      {isHomeAndDachaCategory ? (
        <>
          <Image
            alt=""
            aria-hidden="true"
            className="object-cover object-[68%_center] lg:hidden"
            fill
            priority
            sizes="100vw"
            src="/images/categories/home-dacha-category-hero.png"
          />
          <Image
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-1/2 hidden h-[136%] w-auto max-w-none -translate-y-1/2 object-contain object-right [mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] lg:block"
            height={1086}
            priority
            sizes="(min-width: 1024px) 830px, 0px"
            src="/images/categories/home-dacha-category-hero.png"
            width={1448}
          />
          <div className="absolute inset-0 hidden lg:block lg:bg-[linear-gradient(90deg,rgba(247,251,233,0.98)_0%,rgba(247,251,233,0.9)_31%,rgba(247,251,233,0.58)_48%,rgba(247,251,233,0.08)_70%,rgba(247,251,233,0)_100%)]" />
        </>
      ) : null}
      {isExchangeOrFreeCategory ? (
        <>
          <Image
            alt=""
            aria-hidden="true"
            className="object-cover object-[68%_center] lg:hidden"
            fill
            priority
            sizes="100vw"
            src="/images/categories/exchange-free-category-hero.png"
          />
          <Image
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-1/2 hidden h-[136%] w-auto max-w-none -translate-y-1/2 object-contain object-right [mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] lg:block"
            height={941}
            priority
            sizes="(min-width: 1024px) 830px, 0px"
            src="/images/categories/exchange-free-category-hero.png"
            width={1672}
          />
          <div className="absolute inset-0 hidden lg:block lg:bg-[linear-gradient(90deg,rgba(239,250,240,0.98)_0%,rgba(239,250,240,0.9)_31%,rgba(239,250,240,0.58)_48%,rgba(239,250,240,0.08)_70%,rgba(239,250,240,0)_100%)]" />
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
            src="/images/categories/real-estate-category-hero-v2.png"
          />
          <Image
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-1/2 hidden h-[136%] w-auto max-w-none -translate-y-1/2 object-contain object-right [mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_24%,black_100%)] lg:block"
            height={941}
            priority
            sizes="(min-width: 1024px) 830px, 0px"
            src="/images/categories/real-estate-category-hero-v2.png"
            width={1672}
          />
          <div className="absolute inset-0 hidden lg:block lg:bg-[linear-gradient(90deg,rgba(237,250,253,0.98)_0%,rgba(237,250,253,0.9)_31%,rgba(237,250,253,0.58)_48%,rgba(237,250,253,0.08)_70%,rgba(237,250,253,0)_100%)]" />
        </>
      ) : null}
      {isBeautyCategory ? (
        <style>{`
          [data-category-theme="krasota-i-uhod"] > [data-hero-copy] {
            position: relative;
            z-index: 10;
          }

          [data-category-theme="krasota-i-uhod"] h1,
          [data-category-theme="krasota-i-uhod"] p {
            color: #fff !important;
            text-shadow: 0 2px 8px rgba(57, 30, 13, 0.92), 0 1px 2px rgba(57, 30, 13, 0.92);
          }

        `}</style>
      ) : null}
      {isBusinessCategory ? (
        <style>{`
          [data-category-theme="biznes"] > [data-hero-copy] {
            position: relative;
            z-index: 10;
          }

          [data-category-theme="biznes"] h1,
          [data-category-theme="biznes"] p {
            color: #fff !important;
            text-shadow: 0 2px 8px rgba(6, 30, 43, 0.96), 0 1px 2px rgba(6, 30, 43, 0.96);
          }
        `}</style>
      ) : null}
      <div
        data-hero-copy
        className={
          isDishesCategory
            ? "relative z-10 min-w-0 w-full max-w-[480px] [text-shadow:0_1px_2px_white,0_0_3px_white]"
            : hasCompactHero
            ? "relative z-10 min-w-0 w-[52%] md:w-[35%] md:max-w-[480px]"
            : isAnimalsCategory || isRitualCategory
              ? "relative z-10 max-w-full lg:max-w-xl"
            : hasImageHero
              ? "relative z-10 max-w-full lg:max-w-[800px]"
            : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.34fr)] lg:items-end"
        }
      >
        <div className="min-w-0">
          <h1
            className={`${isDishesCategory ? "text-[22px] lg:text-4xl" : "text-[22px] sm:text-3xl lg:text-4xl"} font-bold leading-tight text-[var(--category-title)] [overflow-wrap:anywhere] ${
                isGardenCategory ? "max-w-[49%] sm:max-w-[58%] lg:max-w-2xl" : hasCompactHero ? "max-w-full" : isBeautyCategory || isTransportCategory || isDishesCategory || isBusinessCategory ? "max-w-[14rem] sm:max-w-[58%] lg:max-w-2xl" : isAnimalsCategory ? "max-w-[72%] sm:max-w-[58%] lg:max-w-2xl" : usesRightAlignedHero ? "max-w-[78%] sm:max-w-[62%] lg:max-w-2xl" : "max-w-4xl"
            }`}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={`${isDishesCategory ? "mt-2.5 text-[13px] leading-5 lg:mt-3 lg:text-base lg:leading-7" : "mt-2.5 text-[13px] leading-5 sm:mt-3 sm:text-base sm:leading-7"} font-semibold text-slate-700 ${isHomeAndDachaCategory ? "invisible sm:visible" : ""} ${
                isGardenCategory ? "max-w-[49%] sm:max-w-[58%] lg:max-w-xl" : hasCompactHero ? "max-w-full md:max-w-xl" : isBeautyCategory || isTransportCategory || isDishesCategory ? "max-w-[14rem] sm:max-w-[19rem] lg:max-w-xl" : isBusinessCategory ? "max-w-[15rem] sm:max-w-[19rem] lg:max-w-xl" : isRitualCategory ? "max-w-[28rem] lg:max-w-xl" : isAnimalsCategory || isRealEstateCategory || isElectronicsCategory || isHomeAndDachaCategory ? "max-w-[19rem] lg:max-w-xl" : usesRightAlignedHero ? "max-w-[78%] sm:max-w-[62%] lg:max-w-xl" : "max-w-4xl"
              }`}
            >
              {(isBeautyCategory || isTransportCategory) && description === "Выберите подкатегорию, посмотрите предложения рядом или разместите свое объявление." ? (
                <>
                  <span className="sm:hidden">
                    Выберите подкатегорию,
                    <br />
                    посмотрите предложения рядом
                    <br />
                    или разместите свое объявление.
                  </span>
                  <span className="hidden sm:inline">{description}</span>
                </>
              ) : isRitualCategory && description === "Деликатный раздел для организации прощания, ухода за местом захоронения, транспорта, принадлежностей и сопутствующих работ рядом." ? (
                <>
                  <span className="lg:hidden">
                    Деликатный раздел для организации прощания,
                    <br />
                    ухода за местом захоронения, транспорта,
                    <br />
                    принадлежностей и сопутствующих работ рядом.
                  </span>
                  <span className="hidden lg:inline">{description}</span>
                </>
              ) : isBusinessCategory && description === "Выберите подкатегорию, посмотрите предложения рядом или разместите свое объявление." ? (
                <>
                  <span className="sm:hidden">
                    Выберите подкатегорию,
                    <br />
                    посмотрите предложения рядом
                    <br />
                    или разместите свое объявление.
                  </span>
                  <span className="hidden sm:inline">{description}</span>
                </>
              ) : (isElectronicsCategory || isExchangeOrFreeCategory) && description === "Выберите подкатегорию, посмотрите предложения рядом или разместите свое объявление." ? (
                <>
                  <span className="sm:hidden">
                    Выберите подкатегорию, посмотрите
                    <br />
                    предложения рядом или разместите
                    <br />
                    свое объявление.
                  </span>
                  <span className="hidden sm:inline">{description}</span>
                </>
              ) : (
                description
              )}
            </p>
          ) : null}
          {!hasImageHero ? (
            <div data-hero-actions className="mt-5 flex min-w-0 max-w-full flex-wrap gap-2">
              {createAction()}
              {listingsAction()}
            </div>
          ) : null}
        </div>
      </div>
      {hasImageHero ? (
        <div
          data-hero-actions
          className={`absolute bottom-4 left-4 right-4 z-20 flex min-w-0 gap-2 sm:bottom-5 sm:left-5 sm:right-5 lg:bottom-7 lg:left-7 lg:right-7 ${
            isTransportCategory || isBusinessCategory || isDishesCategory ? "flex-nowrap items-center" : "flex-wrap items-start sm:flex-nowrap sm:items-center"
          }`}
        >
          {createAction()}
          {listingsAction()}
        </div>
      ) : null}
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
