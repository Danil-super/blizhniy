"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {productionWorkPublications} from '@/lib/client-work-publications';
import type {WorkPublicationKind} from '@/lib/work-publication-contract';
import type {WorkPublicationSnapshot} from '@/lib/postgres-work-publications';
import {useListingPostmoderation} from '@/components/listings/ListingWorkflowProvider';
import {CheckoutCancellation,CheckoutCancellationFeedback} from '@/components/payments/CheckoutCancellation';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {WorkPublicationForm} from './WorkPublicationForm';
import {WorkModerationStatus} from './WorkModerationStatus';
import {PublicationPlacementPeriod} from '@/components/PublicationPlacementPeriod';
import {PublicationPrivacyActions} from '@/components/PublicationPrivacyActions';

function Editor({owner,kind,id,visible,hostedTest}:{hostedTest:boolean;owner:string;kind:WorkPublicationKind;id:string;visible:boolean}){
 const [snapshot,setSnapshot]=useState<WorkPublicationSnapshot|null>(null),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0),[dirty,setDirty]=useState(false),[cancellationPending,setCancellationPending]=useState(false);
 const [cancellationFocus,setCancellationFocus]=useState<boolean|null>(null);
 const localVacancy=useListingPostmoderation();
 useEffect(()=>{const controller=new AbortController();setError(null);
  void productionWorkPublications.read(owner,kind,id,{signal:controller.signal,includeCheckout:true}).then(value=>{if(!controller.signal.aborted)setSnapshot(value);}).catch(failure=>{
   if(controller.signal.aborted)return;setError(failure instanceof Error?failure.message:'Не удалось открыть публикацию.');
   if(failure?.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);
  });return()=>controller.abort();
 },[owner,kind,id,retry]);
 return <section hidden={!visible} inert={!visible} aria-label="Редактор публикации" className="mt-5 min-w-0">
  <Link href={kind==='vacancy'?'/cabinet/vakansii':'/cabinet/zakazy'} prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-blue-800 underline">← Вернуться в кабинет</Link>
  <CheckoutCancellationFeedback focusOnConfirmation={cancellationFocus}/>
  {error?<div><p role="alert" className="my-3 text-rose-800">{error}</p><button type="button" className="min-h-11 font-semibold text-blue-800 underline" onClick={()=>setRetry(value=>value+1)}>Повторить загрузку</button></div>:
   snapshot?<div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"><PublicationPlacementPeriod publishedAt={snapshot.publishedAt} expiresAt={snapshot.expiresAt} status={snapshot.status}/>
    {visible&&<PublicationPrivacyActions owner={owner} kind={kind} publicationId={snapshot.id}/>}
    {snapshot.activeCheckout?<section aria-label="Исходный заказ" className="grid gap-3">
     <p className="text-sm text-slate-700">Для этой публикации есть незавершённый заказ.</p>
     {!cancellationPending&&<div><Link href={`/oplata/${snapshot.activeCheckout.paymentId}?type=${kind}`} prefetch={false} className={draftButton}>
      {snapshot.activeCheckout.status==='succeeded'?'Проверить статус':'Продолжить'}
     </Link></div>}
     {snapshot.activeCheckout.status==='created'&&<CheckoutCancellation owner={owner} paymentId={snapshot.activeCheckout.paymentId}
      targetType={kind} visible={visible} editAfter onPendingChange={setCancellationPending}
      onCancelled={hadFocus=>{setCancellationFocus(hadFocus);setSnapshot(null);setRetry(value=>value+1);}}/>}
    </section>:<><WorkPublicationForm hostedTest={hostedTest} owner={owner} kind={kind} initial={snapshot} onDirtyChange={setDirty}/>
    {!localVacancy&&!dirty&&<WorkModerationStatus owner={owner} snapshot={snapshot}/>}</>}</div>:<p role="status" className="mt-4">Загружаем сохранённую форму…</p>}
 </section>;
}

/** Dedicated edit route: one owner read, never a cabinet list or a second form. */
export function PrimaryWorkPublicationEditor({kind,initialId}:{kind:WorkPublicationKind;initialId:string}){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth?.state==='signed-out'&&scope)setScope(null);const visible=!!owner&&owner===scope;
 return <>{!visible&&<div role="status"><p>{auth?.state==='signed-out'?'Войдите в аккаунт.':'Проверяем вход. Введённые данные временно скрыты.'}</p>
  {auth?.state==='unavailable'&&<button type="button" onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</div>}
  {scope&&<Editor key={`${scope}:${kind}:${initialId}`} owner={scope} kind={kind} id={initialId} visible={visible} hostedTest={visible&&auth?.workPublicationTest===true}/>}</>;
}
