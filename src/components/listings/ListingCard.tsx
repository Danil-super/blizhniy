import Link from "next/link";
import { ArrowRightLeft, CalendarDays, Gift, MapPin, MessageCircle, Phone, ShoppingBag, Tags } from "lucide-react";

export type ListingKind = "prodam" | "kuplyu" | "menyayu" | "otdam-darom" | "arenda";
export type ListingStatus = "draft" | "pending_payment" | "paid" | "published" | "archived" | "expired" | "rejected";

export type DemoListing = {
  slug: string;
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
  showExactAddress: boolean;
  price: string;
  booking?: import("@/lib/types").BookingDetails;
  description: string;
  phone: string;
  messengerUrl?: string;
  status: ListingStatus;
  paid: boolean;
  createdAt: string;
  publishedAt: string;
  expiresAt: string;
  imageTone: "blue" | "green" | "rose" | "amber" | "violet";
};

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
    archived: "Архив",
    expired: "Истек срок",
    rejected: "Отклонено",
  };

  const tone =
    status === "published"
      ? "border-emerald-200 bg-emerald-50 text-[#0a8f32]"
      : status === "pending_payment"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return <span className={`inline-flex h-7 min-w-0 items-center rounded-full border px-2.5 text-xs font-bold sm:h-8 sm:px-3 sm:text-sm ${tone}`}>{labels[status]}</span>;
}

export function ListingCard({ listing }: { listing: DemoListing }) {
  const Icon = kindIcons[listing.kind];

  return (
    <article className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-4 sm:p-4 xl:grid-cols-[140px_minmax(0,1fr)_minmax(180px,auto)]">
      <div className="flex min-w-0 gap-3 sm:contents">
        <Link
          href={`/blizhniy/obyavlenie/${listing.slug}`}
          className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br sm:h-auto sm:min-h-28 sm:w-auto xl:min-h-32 ${imageTones[listing.imageTone]}`}
          aria-label={listing.title}
        >
          <Icon className="h-8 w-8 sm:h-9 sm:w-9 lg:h-12 lg:w-12" />
        </Link>

        <div className="min-w-0 flex-1 sm:flex sm:flex-col sm:justify-center xl:block">
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            <ListingKindBadge kind={listing.kind} />
            <StatusBadge status={listing.status} />
          </div>
          <Link href={`/blizhniy/obyavlenie/${listing.slug}`} className="mt-2 line-clamp-2 text-sm font-black leading-5 text-[#060b27] hover:text-[#0875d1] sm:text-base sm:leading-6 lg:text-2xl lg:leading-tight">
            {listing.title}
          </Link>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600 sm:text-sm lg:mt-2 lg:leading-6">{listing.description}</p>
          <p className="mt-1.5 flex min-w-0 items-start gap-1.5 text-xs text-slate-500 sm:text-sm lg:mt-3 lg:gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="min-w-0 truncate">{listing.city}, {listing.district}</span>
          </p>
        </div>
      </div>

      <div className="grid min-w-0 gap-2 sm:col-span-2 sm:grid-cols-[minmax(0,auto)_minmax(240px,1fr)] sm:items-start sm:gap-3 xl:col-span-1 xl:flex xl:flex-col xl:items-end xl:justify-between xl:gap-4">
        <div className="min-w-0 sm:max-w-[220px] xl:max-w-none xl:text-right">
          <p className="truncate text-base font-black text-[#060b27] sm:text-lg lg:text-2xl">{listing.price}</p>
          <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">{listing.publishedAt}</p>
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5 sm:gap-2 xl:flex xl:flex-wrap xl:justify-end">
          <a
            href={`tel:${listing.phone}`}
            className="inline-flex h-8 min-w-0 overflow-hidden items-center justify-center gap-1.5 rounded-lg border border-[#0aa337] px-2 text-xs font-bold text-[#0a8f32] transition hover:bg-emerald-50 sm:h-9 sm:px-3 sm:text-sm lg:h-10 lg:px-4"
          >
            <Phone className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="truncate">Позвонить</span>
          </a>
          {listing.messengerUrl ? (
            <a
              href={listing.messengerUrl}
              className="inline-flex h-8 min-w-0 overflow-hidden items-center justify-center gap-1.5 rounded-lg border border-[#0875d1] px-2 text-xs font-bold text-[#0875d1] transition hover:bg-blue-50 sm:h-9 sm:px-3 sm:text-sm lg:h-10 lg:px-4"
            >
              <MessageCircle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="truncate sm:hidden">Чат</span>
              <span className="hidden truncate sm:inline">Написать</span>
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
