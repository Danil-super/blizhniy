"use client";
import {ensurePhoneForPlacement} from '@/lib/phone-placement';
import {PhoneClientError} from '@/lib/client-phone-verification';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {accountTestPayment} from '@/lib/client-account-test-payment';
import {ListingPaymentClientError} from '@/lib/client-listing-payment';
import {startListingPayment,type ListingCheckoutAttempt} from '@/lib/listing-payment-start';
import {draftButton} from './PrivateDraftEditor';

export type {ListingCheckoutAttempt} from '@/lib/listing-payment-start';
export function PrivateListingCheckout({owner,id,revision,attempt,localPreview=false}:{owner:string;id:string;revision:string;attempt:ListingCheckoutAttempt;localPreview?:boolean}){
 const auth=usePrimaryAccountAuth(),visible=!!auth&&(auth.state==='signed-in'||auth.state==='admin')&&auth.userId===owner;
 const [quote,setQuote]=useState<Awaited<ReturnType<typeof accountTestPayment.preview>>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[uncertain,setUncertain]=useState(attempt.uncertain);
 const locked=useRef(false),live=useRef(visible),scope=useRef<AbortController|null>(null);
 live.current=visible;
 useEffect(()=>{const controller=new AbortController();scope.current=controller;locked.current=false;setBusy(false);return()=>controller.abort();},[visible]);
 async function run(work:(options:{signal?:AbortSignal})=>Promise<void>){
  if(!live.current||locked.current)return;locked.current=true;setBusy(true);setError(null);const controller=scope.current;
  try{await work({signal:controller?.signal});}catch(failure){if(live.current&&!controller?.signal.aborted){
   if(failure instanceof PhoneClientError){setError(failure.message);return;}
   const code=failure instanceof ListingPaymentClientError?failure.code:'UNKNOWN';
   setError(code==='PHONE_REQUIRED'?'Подтвердите номер телефона, чтобы перейти к оплате размещения.':code==='CHECKOUT_DISABLED'||code==='CHECKOUT_NOT_READY'?localPreview?'Объявление пока не готово к оплате: проверьте обязательные поля и статус блокировки.':'TEST-оплата доступна только согласованному тестовому аккаунту. Для остальных оплата ещё не включена.':code==='CHECKOUT_CHANGED'||code==='DRAFT_CHANGED'?'Объявление или тариф изменились. Обновите сохранённую версию.':'Не удалось подтвердить результат. Не создавайте новый заказ: проверьте сохранённый.');
  }}finally{if(!controller?.signal.aborted){locked.current=false;setBusy(false);}}
 }
 function open(paymentId:string,signal?:AbortSignal){if(live.current&&!signal?.aborted)window.location.assign(`/oplata/${paymentId}`);}
 return <section aria-label="Оплата объявления" hidden={!visible} inert={!visible} aria-busy={busy} className="mt-4 min-w-0 border-t border-slate-200 pt-4">
  {!quote&&!uncertain&&<button type="button" className={draftButton} disabled={busy} onClick={()=>void run(async options=>{
   if(localPreview){await ensurePhoneForPlacement(owner);try{open(await startListingPayment(accountTestPayment,owner,id,revision,attempt,options),options.signal);}finally{if(live.current&&!options.signal?.aborted)setUncertain(attempt.uncertain);}}
   else{const value=await accountTestPayment.preview(owner,id,revision,options);if(live.current&&!options.signal?.aborted)setQuote(value);}
  })}>Оплатить размещение</button>}
  {quote&&<>
   <h3 className="font-semibold">{localPreview?'Оплата размещения — локальный стенд':'Тестирование оплаты'}</h3>
   <p className="mt-2 text-sm">{localPreview?`Симуляция: ${quote.tariff.amount.replace('.',',')} ₽ за ${quote.tariff.durationDays} дн. После подтверждения объявление опубликуется только на этом локальном стенде. Списаний нет.`:`TEST-заказ: ${quote.tariff.amount.replace('.',',')} ₽ за ${quote.tariff.durationDays} дн. Реальные деньги не списываются, публикация не выполняется.`}</p>
   {quote.activePayment?<Link href={`/oplata/${quote.activePayment.id}`} className={`${draftButton} mt-3`}>Открыть существующий заказ</Link>:<>
    <button type="button" className={`${draftButton} mt-3 bg-blue-700 text-white`} disabled={busy||uncertain} onClick={()=>void run(async options=>{
     attempt.input??={listingId:id,expectedRevision:revision,creationKey:crypto.randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays};
     await ensurePhoneForPlacement(owner);attempt.uncertain=true;setUncertain(true);const order=await accountTestPayment.prepare(owner,attempt.input,options);if(!options.signal?.aborted){attempt.uncertain=false;attempt.input=null;setUncertain(false);open(order.id,options.signal);}
    })}>{localPreview?'Перейти к локальной оплате':'Создать TEST-заказ'}</button>
   </>}
  </>}
  {uncertain&&<div className="mt-3"><p className="text-sm">Результат сохранения ещё не подтверждён. Сначала проверьте этот заказ.</p><button type="button" className={`${draftButton} mt-2`} disabled={busy} onClick={()=>void run(async options=>{
   if(!attempt.input)return;const saved=await accountTestPayment.recover(owner,attempt.input.creationKey,options);
   if(saved){attempt.uncertain=false;attempt.input=null;open(saved.id,options.signal);}else if(live.current&&!options.signal?.aborted){attempt.uncertain=false;setUncertain(false);setError('Заказ пока не найден. Проверьте предложение и повторите сохранение с тем же исходным ключом.');}
  })}>Проверить сохранённый заказ</button></div>}
  {busy&&<p role="status" className="mt-3 text-sm">Проверяем заказ…</p>}
  {error&&<p role="alert" className="mt-3 break-words text-sm text-rose-800">{error}</p>}
 </section>;
}
