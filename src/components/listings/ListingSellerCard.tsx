import Link from "next/link";
import { ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Flag, ShieldCheck } from "lucide-react";
import { sellerInitial } from "@/lib/seller-profile";

type ListingSellerCardProps = {
  sellerName?: string;
  registeredSince?: string;
  listingCount?: number;
  soldCount?: number;
  hasContacts?: boolean;
  listingTitle: string;
  profileHref?: string;
};

function supportMailHref(listingTitle: string) {
  const subject = encodeURIComponent(`Жалоба на объявление: ${listingTitle}`);
  return `mailto:demo@blizhniy.local?subject=${subject}`;
}

function pluralListings(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return "объявление";
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "объявления";
  }

  return "объявлений";
}

export function ListingSellerCard({ sellerName, registeredSince, listingCount = 1, soldCount = 0, hasContacts = false, listingTitle, profileHref }: ListingSellerCardProps) {
  const name = sellerName?.trim() || "Продавец";
  const safeListingCount = Math.max(1, listingCount);

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-lg font-bold text-[#0875d1]">
          {sellerInitial(name)}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-slate-400">Продавец</p>
          <h2 className="mt-1 [overflow-wrap:anywhere] text-lg font-bold text-[#060b27]">{name}</h2>
          {hasContacts ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Контакты указаны
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400">
            <CalendarDays className="h-4 w-4 shrink-0 text-[#0875d1]" />
            На платформе
          </div>
          <p className="mt-1 [overflow-wrap:anywhere] text-sm font-bold text-[#060b27]">{registeredSince ? `с ${registeredSince}` : "недавно"}</p>
        </div>
        <div className="min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400">
            <ClipboardList className="h-4 w-4 shrink-0 text-[#0875d1]" />
            Объявления
          </div>
          <p className="mt-1 [overflow-wrap:anywhere] text-sm font-bold text-[#060b27]">
            {safeListingCount} {pluralListings(safeListingCount)}
          </p>
        </div>
        <div className="col-span-2 min-w-0 rounded-lg bg-slate-50 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0875d1]" />
            Продано
          </div>
          <p className="mt-1 [overflow-wrap:anywhere] text-sm font-bold text-[#060b27]">{soldCount} товаров</p>
        </div>
      </div>

      {profileHref ? (
        <Link href={profileHref} className="mt-4 inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-[#0875d1] transition hover:border-[#0875d1] hover:bg-white">
          <span className="truncate">Профиль продавца</span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      ) : null}

      <div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0875d1]" />
        <span>Проверьте товар при встрече и не переводите предоплату, если не уверены в продавце.</span>
      </div>

      <div className="mt-4">
        <a href={supportMailHref(listingTitle)} className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600">
          <Flag className="h-4 w-4 shrink-0" />
          Пожаловаться
        </a>
      </div>
    </section>
  );
}
