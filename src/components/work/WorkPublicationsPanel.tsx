"use client";
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {productionWorkPublications} from '@/lib/client-work-publications';
import {workCabinet} from '@/lib/client-work-cabinet';
import type {WorkCabinetPage} from '@/lib/work-cabinet-contract';
import type {WorkPublicationKind} from '@/lib/work-publication-contract';
import type {WorkPublicationSnapshot} from '@/lib/postgres-work-publications';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {PrimaryWorkPublicationEditor} from './PrimaryWorkPublicationEditor';
import {WorkModerationStatus} from './WorkModerationStatus';
import {useListingPostmoderation,useWorkOwnerActions} from '@/components/listings/ListingWorkflowProvider';
import {WorkOwnerActions} from './WorkOwnerActions';
import type {WorkOwnerActionResult} from '@/lib/postgres-work-owner-actions';
import {WorkCabinetCard} from './WorkCabinetCard';
import {TwoRowCardViewport} from '@/components/cabinet/TwoRowCardViewport';

export function WorkCabinetList({owner,page,disabled,onDetails,onLoadMore,error=false,visible=true,onChanged}:{owner:string;page:WorkCabinetPage;disabled:boolean;onDetails:(id:string)=>void;onLoadMore?:()=>void;error?:boolean;visible?:boolean;onChanged?:(result:WorkOwnerActionResult)=>void}){
 return <TwoRowCardViewport label={page.items[0]?.kind==='workRequest'?'Список заказов':'Список вакансий'} className="mt-5"
  gridClassName="grid auto-rows-fr min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5"
  hasMore={!!page.nextCursor} loading={disabled} error={error} onLoadMore={onLoadMore} enabled={visible}>
   {page.items.map(item=><li key={item.id} className="min-w-0"><WorkCabinetCard owner={owner} item={item} disabled={disabled} showDetails={false} onDetails={()=>onDetails(item.id)} ownerActions={onChanged&&visible?<WorkOwnerActions owner={owner} item={item} onChanged={onChanged}/>:undefined}/></li>)}
 </TwoRowCardViewport>;
}

function Workspace({owner,kind,visible}:{owner:string;kind:WorkPublicationKind;visible:boolean}){
 const localVacancy=useListingPostmoderation();
 const ownerActions=useWorkOwnerActions();
 const [page,setPage]=useState<WorkCabinetPage|null>(null),[editor,setEditor]=useState<WorkPublicationSnapshot|null>(null);
 const [message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const pending=useRef(false),scope=useRef<AbortController|null>(null);
 const retry=useRef<(()=>Promise<void>)|null>(null);
 async function run(work:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setMessage(null);
  try{await work();retry.current=null;}catch(error){if(!scope.current?.signal.aborted){retry.current=work;setMessage(error instanceof Error?error.message:'Не удалось загрузить публикации.');
   if(error&&typeof error==='object'&&'code'in error&&error.code==='UNAUTHENTICATED'){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}}}
  finally{pending.current=false;if(!scope.current?.signal.aborted)setBusy(false);}}
 useEffect(()=>{const controller=new AbortController();scope.current=controller;
  void run(async()=>{const result=await workCabinet.list(owner,kind,null,{signal:controller.signal});if(!controller.signal.aborted)setPage(result);});
  return()=>controller.abort();
 },[owner,kind]);
 async function next(){if(!visible||!page?.nextCursor)return;const cursor=page.nextCursor;
  await run(async()=>{const result=await workCabinet.list(owner,kind,cursor,{signal:scope.current?.signal});
   if(!scope.current?.signal.aborted)setPage(current=>current?{...current,items:[...current.items,...result.items.filter(item=>!current.items.some(existing=>existing.id===item.id))],nextCursor:result.nextCursor}:result);
  });
 }
 return <div hidden={!visible} inert={!visible} className="mt-5 min-w-0">
  <div className="flex flex-wrap gap-3"><Link href={kind==='vacancy'?'/rabota/vakansii/sozdat':'/rabota/zakazy/sozdat'} className={`${draftButton} inline-flex bg-brand-blue text-white`}>{kind==='vacancy'?'Создать вакансию':'Создать заказ'}</Link></div>
  {busy&&<p className="mt-4" role="status">Загружаем публикации…</p>}{message&&<div className="mt-4"><p className="break-words text-rose-700" role="alert">{message}</p>
   <button type="button" className={`${draftButton} mt-2`} disabled={busy} onClick={()=>{if(retry.current)void run(retry.current);}}>Повторить загрузку</button></div>}
  {page?.items.length===0&&<p className="mt-5">{kind==='vacancy'?'Вакансий пока нет.':'Заказов пока нет.'}</p>}
  {page&&page.items.length>0&&<WorkCabinetList owner={owner} page={page} disabled={busy} error={!!message} visible={visible} onChanged={ownerActions?result=>setPage(current=>current?{...current,items:result.action==='remove'?current.items.filter(item=>item.id!==result.publicationId):current.items.map(item=>item.id===result.publicationId&&BigInt(item.revision)<=BigInt(result.resultingRevision)?{...item,revision:result.resultingRevision,status:result.status,updatedAt:result.occurredAt}:item)}:current):undefined} onLoadMore={()=>void next()} onDetails={id=>void run(async()=>{
   const result=await productionWorkPublications.read(owner,kind,id,{signal:scope.current?.signal});if(!scope.current?.signal.aborted)setEditor(result);
  })}/>}
  {editor&&<section className="mt-6 min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-label="Сведения о публикации">
   <h2 className="mb-3 text-xl font-bold">{editor.form.title||'Без названия'}</h2>
   <p className="whitespace-pre-wrap break-words">{editor.form.description}</p>
   <p className="mt-3 text-sm text-slate-600">{editor.form.cityName} · {editor.form.professionName} · Фотографий: {editor.photos.length}</p>
   {localVacancy?<p className="mt-4 text-sm text-slate-600">{editor.paid?'Оплата подтверждена. Текущий статус указан на карточке.':'Черновик сохранён. Его можно открыть для редактирования.'}</p>:<WorkModerationStatus key={`moderation:${editor.id}:${editor.revision}`} owner={owner} snapshot={editor}/>}
   <div className="mt-4 flex flex-wrap gap-3"><Link href={`/rabota/${kind==='vacancy'?'vakansii':'zakazy'}/${editor.id}/edit`} prefetch={false} className={draftButton}>Редактировать</Link>
    <button type="button" className={draftButton} onClick={()=>setEditor(null)}>Закрыть сведения</button></div>
  </section>}
 </div>;
}
export function WorkPublicationsPanel({kind,initialId}:{kind:WorkPublicationKind;initialId?:string}){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);
 const visible=!!owner&&owner===scope;
 if(initialId)return <PrimaryWorkPublicationEditor kind={kind} initialId={initialId}/>;
 return <section aria-label={kind==='vacancy'?'Мои вакансии':'Мои заказы'}>
  {!visible&&<div className="mt-4" role="status"><p>{auth?.state==='signed-out'?'Войдите в аккаунт.':'Проверяем доступ. Введённые данные временно скрыты.'}</p>
   {auth?.state==='unavailable'&&<button type="button" className={`${draftButton} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</div>}
  {scope&&<Workspace key={`${scope}:${kind}`} owner={scope} kind={kind} visible={visible}/>}
 </section>;
}
