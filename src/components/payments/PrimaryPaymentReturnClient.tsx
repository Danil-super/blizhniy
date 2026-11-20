"use client";
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useState} from 'react';
import {useLocalPaymentSimulation} from '@/components/listings/ListingWorkflowProvider';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {listingPayment,ListingPaymentClientError} from '@/lib/client-listing-payment';
import {notifyAccountSessionChange} from '@/lib/local-account';
import type {ListingPaymentSnapshot} from '@/lib/postgres-listing-checkout';
import {ListingPaymentStatus} from './ListingPaymentStatus';
import {TestPaymentLaunch} from './TestPaymentLaunch';
import {vacancyPaymentStatus,workRequestPaymentStatus} from '@/lib/client-vacancy-payment';
import {CheckoutCancellation} from './CheckoutCancellation';
import {specialistPaymentStatus} from '@/lib/client-specialist-payment';
import {PhonePaymentNotice} from '@/components/phone/PhonePaymentNotice';

const button='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60';
// Keep early confirmation fast and cover the worker's 30s and 60s retry intervals.
const statusCheckDelaysMs = [2000, 2000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000];

function StatusReader({owner,paymentId,visible,testCheckout,vacancy,workRequest,specialist,cancellationEnabled}:{owner:string;paymentId:string;visible:boolean;testCheckout:boolean;vacancy:boolean;workRequest:boolean;specialist:boolean;cancellationEnabled:boolean}){
 const router=useRouter(),cabinet=specialist?'/cabinet/specialist':workRequest?'/cabinet/zakazy':vacancy?'/cabinet/vakansii':'/cabinet/obyavleniya';
 const [automaticChecks,setAutomaticChecks]=useState(0);
 const [cancellationPending,setCancellationPending]=useState(false);
 const [snapshot,setSnapshot]=useState<ListingPaymentSnapshot|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!visible||cancellationPending)return;
  const controller=new AbortController();setBusy(true);setError(null);
  void (specialist?specialistPaymentStatus:workRequest?workRequestPaymentStatus:vacancy?vacancyPaymentStatus:listingPayment).read(owner,paymentId,{signal:controller.signal}).then(value=>{
   if(!controller.signal.aborted){setSnapshot(value);setLoaded(true);}
  }).catch(error=>{
   if(controller.signal.aborted)return;setError(error instanceof Error?error.message:'Не удалось проверить платёж.');
   if(error instanceof ListingPaymentClientError&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);
  }).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[owner,paymentId,visible,retry,vacancy,workRequest,specialist,cancellationPending]);
 const localSimulation=useLocalPaymentSimulation(),account=usePrimaryAccountAuth();
 const hostedSpecialist=specialist&&account?.userId===owner&&account?.specialistTest===true&&snapshot?.canResumeSpecialist===true;
 const verificationOnly=!!snapshot&&(snapshot.testOnly||testCheckout)&&!snapshot.testPublication&&!localSimulation;
 const confirmed=!!snapshot&&snapshot.order.status==='succeeded'&&(verificationOnly||!!snapshot.fulfillment);
 const terminal=confirmed||snapshot?.order.status==='failed'||snapshot?.order.status==='refunded';
 useEffect(()=>{
  if(!visible||busy||error||cancellationPending||!snapshot)return;
  if(confirmed){const timer=setTimeout(()=>router.replace(cabinet),2000);return()=>clearTimeout(timer);}
  if(!terminal&&automaticChecks<statusCheckDelaysMs.length){
   const timer=setTimeout(()=>{setAutomaticChecks(value=>value+1);setRetry(value=>value+1);},statusCheckDelaysMs[automaticChecks]);
   return()=>clearTimeout(timer);
  }
 },[visible,busy,error,cancellationPending,snapshot,confirmed,terminal,router,cabinet,automaticChecks]);
 return <div hidden={!visible} inert={!visible} aria-busy={busy} className="min-w-0">
  {busy&&<p role="status" className="mb-4 text-sm text-slate-700">Получаем статус заказа…</p>}
  {error&&<p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800">{error}</p>}
  {snapshot&&<>{(localSimulation||snapshot.testOnly||snapshot.testPublication)&&<p className="mb-3 text-sm font-semibold text-amber-800">Тестовый платёж · Без списания денег</p>}{(error||busy)&&<p className="mb-3 text-sm text-slate-700">Последний полученный статус. Актуальность пока не подтверждена.</p>}<ListingPaymentStatus checkingAutomatically={visible&&!error&&!cancellationPending&&(busy||automaticChecks<statusCheckDelaysMs.length)} snapshot={snapshot} testMode={verificationOnly} target={specialist?'specialist':workRequest?'workRequest':vacancy?'vacancy':'listing'}/></>}
  {(testCheckout||hostedSpecialist)&&snapshot&&(snapshot.order.status==='created'||snapshot.order.status==='pending')&&<TestPaymentLaunch publishes={snapshot.testPublication} disabled={cancellationPending||busy||!!error} owner={owner} paymentId={paymentId} visible={visible} vacancy={vacancy} workRequest={workRequest} specialist={specialist}/>}
  {cancellationEnabled&&!specialist&&snapshot?.order.status==='created'&&!busy&&!error&&<CheckoutCancellation owner={owner} paymentId={paymentId} targetType={workRequest?'workRequest':vacancy?'vacancy':'listing'} visible={visible} onPendingChange={setCancellationPending} onCancelled={()=>{setSnapshot(null);setLoaded(false);setRetry(value=>value+1);}}/>}
  {snapshot?.order.status==='succeeded'&&!verificationOnly&&!snapshot.fulfillment&&<PhonePaymentNotice owner={owner} onVerified={()=>setRetry(value=>value+1)}/>}
  {loaded&&!snapshot&&!error&&!busy&&<p role="status" className="text-sm leading-6 text-slate-700">Платёж недоступен. Проверьте ссылку и убедитесь, что вошли в аккаунт, из которого оформляли заказ.</p>}
  {confirmed&&!error&&<p role="status" className="mt-4 text-sm text-slate-600">Возвращаем в личный кабинет…</p>}
  <div className="mt-5 flex flex-wrap gap-3">{(!confirmed||error)&&<button type="button" className={button} disabled={busy||cancellationPending} onClick={()=>{setAutomaticChecks(0);setRetry(value=>value+1);}}>Проверить статус</button>}<Link href={cabinet} className={button}>{confirmed?'Вернуться на сайт':specialist?'Моя анкета':workRequest?'Мои заказы':vacancy?'Мои вакансии':'Мои объявления'}</Link></div>
 </div>;
}
export function PrimaryPaymentReturnClient({paymentId,testCheckout=false,vacancy=false,workRequest=false,specialist=false,cancellationEnabled=false}:{paymentId:string;testCheckout?:boolean;vacancy?:boolean;workRequest?:boolean;specialist?:boolean;cancellationEnabled?:boolean}){
 const auth=usePrimaryAccountAuth(),owner=auth&&(auth.state==='signed-in'||auth.state==='admin')?auth.userId:null;
 const [scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);
 const visible=!!owner&&scope===owner;
 return <main className="page-container flex min-h-[70vh] items-center justify-center py-8">
  <section aria-label="Статус оплаты" className="w-full min-w-0 max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
   <h1 className="mb-4 text-2xl font-bold text-slate-950">Оплата размещения</h1>
   {!visible&&<div role="status" className="text-sm leading-6 text-slate-700">{auth?.state==='signed-out'?<><p>Войдите в аккаунт, из которого оформляли заказ.</p><Link className={`${button} mt-4`} href={`/auth?returnTo=${encodeURIComponent(`/oplata/${paymentId}${specialist?'?type=specialist':workRequest?'?type=workRequest':vacancy?'?type=vacancy':''}`)}`}>Войти и проверить оплату</Link></>:<><p>Проверяем доступ. Данные заказа временно скрыты.</p>{(!auth||auth.state==='unavailable')&&<button type="button" className={`${button} mt-4`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</>}</div>}
   {scope&&<StatusReader key={`${scope}:${paymentId}:${vacancy}:${workRequest}:${specialist}`} owner={scope} paymentId={paymentId} visible={visible} cancellationEnabled={cancellationEnabled} testCheckout={testCheckout} vacancy={vacancy} workRequest={workRequest} specialist={specialist}/>}
  </section>
 </main>;
}
