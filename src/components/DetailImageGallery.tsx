"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode, TouchEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { StoredMediaImage } from "@/components/StoredMedia";
import { shouldShowClientFallbackContent } from "@/lib/client-runtime-mode";
import { demoPublicationsStorageKey } from "@/lib/demo-publications";

type DetailImageGalleryProps = {
  compactMobile?: boolean;
  fallbackIcon: ReactNode;
  images?: string[];
  localPublicationId?: string;
  title: string;
};

const clientFallbackContentEnabled = shouldShowClientFallbackContent();

export function DetailImageGallery({ compactMobile = false, fallbackIcon, images = [], localPublicationId, title }: DetailImageGalleryProps) {
  const [localImages, setLocalImages] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const didSwipeRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const validImages = [...images, ...localImages].filter(Boolean).filter((image, index, list) => list.indexOf(image) === index);
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, validImages.length - 1));
  const activeImage = validImages[safeActiveIndex];
  const hasMultiple = validImages.length > 1;
  const frameClassName = compactMobile ? "aspect-[4/3] sm:aspect-square" : "aspect-square";

  useEffect(() => {
    if (!clientFallbackContentEnabled || !localPublicationId) {
      return;
    }

    try {
      const parsed = JSON.parse(window.localStorage.getItem(demoPublicationsStorageKey) ?? "[]") as unknown;

      if (!Array.isArray(parsed)) {
        return;
      }

      const publication = parsed.find((item) => Boolean(item && typeof item === "object" && "id" in item && item.id === localPublicationId));
      const publicationImages = publication && typeof publication === "object" && "images" in publication ? publication.images : undefined;

      if (Array.isArray(publicationImages)) {
        setLocalImages(publicationImages.filter((image): image is string => typeof image === "string" && Boolean(image.trim())));
      }
    } catch {
      setLocalImages([]);
    }
  }, [localPublicationId]);

  useEffect(() => {
    if (activeIndex >= validImages.length) {
      setActiveIndex(Math.max(0, validImages.length - 1));
    }
  }, [activeIndex, validImages.length]);

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
    if (!validImages.length) {
      return;
    }

    setActiveIndex((index) => (index - 1 + validImages.length) % validImages.length);
  }

  function showNext() {
    if (!validImages.length) {
      return;
    }

    setActiveIndex((index) => (index + 1) % validImages.length);
  }

  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    didSwipeRef.current = false;
  }

  function handleTouchEnd(event: TouchEvent) {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;

    if (!hasMultiple || !start || !touch) {
      return;
    }

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) < 40 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return;
    }

    didSwipeRef.current = true;

    if (deltaX < 0) {
      showNext();
    } else {
      showPrevious();
    }
  }

  return (
    <>
      <section className="order-2 md:order-1">
        <div
          className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm [touch-action:pan-y]"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            type="button"
            onClick={() => {
              if (didSwipeRef.current) {
                didSwipeRef.current = false;
                return;
              }

              if (activeImage) {
                setOpen(true);
              }
            }}
            disabled={!activeImage}
            className="block w-full disabled:cursor-default"
            aria-label={activeImage ? `Открыть фото: ${title}` : undefined}
          >
            <span className={`flex w-full items-center justify-center overflow-hidden bg-slate-100 ${frameClassName}`}>
              {validImages.length ? (
                <span
                  className="flex h-full w-full transition-transform duration-300 ease-out motion-reduce:transition-none"
                  style={{ transform: `translateX(-${safeActiveIndex * 100}%)` }}
                >
                  {validImages.map((image, index) => (
                    <span key={`${image}-${index}`} className="flex h-full w-full shrink-0 items-center justify-center bg-slate-100">
                      <StoredMediaImage
                        src={image}
                        alt={index === safeActiveIndex ? title : `${title}, фото ${index + 1}`}
                        className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.015] motion-reduce:transition-none"
                        loading={index === 0 ? "eager" : "lazy"}
                      />
                    </span>
                  ))}
                </span>
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
                className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-slate-800 shadow-md ring-1 ring-slate-200 transition hover:bg-white hover:text-[#0875d1] sm:inline-flex"
                aria-label="Предыдущее фото"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={showNext}
                className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-slate-800 shadow-md ring-1 ring-slate-200 transition hover:bg-white hover:text-[#0875d1] sm:inline-flex"
                aria-label="Следующее фото"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
              <span className="absolute bottom-3 right-3 rounded-full bg-slate-950/70 px-3 py-1 text-xs font-bold text-white shadow-sm">
                {safeActiveIndex + 1} / {validImages.length}
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
                  index === safeActiveIndex ? "border-[#0875d1] ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-200"
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
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/85 p-3 sm:p-6 [touch-action:pan-y]"
          role="dialog"
          aria-modal="true"
          aria-label={`Фото: ${title}`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg sm:right-5 sm:top-5" aria-label="Закрыть фото">
            <X className="h-5 w-5" />
          </button>
          {hasMultiple ? (
            <button type="button" onClick={showPrevious} className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-lg sm:left-5 sm:inline-flex" aria-label="Предыдущее фото">
              <ChevronLeft className="h-6 w-6" />
            </button>
          ) : null}
          <div className="flex max-h-[88vh] w-full max-w-5xl items-center justify-center">
            <StoredMediaImage src={activeImage} alt={title} className="max-h-[88vh] w-auto max-w-full rounded-2xl bg-white object-contain shadow-2xl" />
          </div>
          {hasMultiple ? (
            <button type="button" onClick={showNext} className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-lg sm:right-5 sm:inline-flex" aria-label="Следующее фото">
              <ChevronRight className="h-6 w-6" />
            </button>
          ) : null}
          {hasMultiple ? <p className="absolute bottom-4 rounded-full bg-white/95 px-3 py-1 text-sm font-bold text-slate-700">{safeActiveIndex + 1} / {validImages.length}</p> : null}
        </div>
      ) : null}
    </>
  );
}
