"use client";
import {useCallback,useEffect,useRef,useState} from 'react';import Link from 'next/link';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';import {notifyAccountSessionChange} from '@/lib/local-account';
import {productionApplications,ApplicationClientError} from '@/lib/client-applications';
import type {ApplicationPage,ApplicationSnapshot} from '@/lib/postgres-applications';import type {ListingDraftCursor} from '@/lib/listing-draft-contract';
import {ApplicationDetail,applicationButton,applicationLabels,applicationTargetHref} from './ApplicationDetail';
import {ApplicationMessageEditor} from './ApplicationMessageEditor';
import {ApplicationCheckout} from './ApplicationCheckout';
import {useListingPostmoderation} from '@/components/listings/ListingWorkflowProvider';
type Mode='applicant'|'recipient';
function Workspace({owner,visible}:{owner:string;visible:boolean}){
 const local=useListingPostmoderation();
 const [mode,setMode]=useState<Mode>('applicant'),[page,setPage]=useState<ApplicationPage|null>(null),[selected,setSelected]=useState<ApplicationSnapshot|null>(null);
 const [busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[message,setMessage]=useState<string|null>(null),[success,setSuccess]=useState<string|null>(null);
 const [editing,setEditing]=useState(false);
 const [checkoutLocked,setCheckoutLocked]=useState(false),[withdrawConfirm,setWithdrawConfirm]=useState(false);
 const pending=useRef<object|null>(null),scope=useRef<AbortController|null>(null),openedFrom=useRef<HTMLButtonElement|null>(null);
 const run=useCallback(async(work:(signal:AbortSignal)=>Promise<void>)=>{
  const controller=scope.current;if(pending.current||!controller||controller.signal.aborted)return;const attempt={};pending.current=attempt;setBusy(true);setMessage(null);setSuccess(null);
  try{await work(controller.signal);}catch(error){if(!controller.signal.aborted){setMessage(error instanceof Error?error.message:'Не удалось загрузить отклики.');
   if(error instanceof ApplicationClientError&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}}
  finally{if(pending.current===attempt){pending.current=null;if(!controller.signal.aborted)setBusy(false);}}
 },[]);
 const load=useCallback(async(mode:Mode,after:ListingDraftCursor|null,signal:AbortSignal)=>{const result=await productionApplications.list(owner,mode,after,{signal});if(!signal.aborted){setMode(mode);setPage(result);}},[owner]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;pending.current=null;void run(signal=>load('applicant',null,signal));
  return()=>{controller.abort();pending.current=null;};
 },[owner,run,load]);
 function switchMode(next:Mode){if(unknown||editing||checkoutLocked||!visible)return;void run(async signal=>{await load(next,null,signal);if(!signal.aborted)setSelected(null);});}
 function applySaved(saved:ApplicationSnapshot){setSelected(saved);setUnknown(false);setPage(current=>current?{...current,items:current.items.map(item=>item.id===saved.id?{...item,status:saved.status,revision:saved.revision,paid:saved.paid,withdrawn:saved.withdrawn,targetClosed:saved.targetClosed,specialistName:saved.snapshot.name}:item)}:null);}
 function refresh(){if(!selected||!visible||editing||checkoutLocked)return;const id=selected.id;void run(async signal=>{
  const saved=await productionApplications.read(owner,id,{signal});if(!signal.aborted){applySaved(saved);setWithdrawConfirm(false);setSuccess('Актуальное состояние загружено.');
   setPage(current=>current?{...current,items:current.items.map(item=>item.id===saved.id?{...item,status:saved.status,revision:saved.revision,paid:saved.paid}:item)}:null);}
 });}
 function decide(state:'viewed'|'selected'|'rejected'){
  if(!visible||!selected||unknown||editing||checkoutLocked)return;const current=selected;void run(async signal=>{
   setUnknown(true);const saved=await productionApplications.decide(owner,current.id,current.revision,state,{signal});if(!signal.aborted){setSelected(saved);setUnknown(false);setSuccess('Решение сохранено.');
    setPage(page=>page?{...page,items:page.items.map(item=>item.id===saved.id?{...item,status:saved.status,revision:saved.revision}:item)}:null);
    if(local&&state==='selected'&&saved.target.kind==='workRequest')await load(mode,null,signal);}
  });
 }
 return <div hidden={!visible} inert={!visible} className="mt-5 min-w-0" aria-busy={busy}>
  <div className="flex flex-wrap gap-2" role="group" aria-label="Направление откликов">{([['applicant','Свои отклики'],['recipient','Входящие отклики']] as const).map(([value,label])=>
   <button key={value} type="button" className={applicationButton} aria-pressed={mode===value} disabled={busy||unknown||editing||checkoutLocked} onClick={()=>switchMode(value)}>{label}</button>)}
   <button type="button" className={applicationButton} disabled={busy||editing||checkoutLocked} onClick={()=>void run(signal=>load(mode,null,signal))}>Обновить список</button></div>
  {busy&&<p role="status" className="mt-4 text-slate-600">Загружаем отклики…</p>}
  {message&&<p role="alert" className="mt-4 break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">{message}</p>}
  {success&&<p role="status" className="mt-4 text-green-800">{success}</p>}
  {page?.items.length===0&&<div className="mt-5 rounded-xl border border-slate-200 bg-white p-5"><p className="font-semibold text-slate-800">{mode==='applicant'?'Вы ещё не откликались на вакансии и заказы.':'Входящих откликов пока нет.'}</p>
   <p className="mt-2 text-sm text-slate-600">{mode==='applicant'?'Выберите подходящую публикацию в разделе работы. Для отклика заполните и сохраните анкету специалиста. Её модерация не требуется.':'Здесь появятся доставленные отклики на ваши вакансии и заказы.'}</p>
   {mode==='applicant'&&<Link href="/rabota/vakansii" className={`${applicationButton} mt-4`}>Найти работу</Link>}</div>}
   {page&&<ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={mode==='applicant'?'Список своих откликов':'Список входящих откликов'}>{page.items.map(item=><li key={item.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className={`rounded-full px-3 py-1 text-xs font-semibold ${item.status==='selected'?'bg-emerald-50 text-emerald-800':item.status==='rejected'||item.withdrawn?'bg-slate-100 text-slate-700':'bg-blue-50 text-blue-800'}`}>{item.withdrawn?'Отозван':item.targetClosed&&item.status==='pending_payment'?'Заказ закрыт':applicationLabels[item.status]}</p><p className="text-xs text-slate-600">{item.kind==='vacancy'?'Вакансия':'Заказ'}</p></div>
    <Link href={applicationTargetHref(item.kind,item.targetId)} className="mt-3 inline-block min-h-11 break-words py-2 text-lg font-bold text-slate-950 hover:text-blue-800">{item.targetTitle}</Link>
    <div className="mt-2 flex items-center gap-2"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 font-bold text-blue-800">{item.specialistName.slice(0,1)}</span><p className="break-words text-sm font-medium text-slate-700">{item.specialistName}</p></div>
    <p className="mt-3 text-xs text-slate-600">{new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date(item.createdAt))}</p>
   <button type="button" className={`${applicationButton} mt-3`} disabled={busy||unknown||editing||checkoutLocked} onClick={event=>{if(!visible||editing||unknown||checkoutLocked)return;setWithdrawConfirm(false);openedFrom.current=event.currentTarget;void run(async signal=>{
    const saved=await productionApplications.read(owner,item.id,{signal});if(signal.aborted)return;setSelected(saved);setUnknown(false);
    if(local&&saved.view==='recipient'&&saved.status==='sent'){
     setUnknown(true);const viewed=await productionApplications.decide(owner,saved.id,saved.revision,'viewed',{signal});if(!signal.aborted)applySaved(viewed);
    }
   });}}>Подробнее</button>
  </li>)}</ul>}
  {page?.nextCursor&&<button type="button" className={`${applicationButton} mt-4`} disabled={busy||unknown||editing||checkoutLocked} onClick={()=>void run(signal=>load(mode,page.nextCursor,signal))}>Следующая страница</button>}
  {selected&&<ApplicationDetail key={selected.id} value={selected} busy={busy||editing||checkoutLocked} unknown={unknown} local={local} onDecision={decide} onRefresh={refresh}
   onEdit={local?()=>{if(visible&&!busy&&!unknown&&!checkoutLocked&&!selected.withdrawn&&selected.view==='applicant'&&selected.status==='pending_payment'&&!selected.paid&&!selected.sentAt)setEditing(true);}:undefined}
   onWithdraw={local?()=>setWithdrawConfirm(true):undefined}
   onClose={()=>{if(editing||unknown||busy||checkoutLocked)return;setSelected(null);setWithdrawConfirm(false);setSuccess(null);openedFrom.current?.focus();}}/>}
  {selected&&local&&!selected.targetClosed&&selected.view==='applicant'&&!selected.paid&&!selected.withdrawn&&selected.status==='pending_payment'&&<ApplicationCheckout key={selected.id} owner={owner} id={selected.id} revision={selected.revision} disabled={busy||unknown||editing||withdrawConfirm} onLockChange={setCheckoutLocked}/>}
  {selected&&withdrawConfirm&&<section aria-label="Подтверждение отзыва" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"><p className="text-sm text-slate-800">Отозвать неоплаченный отклик? История сохранится, доставка не состоится. Повторный отклик на эту публикацию сейчас недоступен.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={applicationButton} disabled={busy||unknown||checkoutLocked} onClick={()=>void run(async signal=>{setUnknown(true);const saved=await productionApplications.withdraw(owner,selected.id,selected.revision,{signal});if(!signal.aborted){applySaved(saved);setWithdrawConfirm(false);setSuccess('Отклик отозван.');}})}>Подтвердить отзыв</button><button type="button" className={applicationButton} disabled={busy||unknown} onClick={()=>setWithdrawConfirm(false)}>Оставить отклик</button></div></section>}
  {selected&&editing&&<ApplicationMessageEditor key={`${owner}:${selected.id}`} owner={owner} value={selected} visible={visible} onUnknownChange={setUnknown}
   onSaved={saved=>{applySaved(saved);setEditing(false);setSuccess('Изменения отклика сохранены.');}} onCancel={()=>{if(!unknown)setEditing(false);}}/>}
 </div>;
}
export function ApplicationsPanel(){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);const visible=!!owner&&owner===scope;
 return <section aria-label="Рабочие отклики">
  {!visible&&<div role="status" className="mt-4"><p>{auth?.state==='signed-out'?'Войдите в аккаунт.':'Проверяем доступ. Данные временно скрыты.'}</p>
   {auth?.state==='unavailable'&&<button type="button" className={`${applicationButton} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</div>}
  {scope&&<Workspace key={scope} owner={scope} visible={visible}/>}
 </section>;
}
