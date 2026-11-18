"use client";
import {ensurePhoneForPlacement} from '@/lib/phone-placement';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {createWorkPublicationSave} from '@/lib/work-publication-save';
import {productionWorkPublications} from '@/lib/client-work-publications';
import {productionListingMedia,ListingMediaClientError} from '@/lib/client-listing-media';
import type {UploadedImage} from '@/lib/media-upload-contract';
import {workModeration} from '@/lib/client-work-moderation';
import {readWorkPublicationFormData} from '@/lib/work-publication-form-data';
import {checkWorkPublicationForm,type WorkPublicationKind} from '@/lib/work-publication-contract';
import type {WorkPublicationSnapshot} from '@/lib/postgres-work-publications';
import {useDraftLeaveGuard} from '@/components/listings/useDraftLeaveGuard';
import {useListingPostmoderation} from '@/components/listings/ListingWorkflowProvider';
import {checkWorkCheckoutForm} from '@/lib/work-checkout-validation';
import {vacancyPayment,workRequestPayment} from '@/lib/client-vacancy-payment';
import {startListingPayment,type ListingCheckoutAttempt} from '@/lib/listing-payment-start';

export function useWorkPublicationSave(owner:string,kind:WorkPublicationKind,formRef:RefObject<HTMLFormElement|null>,dirty:boolean,initial?:WorkPublicationSnapshot,onSaved?:(value:WorkPublicationSnapshot)=>void){
 const attempt=useRef<ReturnType<typeof createWorkPublicationSave>|null>(null),pending=useRef(false),scope=useRef<AbortController|null>(null);
 const readyFiles=useRef(new Map<Blob,UploadedImage>());
 const submission=useRef(false),draft=useRef(true);
 const localPayment=useListingPostmoderation(),payment=kind==='vacancy'?vacancyPayment:workRequestPayment,checkout=useRef<ListingCheckoutAttempt>({input:null,uncertain:false});
 const [busy,setBusy]=useState(false),[active,setActive]=useState(false),[done,setDone]=useState(false),[uncertain,setUncertain]=useState(false);
 const [message,setMessage]=useState<string|null>(null),[remote,setRemote]=useState<WorkPublicationSnapshot|null>(null);
 const [nextPayment,setNextPayment]=useState<string|null>(null);
 useDraftLeaveGuard((dirty||active)&&!done);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>controller.abort();},[]);
 useEffect(()=>{if(done){if(nextPayment)window.location.assign(`/oplata/${nextPayment}?type=${kind}`);else if(!onSaved)window.location.assign(kind==='vacancy'?'/cabinet/vakansii':'/cabinet/zakazy');}},[done,kind,onSaved,nextPayment]);
 function finish(value:WorkPublicationSnapshot){
  setDone(true);onSaved?.(value);
 }
 async function submitOrFinish(value:WorkPublicationSnapshot){
  if(!draft.current)await ensurePhoneForPlacement(owner);
  if(!draft.current&&localPayment){
   const id=await startListingPayment(payment,owner,value.id,value.revision,checkout.current,{signal:scope.current?.signal});
   if(!scope.current?.signal.aborted){setNextPayment(id);setDone(true);}return;
  }
  if(!draft.current){submission.current=true;setUncertain(true);const result=await workModeration.submit(owner,kind,value.id,value.revision,{signal:scope.current?.signal});
   submission.current=false;setUncertain(false);if(result.state==='rejected'){setMessage(`Модератор просит исправления: ${result.note}`);return;}
   if(!['pending','approved'].includes(result.state))throw Error('Проверьте статус модерации в кабинете.');}
  if(!scope.current?.signal.aborted)finish(value);
 }
 async function run(work:()=>Promise<void>){
  if(pending.current)return;pending.current=true;setBusy(true);setMessage(null);
  try{await work();}catch(error){if(!scope.current?.signal.aborted){
   if(error instanceof ListingMediaClientError&&['INVALID_INPUT','MEDIA_OWNER_QUOTA_EXCEEDED'].includes(error.code)&&attempt.current&&!attempt.current.uncertain&&!attempt.current.completed){attempt.current=null;setActive(false);}
   setMessage(error instanceof Error?error.message:'Не удалось подтвердить сохранение.');}}
  finally{pending.current=false;if(!scope.current?.signal.aborted){setBusy(false);setUncertain(!!attempt.current?.uncertain||submission.current||checkout.current.uncertain);}}
 }
 async function start(asDraft:boolean){
  if(pending.current||uncertain||!formRef.current)return;
  const form=formRef.current;
  if(form.querySelector('[data-photo-preparing="true"]')){setMessage('Дождитесь подготовки фотографий.');return;}
  if(!attempt.current&&!asDraft&&!form.reportValidity())return;
  await run(async()=>{
   if(!attempt.current){
    const data=new FormData(form),parsed=readWorkPublicationFormData(kind,data),input={...parsed,photoIds:data.getAll('keepPhotoIds').map(String)};
    if(!asDraft){const issues=localPayment?checkWorkCheckoutForm(input):checkWorkPublicationForm(input);if(issues.length)throw Error(issues.join(' '));}
    const files=data.getAll('photos').filter((item):item is File=>item instanceof File&&item.size>0);
    draft.current=asDraft;attempt.current=createWorkPublicationSave(owner,kind,input,files,{...productionWorkPublications,upload:async(user,intent,file,options)=>{
     const cached=readyFiles.current.get(file);if(cached)return cached;
     const uploaded=await productionListingMedia.upload(user,intent,file,options);readyFiles.current.set(file,uploaded);return uploaded;
    }},initial,data.get('photoOrder'));setActive(true);
   }
   const saved=await attempt.current.save({signal:scope.current?.signal});await submitOrFinish(saved);
  });
 }
 async function readback(){await run(async()=>{
  if(checkout.current.uncertain&&checkout.current.input){
   const result=await payment.recover(owner,checkout.current.input.creationKey,{signal:scope.current?.signal});
   if(scope.current?.signal.aborted)return;
   checkout.current.uncertain=false;setUncertain(false);
   if(result){checkout.current.completedId=result.id;setNextPayment(result.id);setDone(true);}
   else setMessage(`Заказ не найден. Нажмите «${kind==='vacancy'?'Перейти к оплате':'Оплатить'}» — будет использован тот же ключ.`);return;
  }
  if(submission.current){const saved=attempt.current!.completed!;
   const value=await workModeration.read(owner,kind,saved.id,saved.revision,{signal:scope.current?.signal});
   submission.current=false;if(['pending','approved'].includes(value.state)){finish(saved);return;}
   setMessage(value.state==='rejected'?`Модератор просит исправления: ${value.note}`:'Отправка не подтверждена. Нажмите «Отправить на модерацию» для сохранённой версии.');return;
  }
  const value=await attempt.current!.readback({signal:scope.current?.signal});
  if(attempt.current!.completed)await submitOrFinish(attempt.current!.completed);
  else if(value&&attempt.current!.uncertain)setRemote(value);
  else if(value){setRemote(null);setMessage('На сервере прежняя версия. Ваши правки остались в форме. Повторите сохранение.');}
  else setMessage('Запись не найдена. Можно повторить сохранение с тем же идентификатором.');
 });}
 return{start,readback,busy,active,done,uncertain,lockedAction:attempt.current?(draft.current?'draft':'submit'):null,paymentUncertain:checkout.current.uncertain,message,remote,acceptRemote:()=>{attempt.current!.acceptRemoteRevision();setRemote(null);setUncertain(false);}};
}
