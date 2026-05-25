import Link from "next/link";
import { ArrowRightLeft, Gift, MapPin, MessageCircle, Phone, ShoppingBag, Tags } from "lucide-react";

export type ListingKind = "prodam" | "kuplyu" | "menyayu" | "otdam-darom";
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
};

const kindIcons = {
  prodam: ShoppingBag,
  kuplyu: Tags,
  menyayu: ArrowRightLeft,
  "otdam-darom": Gift,
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
    <span className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
      <Icon className="h-4 w-4 text-[#0875d1]" />
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

  return <span className={`inline-flex h-8 items-center rounded-full border px-3 text-sm font-bold ${tone}`}>{labels[status]}</span>;
}

export function ListingCard({ listing }: { listing: DemoListing }) {
  const Icon = kindIcons[listing.kind];

  return (
    <article className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card sm:grid-cols-[160px_1fr_auto]">
      <Link
        href={`/blizhniy/obyavlenie/${listing.slug}`}
        className={`flex aspect-[4/3] min-h-32 items-center justify-center rounded-lg bg-gradient-to-br ${imageTones[listing.imageTone]}`}
        aria-label={listing.title}
      >
        <Icon className="h-12 w-12" />
      </Link>

      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <ListingKindBadge kind={listing.kind} />
          <StatusBadge status={listing.status} />
        </div>
        <Link href={`/blizhniy/obyavlenie/${listing.slug}`} className="mt-3 block text-2xl font-black text-[#060b27] hover:text-[#0875d1]">
          {listing.title}
        </Link>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{listing.description}</p>
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <MapPin className="h-4 w-4" />
          {listing.city}, {listing.district}
        </p>
      </div>

      <div className="flex flex-col justify-between gap-4 sm:min-w-44 sm:items-end">
        <div className="sm:text-right">
          <p className="text-2xl font-black text-[#060b27]">{listing.price}</p>
          <p className="mt-1 text-sm text-slate-500">{listing.publishedAt}</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <a
            href={`tel:${listing.phone}`}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#0aa337] px-4 text-sm font-bold text-[#0a8f32] transition hover:bg-emerald-50"
          >
            <Phone className="h-4 w-4" />
            Позвонить
          </a>
          {listing.messengerUrl ? (
            <a
              href={listing.messengerUrl}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#0875d1] px-4 text-sm font-bold text-[#0875d1] transition hover:bg-blue-50"
            >
              <MessageCircle className="h-4 w-4" />
              Написать
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
