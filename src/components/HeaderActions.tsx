"use client";

import Link from "next/link";
import Image from "next/image";
import { AnimatedCreateIcon } from "@/components/AnimatedCreateIcon";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuthState } from "@/components/auth/useAuthState";
import lockGif from "../../lock.gif";

export function HeaderActions({ compact = false }: { compact?: boolean }) {
  const { state } = useAuthState();
  const signedIn = state === "signed-in" || state === "admin";
  const authHref = signedIn || state === "loading" ? "/cabinet" : "/auth";
  const authLabel = signedIn || state === "loading" ? "Кабинет" : "Вход";
  const iconClassName = "h-6 w-6";

  return (
    <div className={`flex min-w-0 shrink-0 items-center ${compact ? "gap-1 text-xs sm:gap-3 sm:text-sm" : "gap-5 text-sm"} font-semibold text-slate-950`}>
      <NotificationBell />
      <Link href={authHref} className={`inline-flex min-w-0 items-center gap-1 transition hover:text-[#0875d1] ${compact ? "h-9 rounded-lg px-0.5 sm:px-1" : ""}`}>
        <Image src={lockGif} alt="" width={24} height={24} unoptimized className={`${iconClassName} shrink-0 object-contain`} aria-hidden="true" />
        <span className="whitespace-nowrap">{authLabel}</span>
      </Link>
      <Link href="/blizhniy/sozdat" className={`min-w-0 items-center gap-1 transition hover:text-[#0875d1] ${compact ? "hidden h-9 rounded-lg px-0.5 sm:inline-flex sm:px-1" : "inline-flex"}`}>
        <AnimatedCreateIcon className={iconClassName} />
        <span className="whitespace-nowrap">Разместить</span>
      </Link>
    </div>
  );
}
