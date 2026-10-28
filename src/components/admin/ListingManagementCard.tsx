"use client";
import {MapPin} from 'lucide-react';
import Link from 'next/link';
import type {ListingManagementSummary} from '@/lib/listing-block-contract';
import {ListingKindBadge,StatusBadge,type ListingStatus} from '@/components/listings/ListingBadges';
import {ListingManagementPhoto} from './ListingManagementPhoto';

/** Same photo/content hierarchy as the owner's cards; only administrative actions are exposed. */
export function ListingManagementCard({actor,item}:{actor:string;item:ListingManagementSummary}){
 const title=item.title||'Без названия',card=item.card;
 const price=card?.kind==='otdam-darom'?'Бесплатно':card?.price==null?'Цена не указана':`${new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(card.price))} ₽`;
 const place=[card?.city,card?.district].filter(Boolean).join(', ');
 return <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
  <ListingManagementPhoto actor={actor} listingId={item.id} photoId={card?.coverPhotoId??null} alt={title}/>
  <div className="flex min-w-0 flex-1 flex-col p-3">
   <div className="flex flex-wrap gap-1.5">{card&&<ListingKindBadge kind={card.kind}/>}<StatusBadge status={item.blocked?'blocked':item.status as ListingStatus}/></div>
   <h3 className="mt-2 line-clamp-2 min-h-10 break-words text-base font-bold leading-5 text-[#060b27]">{title}</h3>
   <p className="mt-1 break-words text-base font-bold text-[#060b27]">{price}</p>
   <p className="mt-1 flex min-h-5 items-start gap-1 text-xs text-slate-600"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"/><span className="truncate">{place||'Город не указан'}</span></p>
   <p title={item.blockReason??undefined} className={`mt-2 line-clamp-2 min-h-10 text-sm leading-5 ${item.blocked?'text-rose-900':'text-slate-500'}`}>{item.blocked?<>Причина блокировки: {item.blockReason}</>:item.paid?'Оплата подтверждена.':'Размещение ещё не оплачено.'}</p>
   <Link href={`/admin/obyavleniya/${item.id}`} prefetch={false} aria-label={`Открыть объявление: ${title}`} className="mt-auto inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-[#0875d1] hover:border-blue-300 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">Подробнее<span className="sr-only">: {title}</span></Link>
  </div>
 </article>;
}
