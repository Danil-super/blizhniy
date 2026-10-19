"use client";
import Link from 'next/link';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {AccountAuthSnapshot} from '@/lib/account-session-state';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {parseApplicationCreate,type ApplicationCreateInput,type ApplicationKind} from '@/lib/application-contract';
import {productionApplications,ApplicationClientError,applicationMatchesInput,type ApplicationPreview} from '@/lib/client-applications';
import type {ApplicationSnapshot} from '@/lib/postgres-applications';
import {applicationButton,applicationLabels,applicationTargetHref} from './ApplicationDetail';

type Intent={input:ApplicationCreateInput;phase:'unknown'|'retry'};
function Workspace({owner,kind,targetId,visible}:{owner:string;kind:ApplicationKind;targetId:string;visible:boolean}){
 const [review,setReview]=useState<ApplicationPreview|null>(null),[fresh,setFresh]=useState(false),[text,setText]=useState(''),[issue,setIssue]=useState<string|null>(null);
 const [saved,setSaved]=useState<ApplicationSnapshot|null>(null),[intent,setIntent]=useState<Intent|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[needsProfile,setNeedsProfile]=useState(false);
 const controller=useRef<AbortController|null>(null),pending=useRef<object|null>(null),message=useRef<HTMLTextAreaElement>(null),alert=useRef<HTMLParagraphElement>(null),success=useRef<HTMLHeadingElement>(null),prefix=useId();
 const run=useCallback(async(work:(signal:AbortSignal)=>Promise<void>)=>{
  const current=controller.current;if(!current||current.signal.aborted||pending.current)return;const attempt={};pending.current=attempt;setBusy(true);setError(null);
  try{await work(current.signal);}catch(error){if(!current.signal.aborted){setError(error instanceof Error?error.message:'Не удалось проверить отклик.');
   if(error instanceof ApplicationClientError&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);
   if(error instanceof ApplicationClientError&&error.code==='SPECIALIST_REQUIRED')setNeedsProfile(true);}}
  finally{if(pending.current===attempt){pending.current=null;if(!current.signal.aborted)setBusy(false);}}
 },[]);
 const load=useCallback(async(signal:AbortSignal)=>{
  setFresh(false);const value=await productionApplications.preview(owner,kind,targetId,{signal});if(signal.aborted)return;
  setReview(value);setFresh(true);setNeedsProfile(false);if(value.existing)setSaved(value.existing);
 },[owner,kind,targetId]);
 useEffect(()=>{const current=new AbortController();controller.current=current;void run(load);return()=>{current.abort();pending.current=null;};},[load,run]);
 useEffect(()=>{if(error)alert.current?.focus();},[error]);useEffect(()=>{if(saved)success.current?.focus();},[saved]);
 const locked=busy||!!intent;
 function submit(){
  if(!visible||busy||saved||!review||!fresh||intent?.phase==='unknown')return;
  let input:ApplicationCreateInput;
  try{input=intent?.input??parseApplicationCreate({kind,targetId,creationKey:crypto.randomUUID(),expectedTargetRevision:review.target.revision,specialistId:review.specialist.id,expectedSpecialistRevision:review.specialist.revision,message:text});}
  catch{setIssue('Сообщение должно содержать не более 3000 символов, без управляющих знаков.');message.current?.focus();return;}
  const retry=!!intent;
  void run(async signal=>{setIntent({input,phase:'unknown'});try{const value=await productionApplications.create(owner,input,{signal});if(!signal.aborted){setSaved(value);setIntent(null);}}
   catch(error){if(!signal.aborted&&!retry&&error instanceof ApplicationClientError&&error.code!=='UNKNOWN'){setIntent(null);setFresh(false);}throw error;}});
 }
 function recover(){if(!visible||intent?.phase!=='unknown')return;const original=intent;
  void run(async signal=>{const value=await productionApplications.intent(owner,original.input.creationKey,{signal});if(signal.aborted)return;
   if(value){if(!applicationMatchesInput(value,original.input))throw new ApplicationClientError('UNKNOWN');setSaved(value);setIntent(null);}
   else{setIntent({...original,phase:'retry'});setError('Отклик пока не найден. Можно повторить только исходное сохранение; сообщение и ключ сохранены.');}});
 }
 return <div hidden={!visible} inert={!visible} className="mt-3 min-w-0" aria-busy={busy}>
  {busy&&<p role="status" className="mb-3 text-sm text-slate-700">Проверяем отклик…</p>}
  {error&&<p ref={alert} tabIndex={-1} role="alert" className="mb-3 break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  {saved?<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><h3 ref={success} tabIndex={-1} className="font-semibold text-slate-950">{saved.status==='pending_payment'?'Отклик сохранён. Ожидает оплаты.':`Ваш отклик: ${applicationLabels[saved.status]}.`}</h3>
   {!saved.sentAt&&<p className="mt-2 text-sm text-slate-800">Получатель ещё не получил отклик. {saved.paid?'Отправку должен подтвердить сервер.':'Платёжный сценарий ещё не подключён; деньги не списаны.'}</p>}
   <Link href="/cabinet/otkliki" className={`${applicationButton} mt-3`}>Мои отклики</Link></div>:<>
   {needsProfile&&<Link href="/cabinet/specialist" className={`${applicationButton} mb-3`}>Заполнить анкету</Link>}
   {!fresh&&!busy&&<button type="button" className={`${applicationButton} mb-3`} disabled={!!intent} onClick={()=>{if(visible&&!intent)void run(load);}}>Обновить данные отклика</button>}
   {review&&<form noValidate className="grid min-w-0 gap-3" onSubmit={event=>{event.preventDefault();submit();}}>
    <p className="break-words text-sm text-slate-800">В отклик попадёт ваша опубликованная анкета: <strong>{review.specialist.snapshot.name}</strong>, {review.specialist.snapshot.profession}.</p>
    <p className="text-sm text-slate-700">Сначала сохраните сообщение. Доставка получателю — после подтверждения оплаты сервером, без повторного ввода анкеты.</p>
    <div className="grid min-w-0 gap-1"><label htmlFor={`${prefix}-message`} className="text-sm font-semibold text-slate-950">Сообщение</label><textarea id={`${prefix}-message`} ref={message} value={text} disabled={locked} aria-invalid={!!issue} aria-describedby={`${prefix}-hint${issue?` ${prefix}-error`:''}`} onChange={event=>{if(!visible||locked)return;setText(event.target.value);setIssue(null);setError(null);}} className="min-h-28 w-full min-w-0 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 disabled:bg-slate-100"/></div>
    <p id={`${prefix}-hint`} className="text-sm text-slate-600">Необязательно. До 3000 символов. Контакты будут взяты из вашей анкеты.</p>
    {issue&&<p id={`${prefix}-error`} className="text-sm text-rose-800">{issue}</p>}
    {intent?.phase==='unknown'?<><p className="text-sm text-slate-800">Результат сохранения не подтверждён. Сначала проверьте его, чтобы не создавать повторный отклик.</p><button type="button" className={applicationButton} disabled={busy} onClick={recover}>Проверить сохранение</button></>:<button type="submit" disabled={busy||!fresh} className={applicationButton}>{intent?'Повторить то же сохранение':'Сохранить отклик'}</button>}
   </form>}
  </>}
 </div>;
}
export function PrimaryApplicationComposer({auth,kind,targetId}:{auth:AccountAuthSnapshot;kind:ApplicationKind;targetId:string}){
 const owner=auth.state==='signed-in'||auth.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth.state==='signed-out'&&scope)setScope(null);const visible=!!owner&&owner===scope;
 return <section aria-label="Отклик на публикацию" className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"><h2 className="text-lg font-bold text-slate-950">Откликнуться</h2>
  {!visible&&<div role="status" className="mt-3 text-sm text-slate-700">{auth.state==='signed-out'?<><p>Войдите, чтобы откликнуться своей анкетой специалиста.</p><Link href={`/auth?returnTo=${encodeURIComponent(applicationTargetHref(kind,targetId))}`} className={`${applicationButton} mt-3`}>Войти и откликнуться</Link></>:<><p>Проверяем доступ. Сообщение временно скрыто.</p>{auth.state==='unavailable'&&<button type="button" className={`${applicationButton} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</>}</div>}
  {scope&&<Workspace key={`${kind}:${targetId}:${scope}`} owner={scope} kind={kind} targetId={targetId} visible={visible}/>}
 </section>;
}
