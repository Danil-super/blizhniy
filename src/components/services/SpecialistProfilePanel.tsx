"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {servicePublications} from '@/lib/client-service-publications';
import type {ServicePublicationSnapshot} from '@/lib/postgres-service-publications';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {specialistAbout} from '@/lib/specialist-application-profile';
import {normalizeMessengerHref} from '@/lib/messenger-url';
import {useCookieCabinetProfile,CabinetProfileFailure} from '@/components/cabinet/CookieCabinetProfileProvider';
import {StoredMediaImage} from '@/components/StoredMedia';
import {StatusBadge} from '@/components/listings/ListingBadges';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {PrimaryServicePublicationEditor} from './PrimaryServicePublicationEditor';
import {SpecialistApplicationStatus} from './SpecialistApplicationStatus';
import {ServiceModerationStatus} from './ServiceModerationStatus';
import {useSpecialistCheckout} from '@/components/listings/ListingWorkflowProvider';
import {PublicationPlacementPeriod} from '@/components/PublicationPlacementPeriod';

/** The parent keys this workspace by owner; an uncertain read must never open a create form. */
export function SpecialistProfilePanel({owner,visible}:{owner:string;visible:boolean}){
 const checkout=useSpecialistCheckout();
 const [snapshot,setSnapshot]=useState<ServicePublicationSnapshot|null>(null),[loaded,setLoaded]=useState(false);
 const [error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0),[busy,setBusy]=useState(true);
 const context=useCookieCabinetProfile(),profile=context?.ownerId===owner?context.profile:null;
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setError(null);
  void(async()=>{
   const page=await servicePublications.list(owner,'specialist',null,{signal:controller.signal});
   if(controller.signal.aborted)return;
   if(page.items.length>1||page.nextCursor)throw Error('Не удалось однозначно определить вашу анкету. Повторите загрузку.');
   const value=page.items[0]?await servicePublications.read(owner,'specialist',page.items[0].id,{signal:controller.signal}):null;
   if(value&&value.form.kind!=='specialist')throw Error('Не удалось открыть анкету специалиста.');
   if(!controller.signal.aborted){setSnapshot(value);setLoaded(true);}
  })().catch(cause=>{
   if(controller.signal.aborted)return;setError(cause instanceof Error?cause.message:'Не удалось загрузить анкету.');
   if(cause&&typeof cause==='object'&&'code'in cause&&cause.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);
  }).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[owner,retry]);
 const form=snapshot?.form.kind==='specialist'?snapshot.form:null;
 const profileReady=!!profile&&!context?.loading&&!context?.error;
 const messenger=form?normalizeMessengerHref(form.messengerUrl??undefined):null;
 return <div hidden={!visible} inert={!visible} className="mx-auto w-full min-w-0 max-w-3xl">
  {busy?<p role="status" className="py-4 text-slate-700">Загружаем вашу анкету…</p>:error?<div className="max-w-3xl rounded-xl border border-rose-200 bg-white p-4">
   <p role="alert" className="break-words text-rose-800">{error}</p><button type="button" className={`${draftButton} mt-3`} onClick={()=>{if(visible)setRetry(value=>value+1);}}>Повторить загрузку</button>
  </div>:!loaded?null:!profileReady?context?.ownerId===owner&&context.error?
   <CabinetProfileFailure message={context.error} reload={context.reload}/>:<p role="status">Загружаем данные профиля…</p>:
   snapshot&&form&&<section aria-label="Моя анкета" className="max-w-3xl rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
    <header className="flex min-w-0 flex-wrap items-center gap-3">
     <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-2xl font-bold text-blue-800">
      {profile.avatarDataUrl?<StoredMediaImage src={profile.avatarDataUrl} alt="Фото из профиля" width={64} height={64} className="h-full w-full object-cover"/>:<span aria-hidden="true">{profile.name.slice(0,1)}</span>}
     </div>
     <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-xl font-bold text-slate-950">{profile.name}</h2><StatusBadge status={snapshot.status}/></div><p className="mt-1 break-words text-sm text-slate-700">{form.professionName||'Профессия пока не указана'}</p></div>
     <Link href={`/rabota/specialisty/anketa?draft=${snapshot.id}`} prefetch={false} className={draftButton}>Редактировать</Link>
    </header>
    <dl className="mt-5 grid min-w-0 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
     {([['Город',form.cityName||'Не указан'],['Стоимость работ',form.price?`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(form.price))} ₽`:'Не указана'],
      ['Адрес',form.address],['Телефон',form.contactPhone],['Email',form.email]] as const).map(([label,value])=>value&&<div key={label} className="min-w-0"><dt className="text-slate-600">{label}</dt><dd className="mt-1 break-words font-medium text-slate-950">{value}</dd></div>)}
     {messenger&&<div className="min-w-0"><dt className="text-slate-600">Мессенджер</dt><dd><a href={messenger} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all font-semibold text-blue-800 underline">Связаться в мессенджере</a></dd></div>}
    </dl>
    <section aria-label="О себе" className="mt-5 border-t border-slate-200 pt-4"><h3 className="font-bold text-slate-950">О себе</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{specialistAbout(form)||'Расскажите о себе в анкете.'}</p></section>
    <SpecialistApplicationStatus form={{...form,title:profile.name}}/>
    <PublicationPlacementPeriod publishedAt={snapshot.publishedAt} expiresAt={snapshot.expiresAt} status={snapshot.status}/>
    {checkout&&<ServiceModerationStatus owner={owner} snapshot={snapshot}/>}
   </section>}
  {loaded&&!busy&&!error&&!snapshot&&<div hidden={!profileReady} inert={!profileReady}>
   <PrimaryServicePublicationEditor kind="specialist" embedded={{emptyForOwner:owner}}/>
  </div>}
 </div>;
}
