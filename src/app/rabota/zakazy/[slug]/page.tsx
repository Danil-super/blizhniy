import { publicationOpenGraph } from "@/lib/publication-open-graph";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipboardList, MapPin, Wrench } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { PublicPublicationTerms } from "@/components/PublicPublicationTerms";
import { PublicationComplaintLink } from "@/components/PublicationComplaintLink";
import { DetailImageGallery } from "@/components/DetailImageGallery";
import { LocationMap } from "@/components/LocationMap";
import { SiteHeader } from "@/components/SiteHeader";
import { VacancyApplicationButton } from "@/components/VacancyApplicationButton";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { hasMapCoordinates } from "@/lib/map-location";
import { listWorkRequests } from "@/lib/mock-store";
import {PublicationDates} from '@/components/PublicationDates';
import {PublicationHeading} from '@/components/PublicationHeading';
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { isUuid } from "@/lib/supabase-rest";
import { getStoredWorkRequestById, listWorkRequestsWithStored } from "@/lib/work-request-store";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const request = (await getStoredWorkRequestById(slug, { publicOnly: true })) ?? (shouldShowFallbackContent() ? listWorkRequestsWithStored(listWorkRequests()).find((item) => item.id === slug) : undefined);

  const title = request ? `${request.title} — заказ` : "Заказ";
  const description = request?.description ?? "Карточка заказа на платформе БЛИЖНИЙ.";
  const url = `/rabota/zakazy/${slug}`;
  return {
    ...(request?.testPublication ? { robots: { index: false, follow: true } } : {}),
    title,
    description,
    openGraph: request ? publicationOpenGraph(title, description, url, request.images) : undefined,
    alternates: { canonical: url },
  };
}

function locationLabel(request: { address?: string; city: string; district?: string; showExactAddress?: boolean }) {
  if (request.showExactAddress && request.address) {
    return [request.city, request.address].filter(Boolean).join(", ");
  }

  return [request.city, request.district].filter(Boolean).join(", ");
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const request = (await getStoredWorkRequestById(slug, { publicOnly: true })) ?? (shouldShowFallbackContent() ? listWorkRequestsWithStored(listWorkRequests()).find((item) => item.id === slug) : undefined);

  if (!request) {
    notFound();
  }

  if (request.status !== "published") {
    notFound();
  }

  const images = request.images ?? [];
  const hasPoint = Boolean(request.showExactAddress) && hasMapCoordinates(request.lat, request.lng);
  const canReceivePaidApplications = isUuid(request.id);
  const placeLabel = locationLabel(request);

  return (
    <>
      <SiteHeader />
      <ListingViewTracker listingId={`work-request-${request.id}`} />
      <main className="page-container py-5 sm:py-10">
        <div className="mx-auto max-w-[1120px]">
          <BackLink fallbackHref="/rabota" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
            Назад
          </BackLink>
          <article className="grid gap-4 lg:grid-cols-[minmax(0,740px)_340px] lg:justify-center">
            <section className="grid gap-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
                <PublicationHeading title={request.title} price={request.budget}>
                    <p className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800"><Wrench aria-hidden="true" className="h-4 w-4 shrink-0"/>{request.profession}</p>
                </PublicationHeading>
                <div className="grid gap-5 md:grid-cols-[minmax(18rem,28rem)_minmax(0,1fr)] md:items-start">
                  <DetailImageGallery images={images} localPublicationId={request.id} title={request.title} fallbackIcon={<ClipboardList className="h-16 w-16 text-slate-300" />} />
                  <div className="order-1 min-w-0 self-start md:order-2">
                    <div className="grid gap-3 text-sm font-semibold text-slate-600">
                      <PublicationDates publishedAt={request.publishedAt??request.createdAt} updatedAt={request.updatedAt}/>
                      <p className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-[#0875d1] sm:h-5 sm:w-5" />
                        {placeLabel}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
                <h2 className="text-lg font-bold text-[#060b27]">Описание</h2>
                <p className="mt-3 whitespace-pre-line">{request.description}</p>
              </section>
            </section>
            <aside className="grid h-fit gap-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[#0aa337] sm:h-16 sm:w-16">
                    <ClipboardList className="h-7 w-7 sm:h-8 sm:w-8" />
                  </div>
                  <h2 className="text-xl font-bold text-[#060b27]">Связаться</h2>
                </div>
                <div className="mt-5 grid gap-2">
                  {canReceivePaidApplications ? (
                    <>
                      <VacancyApplicationButton targetKind="workRequest" targetId={request.id} targetTitle={request.title} />
                      <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-600">
                        Контакты заказчика не показываются публично. После отклика заказчик увидит вашу анкету и сам выберет исполнителя.
                      </p>
                    </>
                  ) : (
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-600">
                      Отклики доступны для опубликованных заказов пользователей.
                    </p>
                  )}
                </div>
                <div className="mt-3">
                  <PublicPublicationTerms terms={request.publicationTerms} images={request.images}/>
                  <PublicationComplaintLink section="rabota/zakazy" slug={request.id} />
                </div>
              </section>
              {hasPoint ? (
                <div className="hidden lg:block">
                  <LocationMap location={{ city: request.city, district: request.district, address: request.address, lat: request.lat, lng: request.lng, showExactAddress: Boolean(request.showExactAddress), hasMapPoint: hasPoint }} exactLabel="Точный адрес заказа показывается только если заказчик разрешил" />
                </div>
              ) : placeLabel !== request.city ? (
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
