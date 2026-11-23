"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { emitListingViewsUpdated, incrementListingViews, isStoredListingViewId, hasPrimaryListingCount } from "@/lib/listing-views";

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
      // Vacancy/request/specialist and demo keys have no listing-table row.
      // Keep their existing browser-local counts without a doomed API request.
      const primary = hasPrimaryListingCount(listingId);
      if (!primary && !isStoredListingViewId(listingId)) {
        emitListingViewsUpdated(listingId, incrementListingViews(listingId, initialViews));
        return;
      }

      if (primary) {
        if (document.querySelector('meta[name="blizhniy-listing-views"]')?.getAttribute("content") !== "enabled") return;
        const send = (signal: AbortSignal) => fetch(`/api/listings/${encodeURIComponent(listingId)}/views`, {
          method: "POST", credentials: "same-origin", signal, headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" }, body: "{}",
        });
        const count = async () => {
          if (cancelled) return;
          const signal = AbortSignal.timeout(5000);
          let response = await send(signal);
          // A new guest must return the cookie before the server counts the visit.
          if (response.status === 202 && !cancelled) response = await send(signal);
          if (response.status !== 200 || cancelled) return;
          const data = await response.json();
          if (!cancelled && Number.isSafeInteger(data?.views) && data.views >= 0) emitListingViewsUpdated(listingId, data.views);
        };
        try {
          // Two first visits in separate tabs must use the same guest cookie.
          if (navigator.locks) await navigator.locks.request("blizhniy-listing-view", count);
          else await count();
        } catch {
          // Keep the last server-confirmed count while offline.
        }
        return;
      }

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
