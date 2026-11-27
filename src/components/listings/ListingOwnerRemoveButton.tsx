"use client";
import {useEffect,useRef,useState} from 'react';
import {listingOwnerRemoval,ListingOwnerRemovalClientError} from '@/lib/client-listing-owner-removal';
import type {DraftRemovalTarget} from '@/lib/listing-owner-removal-contract';
import {notifyAccountSessionChange} from '@/lib/local-account';
export function ListingOwnerRemoveButton({owner,id,revision,target,onChanged}:{owner:string;id:string;revision:string;target?:DraftRemovalTarget;onChanged:()=>void}){
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState<string|null>(null),[stale,setStale]=useState(false);
 const [checkoutActive,setCheckoutActive]=useState(false);
 const scope=useRef<AbortController|null>(null),locked=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;locked.current=false;
  setBusy(false);setUncertain(false);setError(null);setStale(false);setCheckoutActive(false);
  return()=>controller.abort();
 },[owner,id,revision,target]);
 async function run(reading:boolean){
  if(locked.current||stale||!reading&&uncertain)return;
  if(!reading&&!window.confirm(target?'Удалить черновик из кабинета? Восстановление не предусмотрено.':'Удалить заблокированное объявление из вашего кабинета? Блокировка и история оплаты сохранятся. Восстановление не предусмотрено.'))return;
  locked.current=true;setBusy(true);setError(null);setCheckoutActive(false);const controller=scope.current;
  try{
   const result=await listingOwnerRemoval[reading?'read':'remove'](owner,id,revision,{signal:controller?.signal,target});
   if(controller?.signal.aborted)return;
   if(result.removed)onChanged();else{setUncertain(false);setError('Удаление не применено. Можно повторить.');}
  }catch(failure){if(!controller?.signal.aborted){
   const code=failure instanceof ListingOwnerRemovalClientError?failure.code:'UNKNOWN';
   if(code==='UNAUTHENTICATED'){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}
   setCheckoutActive(code==='CHECKOUT_ACTIVE');
   setUncertain(code==='UNKNOWN'||reading&&code!=='CHECKOUT_ACTIVE');setStale(code==='DRAFT_CHANGED'||code==='DRAFT_NOT_FOUND');
   setError(code==='CHECKOUT_ACTIVE'?'Сначала проверьте начатую оплату и отмените её подготовку, если она ещё не отправлена.':
    code==='UNKNOWN'?'Результат пока неизвестен. Сначала проверьте удаление.':code==='DRAFT_CHANGED'?'Запись изменилась. Откройте раздел заново перед удалением.':code==='DRAFT_NOT_FOUND'?'Запись не найдена или её удаление недоступно.':code==='RATE_LIMITED'?'Слишком много запросов. Попробуйте позже.':'Не удалось подтвердить удаление. Попробуйте позже.');
  }}finally{if(!controller?.signal.aborted){locked.current=false;setBusy(false);}}
 }
 return <div><button type="button" className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50" disabled={busy||uncertain||stale} onClick={()=>void run(false)}>{busy?'Проверяем…':target?'Удалить черновик':'Удалить'}</button>
  {error&&<p role="alert" className="max-w-64 px-3 py-2 text-sm text-red-800">{error}</p>}
  {checkoutActive&&<a className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-[#0875d1] underline"
   href={target==='marquee'?`/cabinet/oplata-uslugi?type=marquee&id=${id}&revision=${revision}`:'/cabinet/oplata'}>Проверить оплату</a>}
  {uncertain&&!stale&&<button type="button" className="min-h-11 px-3 text-sm font-semibold text-[#0875d1] underline disabled:opacity-50" disabled={busy} onClick={()=>void run(true)}>Проверить удаление</button>}
 </div>;
}
