"use client";

import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, MapPin } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { LocationMap } from "@/components/LocationMap";
import { VacancyMediaGallery } from "@/components/VacancyMediaGallery";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { demoPublicationsStorageKey, type DemoPublication } from "@/lib/demo-publications";

function readStoredPublications() {
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

export function VacancyDetailClient({ vacancyId }: { vacancyId: string }) {
  const [items, setItems] = useState<DemoPublication[]>([]);

  useEffect(() => {
    setItems(readStoredPublications());
  }, []);

  const vacancy = useMemo(() => items.find((item) => item.type === "vacancy" && item.id === vacancyId), [items, vacancyId]);

  if (!vacancy) {
    return (
      <main className="page-container py-10">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-2xl font-black text-[#060b27]">Вакансия не найдена</h1>
          <p className="mt-2 text-slate-600">Демо-вакансии хранятся в браузере, где они были созданы.</p>
          <BackLink fallbackHref="/cabinet/vakansii" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться к вакансиям
          </BackLink>
        </section>
      </main>
    );
  }

  return (
    <>
      <ListingViewTracker listingId={`work-vacancy-${vacancy.id}`} />
      <main className="page-container py-10">
        <BackLink fallbackHref="/cabinet/vakansii" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <article className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <DemoStatusBadge status={vacancy.status} />
            <p className="mt-5 text-slate-500">{vacancy.subtitle}</p>
            <h1 className="mt-2 text-3xl font-black text-[#060b27] sm:text-5xl">{vacancy.title}</h1>
            <p className="mt-4 text-2xl font-black">{vacancy.price ?? "по договоренности"}</p>
            {vacancy.schedule || vacancy.workFormat ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {vacancy.schedule ? <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-[#0875d1]">{vacancy.schedule}</span> : null}
                {vacancy.workFormat ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">{vacancy.workFormat}</span> : null}
              </div>
            ) : null}
            <p className="mt-4 flex items-center gap-2 text-slate-600">
              <MapPin className="h-5 w-5" />
              {vacancy.showExactAddress && vacancy.address ? `${vacancy.city}, ${vacancy.address}` : vacancy.city}
            </p>
            <VacancyMediaGallery images={vacancy.images} title={vacancy.title} />
            <div className="mt-8 grid gap-6 leading-7 text-slate-700">
              <section>
                <h2 className="text-2xl font-black text-[#060b27]">Описание</h2>
                <p className="mt-2 whitespace-pre-line">{vacancy.description ?? "Описание вакансии будет дополнено."}</p>
              </section>
              {vacancy.requirements ? (
                <section>
                  <h2 className="text-2xl font-black text-[#060b27]">Требования</h2>
                  <p className="mt-2 whitespace-pre-line">{vacancy.requirements}</p>
                </section>
              ) : null}
              {vacancy.responsibilities ? (
                <section>
                  <h2 className="text-2xl font-black text-[#060b27]">Обязанности</h2>
                  <p className="mt-2 whitespace-pre-line">{vacancy.responsibilities}</p>
                </section>
              ) : null}
              {vacancy.conditions ? (
                <section>
                  <h2 className="text-2xl font-black text-[#060b27]">Условия</h2>
                  <p className="mt-2 whitespace-pre-line">{vacancy.conditions}</p>
                </section>
              ) : null}
            </div>
            <div className="mt-7">
              <LocationMap location={{ ...vacancy, showExactAddress: Boolean(vacancy.showExactAddress) }} exactLabel="Для вакансий можно показывать точный адрес" />
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
