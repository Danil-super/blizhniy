"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { emitListingViewsUpdated, incrementListingViews } from "@/lib/listing-views";

async function getAccessToken() {
  try {
    const { data } = await getSupabaseBrowserClient().auth.getSession();

    return data.session?.access_token;
  } catch {
    return undefined;
  }
}

export function ListingViewTracker({ initialViews, listingId }: { initialViews?: number; listingId: string }) {
  useEffect(() => {
    let cancelled = false;

    async function trackView() {
      try {
        const token = await getAccessToken();
        const response = await fetch(`/api/listings/${encodeURIComponent(listingId)}/views`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (response.ok) {
          const payload = (await response.json().catch(() => null)) as { views?: unknown } | null;
          const views = Number(payload?.views);

          if (!cancelled && Number.isFinite(views)) {
            emitListingViewsUpdated(listingId, views);
            return;
          }
        }
      } catch {
        // Local/demo publications still use the browser-only fallback below.
      }

      if (!cancelled) {
        emitListingViewsUpdated(listingId, incrementListingViews(listingId, initialViews));
      }
    }

    void trackView();

    return () => {
      cancelled = true;
    };
  }, [initialViews, listingId]);

  return null;
}
