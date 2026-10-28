"use client";
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {applicationPayment,applicationPaymentMatchesInput,ApplicationPaymentClientError} from '@/lib/client-application-payment';
import {notifyAccountSessionChange} from '@/lib/local-account';
import type {ApplicationCheckoutInput,ApplicationPaymentOrder} from '@/lib/application-checkout-contract';
import {applicationButton} from './ApplicationDetail';

type Attempt={input:ApplicationCheckoutInput;phase:'unknown'|'retry'};
type Props={owner:string;id:string;revision:string;disabled?:boolean;onLockChange?:(locked:boolean)=>void;autoStart?:boolean};
function CheckoutWorkspace({owner,id,revision,disabled=false,onLockChange,autoStart=false}:Props){
 const auth=usePrimaryAccountAuth(),visible=!!auth&&(auth.state==='signed-in'||auth.state==='admin')&&auth.userId===owner;
 const [busy,setBusy]=useState(false),[attempt,setAttempt]=useState<Attempt|null>(null),[saved,setSaved]=useState<ApplicationPaymentOrder|null>(null),[error,setError]=useState<string|null>(null);
 const live=useRef(visible),pending=useRef(false),scope=useRef<AbortController|null>(null),intent=useRef<Attempt|null>(null),notify=useRef(onLockChange);
 live.current=visible;notify.current=onLockChange;
 useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>controller.abort();},[owner,id]);
 function remember(value:Attempt|null){intent.current=value;setAttempt(value);}
 async function run(work:(signal:AbortSignal)=>Promise<void>){
  const controller=scope.current;if(!live.current||pending.current||!controller||controller.signal.aborted)return;pending.current=true;setBusy(true);setError(null);notify.current?.(true);
  try{await work(controller.signal);}catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Не удалось подтвердить TEST-заказ.');if(cause instanceof ApplicationPaymentClientError&&cause.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}}
  finally{if(!controller.signal.aborted){pending.current=false;setBusy(false);notify.current?.(!!intent.current);}}
 }
 function open(order:ApplicationPaymentOrder,signal:AbortSignal){if(signal.aborted)return;setSaved(order);remember(null);if(live.current)window.location.assign(`/oplata/${order.id}?type=application`);}
 async function prepare(input:ApplicationCheckoutInput,signal:AbortSignal,repeating=false){
  remember({input,phase:'unknown'});
  try{const order=await applicationPayment.prepare(owner,input,{signal});if(!signal.aborted)open(order,signal);}
  catch(cause){if(!signal.aborted&&!repeating&&cause instanceof ApplicationPaymentClientError&&cause.code!=='UNKNOWN')remember(null);throw cause;}
 }
 function start(){if(disabled||intent.current)return;void run(async signal=>{
  if(saved){open(saved,signal);return;}
  const quote=await applicationPayment.preview(owner,id,revision,{signal});if(signal.aborted||!live.current)return;
  if(quote.activePayment){open(quote.activePayment,signal);return;}
  await prepare({applicationId:id,expectedRevision:revision,creationKey:crypto.randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount},signal);
 });}
  function recover(){const original=intent.current;if(original?.phase!=='unknown')return;void run(async signal=>{
  const order=await applicationPayment.recover(owner,original.input.creationKey,{signal});if(signal.aborted)return;
  if(order){if(!applicationPaymentMatchesInput(order,original.input))throw new ApplicationPaymentClientError('UNKNOWN');open(order,signal);}
  else{remember({...original,phase:'retry'});setError('Заказ пока не найден. Можно повторить только этот TEST-заказ с прежними условиями и ключом.');}
  });}
  const startCurrent=useRef(start),started=useRef(false);startCurrent.current=start;
  useEffect(()=>{
   if(!autoStart||!visible||disabled||started.current)return;
   // A canceled mount (including StrictMode's probe) must not consume the click.
   const timer=setTimeout(()=>{if(!live.current||started.current)return;started.current=true;startCurrent.current();},0);
   return()=>clearTimeout(timer);
  },[autoStart,visible,disabled]);
 return <section hidden={!visible} inert={!visible} aria-label="Локальная TEST-оплата отклика" aria-busy={busy} className="mt-4 min-w-0 rounded-lg border border-amber-300 bg-amber-50 p-4">
  <h3 className="font-semibold text-slate-950">Локальная TEST-оплата отклика</h3>
  <p className="mt-2 text-sm text-slate-800">Без реальных списаний и перехода в банк. Сумму проверим по тарифу; после успешной симуляции отклик получит владелец публикации только на локальном стенде.</p>
  {!attempt&&<button type="button" className={`${applicationButton} mt-3`} disabled={busy||disabled} onClick={start}>{saved?'Открыть существующий заказ':'Оплатить отклик (локальная TEST)'}</button>}
  {attempt?.phase==='unknown'&&<div className="mt-3"><p className="text-sm text-slate-800">Результат создания заказа неизвестен. Не создавайте новый: сначала проверьте сохранённый.</p><button type="button" className={`${applicationButton} mt-3`} disabled={busy} onClick={recover}>Проверить сохранённый заказ</button></div>}
  {attempt?.phase==='retry'&&<button type="button" className={`${applicationButton} mt-3`} disabled={busy} onClick={()=>{const original=intent.current;if(original?.phase==='retry')void run(signal=>prepare(original.input,signal,true));}}>Повторить тот же TEST-заказ</button>}
  {busy&&<p role="status" className="mt-3 text-sm text-slate-700">Проверяем TEST-заказ…</p>}
  {error&&<p role="alert" className="mt-3 break-words text-sm text-rose-800">{error}</p>}
 </section>;
}
export function ApplicationCheckout(props:Props){return <CheckoutWorkspace key={`${props.owner}:${props.id}`} {...props}/>;}
