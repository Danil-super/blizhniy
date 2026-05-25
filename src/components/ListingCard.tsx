import Link from "next/link";
import { MapPin, MessageCircle, Phone } from "lucide-react";
import type { Listing } from "@/lib/types";
import { listingKinds } from "@/lib/data";
import { StatusBadge } from "./StatusBadge";

const tones = {
  emerald: "from-emerald-50 to-emerald-100 text-emerald-700",
  blue: "from-blue-50 to-blue-100 text-blue-700",
  amber: "from-amber-50 to-amber-100 text-amber-700",
  rose: "from-rose-50 to-rose-100 text-rose-700",
  slate: "from-slate-50 to-slate-200 text-slate-700",
};

export function ListingCard({ listing }: { listing: Listing }) {
  const kind = listingKinds.find((item) => item.slug === listing.kind)?.name ?? "Объявление";

  return (
    <article className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-card sm:grid-cols-[128px_1fr_auto]">
      <div className={`flex h-32 w-full items-center justify-center rounded-xl bg-gradient-to-br text-lg font-black sm:w-32 ${tones[listing.imageTone]}`}>
        {kind}
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={listing.status} />
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{listing.subcategory}</span>
        </div>
        <Link href={`/blizhniy/obyavlenie/${listing.slug}`} className="text-xl font-black text-[#060b27] hover:text-[#0875d1]">
          {listing.title}
        </Link>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{listing.description}</p>
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <MapPin className="h-4 w-4" />
          {listing.city}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:items-end">
        <p className="text-xl font-black text-[#060b27]">{listing.price ?? "Обмен"}</p>
        <div className="flex flex-wrap gap-2 sm:flex-col">
          {listing.phone ? (
            <a className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#0aa337] px-4 text-sm font-semibold text-[#0a8f32]" href={`tel:${listing.phone}`}>
              <Phone className="h-4 w-4" />
              Позвонить
            </a>
          ) : null}
          {listing.messengerUrl ? (
            <a className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#0875d1] px-4 text-sm font-semibold text-[#0875d1]" href={listing.messengerUrl}>
              <MessageCircle className="h-4 w-4" />
              Написать
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
