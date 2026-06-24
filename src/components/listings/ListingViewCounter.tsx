"use client";

import { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import { getDemoListingViews, getListingTotalViews, listingViewCountsUpdatedEvent } from "@/lib/listing-views";
import eyesAnimation from "../../../eyes.json";

export function ListingViewCounter({ listingId }: { listingId: string }) {
  const [views, setViews] = useState(() => getDemoListingViews(listingId));
  const iconRef = useRef<HTMLSpanElement>(null);

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
