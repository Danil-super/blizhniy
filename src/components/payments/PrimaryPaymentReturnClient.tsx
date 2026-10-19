"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {listingPayment,ListingPaymentClientError} from '@/lib/client-listing-payment';
import {notifyAccountSessionChange} from '@/lib/local-account';
import type {ListingPaymentSnapshot} from '@/lib/postgres-listing-checkout';
import {ListingPaymentStatus} from './ListingPaymentStatus';

const button='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60';
function StatusReader({owner,paymentId,visible}:{owner:string;paymentId:string;visible:boolean}){
 const [snapshot,setSnapshot]=useState<ListingPaymentSnapshot|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!visible)return;
  const controller=new AbortController();setBusy(true);setError(null);
  void listingPayment.read(owner,paymentId,{signal:controller.signal}).then(value=>{
   if(!controller.signal.aborted){setSnapshot(value);setLoaded(true);}
  }).catch(error=>{
   if(controller.signal.aborted)return;setError(error instanceof Error?error.message:'Не удалось проверить платёж.');
   if(error instanceof ListingPaymentClientError&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);
  }).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[owner,paymentId,visible,retry]);
 return <div hidden={!visible} inert={!visible} aria-busy={busy} className="min-w-0">
  {busy&&<p role="status" className="mb-4 text-sm text-slate-700">Получаем статус заказа…</p>}
  {error&&<p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800">{error}</p>}
  {snapshot&&<>{(error||busy)&&<p className="mb-3 text-sm text-slate-700">Последний полученный статус. Актуальность пока не подтверждена.</p>}<ListingPaymentStatus snapshot={snapshot}/></>}
  {loaded&&!snapshot&&!error&&!busy&&<p role="status" className="text-sm leading-6 text-slate-700">Платёж недоступен. Проверьте ссылку и убедитесь, что вошли в аккаунт, из которого оформляли заказ.</p>}
  <div className="mt-5 flex flex-wrap gap-3"><button type="button" className={button} disabled={busy} onClick={()=>setRetry(value=>value+1)}>Проверить статус</button><Link href="/cabinet/obyavleniya" className={button}>Мои объявления</Link></div>
 </div>;
}
export function PrimaryPaymentReturnClient({paymentId}:{paymentId:string}){
 const auth=usePrimaryAccountAuth(),owner=auth&&(auth.state==='signed-in'||auth.state==='admin')?auth.userId:null;
 const [scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);
 const visible=!!owner&&scope===owner;
 return <main className="page-container flex min-h-[70vh] items-center justify-center py-8">
  <section aria-label="Статус оплаты" className="w-full min-w-0 max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
   <h1 className="mb-4 text-2xl font-bold text-slate-950">Оплата размещения</h1>
   {!visible&&<div role="status" className="text-sm leading-6 text-slate-700">{auth?.state==='signed-out'?<><p>Войдите в аккаунт, из которого оформляли заказ.</p><Link className={`${button} mt-4`} href={`/auth?returnTo=${encodeURIComponent(`/oplata/${paymentId}`)}`}>Войти и проверить оплату</Link></>:<><p>Проверяем доступ. Данные заказа временно скрыты.</p>{(!auth||auth.state==='unavailable')&&<button type="button" className={`${button} mt-4`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</>}</div>}
   {scope&&<StatusReader key={`${scope}:${paymentId}`} owner={scope} paymentId={paymentId} visible={visible}/>}
  </section>
 </main>;
}
