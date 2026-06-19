"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, MapPin } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { LocationMap } from "@/components/LocationMap";
import { StoredMediaImage } from "@/components/StoredMedia";
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
  const draft = status.trim().toLowerCase() === "черновик";
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${draft ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{status}</span>;
}

export function WorkRequestDetailClient({ requestId }: { requestId: string }) {
  const [items, setItems] = useState<DemoPublication[]>([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const request = useMemo(() => items.find((item) => item.type === "workRequest" && item.id === requestId), [items, requestId]);

  useEffect(() => {
    setItems(readStoredPublications());
  }, []);

  if (!request) {
    return (
      <main className="page-container py-10">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h1 className="text-2xl font-black text-[#060b27]">Заказ не найден</h1>
          <p className="mt-2 text-slate-600">Демо-заказы хранятся в браузере, где они были созданы.</p>
          <BackLink fallbackHref="/cabinet/zakazy" className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-5 font-bold text-white">
            Вернуться к заказам
          </BackLink>
        </section>
      </main>
    );
  }

  const messageHref = request.messengerUrl ?? `https://wa.me/${(request.phone ?? "+78610009999").replace(/\D/g, "")}`;
  const images = request.images ?? [];
  const activeImage = images[Math.min(activeImageIndex, Math.max(0, images.length - 1))];

  return (
    <>
      <ListingViewTracker listingId={`work-request-${request.id}`} />
      <main className="page-container py-5 sm:py-10">
        <BackLink fallbackHref="/cabinet/zakazy" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <article className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
            <DemoStatusBadge status={request.status} />
            <p className="mt-4 text-sm text-slate-500 sm:text-base">{request.subtitle}</p>
            <h1 className="mt-2 text-3xl font-black leading-tight text-[#060b27] sm:text-5xl">{request.title}</h1>
            <p className="mt-3 text-xl font-black text-[#060b27] sm:text-2xl">{request.price ?? "по договоренности"}</p>
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-600 sm:text-base">
              <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
              {request.city}
            </p>
            {activeImage ? (
              <section className="mt-6">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  <div className="flex aspect-[4/3] max-h-[34rem] items-center justify-center bg-slate-100">
                    <StoredMediaImage src={activeImage} alt={request.title} className="h-full w-full object-contain" />
                  </div>
                </div>
                {images.length > 1 ? (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                    {images.map((image, index) => (
                      <button
                        key={`${image}-${index}`}
                        type="button"
                        onClick={() => setActiveImageIndex(index)}
                        className={`h-20 w-24 shrink-0 overflow-hidden rounded-xl border bg-white transition sm:h-24 sm:w-32 ${
                          index === activeImageIndex ? "border-[#0875d1] ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-200"
                        }`}
                        aria-label={`Показать фото ${index + 1}`}
                      >
                        <StoredMediaImage src={image} alt={`${request.title}, фото ${index + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            <section className="mt-6 text-sm leading-6 text-slate-700 sm:text-base sm:leading-7">
              <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Описание</h2>
              <p className="mt-2 whitespace-pre-line">{request.description ?? "Описание заказа будет дополнено."}</p>
            </section>
            <div className="mt-6">
              <LocationMap location={{ ...request, showExactAddress: Boolean(request.showExactAddress) }} exactLabel="Точный адрес заказа показывается только если заказчик разрешил" />
            </div>
          </section>
          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-[#0aa337] sm:h-20 sm:w-20">
              <ClipboardList className="h-8 w-8 sm:h-10 sm:w-10" />
            </div>
            <h2 className="mt-4 text-xl font-black text-[#060b27] sm:text-2xl">Связаться</h2>
            <div className="mt-4 grid gap-2 sm:mt-5">
              {request.phone ? (
                <a className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#0875d1] to-[#18a9ff] px-3 font-bold text-white shadow-sm shadow-blue-100 transition hover:from-[#0664b3] hover:to-[#0875d1]" href={`tel:${request.phone}`}>
                  <ContactAssetIcon kind="phone" />
                  Позвонить
                </a>
              ) : null}
              <a className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3 font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50" href={messageHref}>
                <ContactAssetIcon kind="message" />
                Написать
              </a>
            </div>
          </aside>
        </article>
      </main>
    </>
  );
}
