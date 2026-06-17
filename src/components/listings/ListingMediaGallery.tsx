"use client";

import { useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Video } from "lucide-react";
import { StoredMediaImage, StoredMediaVideo } from "@/components/StoredMedia";

export type ListingGalleryMedia = {
  kind: "image" | "video";
  src: string;
};

export function ListingMediaGallery({ media, title }: { media: ListingGalleryMedia[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeMedia = media[activeIndex] ?? media[0];

  function showPrevious() {
    setActiveIndex((index) => (index <= 0 ? media.length - 1 : index - 1));
  }

  function showNext() {
    setActiveIndex((index) => (index >= media.length - 1 ? 0 : index + 1));
  }

  if (!media.length) {
    return (
      <div className="mt-5 flex aspect-[4/3] w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400 sm:mt-6">
        <Camera className="h-12 w-12 sm:h-16 sm:w-16" />
      </div>
    );
  }

  return (
    <section className="mt-5 grid gap-3 sm:mt-6">
      <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {activeMedia.kind === "video" ? (
          <StoredMediaVideo src={activeMedia.src} className="h-full w-full bg-slate-950 object-contain" controls playsInline preload="metadata" />
        ) : (
          <StoredMediaImage src={activeMedia.src} alt={title} className="h-full w-full object-contain" loading="eager" />
        )}

        {media.length > 1 ? (
          <>
            <button
              type="button"
              onClick={showPrevious}
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-card transition hover:bg-white sm:left-3"
              aria-label="Предыдущий файл"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={showNext}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-card transition hover:bg-white sm:right-3"
              aria-label="Следующий файл"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <span className="absolute bottom-3 right-3 rounded-full bg-slate-950/70 px-3 py-1 text-xs font-bold text-white">
              {activeIndex + 1} / {media.length}
            </span>
          </>
        ) : null}
      </div>

      {media.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {media.map((item, index) => (
            <button
              type="button"
              key={`${item.src}-${index}`}
              onClick={() => setActiveIndex(index)}
              className={`relative h-20 w-24 shrink-0 overflow-hidden rounded-lg border-2 bg-slate-100 transition ${
                index === activeIndex ? "border-[#0875d1]" : "border-slate-200 hover:border-blue-200"
              }`}
              aria-label={`Показать файл ${index + 1}`}
            >
              {item.kind === "video" ? (
                <>
                  <StoredMediaVideo src={item.src} className="h-full w-full bg-slate-950 object-cover" muted playsInline preload="metadata" />
                  <span className="absolute inset-0 flex items-center justify-center bg-slate-950/25 text-white">
                    <Video className="h-5 w-5" />
                  </span>
                </>
              ) : (
                <StoredMediaImage src={item.src} alt={`${title}, фото ${index + 1}`} className="h-full w-full object-cover" loading="lazy" />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
