"use client";
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {productionWorkPublications,type WorkPublicationPage} from '@/lib/client-work-publications';
import type {WorkPublicationKind} from '@/lib/work-publication-contract';
import type {WorkPublicationSnapshot} from '@/lib/postgres-work-publications';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {WorkPublicationForm} from './WorkPublicationForm';
import {WorkModerationStatus} from './WorkModerationStatus';

function Workspace({owner,kind,visible,initialId}:{owner:string;kind:WorkPublicationKind;visible:boolean;initialId?:string}){
 const [page,setPage]=useState<WorkPublicationPage|null>(null),[editor,setEditor]=useState<WorkPublicationSnapshot|null>(null);
 const [editorDirty,setEditorDirty]=useState(false);
 const [message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const pending=useRef(false),scope=useRef<AbortController|null>(null);
 async function run(work:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setMessage(null);
  try{await work();}catch(error){if(!scope.current?.signal.aborted){setMessage(error instanceof Error?error.message:'Не удалось загрузить публикации.');
   if(error&&typeof error==='object'&&'code'in error&&error.code==='UNAUTHENTICATED'){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}}}
  finally{pending.current=false;if(!scope.current?.signal.aborted)setBusy(false);}}
 useEffect(()=>{const controller=new AbortController();scope.current=controller;
  void run(async()=>{const result=await productionWorkPublications.list(owner,kind,null,{signal:controller.signal});if(!controller.signal.aborted)setPage(result);
   if(initialId){const saved=await productionWorkPublications.read(owner,kind,initialId,{signal:controller.signal});if(!controller.signal.aborted)setEditor(saved);}});
  return()=>controller.abort();
 },[owner,kind,initialId]);
 return <div hidden={!visible} inert={!visible} className="mt-5 min-w-0">
  <div className="flex flex-wrap gap-3"><Link href={kind==='vacancy'?'/rabota/vakansii/sozdat':'/rabota/zakazy/sozdat'} className={`${draftButton} inline-flex bg-brand-blue text-white`}>{kind==='vacancy'?'Создать вакансию':'Создать заказ'}</Link>
   <button type="button" className={draftButton} disabled={busy} onClick={()=>void run(async()=>{
    const result=await productionWorkPublications.list(owner,kind,null,{signal:scope.current?.signal});if(!scope.current?.signal.aborted)setPage(result);
   })}>Обновить список</button></div>
  {busy&&<p className="mt-4" role="status">Загружаем публикации…</p>}{message&&<p className="mt-4 break-words text-rose-700" role="alert">{message}</p>}
  {page?.items.length===0&&<p className="mt-5">{kind==='vacancy'?'Вакансий пока нет.':'Заказов пока нет.'}</p>}
  {page&&<ul className="mt-5 grid gap-3">{page.items.map(item=><li key={item.id} className="rounded-lg border border-slate-200 bg-white p-4">
   <button type="button" className="min-h-11 break-words text-left font-bold text-brand-blue underline" disabled={busy}
    onClick={()=>void run(async()=>{if(editor&&!window.confirm('Закрыть текущую форму? Несохранённые правки будут потеряны.'))return;
     const result=await productionWorkPublications.read(owner,kind,item.id,{signal:scope.current?.signal});if(!scope.current?.signal.aborted){setEditorDirty(false);setEditor(result);}})}>{item.title||'Без названия'}</button>
   <p className="text-sm text-slate-600">{item.status==='draft'?'Сохранено':item.status==='published'?'Опубликовано':item.status==='expired'?'Срок размещения истёк':item.status==='archived'?'В архиве':'Ожидает публикации'}</p>
  </li>)}</ul>}
  {page?.nextCursor&&<button type="button" className={`${draftButton} mt-4`} disabled={busy} onClick={()=>void run(async()=>{
   const result=await productionWorkPublications.list(owner,kind,page.nextCursor,{signal:scope.current?.signal});if(!scope.current?.signal.aborted)setPage(result);
  })}>Следующая страница</button>}
  {editor&&<section className="mt-6 min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-label="Редактор публикации">
   <h2 className="mb-4 text-xl font-bold">Редактирование</h2>
   <fieldset disabled={!visible} className="min-w-0"><WorkPublicationForm key={`${editor.id}:${editor.revision}`} owner={owner} kind={kind} initial={editor}
    onDirtyChange={setEditorDirty} onSaved={value=>{setEditorDirty(false);setEditor(value);setPage(current=>current?{...current,items:current.items.map(item=>item.id===value.id?
     {...item,title:value.form.title,revision:value.revision,status:value.status,paid:value.paid,updatedAt:value.updatedAt}:item)}:null);}}/></fieldset>
   {editorDirty?<p className="mt-4 text-sm text-slate-600">Сохраните изменения, чтобы отправить эту версию на модерацию.</p>:<WorkModerationStatus key={`moderation:${editor.id}:${editor.revision}`} owner={owner} snapshot={editor}/>}
   <button type="button" className={`${draftButton} mt-4`} onClick={()=>{if(window.confirm('Закрыть редактор? Несохранённые правки будут потеряны.'))setEditor(null);}}>Закрыть редактор</button>
  </section>}
 </div>;
}
export function WorkPublicationsPanel({kind,initialId}:{kind:WorkPublicationKind;initialId?:string}){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);
 const visible=!!owner&&owner===scope;
 return <section aria-label={kind==='vacancy'?'Мои вакансии':'Мои заказы'}>
  {!visible&&<div className="mt-4" role="status"><p>{auth?.state==='signed-out'?'Войдите в аккаунт.':'Проверяем доступ. Введённые данные временно скрыты.'}</p>
   {auth?.state==='unavailable'&&<button type="button" className={`${draftButton} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</div>}
  {scope&&<Workspace key={`${scope}:${kind}:${initialId??''}`} owner={scope} kind={kind} visible={visible} initialId={initialId}/>}
 </section>;
}
