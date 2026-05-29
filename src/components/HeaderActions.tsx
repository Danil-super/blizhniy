"use client";

import Link from "next/link";
import Image from "next/image";
import { AnimatedCreateIcon } from "@/components/AnimatedCreateIcon";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuthState } from "@/components/auth/useAuthState";
import lockGif from "../../lock.gif";

export function HeaderActions({ compact = false }: { compact?: boolean }) {
  const { state } = useAuthState();
  const authHref = state === "signed-in" || state === "admin" ? "/cabinet" : "/auth";
  const authLabel = state === "signed-in" || state === "admin" ? "Кабинет" : "Вход";

  return (
    <div className={`flex shrink-0 items-center ${compact ? "gap-3 text-sm" : "gap-5 text-sm"} font-semibold text-slate-950`}>
      <NotificationBell />
      <Link href={authHref} className={`inline-flex items-center gap-1 transition hover:text-[#0875d1] ${compact ? "h-9 rounded-lg px-1" : ""}`}>
        <Image src={lockGif} alt="" width={24} height={24} unoptimized className="h-6 w-6 shrink-0 object-contain" aria-hidden="true" />
        <span>{authLabel}</span>
      </Link>
      <Link href="/blizhniy/sozdat" className={`inline-flex items-center gap-1 transition hover:text-[#0875d1] ${compact ? "h-9 rounded-lg px-1" : ""}`}>
        <AnimatedCreateIcon className="h-5 w-5" />
        <span>Разместить</span>
      </Link>
    </div>
  );
}
