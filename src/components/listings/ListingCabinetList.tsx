"use client";
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {productionDrafts} from '@/lib/client-listing-drafts';
import type {ListingDraftPage,ListingDraftSummary} from '@/lib/listing-draft-contract';
import {listingCabinet,ListingCabinetClientError} from '@/lib/client-listing-cabinet';
import {notifyAccountSessionChange} from '@/lib/local-account';
import type {ListingCabinetPage} from '@/lib/listing-cabinet-contract';
import {PrivateDraftModeration} from './PrivateDraftModeration';
import {PrivateListingCheckout,type ListingCheckoutAttempt} from './PrivateListingCheckout';
import {draftButton} from './PrivateDraftEditor';
import {CabinetListingCard} from './CabinetListingCard';
import {ListingOwnerRemoveButton} from './ListingOwnerRemoveButton';
import {useDraftRemovals} from './ListingWorkflowProvider';
import {TwoRowCardViewport} from '@/components/cabinet/TwoRowCardViewport';

function ListingCard({owner,item,open,onToggle,checkout,onChanged}:{owner:string;item:ListingDraftSummary;open:boolean;onToggle:()=>void;checkout:ListingCheckoutAttempt;onChanged:()=>void}){
 const draftRemovals=useDraftRemovals();
 return <li className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
  <Link href={`/razmestit/obyavlenie?draft=${item.id}`} className="break-words text-lg font-bold text-[#060b27] hover:text-[#0875d1] hover:underline">{item.title||'Без названия'}</Link>
  {item.price&&<p className="mt-2 font-semibold">{item.price.replace('.',',')} ₽</p>}
  <div className="mt-4 flex flex-wrap gap-3">
   <Link href={`/razmestit/obyavlenie?draft=${item.id}`} className={`${draftButton} inline-flex items-center`}>Редактировать</Link>
   <button type="button" className={draftButton} aria-expanded={open} onClick={onToggle}>Статус и оплата</button>
   {draftRemovals&&<ListingOwnerRemoveButton owner={owner} id={item.id} revision={item.revision} target="listing" onChanged={onChanged}/>}
  </div>
  {open&&<PrivateDraftModeration owner={owner} id={item.id} revision={item.revision} disabled={false} checkoutAttempt={checkout} allowSubmit={false}/>}
 </li>;
}

