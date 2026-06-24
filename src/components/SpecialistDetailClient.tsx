"use client";

import { useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { SpecialistProfileDetail } from "@/components/SpecialistProfileDetail";
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
          <h1 className="text-xl font-bold text-[#060b27]">Анкета не найдена</h1>
          <p className="mt-2 text-slate-600">Анкета не найдена или больше не опубликована.</p>
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
      <SpecialistProfileDetail
        fallbackHref="/cabinet/specialist"
        specialist={{
          ...specialist,
          name: specialist.title,
          profession: specialist.profession ?? specialist.subtitle,
          price: specialist.price ?? "по договоренности",
          showExactAddress: Boolean(specialist.showExactAddress),
          hasMapPoint,
        }}
      />
    </>
  );
}
