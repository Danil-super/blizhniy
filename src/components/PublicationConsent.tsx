"use client";

import {useEffect,useRef,useState} from 'react';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {StoredMediaImage} from '@/components/StoredMedia';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {postPublicationPrivacy,type ContactConsentCategory,type ProfileConsentCategory,type PublicationPrivacyTarget} from '@/lib/client-publication-privacy';

type Consent={
 value:string;
 notice:{version:string;operator:string;purpose:string;resource:string;fileResource?:string;term:string;statement:string};
 email:string;fingerprint:string;expiresAt:string|null;
};
type Location={city:string;address:string|null;latitude:number;longitude:number};
const labels={
 location:{title:'Согласие на публикацию точного адреса',term:'адреса',missing:'сохраните точку',hidden:''},
 phone:{title:'Согласие на публикацию телефона',term:'телефона',missing:'сохраните номер телефона',hidden:'Телефон скрыт.'},
 messenger:{title:'Согласие на публикацию мессенджера',term:'мессенджера',missing:'сохраните ссылку на мессенджер',hidden:'Мессенджер скрыт.'},
 name:{title:'Согласие на публикацию имени',term:'имени',missing:'сохраните имя в профиле',hidden:'Имя скрыто.'},
 avatar:{title:'Согласие на публикацию фото профиля',term:'фото профиля',missing:'сохраните фото в профиле',hidden:'Фото профиля скрыто.'},
 photo:{title:'Согласие на публикацию выбранного фото',term:'выбранного фото',missing:'сохраните фото',hidden:'Фото скрыто.'},
};

type Selection={category?:ContactConsentCategory|ProfileConsentCategory;photoId?:never}|{category:'photo';photoId:string};

