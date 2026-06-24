"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import type { ComponentType } from "react";
import {
  ArrowRight,
  Baby,
  BriefcaseBusiness,
  Building2,
  Car,
  Cog,
  Ellipsis,
  HeartPulse,
  MapPinned,
  PawPrint,
  Shirt,
  Smartphone,
  Sofa,
  Sprout,
  Store,
  TentTree,
  Utensils,
  Wrench,
} from "lucide-react";
import { categoryDisplayItems } from "@/lib/category-display-order";

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

type CategoryTile = {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  imageUrl: string;
  description: string;
  bullets: string[];
  tone: "blue" | "green";
  ageRating?: string;
  imagePosition?: string;
  iconClassName?: string;
};

const categoryImages = {
  animals: "/images/categories/animals.webp",
  garden: "/images/categories/garden.webp",
  kids: "/images/categories/kids.webp",
  ritual: "/images/categories/ritual.webp",
  realEstate: "/images/categories/real-estate.webp",
  jobs: "/images/categories/jobs.webp",
  clothing: "/images/categories/clothing.webp",
  hobby: "/images/categories/hobby.webp",
  auto: "/images/categories/auto.webp",
  business: "/images/categories/business-equipment.webp",
  services: "/images/categories/services.webp",
  electronics: "/images/categories/electronics.webp",
  home: "/images/categories/home-dacha.webp",
  tools: "/images/categories/tools.webp",
  dishes: "/images/categories/dishes.webp",
  travel: "/images/categories/travel-housing.webp",
  beauty: "/images/categories/beauty-health.webp",
  other: "/images/categories/other.webp",
};

