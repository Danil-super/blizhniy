"use client";

import type { ReactNode } from "react";
import { Camera } from "lucide-react";
import { StoredMediaImage } from "@/components/StoredMedia";

export function VacancyCardMedia({ children, className = "bg-blue-50", images, title }: { children?: ReactNode; className?: string; images?: string[]; title: string }) {
  const image = images?.[0];

  return (
    <span className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden text-[#0875d1] ${className}`}>
      {image ? <StoredMediaImage src={image} alt={title} className="absolute inset-0 h-full w-full bg-white object-cover transition duration-300 group-hover:scale-[1.03]" /> : null}
      {image ? <span className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-slate-950/30 to-transparent" /> : children}
      {!image && !children ? (
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/75 shadow-sm ring-1 ring-white/80 transition group-hover:scale-105">
          <Camera className="h-8 w-8" />
        </span>
      ) : null}
    </span>
  );
}

export function VacancyThumbnail({ images, title }: { images?: string[]; title: string }) {
  const image = images?.[0];

  if (!image) {
    return (
      <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">
        <Camera className="h-5 w-5" />
      </span>
    );
  }

  return (
    <span className="relative flex h-12 w-16 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
      <StoredMediaImage src={image} alt={title} className="h-full w-full object-cover" />
    </span>
  );
}
