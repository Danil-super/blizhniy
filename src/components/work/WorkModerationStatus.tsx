"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {workModeration} from '@/lib/client-work-moderation';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import type {WorkPublicationSnapshot} from '@/lib/postgres-work-publications';
import type {WorkModerationState} from '@/lib/postgres-work-moderation';
const labels={not_submitted:'Не отправлено на модерацию',pending:'На модерации',approved:'Одобрено модератором',rejected:'Нужны исправления',outdated:'Форма изменена. Нужна повторная проверка'};
export function WorkModerationStatus({owner,snapshot}:{owner:string;snapshot:WorkPublicationSnapshot}){
 const [value,setValue]=useState<WorkModerationState|null>(null),[message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const pending=useRef(false),scope=useRef<AbortController|null>(null);
 const read=useCallback(async()=>{if(pending.current)return;const signal=scope.current?.signal;pending.current=true;setBusy(true);setMessage(null);
  try{const result=await workModeration.read(owner,snapshot.kind,snapshot.id,snapshot.revision,{signal});if(!signal?.aborted){setValue(result);setUncertain(false);}}
  catch(error){if(!signal?.aborted)setMessage(error instanceof Error?error.message:'Не удалось проверить статус.');}
  finally{pending.current=false;if(!signal?.aborted)setBusy(false);}
 },[owner,snapshot.kind,snapshot.id,snapshot.revision]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;void read();return()=>controller.abort();},[read]);
 async function submit(){if(pending.current||uncertain)return;pending.current=true;setBusy(true);setUncertain(true);setMessage(null);
  try{const result=await workModeration.submit(owner,snapshot.kind,snapshot.id,snapshot.revision,{signal:scope.current?.signal});if(!scope.current?.signal.aborted){setValue(result);setUncertain(false);}}
  catch(error){if(!scope.current?.signal.aborted)setMessage(error instanceof Error?error.message:'Проверьте статус отправки.');}
  finally{pending.current=false;if(!scope.current?.signal.aborted)setBusy(false);}}
 return <section aria-label="Модерация публикации" className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
  <h3 className="font-bold">Модерация</h3><p className="mt-2" role="status">{value?labels[value.state]:'Проверяем статус…'}</p>
  {value?.note&&<p className="mt-2 break-words">Причина: {value.note}</p>}
  <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={busy} onClick={()=>void read()}>Обновить статус модерации</button>
   {(!value||['not_submitted','outdated'].includes(value.state))&&<button type="button" className={draftButton} disabled={busy||uncertain} onClick={()=>void submit()}>Отправить на модерацию</button>}</div>
  {message&&<p role="alert" className="mt-3 break-words text-rose-700">{message}</p>}
 </section>;
}
