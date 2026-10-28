"use client";
import {useEffect,useRef,useState} from 'react';
import {listingOwnerRemoval,ListingOwnerRemovalClientError} from '@/lib/client-listing-owner-removal';
import {notifyAccountSessionChange} from '@/lib/local-account';
export function ListingOwnerRemoveButton({owner,id,revision,onChanged}:{owner:string;id:string;revision:string;onChanged:()=>void}){
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState<string|null>(null),[stale,setStale]=useState(false);
 const scope=useRef<AbortController|null>(null),locked=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;locked.current=false;
  setBusy(false);setUncertain(false);setError(null);setStale(false);
  return()=>controller.abort();
 },[owner,id,revision]);
 async function run(reading:boolean){
  if(locked.current||stale||!reading&&uncertain)return;
  if(!reading&&!window.confirm('Удалить заблокированное объявление из вашего кабинета? Блокировка и история оплаты сохранятся. Восстановление не предусмотрено.'))return;
  locked.current=true;setBusy(true);setError(null);const controller=scope.current;
  try{
   const result=await listingOwnerRemoval[reading?'read':'remove'](owner,id,revision,{signal:controller?.signal});
   if(controller?.signal.aborted)return;
   if(result.removed)onChanged();else{setUncertain(false);setError('Удаление не применено. Можно повторить его кнопкой «Удалить».');}
  }catch(failure){if(!controller?.signal.aborted){
   const code=failure instanceof ListingOwnerRemovalClientError?failure.code:'UNKNOWN';
   if(code==='UNAUTHENTICATED'){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}
   setUncertain(reading||code==='UNKNOWN');setStale(code==='DRAFT_CHANGED'||code==='DRAFT_NOT_FOUND');
   setError(code==='UNKNOWN'?'Результат пока неизвестен. Сначала проверьте удаление.':code==='DRAFT_CHANGED'?'Объявление изменилось. Откройте раздел заново перед удалением.':code==='DRAFT_NOT_FOUND'?'Объявление не найдено или его удаление недоступно.':code==='RATE_LIMITED'?'Слишком много запросов. Попробуйте позже.':'Не удалось удалить объявление. Попробуйте позже.');
  }}finally{if(!controller?.signal.aborted){locked.current=false;setBusy(false);}}
 }
 return <div><button type="button" className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50" disabled={busy||uncertain||stale} onClick={()=>void run(false)}>{busy?'Проверяем…':'Удалить'}</button>
  {error&&<p role="alert" className="max-w-64 px-3 py-2 text-sm text-red-800">{error}</p>}
  {uncertain&&!stale&&<button type="button" className="min-h-11 px-3 text-sm font-semibold text-[#0875d1] underline disabled:opacity-50" disabled={busy} onClick={()=>void run(true)}>Проверить удаление</button>}
 </div>;
}
