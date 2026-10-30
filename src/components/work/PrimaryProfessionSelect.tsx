"use client";
import {useEffect,useState} from 'react';
import {loadProfessionCatalog} from '@/lib/client-professions';
import type {PublicProfession} from '@/lib/profession-catalog-contract';
import {ProfessionSelect} from './ProfessionSelect';

export function PrimaryProfessionSelect({defaultValue='',defaultId,required=false}:{defaultValue?:string;defaultId?:string|null;required?:boolean}){
 const [catalog,setCatalog]=useState<PublicProfession[]>([]),[state,setState]=useState<'loading'|'ready'|'error'>('loading'),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let current=true;
  setState('loading');
  void loadProfessionCatalog(fetch,controller.signal).then(items=>{if(current){setCatalog(items);setState('ready');}}).catch(()=>{if(current)setState('error');});
  return()=>{current=false;controller.abort();};
 },[attempt]);
 useEffect(()=>{
  const refresh=()=>{if(document.visibilityState==='visible')setAttempt(value=>value+1);};
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[]);
 return <div className="min-w-0">
  <ProfessionSelect defaultValue={defaultValue} defaultId={defaultId} required={required} catalog={catalog} catalogState={state}/>
  {state==='loading'&&<p role="status" className="mt-1 text-sm text-slate-500">Загружаем профессии…</p>}
  {state==='error'&&<p role="alert" className="mt-1 text-sm text-rose-700">Не удалось загрузить профессии. <button type="button" onClick={()=>setAttempt(value=>value+1)} className="font-semibold underline">Повторить</button></p>}
 </div>;
}
