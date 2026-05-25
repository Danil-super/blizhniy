"use client";

import Link from "next/link";
import { useAdminAccess } from "@/components/auth/useAdminAccess";

const publicLinks = [
  ["Объявления", "/blizhniy/prodam"],
  ["Работа", "/blizhniy/rabota"],
  ["Специалисты", "/blizhniy/rabota/specialisty"],
  ["Ярмарка", "/yarmarka-masterov"],
  ["Категории", "/blizhniy/kategorii"],
  ["Вход", "/auth"],
  ["Кабинет", "/cabinet"],
];

export function HeaderNav() {
  const { state } = useAdminAccess();
  const links = state === "admin" ? [...publicLinks, ["Админка", "/admin"]] : publicLinks;

  return (
    <nav className="page-container flex gap-2 overflow-x-auto pb-4 text-sm font-semibold text-slate-700" aria-label="Основная навигация">
      {links.map(([label, href]) => (
        <Link key={href} href={href} className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 transition hover:border-blue-200 hover:text-[#0875d1]">
          {label}
        </Link>
      ))}
    </nav>
  );
}
