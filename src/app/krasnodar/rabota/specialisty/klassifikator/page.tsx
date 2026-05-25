import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { professions } from "@/lib/data";

export default function SpecialistClassifierPage() {
  const groups = professions.reduce<Record<string, typeof professions>>((acc, profession) => {
    acc[profession.parent] = [...(acc[profession.parent] ?? []), profession];
    return acc;
  }, {});

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <h1 className="text-4xl font-black text-[#060b27]">Классификатор специалистов</h1>
        <p className="mt-3 text-slate-600">Справочник профессий с алфавитным поиском и привязкой к вакансиям/анкетам.</p>
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(groups).map(([group, items]) => (
            <section key={group} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">{group}</h2>
              <div className="mt-3 grid gap-2">
                {items.map((item) => (
                  <Link key={item.slug} href={`/blizhniy/rabota/specialisty/${item.slug}`} className="text-[#0875d1]">
                    {item.name}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
