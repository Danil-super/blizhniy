import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, MessageCircle, Phone, Video } from "lucide-react";
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
      <main className="page-container py-10">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
          <StatusBadge status={specialist.status} />
          <div className="mt-6 grid gap-8 lg:grid-cols-[180px_1fr_320px]">
            <div className="flex h-44 w-44 items-center justify-center rounded-full bg-blue-50 text-6xl font-black text-[#0875d1]">{specialist.name.slice(0, 1)}</div>
            <section>
              <h1 className="text-5xl font-black text-[#060b27]">{specialist.name}</h1>
              <p className="mt-2 text-2xl font-bold text-[#0875d1]">{specialist.profession}</p>
              <p className="mt-4 flex items-center gap-2 text-slate-600">
                <MapPin className="h-5 w-5" />
                {[specialist.city, specialist.district].filter(Boolean).join(", ")}
              </p>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700">
                {specialist.skills}. Опытный исполнитель для частных заказов и регулярной работы. Анкета готова к расширению полями опыта, портфолио и загрузкой фото.
              </p>
            </section>
            <aside>
              <p className="text-3xl font-black">{specialist.price}</p>
              <div className="mt-5 grid gap-3">
                {specialist.phone ? (
                  <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0875d1] font-bold text-white" href={`tel:${specialist.phone}`}>
                    <Phone className="h-5 w-5" />
                    Позвонить
                  </a>
                ) : null}
                {specialist.messengerUrl ? (
                  <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#0875d1] font-bold text-[#0875d1]" href={specialist.messengerUrl}>
                    <MessageCircle className="h-5 w-5" />
                    Написать
                  </a>
                ) : null}
                <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 font-bold" href={specialist.videoUrl ?? "https://meet.google.com/"}>
                  <Video className="h-5 w-5" />
                  Видеозвонок
                </a>
                <Link href="/blizhniy/rabota/specialisty/anketa" className="text-center text-sm font-semibold text-slate-500">
                  Редактировать мою анкету
                </Link>
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
