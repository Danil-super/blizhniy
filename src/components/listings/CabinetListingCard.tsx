"use client";

import Image from 'next/image';
import Link from 'next/link';
import {ImageIcon, MapPin} from 'lucide-react';
import {useEffect, useState, type ReactNode} from 'react';
import {ListingMediaClientError, productionListingMedia} from '@/lib/client-listing-media';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {createListingThumbnailQueue} from '@/lib/listing-thumbnail-queue';
import type {ListingCabinetSummary} from '@/lib/listing-cabinet-contract';
import {ListingKindBadge, StatusBadge} from './ListingBadges';
import {ListingOwnerVisibilityButton} from './ListingOwnerVisibilityButton';
import {ListingOwnerRemoveButton} from './ListingOwnerRemoveButton';

const action = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-blue-800 transition hover:border-blue-300 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const readThumbnail = createListingThumbnailQueue(productionListingMedia.read);

/** Private thumbnails never use a public media URL or persist an identity/token in the browser. */
function CabinetThumbnail({owner, photoId, title}: {owner: string; photoId: string | null; title: string}) {
  const [url, setUrl] = useState<string | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let active = true, objectUrl: string | null = null;
    setUrl(null); setFailed(false);
    if (photoId) void readThumbnail(owner, photoId, {signal: controller.signal}).then(blob => {
      if (active) {objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);}
    }).catch(error => {
      if (!active) return;
      setFailed(true);
      if (error instanceof ListingMediaClientError && ['UNAUTHENTICATED', 'SESSION_CHANGED'].includes(error.code)) {
        notifyAccountSessionChange(true); notifyAccountSessionChange(false);
      }
    });
    return () => {active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [owner, photoId]);

  return <span data-listing-photo-frame className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-t-xl bg-slate-100">
    {url && !failed ? <Image src={url} unoptimized alt={title} width={400} height={300} className="h-full w-full object-cover object-center" onError={() => setFailed(true)}/> :
      <span className="flex flex-col items-center gap-1 px-1 text-center text-xs text-slate-600"><ImageIcon className="h-7 w-7" aria-hidden="true"/>
        {photoId ? failed ? 'Фото недоступно' : 'Загрузка фото…' : 'Без фото'}</span>}
  </span>;
}

/** Same compact photo/content hierarchy and badges as catalogue cards, with owner actions instead of contacts. */
export function CabinetListingCard({owner, item, open, onToggle, children,managePublication=false,onChanged=()=>{}}: {
  owner: string; item: ListingCabinetSummary; open: boolean; onToggle: () => void; children: ReactNode;managePublication?:boolean;onChanged?:()=>void;
}) {
  const editable = item.card.status === 'draft';
  const title = item.title || 'Без названия';
  const href = editable ? `/razmestit/obyavlenie?draft=${item.id}` : item.card.status === 'published' ? `/obyavlenie/${item.id}` : null;
  const place = [item.card.city, item.card.district].filter(Boolean).join(', ');
  const price = item.kind === 'otdam-darom' ? 'Бесплатно' : item.price === null ? 'Цена не указана' :
    `${new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(item.price))} ₽`;
  const detailsId = `listing-status-${item.id}`;

  return <article className="flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      {href ? <Link href={href} className="block rounded-t-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" aria-label={title}>
        <CabinetThumbnail owner={owner} photoId={item.card.coverPhotoId} title={title}/>
      </Link> : <CabinetThumbnail owner={owner} photoId={item.card.coverPhotoId} title={title}/>}
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <div className="flex flex-wrap gap-1.5"><ListingKindBadge kind={item.kind}/><StatusBadge status={item.card.status}/></div>
        <h3 className="mt-2 line-clamp-2 min-h-10 break-words text-base font-bold leading-5 text-[#060b27]">
          {href ? <Link href={href} className="hover:text-[#0875d1] hover:underline">{title}</Link> : title}
        </h3>
        <p className="mt-1 break-words text-base font-bold text-[#060b27]">{price}</p>
        <p className="mt-1 flex min-h-5 items-start gap-1 text-xs text-slate-600"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"/><span className="truncate">{place||'Город не указан'}</span></p>
    {item.card.status === 'blocked' ? <p title={item.card.blockReason??''} className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-rose-900">
      <span className="font-semibold">Причина блокировки: </span>{item.card.blockReason || 'Обновите список, чтобы получить причину.'}
    </p>:<p className="mt-2 min-h-10 text-xs leading-5 text-slate-500">{item.card.status==='published'?'Объявление доступно в каталоге.':item.card.status==='archived'?'Снято с публикации. Срок размещения продолжает идти.':item.card.status==='pending_payment'?'Продолжите оплату, чтобы разместить объявление.':item.card.status==='draft'?'Черновик сохранён. Можно продолжить заполнение.':item.card.status==='paid'?'Оплата подтверждена. Проверяем публикацию.':'Объявление не показывается в каталоге.'}</p>}
    <div className="mt-auto flex flex-wrap gap-2 pt-3">
      {!managePublication&&editable && <Link href={`/razmestit/obyavlenie?draft=${item.id}`} className={action}>Редактировать</Link>}
      {!managePublication&&item.card.status === 'published' && <Link href={`/obyavlenie/${item.id}`} className={action}>Посмотреть</Link>}
      {['draft','pending_payment','paid'].includes(item.card.status)&&<button type="button" className={action} aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>Статус и оплата</button>}
      {managePublication&&<details data-listing-actions name={`listing-actions-${owner}`} className="relative min-w-0 flex-1"><summary className={`${action} w-full cursor-pointer list-none`}>Действия</summary>
       <div className="absolute bottom-full right-0 z-30 mb-2 w-60 max-w-[80vw] rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
        {['draft','published','archived','blocked'].includes(item.card.status)&&<Link href={`/razmestit/obyavlenie?draft=${item.id}`} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-blue-800 hover:bg-blue-50">Редактировать</Link>}
        {item.card.status==='published'&&<Link href={`/obyavlenie/${item.id}`} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-blue-800 hover:bg-blue-50">Посмотреть</Link>}
        {['published','archived'].includes(item.card.status)&&<ListingOwnerVisibilityButton owner={owner} id={item.id} revision={item.revision} restore={item.card.status==='archived'} onChanged={onChanged}/>}
        {item.card.status==='blocked'&&<ListingOwnerRemoveButton owner={owner} id={item.id} revision={item.revision} onChanged={onChanged}/>}
        {!['draft','published','archived','blocked'].includes(item.card.status)&&<p className="px-3 py-2 text-sm text-slate-600">Статус объявления указан в карточке.</p>}
       </div>
      </details>}
    </div>
    <div id={detailsId}>{open && children}</div>
      </div>
  </article>;
}
