"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, Home, LogIn, PlusCircle, Store, UserRound } from "lucide-react";
import { useAuthState } from "@/components/auth/useAuthState";

export function MobileBottomNav() {
  const pathname = usePathname();
  const { state } = useAuthState();
  const signedIn = state === "signed-in" || state === "admin";
  const checkingAuth = state === "loading";
  const authHref = signedIn || checkingAuth ? "/cabinet" : "/auth";
  const authLabel = signedIn || checkingAuth ? "Профиль" : "Вход";
  const AuthIcon = signedIn || checkingAuth ? UserRound : LogIn;

  const items = [
    { href: "/", label: "Главная", icon: Home },
    { href: "/rabota", label: "Работа", icon: BriefcaseBusiness },
    { href: "/razmestit/obyavlenie", label: "Разместить", icon: PlusCircle, primary: true },
    { href: "/yarmarka-masterov", label: "Ярмарка", icon: Store },
    { href: authHref, label: authLabel, icon: AuthIcon },
  ];

  return (
    <nav className="mobile-bottom-nav pointer-events-none md:hidden" aria-label="Мобильная навигация">
      <div className="pointer-events-auto grid w-full grid-cols-5 gap-1 rounded-[1.75rem] border border-white/70 bg-white/72 p-1.5 shadow-[0_18px_55px_rgba(15,23,42,0.18),0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-slate-900/5 backdrop-blur-2xl">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                item.primary
                  ? "flex min-w-0 -translate-y-1 flex-col items-center justify-center gap-1 rounded-2xl bg-gradient-to-b from-[#16b344] to-[#079230] px-1 py-2 text-[10px] font-black leading-none text-white shadow-[0_14px_28px_rgba(10,163,55,0.28)] ring-1 ring-white/35 transition active:translate-y-0"
                  : `flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-black leading-none transition ${
                      active ? "bg-slate-950/7 text-[#0875d1] shadow-sm ring-1 ring-white/65" : "text-slate-700 hover:bg-white/55 hover:text-[#0875d1]"
                    }`
              }
            >
              <Icon className={item.primary ? "h-6 w-6 shrink-0 drop-shadow-sm" : "h-5 w-5 shrink-0"} />
              <span className="max-w-full truncate whitespace-nowrap">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
