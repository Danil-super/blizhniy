"use client";

import Link from "next/link";
import { BriefcaseBusiness, Grid2X2, Home, LogIn, PlusCircle, Store, UserRound } from "lucide-react";
import { useAuthState } from "@/components/auth/useAuthState";

export function MobileBottomNav() {
  const { state } = useAuthState();
  const signedIn = state === "signed-in" || state === "admin";
  const authHref = signedIn ? "/cabinet" : "/auth";
  const authLabel = signedIn ? "Кабинет" : "Вход";
  const AuthIcon = signedIn ? UserRound : LogIn;

  const items = [
    { href: "/blizhniy", label: "Главная", icon: Home },
    { href: "/blizhniy/kategorii", label: "Каталог", icon: Grid2X2 },
    { href: "/blizhniy/rabota", label: "Работа", icon: BriefcaseBusiness },
    { href: "/blizhniy/sozdat", label: "Разместить", icon: PlusCircle, primary: true },
    { href: "/yarmarka-masterov", label: "Ярмарка", icon: Store },
    { href: authHref, label: authLabel, icon: AuthIcon },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur md:hidden" aria-label="Мобильная навигация">
      <div className="mx-auto grid max-w-md grid-cols-6 gap-1">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <Link key={item.href} href={item.href} className={item.primary ? "flex min-w-0 flex-col items-center gap-1 rounded-xl bg-[#0aa337] px-1.5 py-2 text-[10px] font-bold leading-none text-white" : "flex min-w-0 flex-col items-center gap-1 rounded-xl px-1.5 py-2 text-[10px] font-bold leading-none text-slate-700"}>
              <Icon className="h-5 w-5 shrink-0" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
