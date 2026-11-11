"use client";
import {useLocalPaymentSimulation} from '@/components/listings/ListingWorkflowProvider';
import {CheckoutCancellation} from './CheckoutCancellation';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {applicationPayment,ApplicationPaymentClientError} from '@/lib/client-application-payment';
import {notifyAccountSessionChange} from '@/lib/local-account';
import type {ApplicationPaymentSnapshot} from '@/lib/application-checkout-contract';
const button='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:text-slate-500';
function headline(snapshot:ApplicationPaymentSnapshot){const {order,deliveredAt,targetClosed}=snapshot;
 return order.status==='refunded'?'Платёж возвращён':order.status==='failed'?'Оплата не завершена':order.status==='succeeded'?deliveredAt?'Отклик доставлен':targetClosed?'Заказ закрыт, отклик не доставлен':'Оплата подтверждена, доставка ожидается':targetClosed?'Заказчик уже выбрал исполнителя':order.status==='pending'?'Платёж обрабатывается':'Заказ ожидает оплаты';
}
function Reader({owner,paymentId,visible,cancellationEnabled}:{owner:string;paymentId:string;visible:boolean;cancellationEnabled:boolean}){
 const [cancellationPending,setCancellationPending]=useState(false);
 const [snapshot,setSnapshot]=useState<ApplicationPaymentSnapshot|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
 const [launchBusy,setLaunchBusy]=useState(false),[launchError,setLaunchError]=useState<string|null>(null),[uncertain,setUncertain]=useState(false);
 const live=useRef(visible),launchScope=useRef<AbortController|null>(null),pending=useRef(false);live.current=visible;
 useEffect(()=>{const controller=new AbortController();launchScope.current=controller;return()=>controller.abort();},[owner,paymentId]);
 useEffect(()=>{
  if(!visible||cancellationPending)return;const controller=new AbortController();setBusy(true);setError(null);
  void applicationPayment.read(owner,paymentId,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setSnapshot(value);setLoaded(true);}}).catch(cause=>{
   if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Не удалось проверить заказ.');if(cause instanceof ApplicationPaymentClientError&&cause.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}
  }).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();
 },[owner,paymentId,visible,refresh,cancellationPending]);
 async function launch(){
  const controller=launchScope.current;if(cancellationPending||!live.current||pending.current||busy||error||!controller||controller.signal.aborted||!snapshot||snapshot.targetClosed||!['created','pending'].includes(snapshot.order.status))return;
  pending.current=true;setLaunchBusy(true);setLaunchError(null);setUncertain(true);
  try{const result=await applicationPayment.dispatch(owner,paymentId,{signal:controller.signal});if(controller.signal.aborted)return;
   if(result.confirmationUrl){if(live.current)window.location.assign(`/__local/payment?intent=${paymentId}&type=application`);}
   else{setUncertain(false);setLaunchError('Ссылка оплаты больше не требуется или недоступна. Проверьте статус этого же заказа.');}
  }catch(cause){if(!controller.signal.aborted){setLaunchError('Переход не подтверждён. Проверьте статус или восстановите переход для этого же заказа — новый не создаётся.');if(cause instanceof ApplicationPaymentClientError&&cause.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}}
  finally{if(!controller.signal.aborted){pending.current=false;setLaunchBusy(false);}}
 }
 return <div hidden={!visible} inert={!visible} aria-busy={busy||launchBusy} className="min-w-0">
  {busy&&<p role="status" className="mb-3 text-sm text-slate-700">Получаем статус TEST-заказа…</p>}
  {error&&<p role="alert" className="mb-3 break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  {snapshot&&<>
   {(busy||error)&&<p className="mb-3 text-sm text-slate-600">Последний полученный статус. Актуальность пока не подтверждена.</p>}
   <h2 className="text-xl font-bold text-slate-950">{headline(snapshot)}</h2>
   <dl className="mt-4 border-y border-slate-200 py-4 text-sm"><dt className="text-slate-600">Стоимость отклика</dt><dd className="mt-1 font-bold text-slate-950">{new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(snapshot.order.amount))} ₽</dd></dl>
   <p className="mt-3 text-sm text-slate-700">{snapshot.order.status==='refunded'?'Оплата возвращена. Учитывайте актуальный статус отклика в кабинете.':snapshot.order.status==='failed'?'Отклик не отправлен по этому платежу. Реальных списаний на локальном стенде нет.':snapshot.order.status==='succeeded'?snapshot.deliveredAt?'Доставка подтверждена сервером. Отклик доступен получателю на локальном стенде.':snapshot.targetClosed?'Оплата подтверждена, но заказчик уже выбрал исполнителя. Отклик не доставлен; возврат не выполнен. История платежа сохранена. Реальных списаний на локальном стенде нет.':'Не создавайте повторный платёж. Проверьте этот заказ позже: подтверждения доставки ещё нет.':snapshot.targetClosed?'Новая оплата недоступна: заказ закрыт. История этого платежа сохранена.':'После успешной симуляции сервер доставит отклик владельцу публикации. Реальных списаний нет.'}</p>
   {!busy&&!error&&!snapshot.targetClosed&&['created','pending'].includes(snapshot.order.status)&&<section aria-label="Локальная TEST-оплата" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"><h3 className="font-semibold text-slate-950">Локальная TEST-оплата</h3><p className="mt-2 text-sm text-slate-800">Симулятор успеха, отмены и ожидания. Без перехода в банк и без реальных денег.</p>
    <button type="button" className={`${button} mt-3`} disabled={launchBusy||cancellationPending} onClick={()=>void launch()}>{launchBusy?'Получаем переход…':uncertain?'Восстановить локальную TEST-оплату':'Открыть локальную TEST-оплату'}</button>
    {launchError&&<p role="alert" className="mt-3 break-words text-sm text-slate-800">{launchError}</p>}
   </section>}
  </>}
  {cancellationEnabled&&snapshot?.order.status==='created'&&!busy&&!error&&<CheckoutCancellation owner={owner} paymentId={paymentId} targetType="application" visible={visible} onPendingChange={setCancellationPending} onCancelled={()=>{setSnapshot(null);setLoaded(false);setRefresh(value=>value+1);}}/>}
  {loaded&&!snapshot&&!error&&!busy&&<p role="status" className="text-sm text-slate-700">TEST-заказ недоступен. Проверьте ссылку и аккаунт, из которого оформляли оплату.</p>}
  <div className="mt-5 flex flex-wrap gap-2"><button type="button" className={button} disabled={busy||launchBusy||cancellationPending} onClick={()=>{if(live.current)setRefresh(value=>value+1);}}>Проверить статус</button><Link href="/cabinet/otkliki" className={button}>Мои отклики</Link></div>
 </div>;
}
export function ApplicationPaymentReturnClient({paymentId,cancellationEnabled=false}:{paymentId:string;cancellationEnabled?:boolean}){
 const simulation=useLocalPaymentSimulation();
 const auth=usePrimaryAccountAuth(),owner=auth&&(auth.state==='signed-in'||auth.state==='admin')?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);const visible=!!owner&&owner===scope;
 return <main className="page-container flex min-h-[70vh] items-center justify-center py-8"><section aria-label="Оплата отклика" className="w-full min-w-0 max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
  <h1 className="mb-4 text-2xl font-bold text-slate-950">Оплата отклика</h1>
  {!simulation&&<p role="status" className="text-sm text-slate-700">TEST-оплата откликов на этом сайте пока не включена.</p>}
  {!visible&&<div role="status" className="text-sm text-slate-700">{auth?.state==='signed-out'?<><p>Войдите в аккаунт, из которого оформляли TEST-заказ.</p><Link className={`${button} mt-3`} href={`/auth?returnTo=${encodeURIComponent(`/oplata/${paymentId}?type=application`)}`}>Войти и проверить оплату</Link></>:<><p>Проверяем доступ. Данные заказа временно скрыты.</p>{(!auth||auth.state==='unavailable')&&<button type="button" className={`${button} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</>}</div>}
  {scope&&simulation&&<Reader key={`${scope}:${paymentId}`} owner={scope} paymentId={paymentId} visible={visible} cancellationEnabled={cancellationEnabled}/>}
 </section></main>;
}