const categoryTileVisuals: Record<string, Omit<CategoryTile, "id" | "label" | "href">> = {
  "zhivotnye": {
    icon: PawPrint,
    imageUrl: categoryImages.animals,
    description: "Питомцы, товары для ухода и объявления от владельцев рядом с вами.",
    bullets: ["Домашние питомцы", "Корма и уход", "Товары для животных"],
    tone: "green",
    ageRating: "7+",
  },
  "sad-i-ogorod": {
    icon: Sprout,
    imageUrl: categoryImages.garden,
    description: "Все для участка, сада, растений и сезонных работ.",
    bullets: ["Рассада и саженцы", "Инвентарь", "Цветы и огород"],
    tone: "green",
  },
  "tovary-dlya-detey": {
    icon: Baby,
    imageUrl: categoryImages.kids,
    description: "Игрушки, вещи и полезные товары для детей.",
    bullets: ["Игрушки", "Детская комната", "Спорт и развитие"],
    tone: "green",
    ageRating: "7+",
  },
  "ritualnye-uslugi": {
    icon: MemorialIcon,
    imageUrl: categoryImages.ritual,
    description: "Деликатные услуги, организация и сопутствующие товары.",
    bullets: ["Организация", "Транспорт", "Уход и принадлежности"],
    tone: "blue",
    iconClassName: "h-8 w-8 sm:h-9 sm:w-9",
  },
  "nedvizhimost": {
    icon: Building2,
    imageUrl: categoryImages.realEstate,
    description: "Квартиры, дома и коммерческие объекты в вашем городе.",
    bullets: ["Продажа", "Покупка", "Аренда и объекты"],
    tone: "blue",
  },
  "rabota": {
    icon: BriefcaseBusiness,
    imageUrl: categoryImages.jobs,
    description: "Вакансии, заказы и анкеты специалистов рядом с домом.",
    bullets: ["Вакансии", "Заказы", "Анкеты специалистов"],
    tone: "green",
    ageRating: "14+",
  },
  "odezhda-obuv-aksessuary": {
    icon: Shirt,
    imageUrl: categoryImages.clothing,
    description: "Гардероб, обувь, сумки и аксессуары на каждый день.",
    bullets: ["Одежда", "Обувь", "Аксессуары"],
    tone: "green",
  },
  "hobbi-i-otdyh": {
    icon: TentTree,
    imageUrl: categoryImages.hobby,
    description: "Отдых, турбазы, походы и товары для увлечений.",
    bullets: ["Турбазы", "Походы", "Творчество"],
    tone: "green",
  },
  "transport": {
    icon: Car,
    imageUrl: categoryImages.auto,
    description: "Автомобили, мототехника и транспортные объявления.",
    bullets: ["Авто", "Мототехника", "Запчасти"],
    tone: "blue",
  },
  "biznes": {
    icon: Store,
    imageUrl: categoryImages.business,
    description: "Готовый бизнес, оборудование и рабочие решения.",
    bullets: ["Оборудование", "Готовый бизнес", "Партнерство"],
    tone: "blue",
  },
  "uslugi": {
    icon: Wrench,
    imageUrl: categoryImages.services,
    description: "Мастера, ремонт, уборка и бытовая помощь рядом.",
    bullets: ["Проверенные мастера", "Ремонт и сервис", "Отзывы и рейтинг"],
    tone: "blue",
  },
  "elektronika": {
    icon: Smartphone,
    imageUrl: categoryImages.electronics,
    description: "Гаджеты, техника, ноутбуки и аудио для дома и работы.",
    bullets: ["Смартфоны", "Ноутбуки", "Аудио и видео"],
    tone: "blue",
  },
  "dlya-doma-i-dachi": {
    icon: Sofa,
    imageUrl: categoryImages.home,
    description: "Мебель, декор, освещение и вещи для уютного дома.",
    bullets: ["Мебель", "Декор", "Дача и баня"],
    tone: "green",
  },
  "instrumenty": {
    icon: Cog,
    imageUrl: categoryImages.tools,
    description: "Ручной и электрический инструмент для ремонта и сада.",
    bullets: ["Ручной инструмент", "Электроинструмент", "Для сада"],
    tone: "blue",
  },
  "posuda": {
    icon: Utensils,
    imageUrl: categoryImages.dishes,
    description: "Кухонная посуда, сервировка и предметы для хранения.",
    bullets: ["Кухня", "Столовая", "Хранение"],
    tone: "green",
  },
  "zhile-dlya-puteshestviya": {
    icon: MapPinned,
    imageUrl: categoryImages.travel,
    description: "Апартаменты, дома и места для отдыха с бронированием.",
    bullets: ["Апартаменты", "Дома и турбазы", "Бронирование"],
    tone: "blue",
  },
  "krasota-i-zdorove": {
    icon: HeartPulse,
    imageUrl: categoryImages.beauty,
    description: "Красота, уход, здоровье и специалисты рядом с вами.",
    bullets: ["Косметика", "Уход", "Здоровье"],
    tone: "green",
  },
  "raznoe": {
    icon: Ellipsis,
    imageUrl: categoryImages.other,
    description: "Редкие находки, коллекции, книги и полезные мелочи.",
    bullets: ["Винтаж", "Коллекции", "Разные находки"],
    tone: "blue",
    imagePosition: "center 68%",
  },
};

const categoryTiles: CategoryTile[] = categoryDisplayItems.map((item) => ({
  ...item,
  ...categoryTileVisuals[item.id],
}));

const toneClasses: Record<CategoryTile["tone"], { button: string; buttonIcon: string; hover: string; icon: string; marker: string }> = {
  blue: {
    button: "border-blue-200 bg-white/92 text-[#0875d1] shadow-blue-100 group-hover:border-[#0875d1] group-hover:bg-blue-50",
    buttonIcon: "bg-[#0875d1] text-white",
    hover: "hover:border-blue-200",
    icon: "bg-[#0875d1] text-white shadow-blue-100",
    marker: "bg-[#0875d1]",
  },
  green: {
    button: "border-lime-200 bg-white/92 text-[#2f7f12] shadow-lime-100 group-hover:border-[#3f8f18] group-hover:bg-lime-50",
    buttonIcon: "bg-[#3f8f18] text-white",
    hover: "hover:border-lime-200",
    icon: "bg-[#3f8f18] text-white shadow-lime-100",
    marker: "bg-[#3f8f18]",
  },
};

