"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {parseListingDraftCursor} from '@/lib/listing-draft-contract';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {postPublicationPrivacy,type PublicationPrivacyTarget} from '@/lib/client-publication-privacy';
import {PublicationPhotoWithdrawal} from './PublicationPhotoWithdrawal';
import {PublicationTextWithdrawal} from './PublicationTextWithdrawal';
import {PublicationLocationConsent} from './PublicationLocationConsent';

type Props=PublicationPrivacyTarget&{showUnavailable?:boolean};

export function PublicationPrivacyActions(props:Props){
 return <>
  {props.kind!=='marquee'&&<Withdrawal {...props} whole={false}/>}
  {props.kind!=='marquee'&&<PublicationPhotoWithdrawal {...props}/>}
  <PublicationTextWithdrawal {...props}/>
  <Withdrawal {...props} whole/>
 </>;
}

function Withdrawal({owner,kind,publicationId,showUnavailable,whole}:Props&{whole:boolean}){
 const [receipt,setReceipt]=useState<string|null>(),[confirm,setConfirm]=useState(false);
 const [available,setAvailable]=useState(true),[error,setError]=useState(false),[busy,setBusy]=useState(false);
 const [locationConsent,setLocationConsent]=useState(false);
 const scope=useRef<AbortController|null>(null),button=useRef<HTMLButtonElement>(null),result=useRef<HTMLParagraphElement>(null);
 const savedHere=useRef(false);

 const request=useCallback(async (statusOnly:boolean)=>{
  const controller=scope.current;
  if(!controller||controller.signal.aborted)return;
  setBusy(true);setError(false);
  try{
   const response=await postPublicationPrivacy({owner,kind,publicationId},
    {action:whole?statusOnly?'publication-status':'withdraw-publication':statusOnly?'status':undefined},controller.signal);
   if(controller.signal.aborted)return;
   if(statusOnly&&response.status===404){setAvailable(false);return;}
   if(response.status===401)notifyAccountSessionChange(false);
   if(!response.ok)throw Error();
   const data=await response.json();
   if(controller.signal.aborted)return;
   if(data.kind!==kind||data.publicationId!==publicationId)throw Error();
   const next=data.withdrawnAt===null&&statusOnly?null:
    parseListingDraftCursor({id:publicationId,updatedAt:data.withdrawnAt})!.updatedAt;
   savedHere.current=!statusOnly;
   setLocationConsent(statusOnly&&data.locationConsent===true);
   setReceipt(next);setConfirm(false);
  }catch{
   if(!controller.signal.aborted){setConfirm(false);setError(true);}
  }finally{
   if(!controller.signal.aborted)setBusy(false);
  }
 },[owner,kind,publicationId,whole]);

 useEffect(()=>{
  const controller=new AbortController();
  scope.current=controller;
  void request(true);
  return ()=>controller.abort();
 },[request]);
 useEffect(()=>{if(receipt&&savedHere.current)result.current?.focus({preventScroll:true});},[receipt]);

 if(!available)return showUnavailable&&!whole?<p className="px-3 py-2 text-sm text-slate-600">Управление публичным доступом недоступно.</p>:null;
 if(receipt===undefined&&!error&&!showUnavailable)return null;
 return <section aria-label={whole?'Доступ к публикации':'Точный адрес'} className="my-3 space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
  {error?<><p role="status">{whole?'Не удалось подтвердить состояние публикации.':'Не удалось подтвердить состояние точного адреса.'}</p>
   <button type="button" className={draftButton} disabled={busy} onClick={()=>void request(true)}>Проверить состояние</button></>:
   receipt===undefined?<p role="status">{whole?'Проверяем доступ к публикации…':'Проверяем состояние адреса…'}</p>:
   receipt?<p ref={result} tabIndex={-1} role="status">{whole?'Публикация скрыта.':'Точный адрес скрыт.'}</p>:
   <>
    {confirm&&<p>{whole?'Карточка, описание и фото перестанут быть доступны посетителям. Оплаченный срок продолжит идти. Если нужно разместить исправленный материал, обратитесь в поддержку.':
     'Адрес и точка на карте будут скрыты в этой карточке, в том числе после правок. Оплаченный срок сохраняется.'}</p>}
    <div className="flex flex-wrap gap-2">
     <button ref={button} type="button" className={draftButton} disabled={busy} onClick={()=>{
      if(confirm)void request(false);else setConfirm(true);
     }}>{confirm?(whole?'Подтвердить скрытие публикации':'Подтвердить скрытие'):(whole?'Скрыть всю публикацию':'Скрыть точный адрес')}</button>
     {confirm&&<button type="button" className={draftButton} disabled={busy} onClick={()=>{setConfirm(false);button.current?.focus();}}>Оставить как есть</button>}
    </div>
    {!whole&&locationConsent&&<PublicationLocationConsent key={owner+'|'+kind+'|'+publicationId} owner={owner} kind={kind} publicationId={publicationId}/>}
   </>}
 </section>;
}
