import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Grid2X2, MapPin, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CategoryGrid } from "@/components/CategoryGrid";
import { SiteHeader } from "@/components/SiteHeader";
import { cities, region } from "@/lib/data";

export const metadata: Metadata = {
  title: "Краснодар",
  description: "Региональная витрина объявлений, работы и специалистов Краснодара на платформе БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy",
  },
};

export default function KrasnodarPage() {
  const actions: Array<{ label: string; href: string; icon: LucideIcon }> = [
    { label: "Объявления", href: "/blizhniy/prodam", icon: Grid2X2 },
    { label: "Работа", href: "/blizhniy/rabota", icon: BriefcaseBusiness },
    { label: "Разместить", href: "/blizhniy/sozdat", icon: Plus },
    { label: "Все категории", href: "/blizhniy/kategorii", icon: ArrowRight },
  ];

  return (
    <>
      <SiteHeader />
      <main>
        <section className="page-container py-10">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
            <MapPin className="h-4 w-4 text-[#0875d1]" />
            {region.name}
          </div>
          <h1 className="mt-3 text-5xl font-black text-[#060b27]">Краснодар</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
            Городская страница агрегатора: объявления, вакансии, заказчики, специалисты и быстрый переход к размещению.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {actions.map(({ label, href, icon: Icon }) => (
              <Link key={href} href={href} className="flex h-24 items-center justify-between rounded-xl border border-slate-200 bg-white p-5 font-black shadow-sm transition hover:border-blue-200 hover:text-[#0875d1]">
                {label}
                <Icon className="h-6 w-6" />
              </Link>
            ))}
          </div>
          <p className="mt-6 text-sm leading-6 text-slate-500">Города края: {cities.map((city) => city.name).join(", ")}.</p>
        </section>
        <CategoryGrid />
      </main>
    </>
  );
}
