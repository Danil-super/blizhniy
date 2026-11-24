'use client';
import {useEffect,useRef,useState} from 'react';
import {checkoutCancellation,serviceCheckoutCancellation,CheckoutCancellationClientError} from '@/lib/client-checkout-cancellation';
import type {CheckoutCancellationInput} from '@/lib/checkout-cancellation-contract';
export function CheckoutCancellation({owner,paymentId,targetType,visible,service=false,editAfter=false,onCancelled,onPendingChange}:{owner:string;paymentId:string;targetType:CheckoutCancellationInput['targetType'];visible:boolean;service?:boolean;editAfter?:boolean;onCancelled:()=>void;onPendingChange:(pending:boolean)=>void}){
 const [busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[message,setMessage]=useState<string|null>(null),pending=useRef(false),scope=useRef<AbortController|null>(null),live=useRef(visible);live.current=visible;
 useEffect(()=>{const controller=new AbortController();scope.current=controller;pending.current=false;setBusy(false);return()=>controller.abort();},[owner,paymentId,visible]);
 async function perform(read:boolean){
  const controller=scope.current;if(pending.current||!live.current||!controller||controller.signal.aborted)return;pending.current=true;setBusy(true);if(!read)setUnknown(true);setMessage(null);onPendingChange(true);
  try{
   const result=await (service?serviceCheckoutCancellation:checkoutCancellation)[read?'read':'cancel'](owner,{paymentId,targetType},{signal:controller.signal});if(controller.signal.aborted||!live.current)return;
   setUnknown(false);onPendingChange(false);
   if(result)onCancelled();else setMessage('Отмена не подтверждена. Можно повторить отмену этой же подготовки.');
  }catch(error){if(!controller.signal.aborted&&live.current){const uncertain=!(error instanceof CheckoutCancellationClientError)||error.code==='UNKNOWN';setUnknown(uncertain);onPendingChange(uncertain);setMessage(error instanceof Error?error.message:'Не удалось проверить отмену.');}}
  finally{if(scope.current===controller){pending.current=false;if(!controller.signal.aborted)setBusy(false);}}
 }
 return <section hidden={!visible} inert={!visible} aria-label="Отмена подготовки оплаты" className="mt-4 border-t border-slate-200 pt-4">
  <button type="button" disabled={busy} onClick={()=>void perform(unknown)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60">{busy?'Проверяем подготовку…':unknown?'Проверить отмену':editAfter?'Отменить подготовку и редактировать':'Отменить подготовку оплаты'}</button>
  <p className="mt-2 text-xs leading-5 text-slate-600">Отмена доступна, пока оплата не отправлена. Публикация и история сохранятся.</p>
  {message&&<p role="alert" className="mt-2 break-words text-sm text-slate-800">{message}</p>}
 </section>;
}
