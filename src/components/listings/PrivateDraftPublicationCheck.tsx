"use client";
import {useEffect,useRef,useState} from 'react';
import {inspectListingPublication,ListingPublicationClientError} from '@/lib/client-listing-publication';
import type {ListingPublicationCheck} from '@/lib/listing-publication-check';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {draftButton} from './PrivateDraftEditor';
export function PrivateDraftPublicationCheck({owner,id,revision,disabled}:{owner:string;id:string;revision:string;disabled:boolean}){
 const [report,setReport]=useState<ListingPublicationCheck|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),locked=useRef(false);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;const generation=++epoch.current;locked.current=false;
  setReport(null);setError(null);setBusy(false);return()=>{epoch.current=generation+1;controller.abort();};
 },[owner,id,revision,disabled]);
 async function inspect(){
  if(disabled||locked.current)return;locked.current=true;setBusy(true);setError(null);setReport(null);const generation=epoch.current;
  try{const value=await inspectListingPublication(owner,id,revision,{signal:scope.current?.signal});if(epoch.current===generation)setReport(value);
  }catch(error){if(epoch.current===generation){const failure=error instanceof ListingPublicationClientError?error:new ListingPublicationClientError('UNKNOWN');setError(failure.message);
   if(failure.code==='UNAUTHENTICATED'||failure.code==='DRAFT_NOT_FOUND'){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}
  }}finally{if(epoch.current===generation){locked.current=false;setBusy(false);}}
 }
 return <section className="mt-6 min-w-0 rounded-xl border border-slate-200 bg-white p-4" aria-label="Проверка перед публикацией">
  <h2 className="text-lg font-bold">Перед публикацией</h2>
  <p className="mt-2 text-sm text-slate-600">Проверим сохранённые данные и действующий тариф. Сначала сохраните правки текста, полей и фотографий.</p>
  <button type="button" className={`${draftButton} mt-3`} disabled={disabled||busy} onClick={()=>void inspect()}>{busy?'Проверяем объявление…':'Проверить перед публикацией'}</button>
  {error&&<p className="mt-3" role="alert">{error}</p>}
  {!disabled&&report&&<div className="mt-4 min-w-0 space-y-3 break-words" role="status">
   <p className="font-semibold">{report.checksPassed?'Проверка данных пройдена.':'До публикации нужно исправить:'}</p>
   {report.issues.length>0&&<ul className="list-disc space-y-1 pl-5">{report.issues.map((issue,index)=><li key={`${issue.field}-${index}`}>{issue.message}</li>)}</ul>}
   {report.tariff&&<dl className="grid gap-1 sm:grid-cols-[auto_1fr]"><dt>Тариф</dt><dd>{report.tariff.name}</dd>
    <dt>Стоимость размещения</dt><dd>{report.tariff.amount.replace('.',',')} ₽</dd><dt>Срок</dt><dd>{report.tariff.durationDays} дн.</dd></dl>}
   <p className="text-sm text-slate-600">Это проверка данных, а не публикация или платёж.</p>
   <p className="text-sm text-slate-600">Тариф действует на момент проверки; перед оплатой он будет проверен снова. Отправка на публикацию и оплата ещё не подключены.</p>
  </div>}
 </section>;
}