/** Cabinet is a list, not another placement editor. Identity changes remount its parent. */
export function ListingCabinetList({owner,visible,enriched=false}:{owner:string;visible:boolean;enriched?:boolean}){
 const [page,setPage]=useState<ListingDraftPage|ListingCabinetPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),pending=useRef(false);
 const [selected,setSelected]=useState<string|null>(null),checkouts=useRef(new Map<string,ListingCheckoutAttempt>());
 const openedPayment=useRef(false);
 const failedStage=useRef<'initial'|'next'>('initial');
 useEffect(()=>{
  if(!enriched||!page||openedPayment.current||typeof window==='undefined'||!window.location)return;
  openedPayment.current=true;
  const id=new URLSearchParams(window.location.search).get('pay');
  if(id&&page.items.some(item=>item.id===id))setSelected(id);
 },[enriched,page]);
 for(const item of page?.items??[])if(!checkouts.current.has(item.id))checkouts.current.set(item.id,{input:null,uncertain:false});
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;const generation=++epoch.current;pending.current=true;failedStage.current='initial';setBusy(true);setError(null);
  if(visible)void (enriched?listingCabinet:productionDrafts).list(owner,null,{signal:controller.signal}).then(result=>{if(generation===epoch.current)setPage(result);})
   .catch(failure=>{if(generation===epoch.current){
    if(enriched&&failure instanceof ListingCabinetClientError&&['UNAUTHENTICATED','SESSION_CHANGED'].includes(failure.code)){
     setPage(null);setSelected(null);checkouts.current.clear();notifyAccountSessionChange(true);notifyAccountSessionChange(false);
    }
    setError('Не удалось загрузить объявления. Попробуйте ещё раз — сохранённые данные не потеряны.');
   }})
   .finally(()=>{if(generation===epoch.current){pending.current=false;setBusy(false);}});
  return()=>{epoch.current=generation+1;controller.abort();};
 },[owner,visible,enriched,refresh]);
 if(!visible)return null;
 async function next(){
  if(!visible||pending.current||!page?.nextCursor)return;pending.current=true;failedStage.current='next';setBusy(true);setError(null);const generation=epoch.current;
  try{const result=await (enriched?listingCabinet:productionDrafts).list(owner,page.nextCursor,{signal:scope.current?.signal});if(generation===epoch.current)setPage(current=>current?{...current,items:[...current.items,...result.items.filter(item=>!current.items.some(existing=>existing.id===item.id))],nextCursor:result.nextCursor} as ListingDraftPage|ListingCabinetPage:result);}
  catch(failure){if(generation===epoch.current){
   if(enriched&&failure instanceof ListingCabinetClientError&&['UNAUTHENTICATED','SESSION_CHANGED'].includes(failure.code)){
    setPage(null);setSelected(null);checkouts.current.clear();notifyAccountSessionChange(true);notifyAccountSessionChange(false);
   }
   setError('Не удалось загрузить следующую страницу. Повторите попытку.');
  }}
  finally{if(generation===epoch.current){pending.current=false;setBusy(false);}}
 }
 return <div className="mt-5" onClickCapture={event=>{
  if(!(event.target instanceof Element))return;
  const clicked=event.target.closest('details[data-listing-actions]');
  for(const menu of event.currentTarget.querySelectorAll<HTMLDetailsElement>('details[data-listing-actions][open]'))if(menu!==clicked)menu.open=false;
 }} onKeyDown={event=>{
  if(event.key!=='Escape')return;
  const menus=event.currentTarget.querySelectorAll<HTMLDetailsElement>('details[data-listing-actions][open]');
  if(menus.length)event.preventDefault();
  for(const menu of menus){menu.open=false;if(menu.contains(event.target as Node))menu.querySelector('summary')?.focus();}
 }}>
  <div className="flex flex-wrap gap-3"><Link href="/razmestit/obyavlenie" className={`${draftButton} inline-flex items-center bg-[#0875d1] text-white`}>Создать объявление</Link></div>
  {error&&<div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3"><p role="alert">{error}</p>
   <button type="button" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>{if(failedStage.current==='next')void next();else setRefresh(value=>value+1);}}>Повторить загрузку</button></div>}
  {busy&&<p className="mt-4" role="status">Загружаем объявления…</p>}
  {page&&<section className="mt-6" aria-label={enriched?'Список моих объявлений':'Сохранённые объявления'}><h2 className="text-xl font-bold">{enriched?'Мои объявления':'Сохранённые объявления'}</h2>
   {!page.items.length?<p className="mt-3 text-slate-600">Вы ещё не создали объявлений.</p>:<TwoRowCardViewport label="Прокручиваемый список моих объявлений" className="mt-4 border border-slate-200 bg-slate-50"
    hasMore={!!page.nextCursor} loading={busy} error={!!error} onLoadMore={()=>void next()}
    gridClassName={enriched?'grid auto-rows-fr grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5':'grid auto-rows-fr gap-4'}>{page.items.map(item=>{
    const checkout=checkouts.current.get(item.id)!;
    const toggle=()=>setSelected(value=>value===item.id?null:item.id);
    const changed=()=>setRefresh(value=>value+1);
    if(!('card' in item))return <ListingCard key={`${item.id}:${item.revision}`} owner={owner} item={item} open={selected===item.id} onToggle={toggle} checkout={checkout} onChanged={changed}/>;
    const postmoderation='workflow' in page&&page.workflow==='postmoderation';
    return <li key={`${item.id}:${item.revision}`} className="min-w-0"><CabinetListingCard owner={owner} item={item} open={selected===item.id} onToggle={toggle} managePublication={postmoderation} onChanged={changed}>
     {postmoderation?(item.card.status==='draft'||item.card.status==='pending_payment'||checkout.uncertain?
      <PrivateListingCheckout owner={owner} id={item.id} revision={item.revision} attempt={checkout} postmoderationListing/>:
      <p className="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-600">{item.card.status==='published'?'Объявление опубликовано и доступно в каталоге.':item.card.status==='paid'?'Оплата подтверждена. Текущее состояние объявления указано в карточке. Повторно оплачивать не нужно.':item.card.status==='blocked'?'Объявление скрыто из каталога. Причина блокировки указана выше.':item.card.status==='expired'?'Срок размещения завершён. Объявление больше не показывается в каталоге.':'Объявление не показывается в каталоге.'}</p>):
      <PrivateDraftModeration owner={owner} id={item.id} revision={item.revision} disabled={false} checkoutAttempt={checkout} allowSubmit={false}/>}
    </CabinetListingCard></li>;
   })}</TwoRowCardViewport>}
  </section>}
 </div>;
}
