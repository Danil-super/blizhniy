"use client";
import {useEffect,useRef,useState} from 'react';
import {accountTestPayment} from '@/lib/client-account-test-payment';
import {specialistPayment} from '@/lib/client-specialist-payment';
import {useLocalPaymentSimulation} from '@/components/listings/ListingWorkflowProvider';
import {vacancyPayment,workRequestPayment} from '@/lib/client-vacancy-payment';
export function TestPaymentLaunch({owner,paymentId,visible,vacancy=false,workRequest=false,specialist=false,disabled=false,publishes=false}:{owner:string;paymentId:string;visible:boolean;vacancy?:boolean;workRequest?:boolean;specialist?:boolean;disabled?:boolean;publishes?:boolean}){
 const localPreview=useLocalPaymentSimulation();
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState<string|null>(null);
 const allowed=useRef(visible),locked=useRef(false),scope=useRef<AbortController|null>(null);allowed.current=visible;
 useEffect(()=>{const controller=new AbortController();scope.current=controller;locked.current=false;setBusy(false);return()=>controller.abort();},[visible]);
 async function launch(){
  if(disabled||!allowed.current||locked.current)return;locked.current=true;setBusy(true);setUncertain(true);setMessage(null);const controller=scope.current;
  try{
   const result=await (specialist?specialistPayment:workRequest?workRequestPayment:vacancy?vacancyPayment:accountTestPayment).dispatch(owner,paymentId,{signal:controller?.signal});
   if(!allowed.current||controller?.signal.aborted)return;
   if(result.confirmationUrl)window.location.assign(localPreview?`/__local/payment?intent=${paymentId}${specialist?'&type=specialist':workRequest?'&type=workRequest':vacancy?'&type=vacancy':''}`:result.confirmationUrl);
   else{setUncertain(false);setMessage('Ссылка оплаты больше не требуется или недоступна. Проверьте статус этого заказа.');}
  }catch{if(allowed.current&&!controller?.signal.aborted)setMessage('Переход не подтверждён. Восстановите оплату этого же заказа — новый заказ не создаётся.');}
  finally{if(!controller?.signal.aborted){locked.current=false;setBusy(false);}}
 }
 return <section hidden={!visible} inert={!visible} aria-label="Переход в TEST-оплату" aria-busy={busy} className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
  <h3 className="font-semibold text-slate-950">{localPreview?'Локальная проверка оплаты':'Тестовая оплата'}</h3>
  <p className="mt-2 text-sm leading-6 text-slate-800">{localPreview?'Никаких списаний и перехода в банк. В симуляторе можно проверить успех, отмену и ожидание. Успешная оплата публикует объявление только локально.':publishes?'Только тестовые карты ЮKassa, без списания денег. Тестовое размещение появится после серверного подтверждения оплаты.':'Только тестовые карты ЮKassa. Реальные деньги не списываются; объявление не публикуется. Статус обновляется сервером отдельно.'}</p>
  <button type="button" disabled={busy||disabled} onClick={()=>void launch()} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60">{busy?'Получаем ссылку…':uncertain?'Восстановить переход к оплате':localPreview?'Открыть локальный симулятор':'Перейти в ЮKassa (TEST)'}</button>
  {message&&<p role="alert" className="mt-3 text-sm leading-6 text-slate-800">{message}</p>}
 </section>;
}
