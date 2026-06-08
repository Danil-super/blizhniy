"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { LocationMap } from "@/components/LocationMap";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { demoPublicationsStorageKey, type DemoPublication } from "@/lib/demo-publications";
import { hasMapCoordinates } from "@/lib/map-location";

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
  const draft = status.trim().toLowerCase() === "черновик";
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${draft ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{status}</span>;
}

export function SpecialistDetailClient({ specialistId }: { specialistId: string }) {
  const [items, setItems] = useState<DemoPublication[]>([]);
  const specialist = useMemo(() => items.find((item) => item.type === "specialist" && item.id === specialistId), [items, specialistId]);

  useEffect(() => {
    setItems(readStoredPublications());
  }, []);

  if (!specialist) {
    return (
      <main className="page-container py-10">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-2xl font-black text-[#060b27]">Анкета не найдена</h1>
          <p className="mt-2 text-slate-600">Демо-анкеты хранятся в браузере, где они были созданы.</p>
          <BackLink fallbackHref="/cabinet/specialist" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться к анкетам
          </BackLink>
        </section>
      </main>
    );
  }

  const hasMapPoint = (specialist.hasMapPoint ?? true) && hasMapCoordinates(specialist.lat, specialist.lng);

  return (
    <>
      <ListingViewTracker listingId={`work-specialist-${specialist.id}`} />
      <main className="page-container py-5 sm:py-10">
        <BackLink fallbackHref="/cabinet/specialist" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
          <DemoStatusBadge status={specialist.status} />
          <div className="mt-4 grid gap-5 sm:mt-6 lg:grid-cols-[132px_1fr_300px] lg:gap-7">
            {specialist.images?.[0] ? (
              <div className="h-28 w-28 rounded-full bg-blue-50 bg-contain bg-center bg-no-repeat ring-1 ring-blue-100 sm:h-36 sm:w-36" style={{ backgroundImage: `url(${specialist.images[0]})` }} aria-label={`Фото ${specialist.title}`} />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-full bg-blue-50 text-4xl font-black text-[#0875d1] sm:h-36 sm:w-36 sm:text-5xl">{specialist.title.slice(0, 1)}</div>
            )}
            <section>
              <h1 className="text-3xl font-black leading-tight text-[#060b27] sm:text-4xl">{specialist.title}</h1>
              <p className="mt-1 text-lg font-bold text-[#0875d1] sm:text-xl">{specialist.subtitle}</p>
              <p className="mt-3 flex items-center gap-2 text-sm text-slate-600 sm:text-base">
                <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
                {specialist.city}
              </p>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700 sm:text-base sm:leading-7">{specialist.description ?? "Опытный исполнитель для частных заказов и регулярной работы."}</p>
            </section>
            <aside>
              <p className="text-2xl font-black sm:text-3xl">{specialist.price}</p>
              <div className="mt-4 grid gap-2 sm:mt-5">
                {specialist.phone ? (
                  <a className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#0875d1] to-[#18a9ff] px-3 font-bold text-white shadow-sm shadow-blue-100 transition hover:from-[#0664b3] hover:to-[#0875d1]" href={`tel:${specialist.phone}`}>
                    <ContactAssetIcon kind="phone" />
                    Позвонить
                  </a>
                ) : null}
                <a className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3 font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50" href={specialist.messengerUrl ?? "https://t.me/blizhniy_support"}>
                  <ContactAssetIcon kind="message" />
                  Написать
                </a>
              </div>
            </aside>
          </div>
          {hasMapPoint ? (
            <div className="mt-8">
              <LocationMap location={{ ...specialist, showExactAddress: Boolean(specialist.showExactAddress) }} exactLabel="Точный адрес специалиста по умолчанию не показывается" />
            </div>
          ) : null}
        </article>
      </main>
    </>
  );
}
