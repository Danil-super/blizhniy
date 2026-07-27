"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

type BackLinkProps = {
  fallbackHref: string;
  children?: ReactNode;
  className?: string;
};

function canGoBackInsideApp() {
  const historyIndex = window.history.state && typeof window.history.state.idx === "number" ? window.history.state.idx : 0;
  return historyIndex > 0;
}

export function BackLink({ fallbackHref, children = "Назад", className }: BackLinkProps) {
  const router = useRouter();
  const resolvedClassName = className
    ?.replaceAll("bg-[#0875d1]", "bg-[#d92d20]")
    .replaceAll("text-[#0875d1]", "text-[#d92d20] transition hover:text-[#b42318]")
    .replaceAll("border-slate-300", "border-[#d92d20]")
    .replaceAll("text-slate-800", "text-[#d92d20] transition hover:bg-[#fff1f0] hover:text-[#b42318]")
    ?? "inline-flex items-center gap-2 text-sm font-bold text-[#d92d20] transition hover:text-[#b42318]";

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    event.preventDefault();

    if (canGoBackInsideApp()) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  }

  return (
    <Link href={fallbackHref} onClick={handleClick} className={resolvedClassName}>
      <ArrowLeft className="h-4 w-4" />
      {children}
    </Link>
  );
}
