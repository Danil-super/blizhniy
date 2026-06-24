"use client";

import Link from "next/link";
import { LockKeyhole, PlusCircle, UserRound } from "lucide-react";
import { HeaderControls } from "@/components/HeaderControls";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuthState } from "@/components/auth/useAuthState";

export function HeaderActions({ compact = false }: { compact?: boolean }) {
  const { state } = useAuthState();
  const signedIn = state === "signed-in" || state === "admin";
  const authHref = signedIn || state === "loading" ? "/cabinet" : "/auth";
  const authLabel = signedIn || state === "loading" ? "Кабинет" : "Вход";
  const AuthIcon = signedIn || state === "loading" ? UserRound : LockKeyhole;
  const iconClassName = "h-[18px] w-[18px]";
  const actionIconClassName =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-[#2f8f12] shadow-sm";

  return (
    <div className={`flex min-w-0 shrink-0 items-center ${compact ? "gap-2 text-xs sm:text-sm xl:gap-3" : "gap-5 text-sm"} font-semibold text-slate-950`}>
      <NotificationBell />
      <HeaderControls />
      <Link href={authHref} className={`inline-flex min-w-0 items-center gap-1.5 transition hover:text-[#2f8f12] ${compact ? "h-9 rounded-lg px-0.5 sm:px-1" : ""}`}>
        <span className={actionIconClassName}>
          <AuthIcon className={iconClassName} aria-hidden="true" />
        </span>
        <span className="whitespace-nowrap">{authLabel}</span>
      </Link>
      <Link href="/razmestit" className={`min-w-0 items-center gap-1.5 transition hover:text-[#2f8f12] ${compact ? "hidden h-9 rounded-lg px-0.5 sm:inline-flex sm:px-1" : "inline-flex"}`}>
        <span className={actionIconClassName}>
          <PlusCircle className={iconClassName} aria-hidden="true" />
        </span>
        <span className="whitespace-nowrap">Разместить</span>
      </Link>
    </div>
  );
}
