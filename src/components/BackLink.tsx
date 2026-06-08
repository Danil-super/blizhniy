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

  if (historyIndex > 0) {
    return true;
  }

  if (!document.referrer) {
    return false;
  }

  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function BackLink({ fallbackHref, children = "Назад", className }: BackLinkProps) {
  const router = useRouter();

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
    <Link href={fallbackHref} onClick={handleClick} className={className ?? "inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]"}>
      <ArrowLeft className="h-4 w-4" />
      {children}
    </Link>
  );
}
