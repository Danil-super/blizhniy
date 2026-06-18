"use client";

import { useState } from "react";
import { StoredMediaImage } from "@/components/StoredMedia";

export function VacancyMediaGallery({ images = [], title }: { images?: string[]; title: string }) {
  const validImages = images.filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = validImages[activeIndex] ?? validImages[0];

  if (!activeImage) {
    return null;
  }

  return (
    <section className="mt-6 grid gap-3">
      <div className="relative flex aspect-[4/3] max-h-[32rem] min-h-0 w-full items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <StoredMediaImage src={activeImage} alt={title} className="h-full w-full object-cover" />
      </div>
      {validImages.length > 1 ? (
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
          {validImages.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-white transition sm:h-20 sm:w-20 ${
                index === activeIndex ? "border-[#0875d1] ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-200"
              }`}
              aria-label={`Показать фото ${index + 1}`}
            >
              <StoredMediaImage src={image} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
