import {CalendarDays,RefreshCw} from 'lucide-react';
import {formatPublicationDateTime} from '@/lib/publication-time';
export function PublicationDates({publishedAt,updatedAt}:{publishedAt?:string;updatedAt?:string}){
 if(!publishedAt)return null;
 const updated=updatedAt&&Date.parse(updatedAt)>Date.parse(publishedAt)?updatedAt:undefined;
 return <dl aria-label="Даты публикации" className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs sm:text-sm">
  <div><dt className="flex items-center gap-2 text-slate-500"><CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0"/>Размещено</dt><dd className="mt-0.5 pl-6 font-medium text-slate-800"><time dateTime={publishedAt}>{formatPublicationDateTime(publishedAt)}</time></dd></div>
  {updated&&<div><dt className="flex items-center gap-2 text-slate-500"><RefreshCw aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-600"/>Обновлено</dt><dd className="mt-0.5 pl-6 font-medium text-slate-800"><time dateTime={updated}>{formatPublicationDateTime(updated)}</time></dd></div>}
 </dl>;
}
