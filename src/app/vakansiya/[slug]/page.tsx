import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefcaseBusiness, MapPin } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { LocationMap } from "@/components/LocationMap";
import { VacancyDetailClient } from "@/components/VacancyDetailClient";
import { VacancyMediaGallery } from "@/components/VacancyMediaGallery";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { listVacancies } from "@/lib/mock-store";
import { getStoredVacancyById } from "@/lib/vacancy-store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const vacancy = (await getStoredVacancyById(slug, { publicOnly: true })) ?? listVacancies().find((item) => item.id === slug);

  return {
    title: vacancy ? `${vacancy.title} — вакансия` : "Вакансия",
    description: vacancy?.description ?? "Карточка вакансии на платформе БЛИЖНИЙ.",
    alternates: {
      canonical: `/vakansiya/${slug}`,
    },
  };
}

export default async function VacancyDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vacancy = (await getStoredVacancyById(slug, { publicOnly: true })) ?? listVacancies().find((item) => item.id === slug);

  if (!vacancy) {
    return (
      <>
        <SiteHeader />
        <VacancyDetailClient vacancyId={slug} />
      </>
    );
  }

  if (vacancy.status !== "published") {
    notFound();
  }

  return (
    <>
      <SiteHeader />
      <ListingViewTracker listingId={`work-vacancy-${vacancy.id}`} />
      <main className="page-container py-10">
        <BackLink fallbackHref="/rabota/vakansii" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <article className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <StatusBadge status={vacancy.status} />
            <p className="mt-5 text-slate-500">{vacancy.organization}</p>
            <h1 className="mt-2 text-5xl font-black text-[#060b27]">{vacancy.title}</h1>
            <p className="mt-4 text-2xl font-black">{vacancy.salary}</p>
            {vacancy.schedule || vacancy.workFormat ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {vacancy.schedule ? <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-[#0875d1]">{vacancy.schedule}</span> : null}
                {vacancy.workFormat ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">{vacancy.workFormat}</span> : null}
              </div>
            ) : null}
            <p className="mt-4 flex items-center gap-2 text-slate-600">
              <MapPin className="h-5 w-5" />
              {vacancy.showExactAddress && vacancy.address ? `${vacancy.city}, ${vacancy.address}` : [vacancy.city, vacancy.district].filter(Boolean).join(", ")}
            </p>
            <VacancyMediaGallery images={vacancy.images} title={vacancy.title} />
            <div className="mt-8 grid gap-6 leading-7 text-slate-700">
              <section>
                <h2 className="text-2xl font-black text-[#060b27]">Описание</h2>
                <p className="mt-2">{vacancy.description}</p>
              </section>
              <section>
                <h2 className="text-2xl font-black text-[#060b27]">Требования</h2>
                <p className="mt-2">{vacancy.requirements}</p>
              </section>
              <section>
                <h2 className="text-2xl font-black text-[#060b27]">Обязанности</h2>
                <p className="mt-2">{vacancy.responsibilities}</p>
              </section>
              {vacancy.conditions ? (
                <section>
                  <h2 className="text-2xl font-black text-[#060b27]">Условия</h2>
                  <p className="mt-2">{vacancy.conditions}</p>
                </section>
              ) : null}
            </div>
            <div className="mt-7">
              <LocationMap location={vacancy} exactLabel="Для вакансий организаций можно показывать точный адрес" />
            </div>
          </section>
          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-[#0aa337]">
              <BriefcaseBusiness className="h-10 w-10" />
            </div>
            <h2 className="mt-4 text-2xl font-black">Связаться</h2>
            <div className="mt-5 grid gap-3">
              {vacancy.phone ? (
                <a className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#0875d1] to-[#18a9ff] px-3 font-bold text-white shadow-sm shadow-blue-100 transition hover:from-[#0664b3] hover:to-[#0875d1]" href={`tel:${vacancy.phone}`}>
                  <ContactAssetIcon kind="phone" />
                  Позвонить
                </a>
              ) : null}
              {vacancy.messengerUrl || vacancy.email ? (
                <a className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3 font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50" href={vacancy.messengerUrl ?? `mailto:${vacancy.email}`}>
                  <ContactAssetIcon kind="message" />
                  Написать
                </a>
              ) : null}
            </div>
          </aside>
        </article>
      </main>
    </>
  );
}
