"use client";

import { BadgeCheck, MapPin, UserRound } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { DetailImageGallery } from "@/components/DetailImageGallery";
import { LocationMap } from "@/components/LocationMap";
import { formatPublicationDateTime } from "@/lib/publication-time";

export type SpecialistProfileDetailData = {
  id: string;
  address?: string;
  city: string;
  createdAt?: string;
  description?: string;
  district?: string;
  email?: string;
  hasMapPoint?: boolean;
  images?: string[];
  lat?: number;
  lng?: number;
  messengerUrl?: string;
  name: string;
  phone?: string;
  price: string;
  profession: string;
  publishedAt?: string;
  showExactAddress: boolean;
  skills?: string;
  status: string;
};

function normalizeStatus(status: string) {
  return status.trim().toLowerCase();
}

function statusLabel(status: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "published") {
    return "Опубликовано";
  }

  if (normalized === "pending_payment") {
    return "Ожидает оплату";
  }

  if (normalized === "draft") {
    return "Черновик";
  }

  return status;
}

function StatusPill({ status }: { status: string }) {
  const normalized = normalizeStatus(status);
  const published = normalized === "published" || normalized === "опубликовано";
  const pending = normalized === "pending_payment" || normalized === "ждет оплаты" || normalized === "ожидает оплату";
  const tone = published
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : pending
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-slate-50 text-slate-600";

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${tone}`}>{statusLabel(status)}</span>;
}

function locationLabel(specialist: Pick<SpecialistProfileDetailData, "address" | "city" | "district" | "showExactAddress">) {
  if (specialist.showExactAddress && specialist.address) {
    return [specialist.city, specialist.address].filter(Boolean).join(", ");
  }

  return [specialist.city, specialist.district].filter(Boolean).join(", ");
}

function messageHref(specialist: Pick<SpecialistProfileDetailData, "email" | "messengerUrl">) {
  if (specialist.messengerUrl) {
    return specialist.messengerUrl;
  }

  if (specialist.email) {
    return `mailto:${specialist.email}`;
  }

  return "";
}

export function SpecialistProfileDetail({ fallbackHref = "/rabota/specialisty", specialist }: { fallbackHref?: string; specialist: SpecialistProfileDetailData }) {
  const placeLabel = locationLabel(specialist);
  const publishedLabel = formatPublicationDateTime(specialist.publishedAt ?? specialist.createdAt, "10:00");
  const writeHref = messageHref(specialist);

  return (
    <main className="page-container py-5 sm:py-10">
      <BackLink fallbackHref={fallbackHref} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
        Назад
      </BackLink>
      <article className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(17rem,25rem)_minmax(0,1fr)] md:items-start">
              <DetailImageGallery images={specialist.images} title={specialist.name} fallbackIcon={<UserRound className="h-16 w-16 text-slate-300" />} />
              <div className="order-1 min-w-0 md:order-2">
                <StatusPill status={specialist.status} />
                <p className="mt-3 text-sm font-semibold text-slate-500">Анкета специалиста</p>
                <h1 className="mt-2 text-xl font-bold leading-tight text-[#060b27] sm:text-2xl lg:text-3xl">{specialist.name}</h1>
                <p className="mt-2 text-base font-bold text-[#0875d1] sm:text-lg">{specialist.profession}</p>
                <p className="mt-3 text-xl font-bold text-[#060b27]">{specialist.price}</p>
                <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600">
                  {publishedLabel ? <p>{publishedLabel}</p> : null}
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0875d1] sm:h-5 sm:w-5" />
                    <span>{placeLabel}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
            <h2 className="text-lg font-bold text-[#060b27]">О специалисте</h2>
            <p className="mt-3 whitespace-pre-line">{specialist.description || `${specialist.skills || specialist.profession}. Исполнитель для частных заказов и регулярной работы.`}</p>
          </section>

          {specialist.skills ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-card sm:p-5">
              <h2 className="text-lg font-bold text-[#060b27]">Навыки и работы</h2>
              <p className="mt-3 whitespace-pre-line">{specialist.skills}</p>
            </section>
          ) : null}
        </section>

        <aside className="grid h-fit gap-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[#0aa337] sm:h-16 sm:w-16">
                <BadgeCheck className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
              <h2 className="text-xl font-bold text-[#060b27]">Связаться</h2>
            </div>
            <div className="mt-5 grid gap-2">
              {specialist.phone ? (
                <a className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#0875d1] to-[#18a9ff] px-3 font-bold text-white shadow-sm shadow-blue-100 transition hover:from-[#0664b3] hover:to-[#0875d1]" href={`tel:${specialist.phone}`}>
                  <ContactAssetIcon kind="phone" />
                  Позвонить
                </a>
              ) : null}
              {writeHref ? (
                <a className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3 font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50" href={writeHref}>
                  <ContactAssetIcon kind="message" />
                  Написать
                </a>
              ) : null}
            </div>
          </section>

          {specialist.hasMapPoint ? (
            <div className="hidden lg:block">
              <LocationMap location={specialist} exactLabel="Точный адрес специалиста по умолчанию не показывается" />
            </div>
          ) : (
            <section className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6 lg:block">
              <h2 className="text-xl font-bold text-[#060b27]">Адрес</h2>
              <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-slate-600">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0875d1]" />
                {placeLabel}
              </p>
            </section>
          )}
        </aside>
      </article>
    </main>
  );
}
