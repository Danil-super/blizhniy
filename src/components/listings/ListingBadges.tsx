import {CalendarDays, Gift, ShoppingBag, Tags} from 'lucide-react';

export type ListingKind = 'prodam' | 'kuplyu' | 'otdam-darom' | 'arenda';
export type ListingStatus = 'draft' | 'pending_payment' | 'paid' | 'published' | 'sold' | 'archived' | 'expired' | 'rejected' | 'blocked' | 'assigned' | 'removed';

const kindLabels: Record<ListingKind, string> = {prodam: 'Продам', kuplyu: 'Куплю', 'otdam-darom': 'Отдам даром', arenda: 'Аренда'};
export const listingKindIcons = {prodam: ShoppingBag, kuplyu: Tags, 'otdam-darom': Gift, arenda: CalendarDays};

/** Shared presentation only: private owner cards do not load public counters or media storage. */
export function ListingKindBadge({kind}: {kind: ListingKind}) {
  const Icon = listingKindIcons[kind];
  return <span className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 sm:h-8 sm:px-3 sm:text-sm">
    <Icon className="h-3.5 w-3.5 shrink-0 text-[#0875d1] sm:h-4 sm:w-4"/>{kindLabels[kind]}
  </span>;
}

export function StatusBadge({status}: {status: ListingStatus}) {
  const labels: Record<ListingStatus, string> = {draft: 'Черновик', pending_payment: 'Ожидает оплату', paid: 'Оплачено', published: 'Опубликовано',
    sold: 'Продано', archived: 'Архив', expired: 'Истек срок', rejected: 'Отклонено', blocked: 'Заблокировано', assigned: 'Исполнитель выбран', removed: 'Удалено владельцем'};
  const tones: Record<ListingStatus, string> = {
    draft: 'border-slate-200 bg-slate-50 text-slate-700',
    pending_payment: 'border-amber-200 bg-amber-50 text-amber-800',
    paid: 'border-sky-200 bg-sky-50 text-sky-800',
    published: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    sold: 'border-blue-200 bg-blue-50 text-blue-800',
    archived: 'border-slate-300 bg-slate-100 text-slate-700',
    removed: 'border-slate-300 bg-slate-100 text-slate-700',
    expired: 'border-orange-200 bg-orange-50 text-orange-800',
    rejected: 'border-rose-200 bg-rose-50 text-rose-800',
    blocked: 'border-rose-200 bg-rose-50 text-rose-800',
    assigned: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  };
  return <span className={`inline-flex h-7 min-w-0 items-center rounded-full border px-2.5 text-xs font-bold sm:h-8 sm:px-3 sm:text-sm ${tones[status]}`}>{labels[status]}</span>;
}
