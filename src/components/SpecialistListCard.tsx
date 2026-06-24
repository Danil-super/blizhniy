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
      className="group block min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-card"
    >
      <h2 className="truncate text-xl font-bold leading-tight text-[#060b27]">{specialist.name}</h2>
      <p className="mt-2 line-clamp-2 min-h-10 text-base font-bold leading-5 text-slate-900 transition group-hover:text-[#0875d1]">
        {specialist.profession || "Специалист"}
      </p>
      <p className="mt-6 text-xl font-bold text-[#060b27]">{specialist.price || "по договоренности"}</p>
      {publishedLabel ? (
        <p className="mt-3 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-500">
          <Clock3 className="h-4 w-4 shrink-0" />
          <span className="truncate">{publishedLabel}</span>
        </p>
      ) : null}
      <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
        <MapPin className="h-4 w-4 shrink-0" />
        <span className="truncate">{specialist.city}</span>
      </p>
    </Link>
  );
}
