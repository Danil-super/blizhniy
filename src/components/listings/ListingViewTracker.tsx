"use client";

import { useEffect } from "react";
import { incrementListingViews } from "@/lib/listing-views";

export function ListingViewTracker({ listingId }: { listingId: string }) {
  useEffect(() => {
    incrementListingViews(listingId);
  }, [listingId]);

  return null;
}
