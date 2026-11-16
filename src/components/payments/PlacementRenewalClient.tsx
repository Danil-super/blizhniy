'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {accountTestPayment} from '@/lib/client-account-test-payment';
import {vacancyPayment,workRequestPayment} from '@/lib/client-vacancy-payment';
import {parseListingDraftId} from '@/lib/listing-draft-contract';
import {ensurePhoneForPlacement} from '@/lib/phone-placement';

export type RenewalKind='listing'|'vacancy'|'workRequest';
const button='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-blue-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';
const cabinet={listing:'/cabinet/obyavleniya',vacancy:'/cabinet/vakansii',workRequest:'/cabinet/zakazy'};

function Renewal({owner,id,revision,kind,visible}:{owner:string;id:string;revision:string;kind:RenewalKind;visible:boolean}){
 const client=kind==='listing'?accountTestPayment:kind==='vacancy'?vacancyPayment:workRequestPayment;
 const [quote,setQuote]=useState<Awaited<ReturnType<typeof client.preview>>|null>(null),[ready,setReady]=useState(false),[pending,setPending]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0);
 const key=useRef<string|null>(null),working=useRef(false),scope=useRef<AbortController|null>(null),live=useRef(visible);live.current=visible;
 useEffect(()=>{
  try{if(window.location.hash){if(!/^#checkout=[a-f0-9-]{36}$/.test(window.location.hash))throw Error();key.current=parseListingDraftId(window.location.hash.slice(10));setPending(true);}setReady(true);}
  catch{setError('Сохранённая попытка оплаты повреждена. Вернитесь в кабинет и проверьте историю оплат.');}
 },[]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;working.current=false;setBusy(false);return()=>controller.abort();},[visible]);
 useEffect(()=>{const controller=new AbortController();
  if(ready&&visible&&!pending){setBusy(true);setError('');void client.preview(owner,id,revision,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setQuote(value);})
   .catch(()=>{if(!controller.signal.aborted)setError('Размещение сейчас нельзя продлить. Проверьте статус, телефон и обязательные поля.');})
   .finally(()=>{if(!controller.signal.aborted)setBusy(false);});}
  return()=>controller.abort();
 },[client,owner,id,revision,ready,visible,pending,retry]);
 function open(paymentId:string,signal:AbortSignal){if(live.current&&!signal.aborted)window.location.assign(`/oplata/${paymentId}${kind==='listing'?'':'?type='+kind}`);}
 async function perform(read:boolean){
  const controller=scope.current;if(!visible||working.current||!ready||!controller||controller.signal.aborted)return;
  working.current=true;setBusy(true);setError('');setNotice('');
  try{
   if(read){
    if(!key.current)throw Error();const saved=await client.recover(owner,key.current,{signal:controller.signal});
    if(!live.current||controller.signal.aborted)return;
    if(saved){if(saved.targetId!==id||saved.targetRevision!==revision)throw Error();open(saved.id,controller.signal);}
    else{setPending(false);setNotice('Заказ пока не найден. Можно повторить оплату с тем же ключом после проверки тарифа.');}
   }else{
    if(!quote||pending)return;
    if(quote.activePayment){open(quote.activePayment.id,controller.signal);return;}
    await ensurePhoneForPlacement(owner);if(!live.current||controller.signal.aborted)return;
    key.current??=crypto.randomUUID();window.history.replaceState(null,'',window.location.pathname+window.location.search+'#checkout='+key.current);
    if(window.location.hash!=='#checkout='+key.current)throw Error();
    // Keep the original key in the URL before the write. Reload can only read it back.
    setPending(true);
    const order=await client.prepare(owner,{listingId:id,expectedRevision:revision,creationKey:key.current,expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays},{signal:controller.signal});
    open(order.id,controller.signal);
   }
  }catch{if(live.current&&!controller.signal.aborted)setError('Результат не подтверждён. Проверьте начатую оплату перед повтором.');}
  finally{if(scope.current===controller){working.current=false;if(!controller.signal.aborted)setBusy(false);}}
 }
 return <div hidden={!visible} inert={!visible} aria-busy={busy}>
  <p className="text-sm leading-6 text-slate-700">Оставшееся оплаченное время сохранится. Новый срок добавим после подтверждения оплаты.</p>
  {quote&&!pending&&<div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4"><p className="font-bold text-slate-950">Ещё {quote.tariff.durationDays} дн. · {new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(quote.tariff.amount))}</p><p className="mt-2 text-sm text-slate-700">Локальная симуляция, без списания денег.</p></div>}
  {pending&&<p role="status" className="mt-4 text-sm text-slate-700">Сначала проверим начатую оплату. Новый заказ не создаётся.</p>}
  {notice&&<p role="status" className="mt-3 text-sm text-slate-700">{notice}</p>}
  {error&&<p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
  <div className="mt-5 flex flex-wrap gap-2">{pending?<button type="button" className={button} disabled={busy} onClick={()=>void perform(true)}>Проверить начатую оплату</button>:quote?<button type="button" className={button} disabled={busy} onClick={()=>void perform(false)}>{quote.activePayment?'Открыть начатую оплату':'Оплатить продление'}</button>:<button type="button" className={button} disabled={busy||!ready} onClick={()=>setRetry(v=>v+1)}>Проверить тариф</button>}<Link className={button} href={cabinet[kind]}>В кабинет</Link></div>
 </div>;
}

export function PlacementRenewalClient(props:{id:string;revision:string;kind:RenewalKind}){
 const auth=usePrimaryAccountAuth(),owner=auth&&(auth.state==='signed-in'||auth.state==='admin')?auth.userId:null,[actor,setActor]=useState(owner);
 if(owner&&owner!==actor)setActor(owner);if(auth?.state==='signed-out'&&actor)setActor(null);
 const visible=!!owner&&owner===actor;
 return <main className="page-container flex min-h-[70vh] items-center justify-center py-8"><section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><h1 className="mb-4 text-2xl font-bold text-slate-950">Продлить размещение</h1>
  {!visible&&<p role="status" className="text-sm text-slate-700">{auth?.state==='signed-out'?'Войдите в аккаунт, которому принадлежит публикация.':'Проверяем вход. Данные оплаты временно скрыты.'}</p>}
  {actor&&<Renewal key={`${actor}:${props.kind}:${props.id}:${props.revision}`} {...props} owner={actor} visible={visible}/>}
 </section></main>;
}
