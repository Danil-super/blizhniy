import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, MessageCircle, Phone } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { LocationMap } from "@/components/LocationMap";
import { specialists } from "@/lib/data";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const specialist = specialists.find((item) => item.id === slug);

  return {
    title: specialist ? `${specialist.name} — ${specialist.profession}` : "Специалист",
    description: specialist ? `${specialist.skills}. ${specialist.city}.` : "Карточка специалиста на платформе БЛИЖНИЙ.",
    alternates: {
      canonical: `/blizhniy/specialist/${slug}`,
    },
  };
}

export default async function SpecialistDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const specialist = specialists.find((item) => item.id === slug);

  if (!specialist) {
    notFound();
  }

  return (
    <>
      <SiteHeader />
      <main className="page-container py-5 sm:py-10">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
          <StatusBadge status={specialist.status} />
          <div className="mt-4 grid gap-5 sm:mt-6 lg:grid-cols-[132px_1fr_300px] lg:gap-7">
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-blue-50 text-4xl font-black text-[#0875d1] sm:h-36 sm:w-36 sm:text-5xl">{specialist.name.slice(0, 1)}</div>
            <section>
              <h1 className="text-3xl font-black leading-tight text-[#060b27] sm:text-4xl">{specialist.name}</h1>
              <p className="mt-1 text-lg font-bold text-[#0875d1] sm:text-xl">{specialist.profession}</p>
              <p className="mt-3 flex items-center gap-2 text-sm text-slate-600 sm:text-base">
                <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
                {[specialist.city, specialist.district].filter(Boolean).join(", ")}
              </p>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700 sm:text-base sm:leading-7">
                {specialist.skills}. Опытный исполнитель для частных заказов и регулярной работы. Анкета готова к расширению полями опыта, портфолио и загрузкой фото.
              </p>
            </section>
            <aside>
              <p className="text-2xl font-black sm:text-3xl">{specialist.price}</p>
              <div className="mt-4 grid gap-2 sm:mt-5">
                {specialist.phone ? (
                  <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0875d1] font-bold text-white" href={`tel:${specialist.phone}`}>
                    <Phone className="h-5 w-5" />
                    Позвонить
                  </a>
                ) : null}
                <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#0875d1] font-bold text-[#0875d1]" href={specialist.messengerUrl ?? "https://t.me/blizhniy_support"}>
                    <MessageCircle className="h-5 w-5" />
                    Написать
                </a>
              </div>
            </aside>
          </div>
          <div className="mt-8">
            <LocationMap location={specialist} exactLabel="Точный адрес специалиста по умолчанию не показывается" />
          </div>
        </article>
      </main>
    </>
  );
}
