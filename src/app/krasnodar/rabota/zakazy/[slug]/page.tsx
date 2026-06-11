import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipboardList, MapPin } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { LocationMap } from "@/components/LocationMap";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { WorkRequestDetailClient } from "@/components/WorkRequestDetailClient";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { listWorkRequests } from "@/lib/mock-store";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const request = listWorkRequests().find((item) => item.id === slug);

  return {
    title: request ? `${request.title} — заказ` : "Заказ",
    description: request?.description ?? "Карточка заказа на платформе БЛИЖНИЙ.",
    alternates: {
      canonical: `/krasnodar/rabota/zakazy/${slug}`,
    },
  };
}

export default async function WorkRequestDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const request = listWorkRequests().find((item) => item.id === slug);

  if (!request) {
    return (
      <>
        <SiteHeader />
        <WorkRequestDetailClient requestId={slug} />
      </>
    );
  }

  if (request.status !== "published") {
    notFound();
  }

  const messageHref = request.messengerUrl ?? `https://wa.me/${(request.phone ?? "+78610009999").replace(/\D/g, "")}`;

  return (
    <>
      <SiteHeader />
      <ListingViewTracker listingId={`work-request-${request.id}`} />
      <main className="page-container py-5 sm:py-10">
        <BackLink fallbackHref="/krasnodar/rabota" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <article className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
            <StatusBadge status={request.status} />
            <p className="mt-4 text-sm text-slate-500 sm:text-base">{request.author}</p>
            <h1 className="mt-2 text-3xl font-black leading-tight text-[#060b27] sm:text-5xl">{request.title}</h1>
            <p className="mt-3 text-xl font-black text-[#060b27] sm:text-2xl">{request.budget}</p>
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-600 sm:text-base">
              <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
              {[request.city, request.showExactAddress ? request.address : request.district].filter(Boolean).join(", ")}
            </p>
            <section className="mt-6 text-sm leading-6 text-slate-700 sm:text-base sm:leading-7">
              <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Описание</h2>
              <p className="mt-2">{request.description}</p>
            </section>
            <div className="mt-6">
              <LocationMap location={request} exactLabel="Точный адрес заказа показывается только если заказчик разрешил" />
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
