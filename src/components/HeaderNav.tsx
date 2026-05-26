"use client";

import Link from "next/link";
import { LockKeyhole, Plus } from "lucide-react";
import { useAdminAccess } from "@/components/auth/useAdminAccess";

const publicLinks = [
  ["Для бизнеса", "/cabinet/organization"],
  ["Помощь", "/legal/user-agreement"],
];

export function HeaderNav() {
  const { state } = useAdminAccess();
  const links = state === "admin" ? [...publicLinks, ["Админка", "/admin"]] : publicLinks;
  const showAuthLink = state === "signed-out" || state === "error";

  return (
    <nav className="page-container flex min-h-9 items-center gap-4 overflow-x-auto text-sm [scrollbar-width:none] md:justify-between [&::-webkit-scrollbar]:hidden" aria-label="Основная навигация">
      <div className="flex min-w-0 shrink-0 items-center gap-4 text-slate-600">
        {links.map(([label, href]) => (
          <Link key={href} href={href} className="transition hover:text-[#0875d1]">
            {label}
          </Link>
        ))}
      </div>
      <div className="hidden shrink-0 items-center gap-5 font-semibold text-slate-950 md:flex">
        {showAuthLink ? (
          <Link href="/auth" className="inline-flex items-center gap-1 transition hover:text-[#0875d1]">
            <LockKeyhole className="h-4 w-4" />
            Вход и регистрация
          </Link>
        ) : null}
        <Link href="/blizhniy/sozdat" className="inline-flex items-center gap-1 transition hover:text-[#0875d1]">
          <Plus className="h-4 w-4" />
          Разместить объявление
        </Link>
      </div>
    </nav>
  );
}
