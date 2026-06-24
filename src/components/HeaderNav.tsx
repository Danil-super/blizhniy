"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Menu, X } from "lucide-react";
import { useAuthState } from "@/components/auth/useAuthState";

const publicLinks = [
  ["Объявления", "/obyavleniya"],
  ["Как работает", "/kak-rabotaet"],
  ["Ярмарка мастеров", "/yarmarka-masterov"],
];

export function HeaderNav() {
  const { state } = useAuthState();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const links = state === "admin" ? [["Админка", "/admin"], ...publicLinks] : publicLinks;

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
    <nav className="relative flex min-w-0 flex-1 items-center justify-start gap-2 overflow-visible text-sm md:justify-center md:gap-4" aria-label="Основная навигация">
      <div className="relative lg:hidden" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-11 w-11 appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-700 transition active:scale-95"
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={open}
        >
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition ${
              open ? "border-emerald-200 bg-emerald-50 text-[#2f8f12]" : "border-slate-200 bg-white hover:border-emerald-200 hover:text-[#2f8f12]"
            }`}
          >
            {open ? <X className="h-[18px] w-[18px]" aria-hidden="true" /> : <Menu className="h-[18px] w-[18px]" aria-hidden="true" />}
          </span>
        </button>
        {open ? (
          <div className="fixed left-3 top-[116px] z-[120] w-[min(17.5rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl shadow-slate-900/14 ring-1 ring-slate-900/5">
            <div className="px-2.5 pb-1 pt-1">
              <p className="text-[10px] font-bold uppercase leading-none tracking-wide text-[#2f8f12]">Меню</p>
            </div>
            {links.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="flex min-h-10 items-center justify-between gap-3 rounded-xl px-2.5 text-sm font-bold text-slate-800 transition hover:bg-emerald-50 hover:text-[#2f8f12]"
              >
                <span>{label}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="hidden min-w-0 flex-wrap items-center justify-center gap-7 text-slate-700 lg:flex">
        {links.map(([label, href]) => (
          <Link key={href} href={href} className="whitespace-nowrap font-semibold transition hover:text-[#2f8f12]">
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
