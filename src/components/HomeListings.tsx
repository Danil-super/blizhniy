import Link from "next/link";
import { ArrowRightLeft, Gift, MapPin, ShoppingBag, Tags } from "lucide-react";
import { demoListings } from "@/components/listings/ListingPages";

const kindLabels = {
  prodam: "Продам",
  kuplyu: "Куплю",
  menyayu: "Меняю",
  "otdam-darom": "Даром",
};

const kindIcons = {
  prodam: ShoppingBag,
  kuplyu: Tags,
  menyayu: ArrowRightLeft,
  "otdam-darom": Gift,
};

const imageToneClasses = {
  blue: "from-blue-100 via-white to-cyan-100 text-[#0875d1]",
  green: "from-emerald-100 via-white to-lime-100 text-[#0a8f32]",
  rose: "from-rose-100 via-white to-orange-100 text-rose-700",
  amber: "from-amber-100 via-white to-yellow-50 text-amber-700",
  violet: "from-violet-100 via-white to-blue-100 text-violet-700",
};

const badgeToneClasses = {
  prodam: "bg-blue-600 text-white",
  kuplyu: "bg-emerald-600 text-white",
  menyayu: "bg-violet-600 text-white",
  "otdam-darom": "bg-rose-600 text-white",
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
        {listings.map((listing) => {
          const Icon = kindIcons[listing.kind];

          return (
            <Link
              key={listing.slug}
              href={`/blizhniy/obyavlenie/${listing.slug}`}
              className="group min-w-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-card"
            >
              <span className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br ${imageToneClasses[listing.imageTone]}`}>
                <span className="absolute inset-x-4 top-4 flex justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${badgeToneClasses[listing.kind]}`}>{kindLabels[listing.kind]}</span>
                  <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-bold text-slate-600">{listing.subcategoryName}</span>
                </span>
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/75 shadow-sm ring-1 ring-white/80 transition group-hover:scale-105">
                  <Icon className="h-8 w-8" />
                </span>
                <span className="absolute -bottom-8 -right-6 h-24 w-24 rounded-full bg-white/35" />
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
          );
        })}
      </div>
    </section>
  );
}
