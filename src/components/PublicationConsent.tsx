"use client";

import {useEffect,useRef,useState} from 'react';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {StoredMediaImage} from '@/components/StoredMedia';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {postPublicationPrivacy,type ContactConsentCategory,type ProfileConsentCategory,type PublicationPrivacyTarget} from '@/lib/client-publication-privacy';
import {isPublicationTermsChoice,publicationTermsChoices,type PublicationTermsChoice} from '@/lib/publication-consent-terms';
import {publicationTextLabels,type PublicationTextField} from '@/lib/publication-text-selection';

type Consent={
 value:string;
 notice:{version:string;operator:string;purpose:string;resource:string;fileResource?:string;term:string;statement:string};
 email:string;fingerprint:string;revisionFingerprint:string;expiresAt:string|null;terms:PublicationTermsChoice|null;
};
type Location={city:string;address:string|null;latitude:number;longitude:number};
const labels={
 location:{title:'Согласие на публикацию точного адреса',term:'адреса',missing:'сохраните точку',hidden:''},
 phone:{title:'Согласие на публикацию телефона',term:'телефона',missing:'сохраните номер телефона',hidden:'Телефон скрыт.'},
 messenger:{title:'Согласие на публикацию мессенджера',term:'мессенджера',missing:'сохраните ссылку на мессенджер',hidden:'Мессенджер скрыт.'},
 name:{title:'Согласие на публикацию имени',term:'имени',missing:'сохраните имя в профиле',hidden:'Имя скрыто.'},
 avatar:{title:'Согласие на публикацию фото профиля',term:'фото профиля',missing:'сохраните фото в профиле',hidden:'Фото профиля скрыто.'},
 photo:{title:'Согласие на публикацию выбранного фото',term:'выбранного фото',missing:'сохраните фото',hidden:'Фото скрыто.'},
 link:{title:'Согласие на публикацию ссылки',term:'ссылки',missing:'сохраните ссылку',hidden:'Ссылка скрыта.'},
 text:{title:'Согласие на публикацию текста поля',term:'текста поля',missing:'сохраните текст',hidden:'Поле скрыто целиком.'},
};

type Selection={category?:ContactConsentCategory|ProfileConsentCategory|'link';photoId?:never;field?:never}|
 {category:'photo';photoId:string;field?:never}|{category:'text';field:PublicationTextField;photoId?:never};

