"use client";
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {productionDrafts} from '@/lib/client-listing-drafts';
import type {ListingDraftPage,ListingDraftSummary} from '@/lib/listing-draft-contract';
import {PrivateDraftModeration} from './PrivateDraftModeration';
import type {ListingCheckoutAttempt} from './PrivateListingCheckout';
import {draftButton} from './PrivateDraftEditor';

function ListingCard({owner,item,open,onToggle,checkout}:{owner:string;item:ListingDraftSummary;open:boolean;onToggle:()=>void;checkout:ListingCheckoutAttempt}){
 return <li className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
  <Link href={`/razmestit/obyavlenie?draft=${item.id}`} className="break-words text-lg font-bold text-[#060b27] hover:text-[#0875d1] hover:underline">{item.title||'Без названия'}</Link>
  {item.price&&<p className="mt-2 font-semibold">{item.price.replace('.',',')} ₽</p>}
  <div className="mt-4 flex flex-wrap gap-3">
   <Link href={`/razmestit/obyavlenie?draft=${item.id}`} className={`${draftButton} inline-flex items-center`}>Редактировать</Link>
   <button type="button" className={draftButton} aria-expanded={open} onClick={onToggle}>Статус и оплата</button>
  </div>
  {open&&<PrivateDraftModeration owner={owner} id={item.id} revision={item.revision} disabled={false} checkoutAttempt={checkout} allowSubmit={false}/>}
 </li>;
}

/** Cabinet is a list, not another placement editor. Identity changes remount its parent. */
export function ListingCabinetList({owner,visible}:{owner:string;visible:boolean}){
 const [page,setPage]=useState<ListingDraftPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),pending=useRef(false);
 const [selected,setSelected]=useState<string|null>(null),checkouts=useRef(new Map<string,ListingCheckoutAttempt>());
 for(const item of page?.items??[])if(!checkouts.current.has(item.id))checkouts.current.set(item.id,{input:null,uncertain:false});
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;const generation=++epoch.current;pending.current=true;setBusy(true);setError(null);
  if(visible)void productionDrafts.list(owner,null,{signal:controller.signal}).then(result=>{if(generation===epoch.current)setPage(result);})
   .catch(()=>{if(generation===epoch.current)setError('Не удалось загрузить объявления. Попробуйте ещё раз — сохранённые данные не потеряны.');})
   .finally(()=>{if(generation===epoch.current){pending.current=false;setBusy(false);}});
  return()=>{epoch.current=generation+1;controller.abort();};
 },[owner,visible,refresh]);
 if(!visible)return null;
 async function next(){
  if(pending.current||!page?.nextCursor)return;pending.current=true;setBusy(true);setError(null);const generation=epoch.current;
  try{const result=await productionDrafts.list(owner,page.nextCursor,{signal:scope.current?.signal});if(generation===epoch.current)setPage(current=>current?{items:[...current.items,...result.items.filter(item=>!current.items.some(existing=>existing.id===item.id))],nextCursor:result.nextCursor}:result);}
  catch{if(generation===epoch.current)setError('Не удалось загрузить следующую страницу. Повторите попытку.');}
  finally{if(generation===epoch.current){pending.current=false;setBusy(false);}}
 }
 return <div className="mt-5">
  <div className="flex flex-wrap gap-3"><Link href="/razmestit/obyavlenie" className={`${draftButton} inline-flex items-center bg-[#0875d1] text-white`}>Создать объявление</Link>
   <button type="button" className={draftButton} disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Обновить список</button></div>
  {error&&<p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3" role="alert">{error}</p>}
  {busy&&<p className="mt-4" role="status">Загружаем объявления…</p>}
  {page&&<section className="mt-6" aria-label="Сохранённые объявления"><h2 className="text-xl font-bold">Сохранённые объявления</h2>
   {!page.items.length?<p className="mt-3 text-slate-600">Вы ещё не создали объявлений.</p>:<ul className="mt-4 grid gap-4">{page.items.map(item=><ListingCard key={`${item.id}:${item.revision}`} owner={owner} item={item} open={selected===item.id} onToggle={()=>setSelected(value=>value===item.id?null:item.id)} checkout={checkouts.current.get(item.id)!}/>)}</ul>}
   {page.nextCursor&&<button type="button" className={`${draftButton} mt-4`} disabled={busy} onClick={()=>void next()}>Следующая страница</button>}
  </section>}
 </div>;
}
