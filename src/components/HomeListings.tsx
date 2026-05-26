import Link from "next/link";
import { MapPin } from "lucide-react";
import { demoListings } from "@/components/listings/ListingPages";

const kindLabels = {
  prodam: "Продам",
  kuplyu: "Куплю",
  menyayu: "Меняю",
  "otdam-darom": "Даром",
};

const toneClasses = {
  blue: "bg-blue-50 text-[#0875d1]",
  green: "bg-emerald-50 text-[#0a8f32]",
  rose: "bg-rose-50 text-rose-700",
  amber: "bg-amber-50 text-amber-700",
  violet: "bg-violet-50 text-violet-700",
};

export function HomeListings() {
  const listings = demoListings.filter((listing) => listing.status === "published").slice(0, 8);

  return (
    <section className="page-container pb-10">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Свежие объявления</h2>
        <Link href="/blizhniy/prodam" className="text-sm font-bold text-[#0875d1] hover:text-[#0664b3]">
          Смотреть все
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {listings.map((listing) => (
          <Link
            key={listing.slug}
            href={`/blizhniy/obyavlenie/${listing.slug}`}
            className="group min-w-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-card"
          >
            <span className={`flex aspect-[4/3] items-center justify-center text-sm font-black ${toneClasses[listing.imageTone]}`}>
              {kindLabels[listing.kind]}
            </span>
            <span className="block p-3">
              <span className="block truncate text-base font-black text-[#060b27]">{listing.price}</span>
              <span className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-900 group-hover:text-[#0875d1]">
                {listing.title}
              </span>
              <span className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{listing.city}</span>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
