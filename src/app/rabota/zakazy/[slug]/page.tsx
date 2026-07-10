import { notFound } from "next/navigation";
import { ClipboardList, MapPin } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { DetailImageGallery } from "@/components/DetailImageGallery";
import { LocationMap } from "@/components/LocationMap";
import { SiteHeader } from "@/components/SiteHeader";
import { VacancyApplicationButton } from "@/components/VacancyApplicationButton";
import { ListingViewTracker } from "@/components/listings/ListingViewTracker";
import { hasMapCoordinates } from "@/lib/map-location";
import { listWorkRequests } from "@/lib/mock-store";
import { formatPublicationDateTime } from "@/lib/publication-time";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { isUuid } from "@/lib/supabase-rest";
import { getStoredWorkRequestById } from "@/lib/work-request-store";

type PageProps = {
  params: Promise<{ slug: string }>;
};

function locationLabel(request: { address?: string; city: string; district?: string; showExactAddress?: boolean }) {
  if (request.showExactAddress && request.address) {
    return [request.city, request.address].filter(Boolean).join(", ");
  }

  return [request.city, request.district].filter(Boolean).join(", ");
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const request = (await getStoredWorkRequestById(slug)) ?? (shouldShowFallbackContent() ? listWorkRequests().find((item) => item.id === slug) : undefined);

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
  const publishedLabel = formatPublicationDateTime(request.publishedAt ?? request.createdAt, "10:00");

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
                <div className="grid gap-5 md:grid-cols-[minmax(18rem,28rem)_minmax(0,1fr)] md:items-start">
                  <DetailImageGallery images={images} localPublicationId={request.id} title={request.title} fallbackIcon={<ClipboardList className="h-16 w-16 text-slate-300" />} />
                  <div className="order-1 min-w-0 self-start md:order-2">
                    <p className="text-sm font-semibold text-slate-500">{request.author}</p>
                    <p className="mt-2 text-sm text-slate-500">{request.profession}</p>
                    <h1 className="mt-2 text-xl font-bold leading-tight text-[#060b27] sm:text-2xl lg:text-3xl">{request.title}</h1>
                    <p className="mt-3 text-xl font-bold text-[#060b27]">{request.budget}</p>
                    <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600">
                      {publishedLabel ? <p>{publishedLabel}</p> : null}
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
              </section>
              {hasPoint ? (
                <div className="hidden lg:block">
                  <LocationMap location={{ ...request, showExactAddress: Boolean(request.showExactAddress), hasMapPoint: hasPoint }} exactLabel="Точный адрес заказа показывается только если заказчик разрешил" />
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
