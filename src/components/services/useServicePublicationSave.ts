"use client";
import {useEffect,useRef,useState,type RefObject} from 'react';
import {createServicePublicationSave,readServicePublicationFormData} from '@/lib/service-publication-save';
import {servicePublications,serviceModeration} from '@/lib/client-service-publications';import {productionListingMedia} from '@/lib/client-listing-media';
import {checkServicePublicationForm,type ServicePublicationKind} from '@/lib/service-publication-contract';import type {ServicePublicationSnapshot} from '@/lib/postgres-service-publications';
import {useDraftLeaveGuard} from '@/components/listings/useDraftLeaveGuard';
export function useServicePublicationSave(owner:string,kind:ServicePublicationKind,formRef:RefObject<HTMLFormElement|null>,dirty:boolean,initial:ServicePublicationSnapshot|undefined,onSaved:(value:ServicePublicationSnapshot)=>void){
 const attempt=useRef<ReturnType<typeof createServicePublicationSave>|null>(null),scope=useRef<AbortController|null>(null),pending=useRef(false),submission=useRef(false),draft=useRef(true);
 const [busy,setBusy]=useState(false),[active,setActive]=useState(false),[done,setDone]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState<string|null>(null),[remote,setRemote]=useState<ServicePublicationSnapshot|null>(null);
 useDraftLeaveGuard((dirty||active)&&!done);useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>controller.abort();},[]);
 function finish(value:ServicePublicationSnapshot){if(!scope.current?.signal.aborted){setDone(true);onSaved(value);}}
 async function submitOrFinish(value:ServicePublicationSnapshot){
  if(!draft.current){submission.current=true;setUncertain(true);await serviceModeration.submit(owner,kind,value.id,value.revision,{signal:scope.current?.signal});submission.current=false;setUncertain(false);}
  finish(value);
 }
 async function run(work:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setMessage(null);
  try{await work();}catch(error){if(!scope.current?.signal.aborted){
   if(attempt.current&&!attempt.current.uncertain&&!attempt.current.completed){attempt.current=null;setActive(false);}
   setMessage(error instanceof Error?error.message:'Не удалось подтвердить сохранение.');}}
  finally{pending.current=false;if(!scope.current?.signal.aborted){setBusy(false);setUncertain(!!attempt.current?.uncertain||submission.current);}}
 }
 async function start(asDraft:boolean){
  if(pending.current||uncertain||!formRef.current)return;const element=formRef.current;if(!attempt.current&&!asDraft&&!element.reportValidity())return;
  await run(async()=>{
   if(!attempt.current){const data=new FormData(element),form=readServicePublicationFormData(kind,data);if(!asDraft){const issues=checkServicePublicationForm(form);if(issues.length)throw Error(issues.join(' '));}
    const files=data.getAll('photos').filter((value):value is File=>value instanceof File&&value.size>0);draft.current=asDraft;
    attempt.current=createServicePublicationSave(owner,kind,form,files,{...servicePublications,upload:productionListingMedia.upload},initial);setActive(true);}
   await submitOrFinish(await attempt.current.save({signal:scope.current?.signal}));
  });
 }
 async function readback(){await run(async()=>{
  if(submission.current){const saved=attempt.current!.completed!,review=await serviceModeration.read(owner,kind,saved.id,saved.revision,{signal:scope.current?.signal});submission.current=false;
   if(review.state==='pending'||review.state==='approved'){finish(saved);return;}setMessage('Отправка не подтверждена. Откройте сохранённый материал и проверьте статус модерации.');finish(saved);return;}
  const value=await attempt.current!.readback({signal:scope.current?.signal});if(attempt.current!.completed)await submitOrFinish(attempt.current!.completed);
  else if(value)setRemote(value);else setMessage('Запись не найдена. Можно повторить сохранение с тем же идентификатором.');
 });}
 return{start,readback,busy,active,done,uncertain,message,remote,acceptRemote:()=>{attempt.current!.acceptRemoteRevision();setRemote(null);setUncertain(false);}};
}
