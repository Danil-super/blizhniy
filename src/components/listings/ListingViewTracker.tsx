"use client";

import { useEffect } from "react";
import { incrementListingViews } from "@/lib/listing-views";

export function ListingViewTracker({ listingId }: { listingId: string }) {
  useEffect(() => {
    const throttleKey = `blizhniy-listing-view-tracked-${listingId}`;
    const now = Date.now();
    const lastTrackedAt = Number(window.sessionStorage.getItem(throttleKey) ?? 0);

    if (now - lastTrackedAt < 3000) {
      return;
    }

    window.sessionStorage.setItem(throttleKey, String(now));
    incrementListingViews(listingId);
  }, [listingId]);

  return null;
}
