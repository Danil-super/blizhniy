"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {listingModeration,ListingModerationClientError} from '@/lib/client-listing-moderation';
import type {ListingModerationState} from '@/lib/postgres-listing-moderation';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {draftButton} from './PrivateDraftEditor';
import {PrivateListingCheckout,type ListingCheckoutAttempt} from './PrivateListingCheckout';
const labels={not_submitted:'Не отправлено на модерацию',pending:'На модерации',approved:'Одобрено модератором',rejected:'Нужны исправления',outdated:'После изменений нужна повторная модерация'};
export function PrivateDraftModeration({owner,id,revision,disabled,checkoutAttempt,allowSubmit=true}:{owner:string;id:string;revision:string;disabled:boolean;checkoutAttempt:ListingCheckoutAttempt;allowSubmit?:boolean}){
 const [state,setState]=useState<ListingModerationState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[uncertain,setUncertain]=useState(false);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),locked=useRef(false);
 const run=useCallback(async(submit:boolean)=>{
  if(disabled||locked.current)return;locked.current=true;setBusy(true);setError(null);const generation=epoch.current;
  try{
   const result=await listingModeration[submit?'submit':'read'](owner,id,revision,{signal:scope.current?.signal});
   if(epoch.current===generation){setState(result);setUncertain(false);}
  }catch(error){if(epoch.current===generation){
   const failure=error instanceof ListingModerationClientError?error:new ListingModerationClientError('UNKNOWN');setError(failure.message);
   if(submit&&!['INVALID_INPUT','RATE_LIMITED','DRAFT_CHANGED','DRAFT_NOT_FOUND','UNAUTHENTICATED'].includes(failure.code))setUncertain(true);
   if(failure.code==='DRAFT_CHANGED'){setState(null);setUncertain(true);}
   if(failure.code==='UNAUTHENTICATED'||failure.code==='DRAFT_NOT_FOUND'){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}
  }}finally{if(epoch.current===generation){locked.current=false;setBusy(false);}}
 },[owner,id,revision,disabled]);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;const generation=++epoch.current;locked.current=false;
  setState(null);setError(null);setBusy(false);setUncertain(false);if(!disabled)void run(false);
  return()=>{epoch.current=generation+1;controller.abort();};
 },[run,disabled]);
 const canSubmit=!state||state.state==='not_submitted'||state.state==='outdated';
 return <section className="mt-6 min-w-0 rounded-xl border border-slate-200 bg-white p-4" aria-label="Модерация объявления" aria-busy={busy}>
  <h2 className="text-lg font-bold">Модерация объявления</h2>
  <p className="mt-2 text-sm text-slate-600">Сначала модератор проверяет объявление, затем можно будет оплатить размещение. Отправка на проверку бесплатна.</p>
  {disabled?<p className="mt-3">Сначала сохраните или сверьте правки текста, полей и фотографий.</p>:<>
   {state&&<div className="mt-3 space-y-2 break-words" role="status"><p className="font-semibold">{labels[state.state]}</p>
    {state.state==='rejected'&&<><p>{state.note}</p><p className="text-sm">Исправьте объявление, сохраните новую версию и отправьте её повторно.</p></>}
    {state.state==='approved'&&<p className="text-sm">Проверена текущая версия. Любые правки потребуют повторной модерации. Объявление ещё не опубликовано.</p>}
    {state.state==='pending'&&<p className="text-sm">Объявление ещё не опубликовано. Если вы измените текст, поля или фотографии, отправьте новую версию на проверку.</p>}
   </div>}
   {error&&<p className="mt-3 break-words" role="alert">{error}</p>}
   {busy&&<p className="mt-3" role="status">Проверяем статус отправки…</p>}
   <div className="mt-3 flex flex-wrap gap-3">
    {canSubmit&&allowSubmit&&<button type="button" className={draftButton} disabled={busy||uncertain||!state} onClick={()=>void run(true)}>Отправить на модерацию</button>}
    {!allowSubmit&&canSubmit&&<p className="text-sm text-slate-600">Откройте «Редактировать», проверьте форму и отправьте её на модерацию.</p>}
    <button type="button" className={draftButton} disabled={busy} onClick={()=>void run(false)}>Обновить статус модерации</button>
   </div>
   {(state?.state==='approved'||checkoutAttempt.uncertain)&&<PrivateListingCheckout owner={owner} id={id} revision={revision} attempt={checkoutAttempt}/>}
  </>}
 </section>;
}
