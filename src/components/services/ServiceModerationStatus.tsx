"use client";
import Link from 'next/link';
import {useServiceCheckout,useSpecialistCheckout} from '@/components/listings/ListingWorkflowProvider';
import {PrivateListingCheckout,type ListingCheckoutAttempt} from '@/components/listings/PrivateListingCheckout';
import {useCallback,useEffect,useRef,useState} from 'react';import {serviceModeration} from '@/lib/client-service-publications';
import type {ServicePublicationSnapshot} from '@/lib/postgres-service-publications';import type {ServiceModerationState} from '@/lib/postgres-service-moderation';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
const labels={not_submitted:'Не отправлено на модерацию',pending:'На модерации',approved:'Одобрено модератором',rejected:'Нужны исправления',outdated:'Форма изменена. Нужна повторная проверка'};
type ModerationProps = {owner:string;snapshot:ServicePublicationSnapshot};
export function ServiceModerationStatus(props:ModerationProps){
 const {owner,snapshot}=props;
 return <RevisionModeration key={`${owner}:${snapshot.kind}:${snapshot.id}:${snapshot.revision}`} {...props}/>;
}
function RevisionModeration({owner,snapshot}:ModerationProps){
 const checkout=useServiceCheckout(),specialistCheckout=useSpecialistCheckout(),attempt=useRef<ListingCheckoutAttempt>({input:null,uncertain:false});
 const [value,setValue]=useState<ServiceModerationState|null>(null),[message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const pending=useRef(false),scope=useRef<AbortController|null>(null);
 const read=useCallback(async()=>{if(pending.current)return;const signal=scope.current?.signal;pending.current=true;setBusy(true);setMessage(null);
  try{const result=await serviceModeration.read(owner,snapshot.kind,snapshot.id,snapshot.revision,{signal});if(!signal?.aborted){setValue(result);setUncertain(false);}}
  catch(error){if(!signal?.aborted)setMessage(error instanceof Error?error.message:'Не удалось проверить статус.');}
  finally{if(!signal?.aborted){pending.current=false;setBusy(false);}}
 },[owner,snapshot.kind,snapshot.id,snapshot.revision]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;void read();return()=>{controller.abort();pending.current=false;};},[read]);
 async function submit(){if(pending.current||uncertain)return;const signal=scope.current?.signal;pending.current=true;setBusy(true);setUncertain(true);setMessage(null);
  try{const result=await serviceModeration.submit(owner,snapshot.kind,snapshot.id,snapshot.revision,{signal});if(!signal?.aborted){setValue(result);setUncertain(false);}}
  catch(error){if(!signal?.aborted)setMessage(error instanceof Error?error.message:'Проверьте отправку перед повтором.');}
  finally{if(!signal?.aborted){pending.current=false;setBusy(false);}}
 }
 return <section aria-label="Модерация материала" className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><h3 className="font-bold">Модерация</h3>
  <p className="mt-2" role="status">{value?labels[value.state]:'Проверяем статус…'}</p>{value?.note&&<p className="mt-2 break-words">Причина: {value.note}</p>}
  {value?.state==='approved'&&(snapshot.paid?<p className="mt-2 text-sm text-slate-600">{snapshot.status==='published'?'Размещение оплачено.':'Оплата сохранена. Проверьте статус размещения.'}</p>:specialistCheckout&&snapshot.kind==='specialist'?<PrivateListingCheckout owner={owner} id={snapshot.id} revision={snapshot.revision} attempt={attempt.current} specialist/>:checkout&&snapshot.kind!=='specialist'?<Link prefetch={false} className={draftButton+' mt-3'} href={`/cabinet/oplata-uslugi?type=${snapshot.kind}&id=${snapshot.id}&revision=${snapshot.revision}`}>Перейти к оплате</Link>:<p className="mt-2 text-sm text-slate-600">Материал одобрен. Оплата и размещение выполняются отдельно.</p>)}
  {value?.state==='rejected'&&<p className="mt-2 text-sm text-slate-600">Исправьте и сохраните форму, затем отправьте новую версию.</p>}
  <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={busy} onClick={()=>void read()}>Обновить статус модерации</button>
   {value&&['not_submitted','outdated'].includes(value.state)&&<button type="button" className={draftButton} disabled={busy||uncertain} onClick={()=>void submit()}>Отправить на модерацию</button>}</div>
  {message&&<p role="alert" className="mt-3 break-words text-rose-700">{message}</p>}
 </section>;
}
