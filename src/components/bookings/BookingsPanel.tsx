"use client";
import {useCallback,useEffect,useRef,useState} from 'react';import Link from 'next/link';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';import {notifyAccountSessionChange} from '@/lib/local-account';
import {productionBookings,BookingClientError} from '@/lib/client-bookings';import type {BookingPage,BookingSnapshot} from '@/lib/postgres-bookings';import type {ListingDraftCursor} from '@/lib/listing-draft-contract';
import {BookingDetail,bookingButton,bookingLabels,bookingPeriod} from './BookingDetail';
type Mode='guest'|'host';
function Workspace({owner,visible}:{owner:string;visible:boolean}){
 const [mode,setMode]=useState<Mode>('guest'),[page,setPage]=useState<BookingPage|null>(null),[selected,setSelected]=useState<BookingSnapshot|null>(null),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[message,setMessage]=useState<string|null>(null),[success,setSuccess]=useState<string|null>(null);
 const pending=useRef<object|null>(null),scope=useRef<AbortController|null>(null),openedFrom=useRef<HTMLButtonElement|null>(null);
 const run=useCallback(async(work:(signal:AbortSignal)=>Promise<void>)=>{
  const controller=scope.current;if(pending.current||!controller||controller.signal.aborted)return;const attempt={};pending.current=attempt;setBusy(true);setMessage(null);setSuccess(null);
  try{await work(controller.signal);}catch(error){if(!controller.signal.aborted){setMessage(error instanceof Error?error.message:'Не удалось загрузить заявки.');if(error instanceof BookingClientError&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}}
  finally{if(pending.current===attempt){pending.current=null;if(!controller.signal.aborted)setBusy(false);}}
 },[]);
 const load=useCallback(async(mode:Mode,after:ListingDraftCursor|null,signal:AbortSignal)=>{const result=await productionBookings.list(owner,mode,after,{signal});if(!signal.aborted){setMode(mode);setPage(result);}},[owner]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;pending.current=null;void run(signal=>load('guest',null,signal));return()=>{controller.abort();pending.current=null;};},[owner,run,load]);
 function display(saved:BookingSnapshot){setSelected(saved);setUnknown(false);setPage(page=>page?{...page,items:page.items.map(item=>item.id===saved.id?{...item,status:saved.status,revision:saved.revision}:item)}:null);}
 function refresh(){if(!selected||!visible)return;void run(async signal=>{const saved=await productionBookings.read(owner,selected.id,{signal});if(!signal.aborted){display(saved);setSuccess('Актуальное состояние загружено.');}});}
 function decide(state:'accepted'|'declined'){if(!visible||!selected||unknown)return;const current=selected;void run(async signal=>{setUnknown(true);const saved=await productionBookings.decide(owner,current.id,current.revision,state,{signal});if(!signal.aborted){display(saved);setSuccess('Решение сохранено.');}});}
 return <div hidden={!visible} inert={!visible} className="mt-5 min-w-0" aria-busy={busy}>
  <div className="flex flex-wrap gap-2" role="group" aria-label="Направление бронирований">{([['guest','Мои поездки'],['host','Заявки гостей']] as const).map(([value,label])=>
   <button key={value} type="button" className={bookingButton} aria-pressed={mode===value} disabled={busy||unknown} onClick={()=>{if(visible)void run(async signal=>{await load(value,null,signal);if(!signal.aborted)setSelected(null);});}}>{label}</button>)}
   <button type="button" className={bookingButton} disabled={busy||unknown} onClick={()=>void run(signal=>load(mode,null,signal))}>Обновить список</button></div>
  {busy&&<p role="status" className="mt-4 text-slate-600">Загружаем бронирования…</p>}
  {message&&<p role="alert" className="mt-4 break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">{message}</p>}
  {success&&<p role="status" className="mt-4 text-green-800">{success}</p>}
  {page?.items.length===0&&<div className="mt-5 rounded-xl border border-slate-200 bg-white p-5"><p className="font-semibold text-slate-800">{mode==='guest'?'У вас пока нет бронирований.':'Заявок от гостей пока нет.'}</p>
   <p className="mt-2 text-sm text-slate-600">{mode==='guest'?'Отправьте заявку из объявления с календарём проживания или датой похода.':'Здесь появятся заявки на ваши опубликованные предложения аренды и экскурсий.'}</p>
   {mode==='guest'&&<Link href="/obyavleniya/arenda" className={`${bookingButton} mt-4`}>Найти предложение</Link>}</div>}
  {page&&<ul className="mt-5 grid gap-3" aria-label={mode==='guest'?'Мои бронирования':'Входящие бронирования'}>{page.items.map(item=><li key={item.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
   <p className="text-sm font-semibold text-slate-700">{bookingLabels[item.status]}</p><Link href={`/obyavlenie/${item.listing.id}`} className="mt-2 inline-block min-h-11 break-words py-2 font-semibold text-blue-800 underline">{item.listing.title}</Link>
   <p className="break-words text-sm text-slate-700">{bookingPeriod(item)} · Гостей: {item.guests}</p><p className="mt-1 text-sm font-semibold text-slate-950">{item.total} ₽</p>
   <button type="button" className={`${bookingButton} mt-3`} disabled={busy||unknown} onClick={event=>{openedFrom.current=event.currentTarget;void run(async signal=>{const saved=await productionBookings.read(owner,item.id,{signal});if(!signal.aborted)display(saved);});}}>Подробнее</button>
  </li>)}</ul>}
  {page?.nextCursor&&<button type="button" className={`${bookingButton} mt-4`} disabled={busy||unknown} onClick={()=>void run(signal=>load(mode,page.nextCursor,signal))}>Следующая страница</button>}
  {selected&&<BookingDetail key={selected.id} value={selected} busy={busy} unknown={unknown} onDecision={decide} onRefresh={refresh} onClose={()=>{setSelected(null);setUnknown(false);setSuccess(null);openedFrom.current?.focus();}}/>}
 </div>;
}
export function BookingsPanel(){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);const visible=!!owner&&owner===scope;
 return <section aria-label="Бронирования">{!visible&&<div role="status" className="mt-4"><p>{auth?.state==='signed-out'?'Войдите в аккаунт.':'Проверяем доступ. Данные временно скрыты.'}</p>
  {auth?.state==='unavailable'&&<button type="button" className={`${bookingButton} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</div>}
  {scope&&<Workspace key={scope} owner={scope} visible={visible}/>}
 </section>;
}
