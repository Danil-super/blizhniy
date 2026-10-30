import {formatPublicationDateTime} from '@/lib/publication-time';

/** Paid placement dates from the private server DTO. Editing never renews them. */
export function PublicationPlacementPeriod({publishedAt,expiresAt,status}:{publishedAt:string|null;expiresAt:string|null;status:string}){
 if(!publishedAt||!expiresAt)return null;
 return <section aria-label="Срок размещения" className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
  {status==='expired'&&<p className="mb-3 text-sm font-semibold text-amber-800">Срок размещения истёк</p>}
  <dl className="grid gap-3 text-sm sm:grid-cols-2">
   <div><dt className="text-slate-600">Начало размещения</dt><dd className="mt-1 font-medium"><time dateTime={publishedAt}>{formatPublicationDateTime(publishedAt)}</time></dd></div>
   <div><dt className="text-slate-600">Окончание размещения</dt><dd className="mt-1 font-medium"><time dateTime={expiresAt}>{formatPublicationDateTime(expiresAt)}</time></dd></div>
  </dl>
  <p className="mt-3 text-xs text-slate-600">Редактирование не продлевает размещение.</p>
 </section>;
}
