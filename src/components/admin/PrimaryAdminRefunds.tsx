'use client';
import {useServiceCheckout} from '@/components/listings/ListingWorkflowProvider';
import {useCallback,useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {adminRefunds,AdminRefundClientError} from '@/lib/client-admin-refunds';
import {createRefundActionDrafts} from '@/lib/refund-action-draft';
import {parseAdminRefundCommand,parseAdminRefundResult,type AdminRefundCommand} from '@/lib/admin-refund-contract';
import type {AdminRefundPage,AdminRefundPayment} from '@/lib/postgres-admin-refund-journal';
const button='min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';
const money=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2});
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const types:Record<string,string>={listing:'Объявление',vacancy:'Вакансия',workRequest:'Заказ',application:'Отклик',specialist:'Анкета',fair_application:'Ярмарка',ad_marquee:'Бегущая строка'};
type Action=Extract<AdminRefundCommand,{action:'approve'|'recover'}>;
function status(row:AdminRefundPayment){
 if(row.appliedAt)return'Возврат выполнен';
 if(row.refundStatus==='canceled')return'Возврат отменён';
 if(row.refundStatus==='succeeded')return'Возврат подтверждён, ожидает применения';
 if(row.providerRefundId)return'Возврат обрабатывается';
 if(row.attempted)return'Результат возврата не определён';
 if(row.approvalId)return'Решение принято, ожидает обработки';
 return({created:'Ожидает оплаты',pending:'Платёж обрабатывается',succeeded:'Оплачено',failed:'Оплата не завершена',refunded:'Возврат выполнен'} as Record<string,string>)[row.status];
}
function RefundForm({actor,row,kind,busy,onCancel,onSubmit}:{actor:string;row:AdminRefundPayment;kind:'approve'|'recover';busy:boolean;onCancel:()=>void;onSubmit:(action:Action)=>void}){
 const [providerId,setProviderId]=useState(row.providerRefundId??'');
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');const focus=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{focus.current?.focus();},[]);
 return <form aria-label={kind==='approve'?'Решение о полном возврате':'Сверка возврата'} className="rounded-lg border border-blue-200 bg-blue-50 p-4" onSubmit={event=>{
  event.preventDefault();setError('');try{
   if(kind==='approve'&&!confirmed)throw Error();
   onSubmit(parseAdminRefundCommand({action:kind,expectedAdminId:actor,input:kind==='approve'?{id:crypto.randomUUID(),paymentIntentId:row.id,reason}:{id:crypto.randomUUID(),operationId:row.operationId,providerRefundId:providerId,reason}}) as Action);
  }catch{setError(kind==='approve'?'Укажите причину до 500 символов обычным текстом и подтвердите решение.':'Проверьте номер возврата и укажите причину до 500 символов.');}
 }}>
  <h3 className="font-bold text-slate-950">{kind==='approve'?'Полный возврат платы за размещение':'Сверка существующего возврата'} · {money.format(Number(row.amount))}</h3>
  <p className="mt-1 text-sm leading-6 text-slate-700">{kind==='approve'?'Возврат отменит срок этой покупки. Прежний оплаченный остаток сохранится.':'Проверим результат уже созданного возврата без повторной отправки денег.'}</p>
  {kind==='recover'&&!row.providerRefundId&&<label className="mt-3 block text-sm font-bold text-slate-700">Номер возврата в ЮKassa<input value={providerId} onChange={e=>setProviderId(e.target.value)} required maxLength={36} disabled={busy} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"/><span className="mt-1 block text-xs font-normal text-slate-600">Возьмите номер созданного возврата в кабинете ЮKassa.</span></label>}
  <label className="mt-3 block text-sm font-bold text-slate-700">Причина<textarea ref={focus} value={reason} onChange={e=>setReason(e.target.value)} required maxLength={500} rows={3} disabled={busy} className="mt-1 block w-full resize-y rounded-lg border border-slate-300 bg-white p-3 font-normal text-slate-950"/></label>
  <p className="mt-1 text-right text-xs text-slate-600">{reason.length}/500</p>
  {kind==='approve'&&<label className="mt-2 flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required disabled={busy} className="mt-1"/>Вернуть полную сумму этой покупки.</label>}
  {error&&<p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
  <div className="mt-3 flex flex-wrap gap-2"><button type="submit" disabled={busy} className={button}>{kind==='approve'?'Подтвердить возврат':'Сверить возврат'}</button><button type="button" disabled={busy} className={button} onClick={onCancel}>Отмена</button></div>
 </form>;
}
function RefundWorkspace({actor}:{actor:string}){
 const serviceCheckout=useServiceCheckout();
 const [page,setPage]=useState<AdminRefundPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[storageError,setStorageError]=useState('');
 const [pending,setPending]=useState<Action|null>(null),[storageReady,setStorageReady]=useState(false),[selection,setSelection]=useState<{row:AdminRefundPayment;kind:'approve'|'recover'}|null>(null);
 const life=useRef<{active:boolean;controller:AbortController}|null>(null),working=useRef(false),scroll=useRef<HTMLDivElement>(null);
 const load=useCallback(async(after:string|null=null)=>{
  const scope=life.current;if(!scope?.active||working.current)return;working.current=true;setBusy(true);setError('');setNotice('');if(after===null)setPage(null);
  try{const result=await adminRefunds.call({action:'list',expectedAdminId:actor,input:after},scope.controller.signal) as AdminRefundPage;
   if(scope.active){setPage(result);scroll.current?.scrollTo({top:0});}
  }catch{if(scope.active)setError('Журнал не загружен. Проверьте соединение и обновите данные.');}
  finally{if(life.current===scope){working.current=false;if(scope.active)setBusy(false);}}
 },[actor]);
 useEffect(()=>{
  const scope={active:true,controller:new AbortController()};life.current=scope;
  try{setPending(createRefundActionDrafts(sessionStorage).read(actor));setStorageReady(true);}catch{setStorageError('Браузер не может прочитать сохранённую операцию. Новые решения о возврате недоступны.');}
  void load();return()=>{scope.active=false;scope.controller.abort();working.current=false;};
 },[actor,load]);
 async function perform(action:Action,readback=false){
  const scope=life.current;if(!scope?.active||working.current||!storageReady)return;
  working.current=true;setBusy(true);setError('');setNotice('');
  try{
   const command={...action,expectedAdminId:actor} as Action;
   try{createRefundActionDrafts(sessionStorage).save(actor,command);}catch{setStorageReady(false);throw Error('DRAFT_NOT_SAVED');}
   setPending(command);setSelection(null);
   const value=await adminRefunds.call(readback&&command.action==='approve'?{action:'read',expectedAdminId:actor,input:command.input.id}:command,scope.controller.signal);
   parseAdminRefundResult(command,value);
   if(!scope.active)return;
   createRefundActionDrafts(sessionStorage).clear(actor,command.input.id);setPending(null);
   setNotice(command.action==='approve'?'Решение о возврате сохранено. Обработчик выполнит возврат отдельно.':'Результат возврата проверен. Обновите журнал для текущего состояния.');
  }catch(error){if(scope.active){
   if(!readback&&action.action==='approve'&&error instanceof AdminRefundClientError&&error.code==='REFUND_NOT_LATEST'){
    try{createRefundActionDrafts(sessionStorage).clear(actor,action.input.id);setPending(null);setPage(null);setError(error.message+' Обновите журнал.');}
    catch{setStorageReady(false);setStorageError('Браузер не очистил отклонённое решение. Новые решения недоступны.');}
   }else if(error instanceof Error&&error.message==='DRAFT_NOT_SAVED')setStorageError('Браузер не сохранил номер операции. Команда не отправлена.');
   else setError('Результат операции не подтверждён. Проверьте сохранённое решение или повторите ту же операцию.');
  }}
  finally{if(life.current===scope){working.current=false;if(scope.active)setBusy(false);}}
 }
 return <section aria-label="Локальный журнал возвратов" aria-busy={busy}>
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950">Платежи и возвраты</h2><p className="mt-1 text-sm text-slate-600">Локальный TEST-контур · реальные деньги не списываются.</p></div><button type="button" className={button} disabled={busy} onClick={()=>void load()}>Обновить журнал</button></div>
  {storageError&&<p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{storageError}</p>}
  {notice&&<p role="status" className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
  {error&&<p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {pending&&<div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"><h3 className="font-bold text-amber-950">Сохранённая операция</h3><p className="mt-1 text-sm text-amber-900">Результат нужно подтвердить. Новое решение не создаётся.</p><p className="mt-2 break-all font-mono text-xs text-amber-900">{pending.input.id}</p><p className="mt-2 text-sm text-slate-800">{pending.input.reason}</p><div className="mt-3 flex flex-wrap gap-2">{pending.action==='approve'&&<button type="button" className={button} disabled={busy||!storageReady} onClick={()=>void perform(pending,true)}>Проверить сохранённое решение</button>}<button type="button" className={button} disabled={busy||!storageReady} onClick={()=>void perform(pending)}>Повторить ту же операцию</button></div></div>}
  {selection&&!pending&&<div className="mt-4"><RefundForm actor={actor} key={selection.row.id+selection.kind} {...selection} busy={busy} onCancel={()=>setSelection(null)} onSubmit={action=>void perform(action)}/></div>}
  {busy&&!page&&<p role="status" className="mt-4 text-sm text-slate-600">Загружаем журнал…</p>}
  {page&&<><div ref={scroll} tabIndex={0} aria-label="Прокрутка платежей" className="mt-4 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><ul className="grid gap-2">
   {page.items.map(row=><li key={row.id} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold text-slate-950">{types[row.targetType]??'Платёж'} · {row.id.slice(0,8)}</h3><p className="mt-1 text-sm text-slate-600"><time dateTime={row.createdAt}>{date(row.createdAt)}</time></p></div><div className="text-right"><p className="font-bold text-slate-950">{money.format(Number(row.amount))}</p><p className={'mt-1 text-sm font-semibold '+(row.appliedAt?'text-emerald-800':'text-slate-700')}>{status(row)}</p></div></div>
    {row.reason&&<p className="mt-2 text-sm text-slate-700">Причина возврата: {row.reason}</p>}
    <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer py-2">Идентификаторы платежа и размещения</summary><p className="break-all">Платёж: {row.id}</p><p className="mt-1 break-all">Размещение: {row.targetId}</p></details>
    {row.canRefund===false&&['listing','vacancy','workRequest'].includes(row.targetType)&&row.status==='succeeded'&&!row.approvalId&&<p className="mt-2 text-sm text-slate-600">Для возврата начните с последней покупки и завершите начатую оплату.</p>}
    <div className="mt-2 flex flex-wrap gap-2">{(['listing','vacancy','workRequest'].includes(row.targetType)||serviceCheckout&&['fair_application','ad_marquee'].includes(row.targetType))&&row.status==='succeeded'&&row.capturedAt&&!row.approvalId&&row.canRefund!==false&&<button type="button" className={button} disabled={busy||!!pending||!storageReady} onClick={()=>setSelection({row,kind:'approve'})}>Вернуть плату</button>}
    {row.operationId&&row.attempted&&!row.appliedAt&&row.refundStatus!=='canceled'&&<button type="button" className={button} disabled={busy||!!pending||!storageReady} onClick={()=>setSelection({row,kind:'recover'})}>{row.providerRefundId?'Сверить возврат':'Сверить по номеру ЮKassa'}</button>}</div>
   </li>)}
  </ul>{page.items.length===0&&<p className="p-6 text-center text-sm text-slate-600">В этом TEST-магазине платежей пока нет.</p>}</div>{page.nextAfter&&<button type="button" className={button+' mt-3'} disabled={busy} onClick={()=>void load(page.nextAfter)}>Следующие платежи</button>}</>}
 </section>;
}
export function PrimaryAdminRefunds(){
 const auth=usePrimaryAccountAuth();
 if(auth?.state!=='admin'||!auth.userId)return <p role="status" className="text-sm text-slate-600">{auth?.state==='loading'?'Проверяем права администратора…':'Доступ администратора не подтверждён.'}</p>;
 return <RefundWorkspace key={auth.userId} actor={auth.userId}/>;
}
