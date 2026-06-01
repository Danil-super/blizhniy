"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";

type SubcategoryShareButtonProps = {
  href: string;
  title: string;
};

function getAbsoluteUrl(href: string) {
  if (typeof window === "undefined") {
    return href;
  }

  return new URL(href, window.location.origin).toString();
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function SubcategoryShareButton({ href, title }: SubcategoryShareButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function handleShare() {
    const url = getAbsoluteUrl(href);

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text: `Объявления в разделе «${title}» на БЛИЖНИЙ`,
          url,
        });
      } else {
        await copyText(url);
        setStatus("copied");
        window.setTimeout(() => setStatus("idle"), 1800);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      try {
        await copyText(url);
        setStatus("copied");
        window.setTimeout(() => setStatus("idle"), 1800);
      } catch {
        setStatus("error");
        window.setTimeout(() => setStatus("idle"), 2200);
      }
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white px-2 text-xs font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] sm:gap-2 sm:px-3 sm:text-sm"
      aria-label={`Поделиться ссылкой: ${title}`}
    >
      <Share2 className="h-4 w-4 shrink-0" />
      <span className="hidden min-w-0 truncate 2xl:inline">{status === "copied" ? "Скопировано" : status === "error" ? "Ошибка" : "Поделиться"}</span>
    </button>
  );
}
