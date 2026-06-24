"use client";

import { MouseEvent, PointerEvent, useRef, useState } from "react";
import { Share2 } from "lucide-react";

type ListingShareButtonProps = {
  className?: string;
  href: string;
  iconClassName?: string;
  label?: string;
  stopPropagation?: boolean;
  textBreakpoint?: "always" | "sm" | "lg" | "never";
  title: string;
};

const textVisibilityClasses: Record<NonNullable<ListingShareButtonProps["textBreakpoint"]>, string> = {
  always: "inline",
  sm: "hidden sm:inline",
  lg: "hidden lg:inline",
  never: "hidden",
};

const defaultClassName =
  "inline-flex h-8 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] sm:h-9 sm:px-3 sm:text-sm lg:h-10 lg:px-4";

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

function shouldUseNativeShare() {
  if (typeof window === "undefined" || !navigator.share) {
    return false;
  }

  return window.matchMedia("(pointer: coarse)").matches;
}

export function ListingShareButton({
  className = defaultClassName,
  href,
  iconClassName = "h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4",
  label = "Поделиться",
  stopPropagation = false,
  textBreakpoint = "sm",
  title,
}: ListingShareButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });
  const statusShownOnPressRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);
  const buttonLabel = status === "copied" ? "Скопировано" : status === "error" ? "Ошибка" : label;

  function showStatus(nextStatus: "copied" | "error", button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left + rect.width / 2, 104), window.innerWidth - 104);
    const top = Math.max(rect.top - 8, 44);

    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }

    setTooltipPosition({ left, top });
    setStatus(nextStatus);
    resetTimerRef.current = window.setTimeout(() => setStatus("idle"), 1800);
  }

  function handlePress(event: PointerEvent<HTMLButtonElement>) {
    if (stopPropagation) {
      event.stopPropagation();
    }

    if (shouldUseNativeShare()) {
      return;
    }

    statusShownOnPressRef.current = true;
    showStatus("copied", event.currentTarget);
  }

  async function handleShare(event: MouseEvent<HTMLButtonElement>) {
    if (stopPropagation) {
      event.preventDefault();
      event.stopPropagation();
    }

    const url = getAbsoluteUrl(href);
    const button = event.currentTarget;

    try {
      if (shouldUseNativeShare()) {
        await navigator.share({
          title,
          text: `Объявление «${title}» на БЛИЖНИЙ`,
          url,
        });
      } else {
        if (!statusShownOnPressRef.current) {
          showStatus("copied", button);
        }
        await copyText(url);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      try {
        if (!statusShownOnPressRef.current) {
          showStatus("copied", button);
        }
        await copyText(url);
      } catch {
        showStatus("error", button);
      } finally {
        statusShownOnPressRef.current = false;
      }
    } finally {
      if (!shouldUseNativeShare()) {
        statusShownOnPressRef.current = false;
      }
    }
  }

  return (
    <>
      <button type="button" onPointerDown={handlePress} onClick={handleShare} className={className} aria-label={`Поделиться объявлением: ${title}`}>
        <Share2 className={iconClassName} />
        <span className={`${textVisibilityClasses[textBreakpoint]} whitespace-nowrap`}>{buttonLabel}</span>
      </button>
      {status !== "idle" ? (
        <span
          className="share-copy-popover pointer-events-none fixed z-50 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-950 shadow-card"
          style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
          role="status"
          aria-live="polite"
        >
          {status === "copied" ? "Ссылка скопирована" : "Не удалось скопировать ссылку"}
        </span>
      ) : null}
    </>
  );
}
