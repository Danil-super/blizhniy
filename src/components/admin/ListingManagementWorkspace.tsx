"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {listingManagement,ListingManagementClientError} from '@/lib/client-listing-management';
import type {ListingManagementPage} from '@/lib/listing-block-contract';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {ListingManagementCard} from './ListingManagementCard';

export function ListingManagementList({actor,page}:{actor:string;page:ListingManagementPage}){
 return <section className="mt-5" aria-label="Все объявления">
  <h2 className="text-lg font-bold">Объявления <span className="font-normal text-slate-500">· {page.items.length}{page.nextCursor?'+':''}</span></h2>
  {!page.items.length?<p className="mt-3 rounded-lg border border-dashed p-5 text-slate-600">Объявлений пока нет.</p>:
   <div role="region" aria-label="Список объявлений" tabIndex={0} className="mt-3 max-h-[65vh] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-slate-50 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
    <ul className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{page.items.map(item=><li key={item.id} className="min-w-0"><ListingManagementCard actor={actor} item={item}/></li>)}</ul>
   </div>}
 </section>;
}
export function ListingManagementWorkspace({actor,visible}:{actor:string;visible:boolean}){
 const [page,setPage]=useState<ListingManagementPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),locked=useRef(false);
 const read=useCallback(async(after:string|null)=>{
  if(!visible||locked.current)return;locked.current=true;setBusy(true);setError(null);const generation=epoch.current;
  try{const result=await listingManagement.list(actor,after,scope.current?.signal);if(epoch.current===generation)setPage(result);}
  catch(error){if(epoch.current===generation){const failure=error instanceof ListingManagementClientError?error:new ListingManagementClientError('UNKNOWN');setError(failure.message);
   if(['ADMIN_REQUIRED','UNAUTHENTICATED'].includes(failure.code)){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}}}
  finally{if(epoch.current===generation){locked.current=false;setBusy(false);}}
 },[actor,visible]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;const generation=++epoch.current;locked.current=false;setBusy(false);
  if(visible)void read(null);return()=>{epoch.current=generation+1;controller.abort();};
 },[visible,read]);
 if(!visible)return null;
 return <div>
  <div className="flex flex-wrap items-start justify-between gap-3"><p className="max-w-3xl text-sm text-slate-600">Объявления публикуются после подтверждения оплаты. Откройте «Подробнее», чтобы проверить все поля, фотографии и при необходимости заблокировать нарушение с причиной для автора.</p>
   <button type="button" className={draftButton} disabled={busy} onClick={()=>void read(null)}>Обновить список</button></div>
  {busy&&<p className="mt-3 text-sm" role="status">Загружаем данные…</p>}{error&&<p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
  {page&&<ListingManagementList actor={actor} page={page}/>}
  {page?.nextCursor&&<button type="button" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>void read(page.nextCursor)}>Следующие объявления</button>}
 </div>;
}
