import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipboardList, MapPin, MessageCircle, Phone } from "lucide-react";
import { LocationMap } from "@/components/LocationMap";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { workRequests } from "@/lib/data";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const request = workRequests.find((item) => item.id === slug);

  return {
    title: request ? `${request.title} — заказ` : "Заказ",
    description: request?.description ?? "Карточка заказа на платформе БЛИЖНИЙ.",
    alternates: {
      canonical: `/blizhniy/rabota/zakazy/${slug}`,
    },
  };
}

export default async function WorkRequestDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const request = workRequests.find((item) => item.id === slug);

  if (!request) {
    notFound();
  }

  const messageHref = request.messengerUrl ?? `https://wa.me/${(request.phone ?? "+78610009999").replace(/\D/g, "")}`;

  return (
    <>
      <SiteHeader />
      <main className="page-container py-5 sm:py-10">
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
                <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0aa337] font-bold text-white" href={`tel:${request.phone}`}>
                  <Phone className="h-5 w-5" />
                  Позвонить
                </a>
              ) : null}
              <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#0875d1] font-bold text-[#0875d1]" href={messageHref}>
                <MessageCircle className="h-5 w-5" />
                Написать
              </a>
            </div>
          </aside>
        </article>
      </main>
    </>
  );
}
