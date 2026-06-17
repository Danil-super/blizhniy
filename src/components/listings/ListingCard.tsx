import Link from "next/link";
import { ArrowRightLeft, CalendarDays, Gift, Mail, MapPin, ShoppingBag, Tags } from "lucide-react";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
import { StoredMediaImage } from "@/components/StoredMedia";
import { hasMapCoordinates } from "@/lib/map-location";
import { ListingShareButton } from "./ListingShareButton";
import { ListingViewCounter } from "./ListingViewCounter";

export type ListingKind = "prodam" | "kuplyu" | "menyayu" | "otdam-darom" | "arenda";
export type ListingStatus = "draft" | "pending_payment" | "paid" | "published" | "sold" | "archived" | "expired" | "rejected";

export type DemoListing = {
  viewId?: string;
  slug: string;
  author?: string;
  title: string;
  kind: ListingKind;
  categorySlug: string;
  categoryName: string;
  subcategorySlug: string;
  subcategoryName: string;
  city: string;
  district: string;
  address?: string;
  lat?: number;
  lng?: number;
  hasMapPoint?: boolean;
  showExactAddress: boolean;
  price: string;
  images?: string[];
  booking?: import("@/lib/types").BookingDetails;
  delivery?: import("@/lib/types").DeliveryOptions;
  description: string;
  phone?: string;
  email?: string;
  messengerUrl?: string;
  status: ListingStatus;
  paid: boolean;
  createdAt: string;
  publishedAt: string;
  expiresAt: string;
  imageTone: "blue" | "green" | "rose" | "amber" | "violet";
};

function hasListingMapPoint(listing: DemoListing) {
  return (listing.hasMapPoint ?? true) && hasMapCoordinates(listing.lat, listing.lng);
}

function listingPlaceLabel(listing: DemoListing) {
  if (hasListingMapPoint(listing)) {
    return listing.address || [listing.city, listing.district].filter(Boolean).join(", ");
  }

  return listing.city;
}

function formatListingDate(value?: string) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

const kindLabels: Record<ListingKind, string> = {
  prodam: "Продам",
  kuplyu: "Куплю",
  menyayu: "Меняю",
  "otdam-darom": "Отдам даром",
  arenda: "Аренда",
};

const kindIcons = {
  prodam: ShoppingBag,
  kuplyu: Tags,
  menyayu: ArrowRightLeft,
  "otdam-darom": Gift,
  arenda: CalendarDays,
};

const imageTones = {
  blue: "from-blue-100 via-white to-cyan-100 text-[#0875d1]",
  green: "from-emerald-100 via-white to-lime-100 text-[#0a8f32]",
  rose: "from-rose-100 via-white to-orange-100 text-rose-700",
  amber: "from-amber-100 via-white to-yellow-50 text-amber-700",
  violet: "from-violet-100 via-white to-blue-100 text-violet-700",
};

function ListingImage({ className, iconClassName, listing }: { className: string; iconClassName: string; listing: DemoListing }) {
  const Icon = kindIcons[listing.kind];
  const image = listing.images?.[0];

  if (image) {
    return <StoredMediaImage src={image} alt={listing.title} className={`${className} bg-slate-100 object-cover`} />;
  }

  return (
    <span className={`${className} flex items-center justify-center bg-gradient-to-br ${imageTones[listing.imageTone]}`}>
      <Icon className={iconClassName} />
    </span>
  );
}

export function ListingKindBadge({ kind }: { kind: ListingKind }) {
  const Icon = kindIcons[kind];

  return (
    <span className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 sm:h-8 sm:px-3 sm:text-sm">
      <Icon className="h-3.5 w-3.5 shrink-0 text-[#0875d1] sm:h-4 sm:w-4" />
      {kindLabels[kind]}
    </span>
  );
}

export function StatusBadge({ status }: { status: ListingStatus }) {
  const labels: Record<ListingStatus, string> = {
    draft: "Черновик",
    pending_payment: "Ожидает оплату",
    paid: "Оплачено",
    published: "Опубликовано",
    sold: "Продано",
    archived: "Архив",
    expired: "Истек срок",
    rejected: "Отклонено",
  };

  const tone =
    status === "published"
      ? "border-emerald-200 bg-emerald-50 text-[#0a8f32]"
      : status === "sold"
        ? "border-slate-300 bg-slate-100 text-slate-700"
      : status === "pending_payment"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return <span className={`inline-flex h-7 min-w-0 items-center rounded-full border px-2.5 text-xs font-bold sm:h-8 sm:px-3 sm:text-sm ${tone}`}>{labels[status]}</span>;
}

