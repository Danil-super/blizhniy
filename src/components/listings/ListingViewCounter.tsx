"use client";

import { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import { getListingTotalViews, listingViewCountsUpdatedEvent } from "@/lib/listing-views";
import eyesAnimation from "../../../eyes.json";

export function ListingViewCounter({ initialViews, listingId }: { initialViews?: number; listingId: string }) {
  const [views, setViews] = useState(() => getListingTotalViews(listingId, initialViews));
  const iconRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function syncViews(event?: Event) {
      if (event instanceof CustomEvent && event.detail && typeof event.detail === "object") {
        const detail = event.detail as { listingId?: unknown; views?: unknown };

        if (detail.listingId === listingId && typeof detail.views === "number" && Number.isFinite(detail.views)) {
          setViews(Math.max(0, Math.floor(detail.views)));
          return;
        }
      }

      setViews(getListingTotalViews(listingId, initialViews));
    }

    syncViews();
    window.addEventListener("storage", syncViews);
    window.addEventListener(listingViewCountsUpdatedEvent, syncViews);

    return () => {
      window.removeEventListener("storage", syncViews);
      window.removeEventListener(listingViewCountsUpdatedEvent, syncViews);
    };
  }, [initialViews, listingId]);

  useEffect(() => {
    if (!iconRef.current) {
      return undefined;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation: AnimationItem = lottie.loadAnimation({
      animationData: eyesAnimation,
      autoplay: !prefersReducedMotion,
      container: iconRef.current,
      loop: !prefersReducedMotion,
      renderer: "svg",
      rendererSettings: {
        preserveAspectRatio: "xMidYMid meet",
      },
    });

    if (prefersReducedMotion) {
      animation.goToAndStop(0, true);
    }

    return () => {
      animation.destroy();
    };
  }, []);

  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold italic leading-none text-slate-800 sm:text-sm" aria-label={`${views} просмотров`}>
      <span ref={iconRef} className="block h-5 w-5 shrink-0 overflow-hidden leading-none sm:h-6 sm:w-6" aria-hidden="true" />
      <span>{views}</span>
    </span>
  );
}
