"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getDemoListingViews, getListingTotalViews, listingViewCountsUpdatedEvent } from "@/lib/listing-views";
import viewGif from "../../../view.gif";

export function ListingViewCounter({ listingId }: { listingId: string }) {
  const [views, setViews] = useState(() => getDemoListingViews(listingId));

  useEffect(() => {
    function syncViews() {
      setViews(getListingTotalViews(listingId));
    }

    syncViews();
    window.addEventListener("storage", syncViews);
    window.addEventListener(listingViewCountsUpdatedEvent, syncViews);

    return () => {
      window.removeEventListener("storage", syncViews);
      window.removeEventListener(listingViewCountsUpdatedEvent, syncViews);
    };
  }, [listingId]);

  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-black italic leading-none text-slate-800 sm:text-sm" aria-label={`${views} просмотров`}>
      <Image src={viewGif} alt="" width={24} height={24} unoptimized className="h-5 w-5 shrink-0 object-contain sm:h-6 sm:w-6" aria-hidden="true" />
      <span>{views}</span>
    </span>
  );
}
