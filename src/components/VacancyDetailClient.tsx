"use client";

import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, MapPin } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { DetailImageGallery } from "@/components/DetailImageGallery";
import { LocationMap } from "@/components/LocationMap";
import { VacancyApplicationButton } from "@/components/VacancyApplicationButton";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { shouldShowClientFallbackContent } from "@/lib/client-runtime-mode";
import { demoPublicationsStorageKey, type DemoPublication } from "@/lib/demo-publications";
import { hasMapCoordinates } from "@/lib/map-location";
import { formatPublicationDateTime } from "@/lib/publication-time";

const clientFallbackContentEnabled = shouldShowClientFallbackContent();

function readStoredPublications() {
  if (!clientFallbackContentEnabled) {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "id" in item));
    }
  } catch {
    return [];
  }

  return [];
}

function DemoStatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.trim().toLowerCase();
  const tone =
    normalizedStatus === "опубликовано" || normalizedStatus === "published"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : normalizedStatus === "черновик"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${tone}`}>{status}</span>;
}

function vacancyLocationLabel(vacancy: DemoPublication) {
  if (vacancy.showExactAddress && vacancy.address) {
    return [vacancy.city, vacancy.address].filter(Boolean).join(", ");
  }

  return vacancy.city;
}

export function VacancyDetailClient({ vacancyId }: { vacancyId: string }) {
  const [items, setItems] = useState<DemoPublication[]>([]);

  useEffect(() => {
    if (!clientFallbackContentEnabled) {
      setItems([]);
      return;
    }

    setItems(readStoredPublications());
  }, []);

  const vacancy = useMemo(() => items.find((item) => item.type === "vacancy" && item.id === vacancyId), [items, vacancyId]);

  if (!vacancy) {
    return (
      <main className="page-container py-10">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-xl font-bold text-[#060b27]">Вакансия не найдена</h1>
          <p className="mt-2 text-slate-600">Вакансия не найдена или больше не опубликована.</p>
          <BackLink fallbackHref="/cabinet/vakansii" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться к вакансиям
          </BackLink>
        </section>
      </main>
    );
  }

  const images = vacancy.images ?? [];
  const hasPoint = Boolean(vacancy.showExactAddress) && hasMapCoordinates(vacancy.lat, vacancy.lng);
  const placeLabel = vacancyLocationLabel(vacancy);
  const publishedLabel = formatPublicationDateTime(vacancy.createdAt, "10:00");

  return (
    <>
      <ListingViewTracker listingId={`work-vacancy-${vacancy.id}`} />
      <main className="page-container pb-28 pt-4 sm:py-10">
        <div className="mx-auto max-w-[1120px]">
          <BackLink fallbackHref="/cabinet/vakansii" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад
          </BackLink>
          <article className="grid gap-4 lg:grid-cols-[minmax(0,740px)_340px] lg:justify-center">
          <section className="grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-card sm:p-5">
              <div className="grid gap-3 md:grid-cols-[minmax(17rem,24rem)_minmax(0,1fr)] md:items-start md:gap-4">
                <DetailImageGallery compactMobile images={images} title={vacancy.title} fallbackIcon={<BriefcaseBusiness className="h-14 w-14 text-slate-300 sm:h-16 sm:w-16" />} />
                <div className="order-1 min-w-0 md:order-2">
                  <DemoStatusBadge status={vacancy.status} />
                  <p className="mt-3 text-sm font-semibold text-slate-500 [overflow-wrap:anywhere]">{vacancy.subtitle}</p>
                  <p className="mt-2 text-sm text-slate-500 [overflow-wrap:anywhere]">{vacancy.profession ?? vacancy.title}</p>
                  <h1 className="mt-2 text-xl font-bold leading-tight text-[#060b27] [overflow-wrap:anywhere] sm:text-2xl lg:text-3xl">{vacancy.title}</h1>
                  <p className="mt-3 text-xl font-bold text-[#060b27] [overflow-wrap:anywhere]">{vacancy.price ?? "по договоренности"}</p>
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
            <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
              <h2 className="text-lg font-bold text-[#060b27]">Описание</h2>
              <p className="mt-3 whitespace-pre-line [overflow-wrap:anywhere]">{vacancy.description ?? "Описание вакансии будет дополнено."}</p>
            </section>
            {(vacancy.requirements || vacancy.responsibilities) ? (
              <section className="grid gap-4 md:grid-cols-2">
                {vacancy.requirements ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
                    <h2 className="text-lg font-bold text-[#060b27]">Требования</h2>
                    <p className="mt-3 whitespace-pre-line [overflow-wrap:anywhere]">{vacancy.requirements}</p>
                  </div>
                ) : null}
                {vacancy.responsibilities ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
                    <h2 className="text-lg font-bold text-[#060b27]">Обязанности</h2>
                    <p className="mt-3 whitespace-pre-line [overflow-wrap:anywhere]">{vacancy.responsibilities}</p>
                  </div>
                ) : null}
              </section>
            ) : null}
              {vacancy.conditions ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
                  <h2 className="text-lg font-bold text-[#060b27]">Условия</h2>
                  <p className="mt-3 whitespace-pre-line [overflow-wrap:anywhere]">{vacancy.conditions}</p>
                </div>
              ) : null}
          </section>
          <aside className="grid h-fit gap-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[#0aa337] sm:h-16 sm:w-16">
                  <BriefcaseBusiness className="h-7 w-7 sm:h-8 sm:w-8" />
                </div>
                <h2 className="text-xl font-bold text-[#060b27]">Связаться</h2>
              </div>
              <div className="mt-5 grid gap-2">
                <VacancyApplicationButton vacancyId={vacancy.id} vacancyTitle={vacancy.title} />
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-600">
                  Контакты работодателя не показываются публично. После отклика работодатель сам свяжется с выбранным исполнителем.
                </p>
              </div>
            </section>
            {hasPoint ? (
              <div className="hidden lg:block">
                <LocationMap location={{ ...vacancy, showExactAddress: Boolean(vacancy.showExactAddress), hasMapPoint: hasPoint }} exactLabel="Для вакансий можно показывать точный адрес" />
              </div>
            ) : placeLabel !== vacancy.city ? (
              <section className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6 lg:block">
                <h2 className="text-xl font-bold text-[#060b27]">Адрес</h2>
                <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-slate-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0875d1]" />
                  {placeLabel}
                </p>
              </section>
            ) : null}
          </aside>
          </article>
        </div>
      </main>
    </>
  );
}
