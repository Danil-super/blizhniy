import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefcaseBusiness, MapPin } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { DetailImageGallery } from "@/components/DetailImageGallery";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { LocationMap } from "@/components/LocationMap";
import { VacancyApplicationButton } from "@/components/VacancyApplicationButton";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { hasMapCoordinates } from "@/lib/map-location";
import { listVacancies } from "@/lib/mock-store";
import { formatPublicationDateTime } from "@/lib/publication-time";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { isUuid } from "@/lib/supabase-rest";
import type { JobVacancy } from "@/lib/types";
import { getStoredVacancyById } from "@/lib/vacancy-store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const vacancy = (await getStoredVacancyById(slug, { publicOnly: true })) ?? (shouldShowFallbackContent() ? listVacancies().find((item) => item.id === slug) : undefined);

  return {
    title: vacancy ? `${vacancy.title} — вакансия` : "Вакансия",
    description: vacancy?.description ?? "Карточка вакансии на платформе БЛИЖНИЙ.",
    alternates: {
      canonical: `/vakansiya/${slug}`,
    },
  };
}

function vacancyLocationLabel(vacancy: JobVacancy) {
  if (vacancy.showExactAddress && vacancy.address) {
    return [vacancy.city, vacancy.address].filter(Boolean).join(", ");
  }

  return [vacancy.city, vacancy.district].filter(Boolean).join(", ");
}

export default async function VacancyDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vacancy = (await getStoredVacancyById(slug, { publicOnly: true })) ?? (shouldShowFallbackContent() ? listVacancies().find((item) => item.id === slug) : undefined);

  if (!vacancy) {
    notFound();
  }

  if (vacancy.status !== "published") {
    notFound();
  }

  const images = vacancy.images ?? [];
  const hasPoint = Boolean(vacancy.showExactAddress) && hasMapCoordinates(vacancy.lat, vacancy.lng);
  const canReceivePaidApplications = isUuid(vacancy.id);
  const placeLabel = vacancyLocationLabel(vacancy);
  const publishedLabel = formatPublicationDateTime(vacancy.publishedAt ?? vacancy.createdAt, "10:00");

  return (
    <>
      <SiteHeader />
      <ListingViewTracker listingId={`work-vacancy-${vacancy.id}`} />
      <main className="page-container pb-28 pt-4 sm:py-10">
        <BackLink fallbackHref="/rabota/vakansii" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <article className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-card sm:p-5">
              <div className="grid gap-3 md:grid-cols-[minmax(17rem,24rem)_minmax(0,1fr)] md:items-start md:gap-4">
                <DetailImageGallery compactMobile images={images} title={vacancy.title} fallbackIcon={<BriefcaseBusiness className="h-14 w-14 text-slate-300 sm:h-16 sm:w-16" />} />
                <div className="order-1 min-w-0 md:order-2">
                  <StatusBadge status={vacancy.status} />
                  <p className="mt-3 text-sm font-semibold text-slate-500 [overflow-wrap:anywhere]">{vacancy.organization}</p>
                  <p className="mt-2 text-sm text-slate-500 [overflow-wrap:anywhere]">{vacancy.profession}</p>
                  <h1 className="mt-2 text-2xl font-black leading-tight text-[#060b27] [overflow-wrap:anywhere] sm:text-3xl lg:text-4xl">{vacancy.title}</h1>
                  <p className="mt-3 text-xl font-black text-[#060b27] [overflow-wrap:anywhere] sm:text-2xl">{vacancy.salary}</p>
                  {vacancy.schedule || vacancy.workFormat ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {vacancy.schedule ? <span className="min-w-0 rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-[#0875d1] [overflow-wrap:anywhere]">{vacancy.schedule}</span> : null}
                      {vacancy.workFormat ? <span className="min-w-0 rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700 [overflow-wrap:anywhere]">{vacancy.workFormat}</span> : null}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600">
                    {publishedLabel ? <p>{publishedLabel}</p> : null}
                    <p className="flex min-w-0 items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0875d1] sm:h-5 sm:w-5" />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{placeLabel}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-4">
              <section>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
                  <h2 className="text-lg font-black text-[#060b27] sm:text-xl">Описание</h2>
                  <p className="mt-3 whitespace-pre-line [overflow-wrap:anywhere]">{vacancy.description}</p>
                </div>
              </section>
              <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
                  <h2 className="text-lg font-black text-[#060b27] sm:text-xl">Требования</h2>
                  <p className="mt-3 whitespace-pre-line [overflow-wrap:anywhere]">{vacancy.requirements}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
                  <h2 className="text-lg font-black text-[#060b27] sm:text-xl">Обязанности</h2>
                  <p className="mt-3 whitespace-pre-line [overflow-wrap:anywhere]">{vacancy.responsibilities}</p>
                </div>
              </section>
              {vacancy.conditions ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
                  <h2 className="text-lg font-black text-[#060b27] sm:text-xl">Условия</h2>
                  <p className="mt-3 whitespace-pre-line [overflow-wrap:anywhere]">{vacancy.conditions}</p>
                </div>
              ) : null}
            </div>
          </section>
          <aside className="grid h-fit gap-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[#0aa337] sm:h-16 sm:w-16">
                  <BriefcaseBusiness className="h-7 w-7 sm:h-8 sm:w-8" />
                </div>
                <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Связаться</h2>
              </div>
              <div className="mt-5 grid gap-2">
                {canReceivePaidApplications ? (
                  <>
                    <VacancyApplicationButton vacancyId={vacancy.id} vacancyTitle={vacancy.title} />
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-600">
                      Контакты работодателя не показываются публично. После отклика работодатель сам свяжется с выбранным исполнителем.
                    </p>
                  </>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-600">
                    Отклики доступны для опубликованных вакансий пользователей.
                  </p>
                )}
              </div>
            </section>
            {hasPoint ? (
              <div className="hidden lg:block">
                <LocationMap location={{ ...vacancy, showExactAddress: Boolean(vacancy.showExactAddress), hasMapPoint: hasPoint }} exactLabel="Для вакансий организаций можно показывать точный адрес" />
              </div>
            ) : (
              <section className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6 lg:block">
                <h2 className="text-xl font-black text-[#060b27]">Адрес</h2>
                <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-slate-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0875d1]" />
                  {placeLabel}
                </p>
              </section>
            )}
          </aside>
        </article>
      </main>
    </>
  );
}
