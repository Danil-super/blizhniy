"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import { HeaderActions } from "@/components/HeaderActions";
import { useAuthState } from "@/components/auth/useAuthState";
import menuGif from "../../menu.gif";

const publicLinks = [
  ["Объявления", "/obyavleniya"],
  ["Как работает", "/kak-rabotaet"],
  ["Ярмарка мастеров", "/yarmarka-masterov"],
  ["Для бизнеса", "/cabinet/organization"],
  ["Помощь", "/legal/user-agreement"],
];

export function HeaderNav() {
  const { state } = useAuthState();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const links = state === "admin" ? [...publicLinks, ["Админка", "/admin"]] : publicLinks;

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  return (
    <nav className="page-container relative flex min-h-8 min-w-0 items-center justify-between gap-2 overflow-x-clip text-sm md:min-h-10 md:gap-4" aria-label="Основная навигация">
      <div className="relative md:hidden" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-6 w-6 appearance-none items-center justify-center border-0 bg-transparent p-0 text-slate-800 transition hover:text-[#0875d1]"
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={open}
        >
          {open ? <X className="h-6 w-6" /> : <Image src={menuGif} alt="" width={24} height={24} unoptimized className="h-6 w-6 object-contain" aria-hidden="true" />}
        </button>
        {open ? (
          <div className="absolute left-0 top-[calc(100%+8px)] z-[90] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-2 shadow-xl shadow-slate-900/10">
            {links.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-blue-50 hover:text-[#0875d1]"
              >
                {label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="hidden min-w-0 flex-1 items-center gap-4 text-slate-600 md:flex">
        {links.map(([label, href]) => (
          <Link key={href} href={href} className="transition hover:text-[#0875d1]">
            {label}
          </Link>
        ))}
      </div>
      <div className="min-w-0 shrink-0">
        <HeaderActions compact />
      </div>
    </nav>
  );
}
