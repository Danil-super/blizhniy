"use client";
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {listingManagement,ListingManagementClientError,type ListingManagementDetail} from '@/lib/client-listing-management';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {useDraftLeaveGuard} from '@/components/listings/useDraftLeaveGuard';
import {StatusBadge,type ListingStatus} from '@/components/listings/ListingBadges';
import {ListingModerationFields} from './ListingModerationFields';
import {ListingManagementGallery} from './ListingManagementGallery';

/** Existing protected inspect/block reader, scoped to one route and one verified actor. */
export function ListingManagementDetailWorkspace({actor,listingId,visible}:{actor:string;listingId:string;visible:boolean}){
 const [detail,setDetail]=useState<ListingManagementDetail|null>(null),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[uncertain,setUncertain]=useState(false),[success,setSuccess]=useState(false);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),locked=useRef(false);
 const pendingReadback=useRef(false);
 useDraftLeaveGuard(visible&&(uncertain||!!reason.trim()&&!detail?.listing.blocked));
 const run=useCallback(async<T,>(work:(signal:AbortSignal|undefined)=>Promise<T>,apply:(value:T)=>void,write=false)=>{
  if(!visible||locked.current)return;locked.current=true;setBusy(true);setError(null);setSuccess(false);if(write){pendingReadback.current=true;setUncertain(true);}const generation=epoch.current;
  try{const result=await work(scope.current?.signal);if(epoch.current===generation)apply(result);}
  catch(error){if(epoch.current===generation){const failure=error instanceof ListingManagementClientError?error:new ListingManagementClientError('UNKNOWN');setError(failure.code==='LISTING_NOT_FOUND'?'Объявление не найдено или больше недоступно.':failure.message);
   if(['ADMIN_REQUIRED','UNAUTHENTICATED'].includes(failure.code)){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}}}
  finally{if(epoch.current===generation){locked.current=false;setBusy(false);}}
 },[visible]);
 const inspect=useCallback((readback=false)=>{
  void run(signal=>listingManagement.inspect(actor,listingId,signal),result=>{setDetail(result);pendingReadback.current=false;setUncertain(false);setReason(current=>result.listing.blockReason??(readback?current:''));});
 },[actor,listingId,run]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;const generation=++epoch.current;locked.current=false;setBusy(false);
  if(visible&&!pendingReadback.current)inspect(true);return()=>{epoch.current=generation+1;controller.abort();};
 },[visible,inspect]);
 function block(){if(!detail||busy||uncertain||detail.listing.blocked)return;const text=reason.trim();if(!text||text.length>1000){setError('Укажите причину блокировки от 1 до 1000 символов.');return;}
  void run(signal=>listingManagement.block(actor,listingId,detail.listing.revision,text,signal),listing=>{setDetail(current=>current?{...current,listing}:null);setReason(listing.blockReason??'');pendingReadback.current=false;setUncertain(false);setSuccess(true);},true);
 }
 if(!visible)return null;
 const form=detail?.snapshot.form;
 return <div>
  <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/admin/obyavleniya" className={`${draftButton} inline-flex items-center`}>← Вернуться к объявлениям</Link>
   <button type="button" className={draftButton} disabled={busy} onClick={()=>inspect(true)}>Перечитать объявление</button></div>
  {busy&&<p className="mt-3 text-sm" role="status">Загружаем данные…</p>}{error&&<p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
  {success&&<p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">Объявление заблокировано. Причина сохранена, уведомление добавлено в кабинет автора; письмо сохранено в локальном почтовом ящике.</p>}
  {detail&&form&&<section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="Управление объявлением">
   <div className="flex flex-wrap items-center gap-3"><h2 className="break-words text-xl font-bold">{form.title||'Без названия'}</h2><StatusBadge status={detail.listing.blocked?'blocked':detail.listing.status as ListingStatus}/></div>
   <p className="mt-2 break-all text-xs text-slate-500">ID: {detail.listing.id} · Версия: {detail.listing.revision} · {detail.listing.paid?'Оплата подтверждена':'Размещение не оплачено'}</p>
   <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(16rem,24rem)_minmax(0,1fr)]"><div className="min-w-0">
    <ListingManagementGallery key={`${detail.listing.id}:${detail.listing.revision}`} actor={actor} listingId={listingId} photos={detail.snapshot.photos}/>
   </div><div className="min-w-0"><p className="whitespace-pre-wrap break-words text-sm leading-6">{form.description||'Описание не заполнено.'}</p><ListingModerationFields form={form}/></div></div>
   {detail.listing.blocked?<div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4"><h3 className="font-bold text-red-800">Причина блокировки</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-red-800">{detail.listing.blockReason}</p><p className="mt-2 text-xs text-red-800">Изменение объявления не снимает блокировку.</p></div>:<div className="mt-5 max-w-2xl border-t border-slate-100 pt-4"><label htmlFor="listing-block-reason" className="block text-sm font-bold">Причина блокировки</label><textarea id="listing-block-reason" className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700" maxLength={1000} value={reason} disabled={busy||uncertain} onChange={event=>setReason(event.target.value)} aria-describedby="listing-block-help"/>
    <p id="listing-block-help" className="mt-1 text-xs text-slate-500">Причина обязательна и будет видна автору. Блокировка скрывает объявление с сайта.</p><button type="button" className={`${draftButton} mt-3 border-red-300 text-red-700 hover:bg-red-50`} disabled={busy||uncertain} onClick={block}>Заблокировать объявление</button></div>}
   {uncertain&&<p className="mt-3 text-sm" role="status">Не повторяйте блокировку, пока не проверите результат кнопкой «Перечитать объявление».</p>}
  </section>}
 </div>;
}
