"use client";
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {servicePublications,type ServicePage} from '@/lib/client-service-publications';
import type {ServicePublicationKind} from '@/lib/service-publication-contract';
import type {ServicePublicationSnapshot} from '@/lib/postgres-service-publications';
import {servicePublicationNavigation} from '@/lib/service-publication-navigation';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {serviceFormLabels} from './ServicePublicationForm';
import {ServiceModerationStatus} from './ServiceModerationStatus';
import {PrimaryServicePublicationEditor} from './PrimaryServicePublicationEditor';
import {SpecialistProfilePanel} from './SpecialistProfilePanel';

function Workspace({owner,kind,visible}:{owner:string;kind:Exclude<ServicePublicationKind,'specialist'>;visible:boolean}){
 const [page,setPage]=useState<ServicePage|null>(null),[detail,setDetail]=useState<ServicePublicationSnapshot|null>(null),[message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const pending=useRef(false),scope=useRef<AbortController|null>(null),nav=servicePublicationNavigation[kind];
 async function run(work:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setMessage(null);
  try{await work();}catch(error){if(!scope.current?.signal.aborted){setMessage(error instanceof Error?error.message:'Не удалось загрузить материалы.');if(error&&typeof error==='object'&&'code'in error&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}}
  finally{pending.current=false;if(!scope.current?.signal.aborted)setBusy(false);}
 }
 useEffect(()=>{const controller=new AbortController();scope.current=controller;
  void run(async()=>{const result=await servicePublications.list(owner,kind,null,{signal:controller.signal});if(!controller.signal.aborted)setPage(result);});return()=>controller.abort();
 },[owner,kind]);
 async function read(id:string){const value=await servicePublications.read(owner,kind,id,{signal:scope.current?.signal});if(!scope.current?.signal.aborted)setDetail(value);}
 return <div hidden={!visible} inert={!visible} className="min-w-0">
  <Link href={nav.form} prefetch={false} className={`${draftButton} inline-flex bg-brand-blue text-white`}>{nav.create}</Link>
  {busy&&<p className="mt-3" role="status">Загружаем материалы…</p>}
  {message&&<div className="mt-3"><p role="alert" className="break-words text-rose-800">{message}</p><button type="button" className={`${draftButton} mt-2`} disabled={busy} onClick={()=>void run(async()=>{
   const value=await servicePublications.list(owner,kind,null,{signal:scope.current?.signal});if(!scope.current?.signal.aborted)setPage(value);
  })}>Повторить загрузку</button></div>}
  {page&&<section className="mt-5" aria-label="Сохранённые материалы"><h2 className="text-lg font-bold">Мои материалы</h2>
   {page.items.length===0?<p className="mt-3">Материалов пока нет.</p>:<div role="region" aria-label="Список материалов" tabIndex={0} className="mt-3 max-h-[65vh] overflow-y-auto overscroll-contain rounded-xl p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"><ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {page.items.map(item=><li key={item.id} className="min-w-0"><article className="h-full rounded-xl border border-slate-200 bg-white p-4"><h3 className="break-words font-bold">{item.title||'Без названия'}</h3>
     <p className="mt-2 text-sm text-slate-600">{item.status==='draft'?'Черновик':item.status==='published'?'Опубликовано':item.status==='archived'?'В архиве':item.status==='expired'?'Срок размещения истёк':item.status==='rejected'?'Нужны исправления':'Ожидает размещения'}</p>
     <div className="mt-4 flex flex-wrap gap-2"><Link href={`${nav.form}?draft=${item.id}`} prefetch={false} className={draftButton}>Редактировать</Link>
      <button type="button" className={draftButton} aria-label={`Подробнее: ${item.title||'Без названия'}`} disabled={busy} onClick={()=>void run(()=>read(item.id))}>Подробнее</button></div></article></li>)}
   </ul></div>}
   {page.nextCursor&&<button type="button" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>void run(async()=>{const value=await servicePublications.list(owner,kind,page.nextCursor,{signal:scope.current?.signal});if(!scope.current?.signal.aborted)setPage(value);})}>Следующая страница</button>}
  </section>}
  {detail&&<section aria-label="Сведения о материале" className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"><h2 className="text-xl font-bold">{detail.form.title||'Без названия'}</h2>
   {detail.form.kind!=='marquee'&&<p className="mt-3 whitespace-pre-wrap break-words">{detail.form.description}</p>}
   <ServiceModerationStatus key={`${detail.id}:${detail.revision}`} owner={owner} snapshot={detail}/>
   <div className="mt-4 flex flex-wrap gap-3"><Link href={`${nav.form}?draft=${detail.id}`} prefetch={false} className={draftButton}>Редактировать</Link>
    <button type="button" className={draftButton} onClick={()=>setDetail(null)}>Закрыть сведения</button></div>
  </section>}
 </div>;
}
export function ServicePublicationsPanel({kind,create=false}:{kind:ServicePublicationKind;create?:boolean}){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);const visible=!!owner&&owner===scope;
 if(create)return <PrimaryServicePublicationEditor kind={kind}/>;
 return <section aria-label={serviceFormLabels[kind]}>{!visible&&<div className="mt-3" role="status"><p>{auth?.state==='signed-out'?'Войдите в аккаунт.':'Проверяем вход. Данные временно скрыты.'}</p>
  {auth?.state==='unavailable'&&<button type="button" className={`${draftButton} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</div>}
  {scope&&(kind==='specialist'?<SpecialistProfilePanel key={scope} owner={scope} visible={visible}/>:<Workspace key={`${scope}:${kind}`} owner={scope} kind={kind} visible={visible}/>)}
 </section>;
}
