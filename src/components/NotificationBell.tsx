"use client";

import dynamic from "next/dynamic";
import { Bell } from "lucide-react";
import { usePrimaryAccountAuth } from "@/components/auth/AccountAuthProvider";
import { PrimaryNotificationBell } from "@/components/PrimaryNotificationBell";

const LegacyNotificationBell = dynamic(() => import("./LegacyNotificationBell"), {
  loading: () => <button type="button" disabled aria-label="Уведомления" aria-busy="true"
    className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-green-800 shadow-sm">
    <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
  </button>,
});

export function NotificationBell() {
  return usePrimaryAccountAuth() ? <PrimaryNotificationBell /> : <LegacyNotificationBell />;
}
