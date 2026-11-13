"use client";

import { useEffect } from "react";
import { installLegacyBookingStorageCleanup } from "@/lib/booking-notifications";
import { clearLegacyDemoPublicationsStorage } from "@/lib/demo-publications";
import { shouldShowClientFallbackContent } from "@/lib/client-runtime-mode";
import { clearLegacySiteNotificationStorage } from "@/lib/site-notification-storage";
import { usePrimaryAccountAuth } from "@/components/auth/AccountAuthProvider";

export function BookingLegacyStorageCleanup() {
  const useLegacy = usePrimaryAccountAuth() === null;
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
      let active = true;
      let subscription: { unsubscribe: () => void } | undefined;
      if (useLegacy) {
        void import("@/lib/supabase-browser").then(({ getSupabaseBrowserClient, isSupabaseBrowserConfigured }) => {
          if (!active || !isSupabaseBrowserConfigured()) return;
          subscription = getSupabaseBrowserClient().auth.onAuthStateChange(onChange).data.subscription;
        }).catch(() => { if (active) onChange(); });
      }
      return () => { active = false; subscription?.unsubscribe(); };
    }, () => {
      clearLegacyDemoPublicationsStorage(storage);
      clearLegacySiteNotificationStorage(storage);
    });
  }, [useLegacy]);

  return null;
}