export function PublicationConsent({category,photoId,...target}:PublicationPrivacyTarget&Selection){
 const label=labels[category??'location'];
 const [consent,setConsent]=useState<Consent|null>();
 const [fullName,setFullName]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [withdrawn,setWithdrawn]=useState(false),[confirmWithdrawal,setConfirmWithdrawal]=useState(false);
 const lifetime=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  lifetime.current=controller;
  return ()=>controller.abort();
 },[]);

 async function request(operation:'status'|'confirm'|'withdraw'='status'){
  const controller=lifetime.current;
  if(!controller||controller.signal.aborted||busy)return;
  setBusy(true);setMessage('');
  try{
   const fields={fingerprint:consent?.fingerprint??'',fullName:fullName.trim()};
   const profile=category==='name'||category==='avatar';
   const command=category==='photo'
    ? operation==='confirm'?{action:'confirm-photo-consent' as const,photoId,...fields}
     :{action:'photo-consent-status' as const,photoId}
    :profile
    ? operation==='confirm'?{action:'confirm-profile-consent' as const,category,...fields}
     :{action:operation==='withdraw'?'withdraw-profile-value' as const:'profile-consent-status' as const,category}
    :category
    ? operation==='confirm'?{action:'confirm-contact-consent' as const,category,...fields}
     :{action:operation==='withdraw'?'withdraw-contact' as const:'contact-consent-status' as const,category}
    : operation==='confirm'?{action:'confirm-location-consent' as const,...fields}:{action:'location-consent-status' as const};
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
   if(data.kind!==target.kind||data.publicationId!==target.publicationId||
      (category==='photo'?data.photoId!==photoId:category&&data.category!==category))throw Error();
   if(operation==='withdraw'){
    if(typeof data.withdrawnAt!=='string')throw Error();
    setWithdrawn(true);setConsent(null);setConfirmWithdrawal(false);
    return;
   }
   if(!data.consent)throw Error();
   const next=data.consent as Omit<Consent,'value'>&{
    location?:Location|null;contact?:string|null;profileValue?:string|null;photoValue?:string|null;withdrawnAt?:string|null;
   };
   const location=next.location;
   const value=category==='photo'?(next.photoValue===photoId?photoId:null):profile?next.profileValue:category?next.contact:location&&
    `${location.city}${location.address?', '+location.address:''}. Координаты ${location.latitude}, ${location.longitude}.`;
   if(!value&&operation==='confirm'||value&&(!/^[0-9a-f]{64}$/.test(next.fingerprint)||operation==='confirm'&&!next.expiresAt))throw Error();
   setConsent(value?{email:next.email,fingerprint:next.fingerprint,expiresAt:next.expiresAt,notice:next.notice,value}:null);
   setWithdrawn(typeof next.withdrawnAt==='string');
   setConfirmed(false);
   setConfirmWithdrawal(false);
   if(operation==='confirm'){setFullName('');setMessage('Согласие сохранено.');}
  }catch{
   if(!controller.signal.aborted){
    setConfirmed(false);setConfirmWithdrawal(false);
    setMessage('Не удалось подтвердить состояние согласия. Откройте его заново.');
   }
  }finally{
   if(!controller.signal.aborted)setBusy(false);
  }
 }

 return <section aria-label={label.title} className="space-y-2 border-t border-slate-200 pt-2">
  {message&&<p role="status">{message}</p>}
  {withdrawn?<p role="status">{label.hidden}</p>:
   consent===undefined?<button type="button" className={draftButton} disabled={busy} onClick={()=>void request()}>{'Открыть '+label.title.toLowerCase()}</button>:
   consent===null?<p>Чтобы разрешить публикацию, сначала {label.missing}{category==='name'||category==='avatar'?'':' в форме публикации'}.</p>:
   consent.expiresAt?<div className="space-y-2">
    <p role="status">Согласие на публикацию {label.term} действует до{' '}
     {new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(consent.expiresAt))} (МСК).</p>
    {category&&category!=='photo'&&<>
     {confirmWithdrawal&&<p>Посетители перестанут видеть эти данные в публикации. Последующее изменение этих данных не возобновит показ.</p>}
     <div className="flex flex-wrap gap-2">
      <button type="button" className={draftButton} disabled={busy} onClick={()=>{
       if(confirmWithdrawal)void request('withdraw');else setConfirmWithdrawal(true);
      }}>{confirmWithdrawal?'Подтвердить отзыв':'Отозвать согласие'}</button>
      {confirmWithdrawal&&<button type="button" className={draftButton} disabled={busy} onClick={()=>setConfirmWithdrawal(false)}>Оставить как есть</button>}
     </div>
    </>}
   </div>:
   <div className="space-y-3">
    <h4 className="font-semibold">{label.title}</h4>
    <p>{consent.notice.operator}</p>
    <p>{consent.notice.purpose}</p>
    <p className="break-all">{consent.notice.resource}</p>
    {consent.notice.fileResource&&<p className="break-all">{consent.notice.fileResource}</p>}
    <p>{consent.notice.term}</p>
    {category==='avatar'?<StoredMediaImage src={consent.value} alt="Фото для публикации" className="h-24 w-24 rounded-lg object-cover"/>:
     category!=='photo'&&<p className="break-words">{consent.value}</p>}
    <label className="block">Фамилия, имя, отчество (при наличии)
     <input autoComplete="name" maxLength={160} value={fullName} onChange={event=>setFullName(event.target.value)}
      className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2" disabled={busy}/>
    </label>
    <p className="break-words">Подтверждённая почта для связи — {consent.email}. Имя из этой формы и почта сохраняются в записи о согласии.</p>
    <label className="flex items-start gap-2">
     <input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>
     <span>{consent.notice.statement}</span>
    </label>
    <button type="button" className={draftButton} disabled={busy||!confirmed||fullName.trim().length<2} onClick={()=>void request('confirm')}>Подтвердить согласие</button>
   </div>}
  {consent!==undefined&&!withdrawn&&<button type="button" className={draftButton} disabled={busy} onClick={()=>void request()}>Обновить состояние согласия</button>}
 </section>;
}
