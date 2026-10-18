"use client";
import {useEffect,useRef,useState,type RefObject} from 'react';
import {createWorkPublicationSave} from '@/lib/work-publication-save';
import {productionWorkPublications} from '@/lib/client-work-publications';
import {productionListingMedia} from '@/lib/client-listing-media';
import {workModeration} from '@/lib/client-work-moderation';
import {readWorkPublicationFormData} from '@/lib/work-publication-form-data';
import {checkWorkPublicationForm,type WorkPublicationKind} from '@/lib/work-publication-contract';
import type {WorkPublicationSnapshot} from '@/lib/postgres-work-publications';
import {useDraftLeaveGuard} from '@/components/listings/useDraftLeaveGuard';

export function useWorkPublicationSave(owner:string,kind:WorkPublicationKind,formRef:RefObject<HTMLFormElement|null>,dirty:boolean,initial?:WorkPublicationSnapshot,onSaved?:(value:WorkPublicationSnapshot)=>void){
 const attempt=useRef<ReturnType<typeof createWorkPublicationSave>|null>(null),pending=useRef(false),scope=useRef<AbortController|null>(null);
 const submission=useRef(false),draft=useRef(true);
 const [busy,setBusy]=useState(false),[active,setActive]=useState(false),[done,setDone]=useState(false),[uncertain,setUncertain]=useState(false);
 const [message,setMessage]=useState<string|null>(null),[remote,setRemote]=useState<WorkPublicationSnapshot|null>(null);
 useDraftLeaveGuard((dirty||active)&&!done);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>controller.abort();},[]);
 useEffect(()=>{if(done&&!onSaved)window.location.assign(kind==='vacancy'?'/cabinet/vakansii':'/cabinet/zakazy');},[done,kind,onSaved]);
 function finish(value:WorkPublicationSnapshot){
  setDone(true);onSaved?.(value);
 }
 async function submitOrFinish(value:WorkPublicationSnapshot){
  if(!draft.current){submission.current=true;setUncertain(true);const result=await workModeration.submit(owner,kind,value.id,value.revision,{signal:scope.current?.signal});
   submission.current=false;setUncertain(false);if(result.state==='rejected'){setMessage(`Модератор просит исправления: ${result.note}`);return;}
   if(!['pending','approved'].includes(result.state))throw Error('Проверьте статус модерации в кабинете.');}
  if(!scope.current?.signal.aborted)finish(value);
 }
 async function run(work:()=>Promise<void>){
  if(pending.current)return;pending.current=true;setBusy(true);setMessage(null);
  try{await work();}catch(error){if(!scope.current?.signal.aborted)setMessage(error instanceof Error?error.message:'Не удалось подтвердить сохранение.');}
  finally{pending.current=false;if(!scope.current?.signal.aborted){setBusy(false);setUncertain(!!attempt.current?.uncertain||submission.current);}}
 }
 async function start(asDraft:boolean){
  if(pending.current||uncertain||!formRef.current)return;
  const form=formRef.current;
  if(!attempt.current&&!asDraft&&!form.reportValidity())return;
  await run(async()=>{
   if(!attempt.current){
    const data=new FormData(form),parsed=readWorkPublicationFormData(kind,data),input={...parsed,photoIds:data.getAll('keepPhotoIds').map(String)};
    if(!asDraft){const issues=checkWorkPublicationForm(input);if(issues.length)throw Error(issues.join(' '));}
    const files=data.getAll('photos').filter((item):item is File=>item instanceof File&&item.size>0);
    draft.current=asDraft;attempt.current=createWorkPublicationSave(owner,kind,input,files,{...productionWorkPublications,upload:productionListingMedia.upload},initial);setActive(true);
   }
   const saved=await attempt.current.save({signal:scope.current?.signal});await submitOrFinish(saved);
  });
 }
 async function readback(){await run(async()=>{
  if(submission.current){const saved=attempt.current!.completed!;
   const value=await workModeration.read(owner,kind,saved.id,saved.revision,{signal:scope.current?.signal});
   submission.current=false;if(['pending','approved'].includes(value.state)){finish(saved);return;}
   setMessage(value.state==='rejected'?`Модератор просит исправления: ${value.note}`:'Отправка не подтверждена. Нажмите «Отправить на модерацию» для сохранённой версии.');return;
  }
  const value=await attempt.current!.readback({signal:scope.current?.signal});
  if(attempt.current!.completed)await submitOrFinish(attempt.current!.completed);
  else if(value)setRemote(value);else setMessage('Запись не найдена. Можно повторить сохранение с тем же идентификатором.');
 });}
 return{start,readback,busy,active,done,uncertain,message,remote,acceptRemote:()=>{attempt.current!.acceptRemoteRevision();setRemote(null);setUncertain(false);}};
}
