"use client";
import {useEffect,useRef,useState} from 'react';import Link from 'next/link';import {Bell,X} from 'lucide-react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';import {notifyAccountSessionChange} from '@/lib/local-account';
import {notificationInbox,InboxClientError} from '@/lib/client-notification-inbox';
import type {InboxPage} from '@/lib/postgres-notification-inbox';import type {ListingDraftCursor} from '@/lib/listing-draft-contract';
const button='min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-500';
const trigger='relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-green-800 shadow-sm hover:bg-white';
const panelClass='fixed right-3 top-12 z-[100] max-h-[calc(100dvh-4rem)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl md:absolute md:right-0 md:top-[calc(100%+8px)]';
const formatDate=(value:string)=>new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));

function InboxWorkspace({owner,visible,onOpenChange}:{owner:string;visible:boolean;onOpenChange:(open:boolean)=>void}){
 const [open,setOpen]=useState(false),[page,setPage]=useState<InboxPage|null>(null),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[message,setMessage]=useState<string|null>(null);
 const scope=useRef<AbortController|null>(null),pending=useRef(false),root=useRef<HTMLDivElement>(null),toggle=useRef<HTMLButtonElement>(null);
 useEffect(()=>onOpenChange(open),[open,onOpenChange]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>controller.abort();},[owner]);
 useEffect(()=>{
  function outside(event:PointerEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}
  function escape(event:KeyboardEvent){if(open&&visible&&event.key==='Escape'){setOpen(false);toggle.current?.focus();}}
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open,visible]);
 async function run(work:()=>Promise<void>){
  if(pending.current)return;pending.current=true;setBusy(true);setMessage(null);
  try{await work();}catch(error){if(!scope.current?.signal.aborted){setMessage(error instanceof Error?error.message:'Не удалось загрузить уведомления.');
   if(error instanceof InboxClientError&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}}
  finally{pending.current=false;if(!scope.current?.signal.aborted)setBusy(false);}
 }
 async function read(after:ListingDraftCursor|null){
  const result=await notificationInbox.list(owner,after,{signal:scope.current?.signal});if(scope.current?.signal.aborted)return;
  setPage(result);setUnknown(false);
 }
 function refresh(after:ListingDraftCursor|null=null){void run(()=>read(after));}
 function mark(action:'read'|'dismiss'){
  if(!page||unknown||!visible)return;const ids=page.items.filter(item=>action==='dismiss'||!item.read).map(item=>item.id);if(!ids.length)return;
  void run(async()=>{setUnknown(true);await notificationInbox.mark(owner,action,ids,{signal:scope.current?.signal});await read(null);});
 }
 return <div className="relative" ref={root} hidden={!visible} inert={!visible}>
  <button type="button" ref={toggle} className={trigger} aria-label="Уведомления" aria-expanded={open} onClick={()=>{setOpen(value=>!value);if(!open&&!page)refresh();}}>
   <Bell className="h-[18px] w-[18px]" aria-hidden="true"/>
   {page?.items.some(item=>!item.read)&&<span className="absolute right-0 top-0 h-3 w-3 rounded-full bg-rose-600 ring-2 ring-white" aria-label="На странице есть непрочитанные уведомления"/>}
  </button>
  {open&&<section className={panelClass} aria-label="Личные уведомления" aria-busy={busy}>
   <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4"><div><p className="font-bold text-slate-950">Уведомления</p><p className="mt-1 text-sm text-slate-600">События вашего аккаунта</p></div>
    <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100" aria-label="Закрыть уведомления" onClick={()=>{setOpen(false);toggle.current?.focus();}}><X aria-hidden="true" className="h-5 w-5"/></button></div>
   <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
    <button type="button" className={button} disabled={busy} onClick={()=>refresh()}>{unknown?'Проверить уведомления':'Обновить'}</button>
    {!!page?.items.length&&<><button type="button" className={button} disabled={busy||unknown||!page.items.some(item=>!item.read)} onClick={()=>mark('read')}>Прочитать показанные</button>
     <button type="button" className={button} disabled={busy||unknown} onClick={()=>mark('dismiss')}>Убрать показанные</button></>}
   </div>
   {message&&<p role="alert" className="border-b border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{message}</p>}
   {busy&&<p role="status" className="p-3 text-sm text-slate-600">Загружаем уведомления…</p>}
   {page?.items.map(item=><article key={item.id} className={`break-words border-b border-slate-200 p-4 ${item.read?'bg-white':'bg-blue-50'}`}>
    <p className="font-bold text-slate-950">{item.title}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{item.message}</p>
    <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-600"><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time><span>{item.read?'Прочитано':'Новое'}</span></div>
    {item.actionHref&&<Link href={item.actionHref} className="mt-2 inline-flex min-h-11 items-center font-semibold text-blue-800 underline">Открыть в кабинете</Link>}
   </article>)}
   {page?.items.length===0&&<p role="status" className="p-6 text-center text-sm text-slate-600">Уведомлений пока нет.</p>}
   {page?.nextCursor&&<div className="p-3"><button type="button" className={button} disabled={busy||unknown} onClick={()=>refresh(page.nextCursor)}>Более ранние</button></div>}
  </section>}
 </div>;
}

export function PrimaryNotificationBell(){
 const auth=usePrimaryAccountAuth(),current=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null,[owner,setOwner]=useState(current),[open,setOpen]=useState(false);
 if(current&&current!==owner)setOwner(current);if(auth?.state==='signed-out'&&owner)setOwner(null);const visible=!!current&&current===owner;
 return <>{owner&&<InboxWorkspace key={owner} owner={owner} visible={visible} onOpenChange={setOpen}/>}
  {!visible&&<div className="relative"><button type="button" className={trigger} aria-label="Уведомления" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Bell className="h-[18px] w-[18px]" aria-hidden="true"/></button>
   {open&&<div className={panelClass} role="status"><div className="p-4 text-sm text-slate-700">
    {auth?.state==='signed-out'?<><p>Уведомления доступны после входа.</p><Link className="mt-3 inline-flex min-h-11 items-center font-semibold text-blue-800 underline" href="/auth">Войти в аккаунт</Link></>:
     auth?.state==='unavailable'?<><p>Не удалось проверить вход.</p><button type="button" className={`${button} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку</button></>:<p>Проверяем вход. Личные сообщения временно скрыты.</p>}
   </div></div>}
  </div>}
 </>;
}
