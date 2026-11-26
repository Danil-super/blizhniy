'use client';

import {useEffect,useRef,useState} from 'react';
import {adminRefunds,AdminRefundClientError} from '@/lib/client-admin-refunds';
import {createRefundActionDrafts} from '@/lib/refund-action-draft';
import {parseAdminRefundCommand,parseAdminRefundResult,type AdminRefundCommand} from '@/lib/admin-refund-contract';

type Action=Extract<AdminRefundCommand,{action:'approve'|'recover'}>;
type RefundPayment={id:string;amount:string;operationId:string|null;providerRefundId:string|null};
type Selection={row:RefundPayment;kind:Action['action']};

export const refundButton='min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';
const money=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2});

function RefundForm({actor,row,kind,busy,onCancel,onSubmit}:{actor:string;row:RefundPayment;kind:'approve'|'recover';busy:boolean;onCancel:()=>void;onSubmit:(action:Action)=>void}){
 const [providerId,setProviderId]=useState(row.providerRefundId??'');
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 const providerNumber=useRef<HTMLInputElement>(null), reasonField=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{(providerNumber.current??reasonField.current)?.focus();},[]);
 return <form aria-label={kind==='approve'?'Решение о полном возврате':'Сверка возврата'} className="rounded-lg border border-blue-200 bg-blue-50 p-4" onSubmit={event=>{
  event.preventDefault();setError('');try{
   if(kind==='approve'&&!confirmed)throw Error();
   onSubmit(parseAdminRefundCommand({action:kind,expectedAdminId:actor,input:kind==='approve'?{id:crypto.randomUUID(),paymentIntentId:row.id,reason}:{id:crypto.randomUUID(),operationId:row.operationId,providerRefundId:providerId,reason}}) as Action);
  }catch{setError(kind==='approve'?'Укажите причину до 500 символов обычным текстом и подтвердите решение.':'Проверьте номер возврата и укажите причину до 500 символов.');}
 }}>
  <h3 className="font-bold text-slate-950">{kind==='approve'?'Полный возврат платы за размещение':'Сверка существующего возврата'} · {money.format(Number(row.amount))}</h3>
  <p className="mt-1 text-sm leading-6 text-slate-700">{kind==='approve'?'Возврат отменит срок этой покупки. Прежний оплаченный остаток сохранится.':'Проверим результат уже созданного возврата без повторной отправки денег.'}</p>
  {kind==='recover'&&!row.providerRefundId&&<label className="mt-3 block text-sm font-bold text-slate-700">Номер возврата в ЮKassa<input ref={providerNumber} value={providerId} onChange={e=>setProviderId(e.target.value)} required maxLength={36} disabled={busy} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"/><span className="mt-1 block text-xs font-normal text-slate-600">Возьмите номер созданного возврата в кабинете ЮKassa.</span></label>}
  <label className="mt-3 block text-sm font-bold text-slate-700">Причина<textarea ref={reasonField} value={reason} onChange={e=>setReason(e.target.value)} required maxLength={500} rows={3} disabled={busy} className="mt-1 block w-full resize-y rounded-lg border border-slate-300 bg-white p-3 font-normal text-slate-950"/></label>
  <p className="mt-1 text-right text-xs text-slate-600">{reason.length}/500</p>
  {kind==='approve'&&<label className="mt-2 flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required disabled={busy} className="mt-1"/>Вернуть полную сумму этой покупки.</label>}
  {error&&<p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
  <div className="mt-3 flex flex-wrap gap-2"><button type="submit" disabled={busy} className={refundButton}>{kind==='approve'?'Подтвердить возврат':'Сверить возврат'}</button><button type="button" disabled={busy} className={refundButton} onClick={onCancel}>Отмена</button></div>
 </form>;
}
export function useAdminRefundActions(actor:string,enabled:boolean,onSettled:(state:'recorded'|'rejected')=>void,loading=false){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [storageError,setStorageError]=useState(''),[storageReady,setStorageReady]=useState(false);
 const [pending,setPending]=useState<Action|null>(null),[selection,setSelection]=useState<Selection|null>(null);
 const life=useRef<{active:boolean;controller:AbortController}|null>(null),working=useRef(false);
 const opener=useRef<HTMLButtonElement|null>(null),submittedFrom=useRef<Element|null>(null);
 const errorFeedback=useRef<HTMLParagraphElement>(null),noticeFeedback=useRef<HTMLParagraphElement>(null);
 const failure=storageError||error;

 useEffect(()=>{
  if(busy||(!failure&&!notice)||!submittedFrom.current)return;
  const source=submittedFrom.current;submittedFrom.current=null;
  if(document.activeElement===document.body||document.activeElement===source){
   (failure?errorFeedback:noticeFeedback).current?.focus();
  }
 },[busy,failure,notice]);

 function select(next:Selection|null,button:HTMLButtonElement|null=null){
  opener.current=button;setSelection(next);
 }
 function cancel(){
  const button=opener.current;
  select(null);
  if(button?.isConnected)button.focus();
 }

 useEffect(()=>{
  if(!enabled)return;
  const scope={active:true,controller:new AbortController()};life.current=scope;
  try{setPending(createRefundActionDrafts(sessionStorage).read(actor));setStorageReady(true);}
  catch{setStorageError('Браузер не может прочитать сохранённую операцию. Новые решения о возврате недоступны.');}
  return()=>{scope.active=false;scope.controller.abort();working.current=false;};
 },[actor,enabled]);

 async function perform(action:Action,readback=false){
  const scope=life.current;if(!scope?.active||working.current||!storageReady)return;
  submittedFrom.current=document.activeElement;
  working.current=true;setBusy(true);setError('');setNotice('');
  try{
   const command={...action,expectedAdminId:actor} as Action;
   try{createRefundActionDrafts(sessionStorage).save(actor,command);}catch{setStorageReady(false);throw Error('DRAFT_NOT_SAVED');}
   setPending(command);setSelection(null);
   const value=await adminRefunds.call(readback&&command.action==='approve'?{action:'read',expectedAdminId:actor,input:command.input.id}:command,scope.controller.signal);
   parseAdminRefundResult(command,value);
   if(!scope.active)return;
   createRefundActionDrafts(sessionStorage).clear(actor,command.input.id);setPending(null);
   onSettled('recorded');
   setNotice(command.action==='approve'?'Решение о возврате сохранено. Обработчик выполнит возврат отдельно.':'Результат возврата проверен. Обновите журнал для текущего состояния.');
  }catch(error){if(scope.active){
   if(!readback&&action.action==='approve'&&error instanceof AdminRefundClientError&&error.code==='REFUND_NOT_LATEST'){
    try{createRefundActionDrafts(sessionStorage).clear(actor,action.input.id);setPending(null);onSettled('rejected');setError(error.message+' Обновите журнал.');}
    catch{setStorageReady(false);setStorageError('Браузер не очистил отклонённое решение. Новые решения недоступны.');}
   }else if(error instanceof Error&&error.message==='DRAFT_NOT_SAVED')setStorageError('Браузер не сохранил номер операции. Команда не отправлена.');
   else setError('Результат операции не подтверждён. Проверьте сохранённое решение или повторите ту же операцию.');
  }}
  finally{if(life.current===scope){working.current=false;if(scope.active)setBusy(false);}}
 }
 const feedback=enabled&&<>
  <p ref={errorFeedback} role="alert" tabIndex={-1} className={failure?'mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800':undefined}>{failure}</p>
  <p ref={noticeFeedback} role="status" tabIndex={-1} className={notice?'mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900':undefined}>{notice}</p>
 </>;
 const panel=enabled&&<>
  {pending&&<div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"><h3 className="font-bold text-amber-950">Сохранённая операция</h3><p className="mt-1 text-sm text-amber-900">Результат нужно подтвердить. Новое решение не создаётся.</p><p className="mt-2 break-all font-mono text-xs text-amber-900">{pending.input.id}</p><p className="mt-2 text-sm text-slate-800">{pending.input.reason}</p><div className="mt-3 flex flex-wrap gap-2">{pending.action==='approve'&&<button type="button" className={refundButton} disabled={busy||loading||!storageReady} onClick={()=>void perform(pending,true)}>Проверить сохранённое решение</button>}<button type="button" className={refundButton} disabled={busy||loading||!storageReady} onClick={()=>void perform(pending)}>Повторить ту же операцию</button></div></div>}
  {selection&&!pending&&<div className="mt-4"><RefundForm actor={actor} key={selection.row.id+selection.kind} {...selection} busy={busy||loading} onCancel={cancel} onSubmit={action=>void perform(action)}/></div>}
 </>;
 return{feedback,panel,busy,disabled:busy||!!pending||!storageReady,select,life,working,clearFeedback:()=>{setError('');setNotice('');}};
}
