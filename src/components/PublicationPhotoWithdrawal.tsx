"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {WorkCabinetPhoto} from '@/components/work/WorkCabinetPhoto';
import {postPublicationPrivacy,type PublicationPrivacyTarget} from '@/lib/client-publication-privacy';
import {parseListingDraftCursor} from '@/lib/listing-draft-contract';
import {parseListingPhotoIds} from '@/lib/listing-photo-contract';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {PublicationConsent} from './PublicationConsent';

type Photo={id:string;withdrawnAt:string|null};

export function PublicationPhotoWithdrawal(target:PublicationPrivacyTarget){
 const [open,setOpen]=useState(false);
 return <details className="my-3 rounded-lg border border-slate-200 p-3 text-sm" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-blue-800 underline">
   {target.kind==='specialist'?'Видимость фото профиля':'Видимость фотографий'}
  </summary>
  {open&&<PhotoChooser {...target}/>}
 </details>;
}

function PhotoChooser({owner,kind,publicationId}:PublicationPrivacyTarget){
 const [photos,setPhotos]=useState<Photo[]>(),[id,setId]=useState(''),[confirm,setConfirm]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [consentEnabled,setConsentEnabled]=useState(false),[previewKey,setPreviewKey]=useState('');
 const scope=useRef<AbortController|null>(null);
 const primary=useRef<HTMLButtonElement>(null),result=useRef<HTMLParagraphElement>(null);
 const recentlySaved=useRef<string|undefined>(undefined);
 const selected=photos?.find(photo=>photo.id===id);

 const request=useCallback(async (remove?:string)=>{
  const controller=scope.current;if(!controller||controller.signal.aborted)return;
  setBusy(true);setError(false);
  try{
   const response=await postPublicationPrivacy({owner,kind,publicationId},
    remove?{action:'withdraw-photo',photoId:remove}:{action:'photos'},controller.signal);
   if(controller.signal.aborted)return;
   if(response.status===401)notifyAccountSessionChange(false);
   if(!response.ok)throw Error();
   const data=await response.json();
   if(controller.signal.aborted)return;
   if(data.kind!==kind||data.publicationId!==publicationId)throw Error();
   const date=(value:unknown)=>parseListingDraftCursor({id:publicationId,updatedAt:value})!.updatedAt;
   if(remove){
    if(data.photoId!==remove)throw Error();
    const withdrawnAt=date(data.withdrawnAt);
    recentlySaved.current=remove;
    setPhotos(current=>current?.map(photo=>photo.id===remove?{...photo,withdrawnAt}:photo));
   }else{
    if(!Array.isArray(data.photos)||data.photos.length>10000)throw Error();
    const rows:Photo[]=data.photos;
    if(kind==='specialist'){
     if(rows.length>1||rows.some(photo=>photo.id!=='avatar'))throw Error();
    }else parseListingPhotoIds(rows.map(photo=>photo.id));
    const list=rows.map(photo=>({id:photo.id,withdrawnAt:photo.withdrawnAt===null?null:date(photo.withdrawnAt)}));
    setPhotos(list);
    setConsentEnabled(data.photoConsent===true);
    setId(current=>list.some(photo=>photo.id===current)?current:list[0]?.id??'');
   }
  }catch{if(!controller.signal.aborted)setError(true);}
  finally{if(!controller.signal.aborted){setBusy(false);setConfirm(false);}}
 },[owner,kind,publicationId]);

 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;
  void request();
  return ()=>controller.abort();
 },[request]);
 useEffect(()=>{
  if(selected?.withdrawnAt&&selected.id===recentlySaved.current){
   result.current?.focus({preventScroll:true});recentlySaved.current=undefined;
  }
 },[selected]);

 if(error)return <div className="grid gap-2">
  <p role="status">Не удалось подтвердить видимость фото.</p>
  <div><button className={draftButton} type="button" disabled={busy} onClick={()=>void request()}>Проверить видимость фото</button></div>
 </div>;
 if(!photos)return <p role="status">Загружаем фотографии…</p>;
 if(!selected)return <p role="status">Нет фотографий для скрытия.</p>;
 return <div className="grid gap-3">
  {kind!=='specialist'&&<>
   <label className="grid gap-1">Выберите фото
    <select value={id} disabled={busy} className="min-h-11 rounded border border-slate-500 bg-white px-2"
     onChange={event=>{setId(event.currentTarget.value);setPreviewKey('');setConfirm(false);}}>
     {photos.map((photo,index)=><option key={photo.id} value={photo.id}>{`Фото ${index+1}${photo.withdrawnAt?' — скрыто':''}`}</option>)}
    </select>
   </label>
   <div className="max-w-56"><WorkCabinetPhoto key={id} owner={owner} photoId={id} title="Выбранное фото"
    onReady={()=>setPreviewKey(owner+'|'+id)}/></div>
   {consentEnabled&&!selected.withdrawnAt&&previewKey===owner+'|'+id&&
    <PublicationConsent key={previewKey} owner={owner} kind={kind} publicationId={publicationId} category="photo" photoId={id}/>}
  </>}
  {selected.withdrawnAt?<p ref={result} tabIndex={-1} role="status">Фото скрыто в этой публикации.</p>:<>
   {confirm&&<p>{kind==='specialist'?'Фото профиля исчезнет из публичной анкеты. Остальные сведения в анкете сохранятся.':
    'Это фото, включая прежнюю публичную ссылку, будет скрыто в этой публикации. Карточка и остальные фото останутся доступны.'}</p>}
   <div className="flex flex-wrap gap-2">
    <button ref={primary} className={draftButton} type="button" disabled={busy} onClick={()=>{if(confirm)void request(id);else setConfirm(true);}}>
     {confirm?'Подтвердить скрытие фото':'Скрыть выбранное фото'}
    </button>
    {confirm&&<button className={draftButton} type="button" disabled={busy} onClick={()=>{setConfirm(false);primary.current?.focus();}}>Оставить фото</button>}
   </div>
  </>}
 </div>;
}
