import Link from "next/link";
import { Clock3, MapPin } from "lucide-react";
import type { SpecialistProfile } from "@/lib/types";

function formatPublicationDate(value?: string) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function SpecialistListCard({ specialist }: { specialist: SpecialistProfile }) {
  const publishedLabel = formatPublicationDate(specialist.publishedAt ?? specialist.createdAt);

  return (
    <Link
      href={`/specialist/${specialist.id}`}
      className="group block min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-card sm:p-5"
    >
      <h2 className="truncate text-base font-bold leading-tight text-[#060b27] sm:text-xl">{specialist.name}</h2>
      <p className="mt-1.5 line-clamp-2 text-sm font-bold leading-5 text-slate-900 transition group-hover:text-[#0875d1] sm:mt-2 sm:min-h-10 sm:text-base">
        {specialist.profession || "Специалист"}
      </p>
      <p className="mt-4 text-base font-bold text-[#060b27] sm:mt-6 sm:text-xl">{specialist.price || "по договоренности"}</p>
      {publishedLabel ? (
        <p className="mt-2 flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500 sm:mt-3 sm:gap-1.5 sm:text-sm">
          <Clock3 className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          <span className="truncate">{publishedLabel}</span>
        </p>
      ) : null}
      <p className="mt-1.5 flex min-w-0 items-center gap-1 text-xs text-slate-500 sm:mt-2 sm:gap-1.5 sm:text-sm">
        <MapPin className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
        <span className="truncate">{specialist.city}</span>
      </p>
    </Link>
  );
}