export function PublicationConsent({category,photoId,field,...target}:PublicationPrivacyTarget&Selection){
 const label=labels[category??'location'];
 const [consent,setConsent]=useState<Consent|null>();
 const [fullName,setFullName]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [terms,setTerms]=useState<PublicationTermsChoice|''>(''),[editing,setEditing]=useState(false);
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
  const confirmation=operation==='confirm'&&consent&&terms?{
   fingerprint:editing?consent.revisionFingerprint:consent.fingerprint,fullName:fullName.trim(),terms,
  }:null;
  if(!controller||controller.signal.aborted||busy||operation==='confirm'&&!confirmation)return;
  setBusy(true);setMessage('');
  try{
   const profile=category==='name'||category==='avatar';
   const command=category==='photo'
    ? confirmation?{action:'confirm-photo-consent' as const,photoId,...confirmation}
     :{action:'photo-consent-status' as const,photoId}
    :category==='link'
    ? confirmation?{action:'confirm-link-consent' as const,...confirmation}
     :{action:operation==='withdraw'?'withdraw-link' as const:'link-consent-status' as const}
    :category==='text'
    ? confirmation?{action:'confirm-text-consent' as const,field,...confirmation}
     :{action:operation==='withdraw'?'withdraw-text-field' as const:'text-consent-status' as const,field}
    :profile
    ? confirmation?{action:'confirm-profile-consent' as const,category,...confirmation}
     :{action:operation==='withdraw'?'withdraw-profile-value' as const:'profile-consent-status' as const,category}
    :category
    ? confirmation?{action:'confirm-contact-consent' as const,category,...confirmation}
     :{action:operation==='withdraw'?'withdraw-contact' as const:'contact-consent-status' as const,category}
    : confirmation?{action:'confirm-location-consent' as const,...confirmation}:{action:'location-consent-status' as const};
   const response=await postPublicationPrivacy(target,command,controller.signal);
   if(controller.signal.aborted)return;
   if(response.status===401)notifyAccountSessionChange(false);
   if(response.status===409){
    setConsent(undefined);setConfirmed(false);setTerms('');setEditing(false);
    setMessage('Данные изменились. Откройте согласие заново.');
    return;
   }
   if(!response.ok)throw Error();
   const data=await response.json();
   if(controller.signal.aborted)return;
   if(data.kind!==target.kind||data.publicationId!==target.publicationId||
      (category==='photo'?data.photoId!==photoId:category==='text'?data.field!==field:category&&data.category!==category))throw Error();
   if(operation==='withdraw'){
    if(typeof data.withdrawnAt!=='string')throw Error();
    setWithdrawn(true);setConsent(null);setConfirmWithdrawal(false);
    return;
   }
   if(!data.consent)throw Error();
   const next=data.consent as Omit<Consent,'value'>&{
    location?:Location|null;contact?:string|null;profileValue?:string|null;photoValue?:string|null;linkValue?:string|null;withdrawnAt?:string|null;
    textValue?:string|null;
   };
   const location=next.location;
   const value=category==='photo'?(next.photoValue===photoId?photoId:null):category==='link'?next.linkValue:category==='text'?next.textValue:
    profile?next.profileValue:category?next.contact:location&&
    `${location.city}${location.address?', '+location.address:''}. Координаты ${location.latitude}, ${location.longitude}.`;
   if(!value&&operation==='confirm'||value&&(!/^[0-9a-f]{64}$/.test(next.fingerprint)||
     !/^[0-9a-f]{64}$/.test(next.revisionFingerprint)||
     (next.expiresAt? !isPublicationTermsChoice(next.terms):next.terms!==null)||
     operation==='confirm'&&(!next.expiresAt||next.terms!==terms)))throw Error();
   setConsent(value?{email:next.email,fingerprint:next.fingerprint,revisionFingerprint:next.revisionFingerprint,
    terms:next.terms,expiresAt:next.expiresAt,notice:next.notice,value}:null);
   setTerms('');setEditing(false);
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

 const supportSubject=encodeURIComponent('Условия распространения данных');
 const supportBody=consent?encodeURIComponent([
  'Публикация: '+consent.notice.resource,
  'Идентификатор публикации: '+target.publicationId,
  'Область: '+(field?publicationTextLabels[field]:label.title),
  '',
  'Условие: ',
 ].join('\r\n')):null;

 return <>
 <section aria-label={label.title} className="space-y-2 border-t border-slate-200 pt-2">
  {message&&<p role="status">{message}</p>}
  {withdrawn?<p role="status">{label.hidden}</p>:
   consent===undefined?<button type="button" className={draftButton} disabled={busy} onClick={()=>void request()}>{'Открыть '+label.title.toLowerCase()}</button>:
   consent===null?<p>Чтобы разрешить публикацию, сначала {label.missing}{category==='name'||category==='avatar'?'':' в форме публикации'}.</p>:
   consent.expiresAt&&!editing?<div className="space-y-2">
    <p role="status">Согласие на публикацию {label.term} действует до{' '}
     {new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(consent.expiresAt))} (МСК).</p>
    {consent.terms&&<p>{publicationTermsChoices[consent.terms]}</p>}
    <button type="button" className={draftButton} disabled={busy} onClick={()=>{
     setMessage('');setConfirmed(false);setConfirmWithdrawal(false);setTerms(consent.terms??'');setEditing(true);
    }}>Изменить условия</button>
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
     category!=='photo'&&<p className="whitespace-pre-wrap break-words">{consent.value}</p>}
    <label className="block">Фамилия, имя, отчество (при наличии)
     <input autoComplete="name" maxLength={160} value={fullName} onChange={event=>setFullName(event.target.value)}
      className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2" disabled={busy}/>
    </label>
    <p className="break-words">Подтверждённая почта для связи — {consent.email}. Имя из этой формы и почта сохраняются в записи о согласии.</p>
    <label className="block">Условия и запреты
     <select value={terms} disabled={busy} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2"
      onChange={event=>{
       const choice=event.target.value;
       setTerms(isPublicationTermsChoice(choice)?choice:'');setConfirmed(false);
      }}>
      <option value="">Выберите условия</option>
      {Object.entries(publicationTermsChoices).map(([value,label])=><option key={value} value={value}>{label}</option>)}
     </select>
    </label>
    <p>Выбранные условия будут видны в публикации.</p>
    <label className="flex items-start gap-2">
     <input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>
     <span>{consent.notice.statement}</span>
    </label>
    <button type="button" className={draftButton} disabled={busy||!terms||!confirmed||fullName.trim().length<2} onClick={()=>void request('confirm')}>Подтвердить согласие</button>
    {editing&&<button type="button" className={draftButton} disabled={busy} onClick={()=>{
     setFullName('');setTerms('');setConfirmed(false);setEditing(false);
    }}>Отмена</button>}
   </div>}
  {consent!==undefined&&!withdrawn&&<button type="button" className={draftButton} disabled={busy} onClick={()=>void request()}>Обновить состояние согласия</button>}
 </section>
 {supportBody&&!withdrawn&&<p className="mt-2">
  <a className="font-semibold text-blue-800 underline underline-offset-2"
   aria-label={`Написать в поддержку об условиях · ${label.title}`}
   href={`mailto:prostova04@yandex.ru?subject=${supportSubject}&body=${supportBody}`}>Написать в поддержку об условиях</a>
 </p>}
 </>;
}
