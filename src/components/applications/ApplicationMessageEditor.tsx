"use client";
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {parseApplicationEdit,type ApplicationEditInput} from '@/lib/application-contract';
import {productionApplications,ApplicationClientError,type ApplicationPreview} from '@/lib/client-applications';
import {notifyAccountSessionChange} from '@/lib/local-account';
import type {ApplicationSnapshot} from '@/lib/postgres-applications';
import {applicationButton} from './ApplicationDetail';

type Attempt={input:ApplicationEditInput;before:ApplicationSnapshot;phase:'unknown'|'retry'};
const editable=(value:ApplicationSnapshot)=>value.view==='applicant'&&!value.withdrawn&&value.status==='pending_payment'&&!value.paid&&!value.sentAt;
const sameTarget=(a:ApplicationSnapshot,b:ApplicationSnapshot)=>a.id===b.id&&a.view==='applicant'&&a.target.id===b.target.id&&a.target.kind===b.target.kind;
export function ApplicationMessageEditor({owner,value,visible,onSaved,onUnknownChange,onCancel}:{owner:string;value:ApplicationSnapshot;visible:boolean;onSaved:(value:ApplicationSnapshot)=>void;onUnknownChange:(value:boolean)=>void;onCancel:()=>void}){
 const [base,setBase]=useState(value),[message,setMessage]=useState(value.message),[review,setReview]=useState<ApplicationPreview|null>(null);
 const [attempt,setAttempt]=useState<Attempt|null>(null),[remote,setRemote]=useState<ApplicationSnapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const scope=useRef<AbortController|null>(null),pending=useRef<object|null>(null),textarea=useRef<HTMLTextAreaElement>(null),alert=useRef<HTMLParagraphElement>(null),prefix=useId();
 const callbacks=useRef({onSaved,onUnknownChange});callbacks.current={onSaved,onUnknownChange};
 const run=useCallback(async(work:(signal:AbortSignal)=>Promise<void>)=>{
  const controller=scope.current;if(!controller||controller.signal.aborted||pending.current)return;const token={};pending.current=token;setBusy(true);setError(null);
  try{await work(controller.signal);}catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Не удалось проверить отклик.');if(cause instanceof ApplicationClientError&&cause.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}}
  finally{if(pending.current===token){pending.current=null;if(!controller.signal.aborted)setBusy(false);}}
 },[]);
 const load=useCallback(async(candidate:ApplicationSnapshot,signal:AbortSignal)=>{
  setReview(null);const result=await productionApplications.preview(owner,candidate.target.kind,candidate.target.id,{signal});if(signal.aborted)return;
  const existing=result.existing;
  if(!existing||!sameTarget(existing,candidate)||existing.revision!==candidate.revision||!editable(existing)){
   setRemote(existing);setError('Отклик уже изменился или недоступен для редактирования. Ваш текст сохранён в форме.');return;
  }
  setBase(existing);setReview(result);setRemote(null);
 },[owner]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;pending.current=null;void run(signal=>load(value,signal));return()=>{controller.abort();pending.current=null;};},[owner,value.id,load,run,value]);
 useEffect(()=>{if(error)alert.current?.focus();},[error]);
 useEffect(()=>{if(review&&!busy&&!attempt)textarea.current?.focus();},[review,busy,attempt]);
 function accepts(saved:ApplicationSnapshot,input:ApplicationEditInput,before:ApplicationSnapshot){
  return sameTarget(saved,before)&&editable(saved)&&saved.revision===(BigInt(input.expectedRevision)+BigInt(1)).toString()&&saved.message===input.message&&saved.specialistId===input.specialistId;
 }
 function submit(){
  if(!visible||busy||pending.current||attempt?.phase==='unknown'||!review||!editable(base))return;
  let input:ApplicationEditInput;
  try{input=attempt?.input??parseApplicationEdit({applicationId:base.id,expectedRevision:base.revision,expectedTargetRevision:review.target.revision,specialistId:review.specialist.id,expectedSpecialistRevision:review.specialist.revision,message});}
   catch{setError('Сообщение: до 500 символов, без HTML-разметки и скрытых управляющих знаков.');textarea.current?.focus();return;}
  const before=attempt?.before??base,repeating=!!attempt;
  void run(async signal=>{
   setAttempt({input,before,phase:'unknown'});callbacks.current.onUnknownChange(true);
   try{const saved=await productionApplications.update(owner,input,{signal});if(signal.aborted)return;if(!accepts(saved,input,before))throw new ApplicationClientError('UNKNOWN');
    setAttempt(null);callbacks.current.onUnknownChange(false);callbacks.current.onSaved(saved);
   }catch(cause){if(!signal.aborted&&!repeating&&cause instanceof ApplicationClientError&&cause.code!=='UNKNOWN'){setAttempt(null);setReview(null);callbacks.current.onUnknownChange(false);}throw cause;}
  });
 }
 function recover(){
  if(!visible||busy||attempt?.phase!=='unknown')return;const original=attempt;
  void run(async signal=>{
   const saved=await productionApplications.read(owner,original.input.applicationId,{signal});if(signal.aborted)return;
   if(accepts(saved,original.input,original.before)){setAttempt(null);callbacks.current.onUnknownChange(false);callbacks.current.onSaved(saved);return;}
   if(sameTarget(saved,original.before)&&JSON.stringify(saved)===JSON.stringify(original.before)){
    setAttempt({...original,phase:'retry'});callbacks.current.onUnknownChange(false);setError('Изменений пока нет. Можно повторить только исходное сохранение; сообщение и версии сохранены.');return;
   }
   setRemote(saved);setReview(null);setAttempt(null);callbacks.current.onUnknownChange(false);setError('На сервере другая версия отклика. Ваши правки остались в форме; автоматического перезаписывания не было.');
  });
 }
 const locked=busy||!!attempt;
 return <section className="mt-4 min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-labelledby={`${prefix}-title`} aria-busy={busy}>
  <h3 id={`${prefix}-title`} className="text-lg font-bold text-slate-950">Редактирование отклика</h3>
  <p className="mt-2 text-sm text-slate-600">Сообщение можно изменить до начала оплаты и доставки. При сохранении обновится копия вашей анкеты.</p>
  {busy&&<p role="status" className="mt-3 text-sm text-slate-700">Проверяем данные отклика…</p>}
  {error&&<p ref={alert} tabIndex={-1} role="alert" className="mt-3 break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  {remote&&<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800"><p className="font-semibold">Сообщение на сервере</p><p className="mt-1 whitespace-pre-wrap break-words">{remote.message||'Без сообщения'}</p>
   {editable(remote)&&sameTarget(remote,base)&&<button type="button" className={`${applicationButton} mt-3`} disabled={busy||!!attempt} onClick={()=>{if(visible)void run(signal=>load(remote,signal));}}>Проверить новую версию, сохранив мои правки</button>}</div>}
  <form noValidate className="mt-3 grid min-w-0 gap-3" onSubmit={event=>{event.preventDefault();submit();}}>
   <label htmlFor={`${prefix}-message`} className="text-sm font-semibold text-slate-950">Сообщение</label>
    <textarea ref={textarea} id={`${prefix}-message`} name="message" maxLength={500} value={message} disabled={locked} aria-describedby={`${prefix}-hint`} onChange={event=>{if(!visible||locked)return;setMessage(event.target.value);setError(null);}} className="min-h-28 w-full min-w-0 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 disabled:bg-slate-100"/>
    <p id={`${prefix}-hint`} className="text-sm text-slate-600">{message.length} / 500 символов. Правки сохраняются только после нажатия кнопки.</p>
   {attempt?.phase==='unknown'?<><p className="text-sm text-slate-800">Результат не подтверждён. Не повторяйте сохранение или оплату, пока не проверите отклик.</p><button type="button" className={applicationButton} disabled={busy} onClick={recover}>Проверить сохранение</button></>:
    <div className="flex flex-wrap gap-2"><button type="submit" className={applicationButton} disabled={busy||!review}>{attempt?'Повторить то же сохранение':'Сохранить изменения'}</button>
     <button type="button" className={applicationButton} disabled={busy} onClick={()=>{if(visible)onCancel();}}>Отменить редактирование</button>
     {!review&&<button type="button" className={applicationButton} disabled={busy} onClick={()=>{if(visible)void run(signal=>load(base,signal));}}>Проверить данные отклика</button>}</div>}
  </form>
 </section>;
}