export function ListingCard({ listing }: { listing: DemoListing }) {
  const href = `/obyavlenie/${listing.slug}`;

  return (
    <article className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-4 sm:p-4 xl:grid-cols-[140px_minmax(0,1fr)_minmax(180px,auto)]">
      <div className="flex min-w-0 gap-3 sm:contents">
        <Link
          href={href}
          className="block h-24 w-24 shrink-0 overflow-hidden rounded-lg sm:h-auto sm:min-h-28 sm:w-auto xl:min-h-32"
          aria-label={listing.title}
        >
          <ListingImage listing={listing} className="h-full w-full rounded-lg" iconClassName="h-8 w-8 sm:h-9 sm:w-9 lg:h-12 lg:w-12" />
        </Link>

        <div className="min-w-0 flex-1 sm:flex sm:flex-col sm:justify-center xl:block">
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            <ListingKindBadge kind={listing.kind} />
            <StatusBadge status={listing.status} />
          </div>
          <Link href={href} className="mt-2 line-clamp-2 text-sm font-black leading-5 text-[#060b27] hover:text-[#0875d1] sm:text-base sm:leading-6 lg:text-2xl lg:leading-tight">
            {listing.title}
          </Link>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600 sm:text-sm lg:mt-2 lg:leading-6">{listing.description}</p>
          <p className="mt-1.5 flex min-w-0 items-start gap-1.5 text-xs text-slate-500 sm:text-sm lg:mt-3 lg:gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]" title={listingPlaceLabel(listing)}>{listingPlaceLabel(listing)}</span>
          </p>
        </div>
      </div>

      <div className="grid min-w-0 gap-2 sm:col-span-2 sm:grid-cols-[minmax(0,auto)_minmax(240px,1fr)] sm:items-start sm:gap-3 xl:col-span-1 xl:flex xl:flex-col xl:items-end xl:justify-between xl:gap-4">
        <div className="min-w-0 sm:max-w-[220px] xl:max-w-none xl:text-right">
          <p className="truncate text-base font-black text-[#060b27] sm:text-lg lg:text-2xl">{listing.price}</p>
        </div>
        <div className={`grid min-w-0 gap-1.5 sm:gap-2 xl:flex xl:flex-wrap xl:justify-end ${listing.messengerUrl || listing.email ? "grid-cols-3" : "grid-cols-2"}`}>
          {listing.phone ? (
            <a
              href={`tel:${listing.phone}`}
              className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50 sm:h-9 sm:px-3 sm:text-sm lg:h-10 lg:px-4"
            >
              <ContactAssetIcon kind="phone" className="h-5 w-5 sm:h-6 sm:w-6" />
              <span className="truncate">Позвонить</span>
            </a>
          ) : null}
          {listing.messengerUrl ? (
            <a
              href={listing.messengerUrl}
              className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50 sm:h-9 sm:px-3 sm:text-sm lg:h-10 lg:px-4"
            >
              <ContactAssetIcon kind="message" className="h-5 w-5 sm:h-6 sm:w-6" />
              <span className="truncate sm:hidden">Чат</span>
              <span className="hidden truncate sm:inline">Написать</span>
            </a>
          ) : null}
          {!listing.messengerUrl && listing.email ? (
            <a
              href={`mailto:${listing.email}`}
              className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-2 text-xs font-bold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] hover:from-white hover:to-blue-50 sm:h-9 sm:px-3 sm:text-sm lg:h-10 lg:px-4"
            >
              <Mail className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
              <span className="truncate">Email</span>
            </a>
          ) : null}
          <ListingShareButton href={href} title={listing.title} textBreakpoint="lg" />
        </div>
      </div>
    </article>
  );
}

export function ListingGridCard({ listing }: { listing: DemoListing }) {
  const href = `/obyavlenie/${listing.slug}`;
  const viewId = listing.viewId ?? listing.slug;

  return (
    <article className="group relative min-w-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-card">
      <Link href={href} className="block min-w-0">
        <span className="relative block aspect-[1.18/1] overflow-hidden bg-slate-100">
          <ListingImage listing={listing} className="h-full w-full" iconClassName="h-8 w-8" />
          {listing.images?.[0] ? <span className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-slate-950/30 to-transparent" /> : <span className="absolute -bottom-8 -right-6 h-24 w-24 rounded-full bg-white/35" />}
        </span>
        <span className="block p-2">
          <span className="line-clamp-2 min-h-8 text-[13px] font-black leading-4 text-slate-900 transition group-hover:text-[#0875d1]">
            {listing.title}
          </span>
          <span className="mt-0.5 block truncate text-base font-black leading-5 text-[#060b27]">{listing.price}</span>
          {formatListingDate(listing.publishedAt || listing.createdAt) ? (
            <span className="mt-1 flex min-w-0 items-center gap-1 text-[11px] font-semibold text-slate-500">
              <CalendarDays className="h-3 w-3 shrink-0" />
              <span className="truncate">{formatListingDate(listing.publishedAt || listing.createdAt)}</span>
            </span>
          ) : null}
          <span className="mt-1 flex items-end justify-between gap-1.5 text-[11px] text-slate-500">
            <span className="flex min-w-0 items-start gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="line-clamp-2 min-w-0 leading-[14px] [overflow-wrap:anywhere]" title={listingPlaceLabel(listing)}>{listingPlaceLabel(listing)}</span>
            </span>
            <ListingViewCounter listingId={viewId} />
          </span>
        </span>
      </Link>
      <ListingShareButton
        href={href}
        title={listing.title}
        textBreakpoint="never"
        className="absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white/95 text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-white hover:text-[#0875d1]"
      />
    </article>
  );
}
