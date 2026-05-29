"use client";

import Link from "next/link";
import { HeaderActions } from "@/components/HeaderActions";
import { useAuthState } from "@/components/auth/useAuthState";

const publicLinks = [
  ["Как работает", "/kak-rabotaet"],
  ["Для бизнеса", "/cabinet/organization"],
  ["Помощь", "/legal/user-agreement"],
];

export function HeaderNav() {
  const { state } = useAuthState();
  const links = state === "admin" ? [...publicLinks, ["Админка", "/admin"]] : publicLinks;

  return (
    <nav className="page-container flex min-h-9 items-center gap-3 text-sm md:gap-4 md:justify-between" aria-label="Основная навигация">
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto text-slate-600 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {links.map(([label, href]) => (
          <Link key={href} href={href} className="transition hover:text-[#0875d1]">
            {label}
          </Link>
        ))}
      </div>
      <div className="shrink-0">
        <HeaderActions compact />
      </div>
    </nav>
  );
}
