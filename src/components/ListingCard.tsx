import Link from "next/link";
import { MapPin } from "lucide-react";
import { ContactAssetIcon } from "@/components/ContactAssetIcon";
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
    <article className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-card sm:grid-cols-[128px_1fr_auto] sm:gap-4 sm:p-4">
      <div className={`flex h-24 w-full items-center justify-center rounded-xl bg-gradient-to-br px-3 text-center text-base font-bold sm:h-32 sm:w-32 sm:text-lg ${tones[listing.imageTone]}`}>
        {kind}
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={listing.status} />
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{listing.subcategory}</span>
        </div>
        <Link href={`/obyavlenie/${listing.slug}`} className="[overflow-wrap:anywhere] text-lg font-bold text-[#060b27] hover:text-[#0875d1] sm:text-xl">
          {listing.title}
        </Link>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{listing.description}</p>
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <MapPin className="h-4 w-4 shrink-0" />
          {listing.city}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:items-end">
        <p className="[overflow-wrap:anywhere] text-lg font-bold text-[#060b27] sm:text-xl">{listing.price ?? "Цена не указана"}</p>
        <div className="flex flex-wrap gap-2 sm:flex-col">
          {listing.phone ? (
            <a className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3 text-sm font-semibold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] sm:flex-none sm:px-4" href={`tel:${listing.phone}`}>
              <ContactAssetIcon kind="phone" className="h-6 w-6" />
              Позвонить
            </a>
          ) : null}
          {listing.messengerUrl ? (
            <a className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3 text-sm font-semibold text-[#0875d1] shadow-sm shadow-blue-50 transition hover:border-[#0875d1] sm:flex-none sm:px-4" href={listing.messengerUrl}>
              <ContactAssetIcon kind="message" className="h-6 w-6" />
              Написать
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
