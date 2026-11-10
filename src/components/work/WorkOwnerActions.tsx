"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {workOwnerActions,WorkOwnerActionClientError} from '@/lib/client-work-owner-actions';
import type {WorkOwnerAction} from '@/lib/work-owner-actions-contract';
import type {WorkOwnerActionResult} from '@/lib/postgres-work-owner-actions';
import type {WorkCabinetItem} from '@/lib/work-cabinet-contract';
const button='min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-[#0875d1] hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-50';
export function WorkOwnerActions({owner,item,onChanged}:{owner:string;item:WorkCabinetItem;onChanged:(result:WorkOwnerActionResult)=>void}){
 const [action,setAction]=useState<WorkOwnerAction['action']|null>(null),[reason,setReason]=useState(''),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),pending=useRef<WorkOwnerAction|null>(null),sending=useRef(false),id=useId();
 const opened=action!==null;
 useEffect(()=>{if(!opened)return;const node=dialog.current;if(!node)return;node.showModal();return()=>node.close();},[opened]);
 function open(){setAction(pending.current?.action??(item.status==='published'?'withdraw':item.status==='archived'?'restore':'remove'));}
 async function submit(){
  if(sending.current||!action)return;sending.current=true;setBusy(true);setError(null);
  const input=pending.current??{operationId:crypto.randomUUID(),publicationId:item.id,kind:item.kind,expectedRevision:item.revision,action,reason:action==='restore'?null:reason};pending.current=input;
  try{const result=await workOwnerActions.change(owner,input);pending.current=null;setUnknown(false);setAction(null);onChanged(result);}
  catch(cause){const uncertain=!(cause instanceof WorkOwnerActionClientError)||cause.code==='UNKNOWN';setUnknown(uncertain);if(!uncertain)pending.current=null;setError(cause instanceof Error?cause.message:'Не удалось выполнить действие.');}
  finally{sending.current=false;setBusy(false);}
 }
 return <>
  <button type="button" className={button} onClick={open} aria-label={`Действия: ${item.title||'Без названия'}`}>Действия</button>
  <dialog ref={dialog} aria-labelledby={`${id}-title`} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/40" onCancel={event=>{if(busy)event.preventDefault();else setAction(null);}} onClose={()=>setAction(null)}>
   <h2 id={`${id}-title`} className="break-words text-lg font-bold">{item.title||'Без названия'}</h2>
   <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Действие с публикацией">
    {(item.status==='published'?['withdraw','remove']:item.status==='archived'?['restore','remove']:['remove']).map(value=><button key={value} type="button" disabled={busy||unknown} aria-pressed={action===value} className={`${button} ${action===value?'border-blue-400 bg-blue-50':''}`} onClick={()=>{setAction(value as WorkOwnerAction['action']);setError(null);}}>{value==='withdraw'?'Снять с публикации':value==='restore'?'Опубликовать снова':'Удалить'}</button>)}
   </div>
   <p className="mt-4 text-sm leading-6 text-slate-600">{action==='restore'?'Публикация вернётся на оставшийся оплаченный срок.':action==='remove'?'Публикация исчезнет из кабинета и каталога. История оплаты и откликов сохранится.':'Публикация исчезнет из каталога. Её можно вернуть в пределах оплаченного срока.'}</p>
   <form className="mt-4" onSubmit={event=>{event.preventDefault();void submit();}}>
    {action!=='restore'&&<><label className="block text-sm font-semibold" htmlFor={`${id}-reason`}>Причина</label><textarea id={`${id}-reason`} value={reason} required maxLength={500} disabled={busy||unknown} onChange={event=>setReason(event.target.value)} className="mt-2 block min-h-24 w-full rounded-lg border border-slate-300 p-3 font-normal focus:border-blue-500 focus:outline-blue-500"/></>}
    {error&&<p className="mt-3 break-words text-sm text-rose-700" role="alert">{error}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={()=>setAction(null)}>Отмена</button><button type="submit" disabled={busy||(action!=='restore'&&!reason.trim())} className={`${button} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`}>{busy?'Выполняем…':unknown?'Проверить / повторить':'Подтвердить'}</button></div>
   </form>
  </dialog>
 </>;
}