export function CategoryGrid({ variant = "scroll" }: { variant?: "scroll" | "grid" }) {
  const topPadding = variant === "grid" ? "py-6 sm:py-8" : "pb-8 pt-4 sm:pb-10 sm:pt-5";

  return (
    <section className={`${topPadding} page-container`} aria-label="Категории">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-3">
        {categoryTiles.map((category, index) => {
          const Icon = category.icon;
          const tone = toneClasses[category.tone];
          const isLastOddCard = categoryTiles.length % 2 === 1 && index === categoryTiles.length - 1;

          return (
            <Link
              key={`${category.label}-${category.href}`}
              href={category.href}
              data-category-card
              className={`group relative block min-h-[300px] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow transition duration-300 hover:-translate-y-0.5 hover:shadow-card lg:min-h-[340px] ${isLastOddCard ? "lg:col-span-2 lg:min-h-[420px]" : ""} ${tone.hover}`}
            >
              <img
                aria-hidden="true"
                alt=""
                className="absolute inset-0 h-full w-full object-cover brightness-[1.04] contrast-[1.12] saturate-[1.16] transition duration-500 group-hover:scale-[1.02]"
                decoding="async"
                fetchPriority={index < 2 || isLastOddCard ? "high" : "auto"}
                loading={index < 2 || isLastOddCard ? "eager" : "lazy"}
                src={category.imageUrl}
                style={{ objectPosition: category.imagePosition ?? "center" }}
              />
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 bg-gradient-to-r from-white via-white/96 to-white/0 ${
                  isLastOddCard ? "w-[70%] sm:w-[58%] lg:w-[38%]" : "w-[82%] sm:w-[74%] lg:w-[56%]"
                }`}
              />
              {category.ageRating ? (
                <span className="absolute right-4 top-4 z-20 inline-flex h-8 min-w-10 items-center justify-center rounded-full border border-white/80 bg-white/90 px-2 text-xs font-black text-slate-700 shadow-sm">
                  {category.ageRating}
                </span>
              ) : null}
              <span
                className={`relative z-10 flex min-h-[300px] flex-col p-5 pb-20 sm:p-6 sm:pb-24 lg:min-h-[340px] lg:p-8 lg:pb-24 ${
                  isLastOddCard ? "max-w-[66%] sm:max-w-[54%] lg:min-h-[420px] lg:max-w-[32%]" : "max-w-[72%] sm:max-w-[68%] lg:max-w-[44%]"
                }`}
              >
                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg transition group-hover:scale-105 sm:h-16 sm:w-16 ${tone.icon}`}>
                  <Icon className={category.iconClassName ?? "h-8 w-8 sm:h-9 sm:w-9"} />
                </span>
                <h2 className="mt-5 block text-2xl font-black leading-tight text-[#183114] sm:text-3xl lg:text-[34px]">{category.label}</h2>
                <span className="mt-3 block max-w-[25rem] text-sm font-semibold leading-6 text-slate-700 sm:text-[15px]">{category.description}</span>
                <span className="mt-4 grid gap-2 text-xs font-bold leading-5 text-slate-700 sm:text-sm">
                  {category.bullets.slice(0, 3).map((bullet) => (
                    <span key={bullet} className="flex min-w-0 items-start gap-2">
                      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${tone.marker}`} />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{bullet}</span>
                    </span>
                  ))}
                </span>
              </span>
              <span className={`absolute bottom-5 left-5 z-20 inline-flex h-10 w-fit items-center justify-center gap-2 rounded-full border px-3.5 text-sm font-black shadow-lg backdrop-blur transition sm:bottom-6 sm:left-6 lg:bottom-8 lg:left-8 ${tone.button}`}>
                <span>Открыть</span>
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition group-hover:translate-x-0.5 ${tone.buttonIcon}`}>
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
