import { Flag } from "lucide-react";
import { getPublicSiteUrl } from "@/lib/site-url";

type PublicationSection = "obyavlenie" | "vakansiya" | "rabota/zakazy" | "specialist";

export function PublicationComplaintLink({ section, slug }: { section: PublicationSection; slug: string }) {
  const url = `${getPublicSiteUrl()}/${section}/${encodeURIComponent(slug)}`;
  const subject = encodeURIComponent("Жалоба на публикацию БЛИЖНИЙ");
  const body = encodeURIComponent(`Публикация: ${url}\r\n\r\nПричина жалобы: `);

  return (
    <a href={`mailto:prostova04@yandex.ru?subject=${subject}&body=${body}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
      <Flag aria-hidden="true" className="h-4 w-4 shrink-0" />
      Пожаловаться по почте
    </a>
  );
}
