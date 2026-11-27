"use client";

import { useEffect, useRef } from "react";
import { guardDraftLeave } from "./useDraftLeaveGuard";

export const listingFormSaveStarted = "blizhniy-listing-form-save-started";
export const listingFormSaveConfirmed = "blizhniy-listing-form-save-confirmed";

export function ListingFormLeaveGuard() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = marker.current?.closest("form");
    if (!form) return;
    let stop: (() => void) | undefined;
    const arm = () => { stop ??= guardDraftLeave(); };
    const clear = () => { stop?.(); stop = undefined; };
    form.addEventListener("input", arm);
    form.addEventListener("change", arm);
    form.addEventListener(listingFormSaveStarted, arm);
    form.addEventListener(listingFormSaveConfirmed, clear);
    return () => {
      form.removeEventListener("input", arm);
      form.removeEventListener("change", arm);
      form.removeEventListener(listingFormSaveStarted, arm);
      form.removeEventListener(listingFormSaveConfirmed, clear);
      clear();
    };
  }, []);
  return <span ref={marker} hidden />;
}
