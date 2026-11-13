"use client";
import Link from 'next/link';
import {BriefcaseBusiness,Building2,MapPin} from 'lucide-react';
import {StatusBadge} from '@/components/listings/ListingBadges';
import type {WorkCabinetItem} from '@/lib/work-cabinet-contract';
import {WorkCabinetPhoto} from './WorkCabinetPhoto';
import type {ReactNode} from 'react';
import {usePlacementRenewals} from '@/components/listings/ListingWorkflowProvider';
const action='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-[#0875d1] hover:border-blue-300 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

export function WorkCabinetCard({owner,item,onDetails,disabled,showDetails=true,ownerActions}:{owner:string;item:WorkCabinetItem;onDetails:()=>void;disabled:boolean;showDetails?:boolean;ownerActions?:ReactNode}){
 const renewals=usePlacementRenewals();
 const title=item.title||'Без названия',vacancy=item.kind==='vacancy';
 const place=[item.city,item.district].filter(Boolean).join(', ')||'Город не указан';
 const amount=item.amount===null?'По договорённости':`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(item.amount))} ₽`;
 const href=vacancy?`/vakansiya/${item.id}`:`/rabota/zakazy/${item.id}`;
 const editHref=`/rabota/${vacancy?'vakansii':'zakazy'}/${item.id}/edit`;
 return <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
  <WorkCabinetPhoto owner={owner} photoId={item.coverPhotoId} title={title}/>
  <div className="flex min-w-0 flex-1 flex-col p-3">
   <div className="flex flex-wrap items-center gap-1.5"><span className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 px-2 text-xs font-semibold text-slate-700"><BriefcaseBusiness className="h-3.5 w-3.5 text-[#0875d1]" aria-hidden="true"/>{vacancy?'Вакансия':'Заказ'}</span><StatusBadge status={item.status}/></div>
   <h3 className="mt-2 min-h-10 text-base font-bold leading-5 text-[#060b27]">{showDetails?<button type="button" disabled={disabled} onClick={onDetails}
    className="line-clamp-2 break-words text-left hover:text-[#0875d1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">{title}</button>:<Link href={item.status==='published'?href:editHref} prefetch={false} className="line-clamp-2 break-words hover:text-[#0875d1]">{title}</Link>}</h3>
   <p className="mt-1 break-words text-base font-bold text-[#060b27]">{amount}</p>
   <p className="mt-1 flex min-h-5 items-start gap-1 text-xs text-slate-600"><Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/><span className="truncate">{item.organization||item.profession||'Специализация не указана'}</span></p>
   <p className="mt-1 flex min-h-5 items-start gap-1 text-xs text-slate-600"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/><span className="truncate">{place}</span></p>
   <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-4 text-slate-500">{item.status==='assigned'?'Заказ закрыт. История и отклики сохранены.':[item.schedule,item.workFormat].filter(Boolean).join(' · ')||(vacancy?'График и формат не указаны':'Сохранённый заказ')}</p>
   <div className="mt-auto flex flex-wrap gap-2 pt-3">
    {showDetails&&<button type="button" className={action} disabled={disabled} onClick={onDetails} aria-label={`Подробнее: ${title}`}>Подробнее</button>}
    <Link href={editHref} prefetch={false} className={action}>Редактировать</Link>
    {item.status==='published'&&<Link href={href} prefetch={false} className={action}>Посмотреть</Link>}
    {renewals&&item.paid&&['published','expired'].includes(item.status)&&<Link href={`/cabinet/prodlit?type=${item.kind}&id=${item.id}&revision=${item.revision}`} prefetch={false} className={action}>Продлить</Link>}
    {ownerActions}
   </div>
  </div>
 </article>;
}
