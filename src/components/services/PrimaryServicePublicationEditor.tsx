"use client";
import Link from 'next/link';
import {useEffect,useState,type ComponentProps} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {servicePublications} from '@/lib/client-service-publications';
import type {ServicePublicationKind} from '@/lib/service-publication-contract';
import type {ServicePublicationSnapshot} from '@/lib/postgres-service-publications';
import {servicePublicationNavigation} from '@/lib/service-publication-navigation';
import {ServicePublicationForm} from './ServicePublicationForm';
import {ServiceModerationStatus} from './ServiceModerationStatus';
import {SpecialistApplicationStatus} from './SpecialistApplicationStatus';
import {useCookieCabinetProfile,CabinetProfileFailure} from '@/components/cabinet/CookieCabinetProfileProvider';

/** Mount uncontrolled fields only after defaults load; never remount a dirty form on a transient recheck. */
function ProfileReadyForm(props:ComponentProps<typeof ServicePublicationForm>){
 const context=useCookieCabinetProfile(),[ready,setReady]=useState(props.kind==='marquee');
 if(context?.ownerId===props.owner&&context.profile&&!ready)setReady(true);
 if(!ready)return context?.error?<CabinetProfileFailure message={context.error} reload={context.reload}/>:<p role="status">Загружаем данные профиля для формы…</p>;
 return <ServicePublicationForm {...props}/>;
}

function Editor({owner,kind,id,visible,embedded}:{owner:string;kind:ServicePublicationKind;id?:string;visible:boolean;embedded:boolean}){
 const [snapshot,setSnapshot]=useState<ServicePublicationSnapshot|undefined>(),[ready,setReady]=useState(!id&&kind!=='specialist'),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0),[dirty,setDirty]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{if(saved)window.location.assign(servicePublicationNavigation[kind].cabinet);},[saved,kind]);
 useEffect(()=>{if(!id&&kind!=='specialist')return;const controller=new AbortController();setError(null);
  void(async()=>{
   // One durable specialist profile per owner: reopen it instead of a conflicting second create.
   const target=id??(await servicePublications.list(owner,kind,null,{signal:controller.signal})).items[0]?.id;
   const value=target?await servicePublications.read(owner,kind,target,{signal:controller.signal}):undefined;
   if(!controller.signal.aborted){setSnapshot(value);setReady(true);}
  })().catch(failure=>{
   if(controller.signal.aborted)return;setError(failure instanceof Error?failure.message:'Не удалось открыть материал.');
   if(failure?.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);
  });return()=>controller.abort();
 },[owner,kind,id,retry]);
 return <section hidden={!visible} inert={!visible} aria-label="Редактор материала">
  {!embedded&&<Link href={servicePublicationNavigation[kind].cabinet} prefetch={false} className="mb-4 inline-flex min-h-11 items-center font-semibold text-blue-800 underline">← Вернуться в кабинет</Link>}
  {error?<div><p role="alert" className="mb-3 text-rose-800">{error}</p><button type="button" className="min-h-11 font-semibold text-blue-800 underline" onClick={()=>setRetry(value=>value+1)}>Повторить загрузку</button></div>:
   ready?<div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6"><ProfileReadyForm owner={owner} kind={kind} initial={snapshot} onDirtyChange={setDirty}
    onSaved={()=>setSaved(true)}/>
    {snapshot&&!dirty&&(kind==='specialist'?<SpecialistApplicationStatus form={snapshot.form}/>:<ServiceModerationStatus owner={owner} snapshot={snapshot}/>)}</div>:<p role="status">Загружаем сохранённую форму…</p>}
 </section>;
}

export function PrimaryServicePublicationEditor({kind,initialId,embedded=false}:{kind:ServicePublicationKind;initialId?:string;embedded?:boolean}){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);const visible=!!owner&&owner===scope;
 return <>{!visible&&<div role="status"><p>{auth?.state==='signed-out'?'Войдите в аккаунт.':'Проверяем вход. Введённые данные временно скрыты.'}</p>
  {auth?.state==='unavailable'&&<button type="button" onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</div>}
  {scope&&<Editor key={`${scope}:${kind}:${initialId??'new'}`} owner={scope} kind={kind} id={initialId} visible={visible} embedded={embedded}/>}</>;
}
