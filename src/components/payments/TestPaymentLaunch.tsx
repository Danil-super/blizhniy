"use client";
import {useEffect,useRef,useState} from 'react';
import {accountTestPayment} from '@/lib/client-account-test-payment';
export function TestPaymentLaunch({owner,paymentId,visible}:{owner:string;paymentId:string;visible:boolean}){
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState<string|null>(null);
 const allowed=useRef(visible),locked=useRef(false),scope=useRef<AbortController|null>(null);allowed.current=visible;
 useEffect(()=>{const controller=new AbortController();scope.current=controller;locked.current=false;setBusy(false);return()=>controller.abort();},[visible]);
 async function launch(){
  if(!allowed.current||locked.current)return;locked.current=true;setBusy(true);setUncertain(true);setMessage(null);const controller=scope.current;
  try{
   const result=await accountTestPayment.dispatch(owner,paymentId,{signal:controller?.signal});
   if(!allowed.current||controller?.signal.aborted)return;
   if(result.confirmationUrl)window.location.assign(result.confirmationUrl);
   else{setUncertain(false);setMessage('Ссылка оплаты больше не требуется или недоступна. Проверьте статус этого заказа.');}
  }catch{if(allowed.current&&!controller?.signal.aborted)setMessage('Переход не подтверждён. Восстановите оплату этого же заказа — новый заказ не создаётся.');}
  finally{if(!controller?.signal.aborted){locked.current=false;setBusy(false);}}
 }
 return <section hidden={!visible} inert={!visible} aria-label="Переход в TEST-оплату" aria-busy={busy} className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
  <h3 className="font-semibold text-slate-950">Тестовая оплата</h3>
  <p className="mt-2 text-sm leading-6 text-slate-800">Только тестовые карты ЮKassa. Реальные деньги не списываются; объявление не публикуется. Статус обновляется сервером отдельно.</p>
  <button type="button" disabled={busy} onClick={()=>void launch()} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60">{busy?'Получаем ссылку…':uncertain?'Восстановить переход к оплате':'Перейти в ЮKassa (TEST)'}</button>
  {message&&<p role="alert" className="mt-3 text-sm leading-6 text-slate-800">{message}</p>}
 </section>;
}
