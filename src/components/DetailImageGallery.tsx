"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { StoredMediaImage } from "@/components/StoredMedia";

type DetailImageGalleryProps = {
  fallbackIcon: ReactNode;
  images?: string[];
  title: string;
};

export function DetailImageGallery({ fallbackIcon, images = [], title }: DetailImageGalleryProps) {
  const validImages = images.filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const activeImage = validImages[Math.min(activeIndex, Math.max(0, validImages.length - 1))];
  const hasMultiple = validImages.length > 1;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }

      if (event.key === "ArrowLeft") {
        setActiveIndex((index) => (index - 1 + validImages.length) % validImages.length);
      }

      if (event.key === "ArrowRight") {
        setActiveIndex((index) => (index + 1) % validImages.length);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, validImages.length]);

  function showPrevious() {
    setActiveIndex((index) => (index - 1 + validImages.length) % validImages.length);
  }

  function showNext() {
    setActiveIndex((index) => (index + 1) % validImages.length);
  }

  return (
    <>
      <section className="order-2 md:order-1">
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
          <button
            type="button"
            onClick={() => activeImage && setOpen(true)}
            disabled={!activeImage}
            className="block w-full disabled:cursor-default"
            aria-label={activeImage ? `Открыть фото: ${title}` : undefined}
          >
            <span className="flex aspect-square w-full items-center justify-center bg-slate-100">
              {activeImage ? (
                <StoredMediaImage src={activeImage} alt={title} className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.015]" />
              ) : (
                fallbackIcon
              )}
            </span>
          </button>
          {hasMultiple ? (
            <>
              <button
                type="button"
                onClick={showPrevious}
                className="absolute left-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-slate-800 shadow-md ring-1 ring-slate-200 transition hover:bg-white hover:text-[#0875d1] sm:left-3 sm:h-11 sm:w-11"
                aria-label="Предыдущее фото"
              >
                <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
              <button
                type="button"
                onClick={showNext}
                className="absolute right-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-slate-800 shadow-md ring-1 ring-slate-200 transition hover:bg-white hover:text-[#0875d1] sm:right-3 sm:h-11 sm:w-11"
                aria-label="Следующее фото"
              >
                <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
              <span className="absolute bottom-3 left-1/2 rounded-full bg-slate-950/65 px-3 py-1 text-xs font-bold text-white shadow-sm -translate-x-1/2">
                {activeIndex + 1} / {validImages.length}
              </span>
            </>
          ) : null}
        </div>
        {hasMultiple ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {validImages.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-white transition sm:h-20 sm:w-20 ${
                  index === activeIndex ? "border-[#0875d1] ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-200"
                }`}
                aria-label={`Показать фото ${index + 1}`}
              >
                <StoredMediaImage src={image} alt={`${title}, фото ${index + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </section>
      {open && activeImage ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/85 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Фото: ${title}`}>
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg sm:right-5 sm:top-5" aria-label="Закрыть фото">
            <X className="h-5 w-5" />
          </button>
          {hasMultiple ? (
            <button type="button" onClick={showPrevious} className="absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-lg sm:left-5" aria-label="Предыдущее фото">
              <ChevronLeft className="h-6 w-6" />
            </button>
          ) : null}
          <div className="flex max-h-[88vh] w-full max-w-5xl items-center justify-center">
            <StoredMediaImage src={activeImage} alt={title} className="max-h-[88vh] w-auto max-w-full rounded-2xl bg-white object-contain shadow-2xl" />
          </div>
          {hasMultiple ? (
            <button type="button" onClick={showNext} className="absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-lg sm:right-5" aria-label="Следующее фото">
              <ChevronRight className="h-6 w-6" />
            </button>
          ) : null}
          {hasMultiple ? <p className="absolute bottom-4 rounded-full bg-white/95 px-3 py-1 text-sm font-bold text-slate-700">{activeIndex + 1} / {validImages.length}</p> : null}
        </div>
      ) : null}
    </>
  );
}
