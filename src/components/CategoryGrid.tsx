import Link from "next/link";
import {
  BriefcaseBusiness,
  Cat,
  Gem,
  Hammer,
  HeartPulse,
  Home,
  Leaf,
  Scissors,
  Shirt,
  Sparkles,
} from "lucide-react";
import { categories } from "@/lib/data";

const icons = [
  Gem,
  Cat,
  Scissors,
  HeartPulse,
  Home,
  BriefcaseBusiness,
  Hammer,
  Leaf,
  Shirt,
  Sparkles,
];

export function CategoryGrid() {
  function categoryHref(slug: string) {
    if (slug === "rabota") {
      return "/blizhniy/rabota";
    }

    if (slug === "yarmarka-masterov") {
      return "/yarmarka-masterov";
    }

    return `/blizhniy/${slug}`;
  }

  return (
    <section className="page-container py-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[#0875d1]">Категории</p>
          <h2 className="mt-1 text-3xl font-black text-[#060b27]">Что ищем рядом</h2>
        </div>
        <Link href="/blizhniy/kategorii" className="hidden font-semibold text-[#0875d1] sm:block">
          Все категории
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {categories.map((category, index) => {
          const Icon = icons[index] ?? Sparkles;
          return (
            <Link
              key={category.slug}
              href={categoryHref(category.slug)}
              className="group min-h-36 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-card"
            >
              <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-[#0875d1] group-hover:bg-blue-50">
                <Icon className="h-6 w-6" />
              </span>
              <span className="block text-lg font-bold text-[#060b27]">{category.name}</span>
              <span className="mt-2 block text-sm leading-5 text-slate-500">
                {category.children.slice(0, 2).join(", ")}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
