"use client";
import {useEffect,useRef,useState} from 'react';import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';import {notifyAccountSessionChange} from '@/lib/local-account';
import {servicePublications,type ServicePage} from '@/lib/client-service-publications';import type {ServicePublicationKind} from '@/lib/service-publication-contract';import type {ServicePublicationSnapshot} from '@/lib/postgres-service-publications';
import {draftButton} from '@/components/listings/PrivateDraftEditor';import {ServicePublicationForm,serviceFormLabels} from './ServicePublicationForm';import {ServiceModerationStatus} from './ServiceModerationStatus';
function Workspace({owner,kind,visible,create}:{owner:string;kind:ServicePublicationKind;visible:boolean;create:boolean}){
 const [page,setPage]=useState<ServicePage|null>(null),[editor,setEditor]=useState<ServicePublicationSnapshot|null|undefined>(null),[dirty,setDirty]=useState(false),[message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const pending=useRef(false),scope=useRef<AbortController|null>(null);
 async function run(work:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setMessage(null);
  try{await work();}catch(error){if(!scope.current?.signal.aborted){setMessage(error instanceof Error?error.message:'Не удалось загрузить материалы.');if(error&&typeof error==='object'&&'code'in error&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}}
  finally{pending.current=false;if(!scope.current?.signal.aborted)setBusy(false);}
 }
 useEffect(()=>{const controller=new AbortController();scope.current=controller;
  void run(async()=>{const result=await servicePublications.list(owner,kind,null,{signal:controller.signal});if(controller.signal.aborted)return;setPage(result);
   if(kind==='specialist'){
    const first=result.items[0],saved=first?await servicePublications.read(owner,kind,first.id,{signal:controller.signal}):undefined;if(!controller.signal.aborted)setEditor(saved);
   }else if(create)setEditor(undefined);
  });return()=>controller.abort();
 },[owner,kind,create]);
 function saved(value:ServicePublicationSnapshot){setEditor(value);setDirty(false);setMessage('Материал сохранён.');setPage(current=>current?{...current,items:[{id:value.id,kind:value.kind,title:value.form.title,revision:value.revision,status:value.status,paid:value.paid,updatedAt:value.updatedAt},...current.items.filter(item=>item.id!==value.id)].slice(0,20)}:null);}
 return <div hidden={!visible} inert={!visible} className="min-w-0">
  <div className="flex flex-wrap gap-3">{kind!=='specialist'&&page&&<button type="button" className={draftButton} disabled={busy} onClick={()=>{if(dirty&&!window.confirm('Закрыть форму? Несохранённые изменения будут потеряны.'))return;setEditor(undefined);setDirty(false);setMessage(null);}}>{kind==='fair'?'Новая заявка на ярмарку':'Создать рекламный текст'}</button>}
   <button type="button" className={draftButton} disabled={busy} onClick={()=>void run(async()=>{const result=await servicePublications.list(owner,kind,null,{signal:scope.current?.signal});if(!scope.current?.signal.aborted){setPage(result);if(kind==='specialist'&&editor===null){const first=result.items[0];setEditor(first?await servicePublications.read(owner,kind,first.id,{signal:scope.current?.signal}):undefined);}}})}>Обновить список</button></div>
  {busy&&<p className="mt-3" role="status">Загружаем материалы…</p>}{message&&<p className="mt-3 break-words" role="status">{message}</p>}
  {!create&&kind!=='specialist'&&page&&<section className="mt-5" aria-label="Сохранённые материалы"><h2 className="text-lg font-bold">Мои материалы</h2>
   {page.items.length===0?<p className="mt-3">Материалов пока нет.</p>:<ul className="mt-3 grid gap-3">{page.items.map(item=><li key={item.id} className="rounded-lg border border-slate-200 bg-white p-3"><button type="button" className="min-h-11 break-words text-left font-bold text-blue-800 underline" disabled={busy} onClick={()=>void run(async()=>{
    if(dirty&&!window.confirm('Закрыть форму? Несохранённые изменения будут потеряны.'))return;const row=await servicePublications.read(owner,kind,item.id,{signal:scope.current?.signal});if(!scope.current?.signal.aborted){setEditor(row);setDirty(false);}
   })}>{item.title||'Без названия'}</button><p className="text-sm text-slate-600">{item.status==='draft'?'Сохранено':item.status==='published'?'Опубликовано':item.status==='archived'?'В архиве':item.status==='expired'?'Срок размещения истёк':'Ожидает размещения'}</p></li>)}</ul>}
   {page.nextCursor&&<button type="button" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>void run(async()=>{const result=await servicePublications.list(owner,kind,page.nextCursor,{signal:scope.current?.signal});if(!scope.current?.signal.aborted)setPage(result);})}>Следующая страница</button>}
  </section>}
  {editor!==null&&<section className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"><h2 className="mb-4 text-xl font-bold">{serviceFormLabels[kind]}</h2>
   <fieldset disabled={!visible} className="min-w-0"><ServicePublicationForm key={editor?`${editor.id}:${editor.revision}`:'new'} owner={owner} kind={kind} initial={editor} onSaved={saved}
    onDirtyChange={value=>{setDirty(value);if(value)setMessage(null);}}/></fieldset>
   {editor&&(dirty?<p className="mt-4 text-sm text-slate-600">Сохраните правки, чтобы отправить эту версию на модерацию.</p>:<ServiceModerationStatus key={`${editor.id}:${editor.revision}`} owner={owner} snapshot={editor}/>)}
  </section>}
 </div>;
}
export function ServicePublicationsPanel({kind,create=false}:{kind:ServicePublicationKind;create?:boolean}){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);const visible=!!owner&&owner===scope;
 return <section aria-label={serviceFormLabels[kind]}>{!visible&&<div className="mt-3" role="status"><p>{auth?.state==='signed-out'?'Войдите в аккаунт.':'Проверяем вход. Введённые данные временно скрыты.'}</p>
  {auth?.state==='unavailable'&&<button type="button" className={`${draftButton} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</div>}
  {scope&&<Workspace key={`${scope}:${kind}`} owner={scope} kind={kind} visible={visible} create={create}/>}
 </section>;
}
