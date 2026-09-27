"use client";

import { useEffect } from "react";
import { installLegacyBookingStorageCleanup } from "@/lib/booking-notifications";
import { shouldShowClientFallbackContent } from "@/lib/client-runtime-mode";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

export function BookingLegacyStorageCleanup() {
  useEffect(() => {
    if (shouldShowClientFallbackContent()) {
      return;
    }

    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      return;
    }

    return installLegacyBookingStorageCleanup(storage, (onChange) => {
      if (!isSupabaseBrowserConfigured()) {
        return () => {};
      }

      const { data: { subscription } } = getSupabaseBrowserClient().auth.onAuthStateChange(onChange);
      return () => subscription.unsubscribe();
    });
  }, []);

  return null;
}
