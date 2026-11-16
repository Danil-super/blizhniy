'use client';
import Link from 'next/link';
import {CheckoutCancellation} from './CheckoutCancellation';
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {serviceCheckout,type ServiceQuote} from '@/lib/client-service-checkout';
import type {PaidServiceKind} from '@/lib/service-checkout-contract';
import type {ServicePaymentSnapshot} from '@/lib/postgres-service-checkout';
import {parseListingDraftId} from '@/lib/listing-draft-contract';
import {ensurePhoneForPlacement} from '@/lib/phone-placement';
const button='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-blue-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';
const money=(value:string)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(value));
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeZone:'Europe/Moscow'}).format(new Date(value));
const returnPath=(kind:PaidServiceKind)=>kind==='fair'?'/cabinet/fair-applications':'/reklama/begushchaya-stroka?view=list';
type Props={kind:PaidServiceKind;publicationId?:string;revision?:string;paymentId?:string};
function Workspace({owner,visible,...props}:Props&{owner:string;visible:boolean}){
 const {kind,publicationId,revision,paymentId}=props,[quote,setQuote]=useState<ServiceQuote|null>(null),[snapshot,setSnapshot]=useState<ServicePaymentSnapshot|null>(null),[busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[ready,setReady]=useState(false),[cancelPending,setCancelPending]=useState(false);
 const key=useRef<string|null>(null),working=useRef(false),scope=useRef<AbortController|null>(null),live=useRef(visible);live.current=visible;
 useEffect(()=>{try{if(!paymentId&&window.location.hash){if(!/^#checkout=[a-f0-9-]{36}$/.test(window.location.hash))throw Error();key.current=parseListingDraftId(window.location.hash.slice(10));setPending(true);}setReady(true);}catch{setError('Сохранённая попытка повреждена. Проверьте историю оплат в кабинете.');}},[paymentId]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;working.current=false;setBusy(false);return()=>controller.abort();},[visible]);
 useEffect(()=>{
  const controller=new AbortController();if(ready&&visible&&!pending){setBusy(true);setError('');
   const work=paymentId?serviceCheckout.order(kind,owner,paymentId,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setSnapshot(value);}):serviceCheckout.preview(kind,owner,publicationId!,revision!,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setQuote(value);});
   void work.catch(()=>{if(!controller.signal.aborted)setError('Не удалось проверить размещение. Проверьте телефон, одобрение и сохранённую оплату.');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  }return()=>controller.abort();
 },[kind,owner,publicationId,revision,paymentId,ready,visible,pending,retry]);
 function open(id:string,signal:AbortSignal){if(live.current&&!signal.aborted)window.location.assign(`/oplata/uslugi/${id}?type=${kind}`);}
 async function perform(action:'prepare'|'recover'|'dispatch'){
  const controller=scope.current;if(!visible||!ready||working.current||!controller||controller.signal.aborted)return;
  working.current=true;setBusy(true);setError('');
  try{
   if(action==='recover'){
    if(!key.current)throw Error();const saved=await serviceCheckout.recover(kind,owner,key.current,{signal:controller.signal});
    if(saved){if(saved.targetId!==publicationId||saved.targetRevision!==revision)throw Error();open(saved.id,controller.signal);}
    else if(live.current&&!controller.signal.aborted)setPending(false);
   }else if(action==='dispatch'){
    if(!paymentId||snapshot?.order.status!=='created'&&snapshot?.order.status!=='pending')throw Error();
    await serviceCheckout.dispatch(kind,owner,paymentId,{signal:controller.signal});if(live.current&&!controller.signal.aborted)window.location.assign(`/__local/payment?intent=${paymentId}&type=${kind}`);
   }else{
    if(!quote||pending||!publicationId||!revision)return;if(quote.activePayment){open(quote.activePayment.id,controller.signal);return;}
    await ensurePhoneForPlacement(owner);if(!live.current||controller.signal.aborted)return;
    key.current??=crypto.randomUUID();window.history.replaceState(null,'',window.location.pathname+window.location.search+'#checkout='+key.current);if(window.location.hash!=='#checkout='+key.current)throw Error();
    setPending(true);const order=await serviceCheckout.prepare(kind,owner,{publicationId,expectedRevision:revision,creationKey:key.current,expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays,expectedFairDate:quote.fairEvent?.date??null},{signal:controller.signal});open(order.id,controller.signal);
   }
  }catch{if(live.current&&!controller.signal.aborted)setError('Результат не подтверждён. Проверьте начатую оплату перед повтором.');}
  finally{if(scope.current===controller){working.current=false;if(!controller.signal.aborted)setBusy(false);}}
 }
 const order=snapshot?.order,event=quote?.fairEvent??order?.fairEvent,amount=quote?.tariff.amount??order?.amount;
 return <div hidden={!visible} inert={!visible} aria-busy={busy}>
  {amount&&<p className="text-2xl font-bold text-slate-950">{money(amount)}</p>}
  {event?<p className="mt-3 text-sm leading-6 text-slate-700">Ярмарка {date(event.date+'T12:00:00+03:00')}. Карточка участника действует до конца этого дня.</p>:<p className="mt-3 text-sm leading-6 text-slate-700">Реклама на {quote?.tariff.durationDays??order?.durationDays??'…'} дн. Если все пять мест заняты, заявка будет ждать в очереди. Оплаченный срок начнётся после появления места.</p>}
  {order&&<p role="status" className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 font-semibold">{order.status==='refunded'?'Плата возвращена':order.status==='failed'?'Оплата отменена':order.status==='succeeded'?snapshot.fulfillment?'Размещение выполнено':snapshot.eventEnded?'Ярмарка завершилась. Размещение не началось; обратитесь к администратору за возвратом.':'Оплата подтверждена. '+(kind==='marquee'?'Ожидаем место или проверку размещения.':'Проверяем размещение для выбранной ярмарки.'):'Ожидает оплаты'}</p>}
  {order?.status==='created'&&snapshot?.eventEnded&&<p role="status" className="mt-3 text-sm text-slate-700">Эта ярмарка уже завершилась. Отмените подготовку оплаты и оформите заявку на новое событие.</p>}
  {pending&&<p role="status" className="mt-3 text-sm text-slate-700">Сначала проверим начатую оплату. Новый заказ не создаётся.</p>}
  {error&&<p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
  <p className="mt-4 text-sm text-slate-600">Локальная симуляция. Настоящие деньги не списываются.</p>
  <div className="mt-5 flex flex-wrap gap-2">
   {pending?<button type="button" className={button} disabled={busy} onClick={()=>void perform('recover')}>Проверить начатую оплату</button>:paymentId?<>{order&&['created','pending'].includes(order.status)&&!(order.status==='created'&&snapshot?.eventEnded)&&<button type="button" className={button} disabled={busy||cancelPending} onClick={()=>void perform('dispatch')}>Открыть локальный симулятор</button>}<button type="button" className={button} disabled={busy} onClick={()=>setRetry(n=>n+1)}>Проверить статус</button></>:quote?<button type="button" className={button} disabled={busy} onClick={()=>void perform('prepare')}>{quote.activePayment?'Открыть начатую оплату':'Перейти к оплате'}</button>:<button type="button" className={button} disabled={busy||!ready} onClick={()=>setRetry(n=>n+1)}>Проверить условия</button>}
   <Link href={returnPath(kind)} className={button}>Мои публикации</Link>
  </div>
  {paymentId&&order?.status==='created'&&<CheckoutCancellation service owner={owner} paymentId={paymentId} targetType={kind==='fair'?'fair_application':'ad_marquee'} visible={visible} onCancelled={()=>setRetry(n=>n+1)} onPendingChange={setCancelPending}/>}
 </div>;
}
export function ServiceCheckoutClient(props:Props){
 const auth=usePrimaryAccountAuth(),owner=auth&&(auth.state==='signed-in'||auth.state==='admin')?auth.userId:null,[actor,setActor]=useState(owner);
 if(owner&&owner!==actor)setActor(owner);if(auth?.state==='signed-out'&&actor)setActor(null);const visible=!!owner&&owner===actor;
 return <main className="page-container flex min-h-[70vh] items-center justify-center py-8"><section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><h1 className="mb-4 text-2xl font-bold text-slate-950">{props.kind==='fair'?'Участие в ярмарке':'Реклама в бегущей строке'}</h1>
  {!visible&&<p role="status" className="text-sm text-slate-700">{auth?.state==='signed-out'?'Войдите в аккаунт владельца публикации.':'Проверяем вход. Данные оплаты временно скрыты.'}</p>}
  {actor&&<Workspace key={`${actor}:${props.kind}:${props.publicationId??props.paymentId}:${props.revision??''}`} {...props} owner={actor} visible={visible}/>}
 </section></main>;
}
