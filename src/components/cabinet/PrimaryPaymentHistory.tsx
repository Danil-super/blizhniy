"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {paymentHistory,PaymentHistoryClientError} from '@/lib/client-payment-history';
import type {PaymentHistoryCursor,PaymentHistoryPage,WorkPaymentReceipt} from '@/lib/payment-history-contract';

const targets={listing:{label:'Размещение объявления',href:'/cabinet/obyavleniya'},vacancy:{label:'Размещение вакансии',href:'/cabinet/vakansii'},workRequest:{label:'Размещение заказа',href:'/cabinet/zakazy'},specialist:{label:'Анкета специалиста',href:'/cabinet/specialist'},application:{label:'Отклик',href:'/cabinet/otkliki'},fair_application:{label:'Участие в ярмарке',href:'/cabinet/fair-applications'},ad_marquee:{label:'Бегущая строка',href:'/reklama/begushchaya-stroka?view=list'}};
const statuses={created:{label:'Ожидает оплаты',tone:'border-amber-200 bg-amber-50 text-amber-800'},pending:{label:'Обрабатывается',tone:'border-blue-200 bg-blue-50 text-blue-800'},succeeded:{label:'Оплачено',tone:'border-emerald-200 bg-emerald-50 text-emerald-800'},failed:{label:'Отменён',tone:'border-slate-200 bg-slate-50 text-slate-700'},refunded:{label:'Возвращён',tone:'border-violet-200 bg-violet-50 text-violet-800'}};
const button='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-60';
const money=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2});
const date=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});

export function PrimaryPaymentHistory({receipt}:{receipt?:WorkPaymentReceipt}={}){
 const auth=usePrimaryAccountAuth(),owner=auth&&(auth.state==='signed-in'||auth.state==='admin')?auth.userId:null;
 if(receipt&&auth?.state==='signed-out'){
  const returnTo='/oplata/'+encodeURIComponent(receipt.id)+'?type='+receipt.targetType;
  return <Link href={'/auth?returnTo='+encodeURIComponent(returnTo)} className={button}>Войти и посмотреть платёж</Link>;
 }
 return owner?<History key={receipt?`${owner}:${receipt.targetType}:${receipt.id}`:owner} owner={owner} receipt={receipt}/>:<p role="status">Проверяем доступ к платежам…</p>;
}
function History({owner,receipt}:{owner:string;receipt?:WorkPaymentReceipt}){
 const [page,setPage]=useState<PaymentHistoryPage|null>(null),[cursor,setCursor]=useState<PaymentHistoryCursor|null>(null);
 const [busy,setBusy]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setError('');
  void paymentHistory.list(owner,cursor,{signal:controller.signal,receipt}).then(next=>{
   if(!controller.signal.aborted)setPage(current=>({items:cursor?[...(current?.items??[]),...next.items]:next.items,nextCursor:next.nextCursor}));
  }).catch(error=>{
   if(controller.signal.aborted)return;
   setError(error instanceof PaymentHistoryClientError?error.message:'Не удалось загрузить историю платежей. Повторите загрузку.');
   if(error instanceof PaymentHistoryClientError&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);
  }).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[owner,cursor,retry,receipt]);
 return <section aria-label="История платежей" aria-busy={busy} className="mx-auto w-full max-w-3xl">
  <h2 className="text-xl font-bold text-slate-950">{receipt?targets[receipt.targetType].label:'История платежей'}</h2>
  <p className="mt-2 text-sm leading-6 text-slate-600">{receipt?'Здесь указан сохранённый результат оплаты. Текущий статус можно посмотреть в кабинете.':'Платежи за размещения и отклики. Продолжить оформление можно в соответствующем разделе кабинета.'}</p>
  {error&&<div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p>{error}</p><button type="button" className={`${button} mt-3`} disabled={busy} onClick={()=>setRetry(value=>value+1)}>Повторить загрузку</button></div>}
  {busy&&<p role="status" className="mt-4 text-sm text-slate-600">Загружаем платежи…</p>}
  {page?.items.length===0&&!error&&!busy&&<div className="mt-4 rounded-xl border border-slate-200 bg-white p-5"><p className="font-semibold text-slate-950">{receipt?'Платёж недоступен':'Платежей пока нет'}</p><p className="mt-2 text-sm text-slate-600">{receipt?'Проверьте ссылку и аккаунт, из которого оформляли заказ.':'Они появятся здесь после оформления размещения или отклика.'}</p>{receipt&&<Link className={`${button} mt-3`} href={targets[receipt.targetType].href}>Перейти в раздел</Link>}</div>}
  {page&&page.items.length>0&&<ul className="mt-4 grid gap-3">{page.items.map(item=>{
   const target=targets[item.targetType],status=statuses[item.status];
   return <li key={item.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold text-slate-950">{receipt?'Сумма платежа':target.label}</h3><p className="text-lg font-bold text-slate-950">{money.format(Number(item.amount))}</p></div>
    <div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>{item.isTest&&<span className="text-xs font-bold text-slate-600">TEST · без списания денег</span>}</div>
    <time dateTime={item.createdAt} className="mt-3 block text-sm text-slate-600">{date.format(new Date(item.createdAt))}</time>
    <p className="mt-1 break-all text-xs text-slate-500">Заказ {item.id}</p>
    <Link href={target.href} className={`${button} mt-3`}>Перейти в раздел</Link>
   </li>;
  })}</ul>}
  {page?.nextCursor&&!error&&<button type="button" className={`${button} mt-4`} disabled={busy} onClick={()=>setCursor(page.nextCursor)}>Показать ещё</button>}
 </section>;
}
