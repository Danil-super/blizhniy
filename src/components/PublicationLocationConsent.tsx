"use client";

import {useEffect,useRef,useState} from 'react';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {postPublicationPrivacy,type PublicationPrivacyTarget} from '@/lib/client-publication-privacy';

type Consent={
 location:{city:string;address:string|null;latitude:number;longitude:number};
 notice:{version:string;operator:string;purpose:string;resource:string;term:string;statement:string};
 email:string;fingerprint:string;expiresAt:string|null;
};

export function PublicationLocationConsent(target:PublicationPrivacyTarget){
 const [consent,setConsent]=useState<Consent|null>();
 const [fullName,setFullName]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const lifetime=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  lifetime.current=controller;
  return ()=>controller.abort();
 },[]);

 async function request(apply=false){
  const controller=lifetime.current;
  if(!controller||controller.signal.aborted||busy)return;
  setBusy(true);setMessage('');
  try{
   const command=apply&&consent?{action:'confirm-location-consent' as const,fingerprint:consent.fingerprint,fullName:fullName.trim()}
    :{action:'location-consent-status' as const};
   const response=await postPublicationPrivacy(target,command,controller.signal);
   if(controller.signal.aborted)return;
   if(response.status===401)notifyAccountSessionChange(false);
   if(response.status===409){
    setConsent(undefined);setConfirmed(false);
    setMessage('Данные изменились. Откройте согласие заново.');
    return;
   }
   if(!response.ok)throw Error();
   const data=await response.json();
   if(controller.signal.aborted)return;
   if(data.kind!==target.kind||data.publicationId!==target.publicationId||!data.consent)throw Error();
   const next=data.consent as Consent|{location:null};
   if(next.location===null&&apply)throw Error();
   if(next.location!==null&&(!/^[0-9a-f]{64}$/.test(next.fingerprint)||apply&&!next.expiresAt))throw Error();
   setConsent(next.location===null?null:next);
   setConfirmed(false);
   if(apply){setFullName('');setMessage('Согласие сохранено.');}
  }catch{
   if(!controller.signal.aborted){
    setConfirmed(false);
    setMessage('Не удалось подтвердить состояние согласия. Откройте его заново.');
   }
  }finally{
   if(!controller.signal.aborted)setBusy(false);
  }
 }

 return <div className="space-y-2 border-t border-slate-200 pt-2">
  {message&&<p role="status">{message}</p>}
  {consent===undefined?<button type="button" className={draftButton} disabled={busy} onClick={()=>void request()}>Открыть согласие на публикацию точного адреса</button>:
   consent===null?<p>Чтобы разрешить показ точного адреса, сначала сохраните точку в форме публикации.</p>:
   consent.expiresAt?<p role="status">Согласие на публикацию адреса действует до{' '}
    {new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(consent.expiresAt))} (МСК).</p>:
   <div className="space-y-3">
    <h4 className="font-semibold">Согласие на публикацию точного адреса</h4>
    <p>{consent.notice.operator}</p>
    <p>{consent.notice.purpose}</p>
    <p className="break-all">{consent.notice.resource}</p>
    <p>{consent.notice.term}</p>
    <p>{consent.location.city}{consent.location.address&&', '+consent.location.address}. Координаты {consent.location.latitude}, {consent.location.longitude}.</p>
    <label className="block">Фамилия, имя, отчество (при наличии)
     <input autoComplete="name" maxLength={160} value={fullName} onChange={event=>setFullName(event.target.value)}
      className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2" disabled={busy}/>
    </label>
    <p className="break-words">Подтверждённая почта для связи — {consent.email}. Имя из этой формы и почта сохраняются в записи о согласии.</p>
    <label className="flex items-start gap-2">
     <input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>
     <span>{consent.notice.statement}</span>
    </label>
    <button type="button" className={draftButton} disabled={busy||!confirmed||fullName.trim().length<2} onClick={()=>void request(true)}>Подтвердить согласие</button>
   </div>}
  {consent!==undefined&&<button type="button" className={draftButton} disabled={busy} onClick={()=>void request()}>Обновить состояние согласия</button>}
 </div>;
}
