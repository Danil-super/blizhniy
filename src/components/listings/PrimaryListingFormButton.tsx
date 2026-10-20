"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {productionDrafts} from '@/lib/client-listing-drafts';
import {productionListingMedia} from '@/lib/client-listing-media';
import {productionListingForm,ListingFormClientError} from '@/lib/client-listing-form';
import {createListingFormSave} from '@/lib/listing-form-save';
import {createListingFormModeration} from '@/lib/listing-form-moderation';
import {listingModeration} from '@/lib/client-listing-moderation';
import {checkListingFormContent} from '@/lib/listing-publication-check';
import {readListingFormData} from '@/lib/listing-form-data';
import type {ListingFormSnapshot} from '@/lib/listing-form-contract';
import type {UploadedImage} from '@/lib/media-upload-contract';
import {ListingDraftInputError} from '@/lib/listing-draft-contract';
import {useDraftLeaveGuard} from './useDraftLeaveGuard';
import {draftButton} from './PrivateDraftEditor';

export function PrimaryListingFormButton({draft,label,returnHref,className,existing,expectedOwnerId}:{draft:boolean;label:string;returnHref:string;className?:string;existing?:ListingFormSnapshot;expectedOwnerId?:string}){
 const auth=usePrimaryAccountAuth(),identity=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null;
 const owner=identity&&(!expectedOwnerId||identity===expectedOwnerId)?identity:null;
 const attempt=useRef<ReturnType<typeof createListingFormSave>|null>(null),formRef=useRef<HTMLFormElement|null>(null),pending=useRef(false),epoch=useRef(0);
 const moderation=useRef<ReturnType<typeof createListingFormModeration>|null>(null),controlsRef=useRef<HTMLFieldSetElement|null>(null),intentKey=useId();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[remote,setRemote]=useState<ListingFormSnapshot|null>(null),[active,setActive]=useState(false),[done,setDone]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const baseline=useRef(existing),readyFiles=useRef(new Map<Blob,UploadedImage>());
 const [rejected,setRejected]=useState(false);
 useDraftLeaveGuard(active&&!done);
 useEffect(()=>{const scope=new AbortController();controller.current=scope;const generation=++epoch.current;
  return()=>{epoch.current=generation+1;scope.abort();};
 },[]);
 useEffect(()=>{
  if(!active||done||!formRef.current)return;
  // The sibling fieldset stays locked even when its button rerenders on a
  // session recheck; a React update to button.disabled cannot unlock its parent.
  const controls=Array.from(formRef.current.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLFieldSetElement>('input,textarea,select,button,fieldset[data-primary-group]')).filter(control=>control!==controlsRef.current&&!controlsRef.current?.contains(control)).map(control=>({control,disabled:control.disabled}));
  controls.forEach(({control})=>{control.disabled=true;});
  return()=>{controls.forEach(({control,disabled})=>{control.disabled=disabled;});};
 },[active,done]);
 useEffect(()=>{if(done)window.location.assign(returnHref);},[done,returnHref]);
 async function finish(){
  if(!draft){
   const saved=attempt.current?.completed;if(!saved||!owner)throw Error('Сначала подтвердите сохранение формы.');
   moderation.current??=createListingFormModeration(owner,saved,listingModeration);
   await moderation.current.submit({signal:controller.current?.signal});
  }
  if(!controller.current?.signal.aborted)setDone(true);
 }
 async function run(work:()=>Promise<void>){
  if(pending.current||!owner)return;pending.current=true;setBusy(true);setMessage(null);const generation=epoch.current;
  try{await work();}catch(error){if(generation===epoch.current){setMessage(error instanceof ListingDraftInputError?'Проверьте поля объявления: цену, контакты, координаты и параметры аренды.':error instanceof Error?error.message:'Не удалось подтвердить сохранение.');
   if(error instanceof ListingFormClientError&&['INVALID_INPUT','RATE_LIMITED'].includes(error.code))setRejected(true);
  }}
  finally{if(generation===epoch.current){pending.current=false;setBusy(false);if(formRef.current)delete formRef.current.dataset.primarySaving;}}
 }
 async function save(form:HTMLFormElement){
  if(form.dataset.primaryIntent&&form.dataset.primaryIntent!==intentKey){setMessage('В этой форме уже выполняется сохранение. Сначала проверьте его результат.');return;}
  if(form.dataset.primarySaving==='1')return;form.dataset.primarySaving='1';formRef.current=form;
  await run(async()=>{
   if(!attempt.current){
    const consent=form.querySelector<HTMLInputElement>('input[name="placementRightsAccepted"]');
    if(!consent?.checked)throw new Error('Подтвердите право размещать объявление и фотографии.');
    const data=new FormData(form),files=data.getAll('photos').filter((item):item is File=>item instanceof File&&item.size>0);
    const input=readListingFormData(data);
    if(!draft){const issues=checkListingFormContent(input,true);if(issues.length)throw Error(issues.map(issue=>issue.message).join(' '));}
    attempt.current=createListingFormSave(owner!,input,files,{create:productionDrafts.createEmpty,upload:async(user,intent,file,options)=>{
     const cached=readyFiles.current.get(file);if(cached)return cached;
     const uploaded=await productionListingMedia.upload(user,intent,file,options);readyFiles.current.set(file,uploaded);return uploaded;
    },read:productionListingForm.read,write:productionListingForm.write},baseline.current);form.dataset.primaryIntent=intentKey;setActive(true);
   }
   await attempt.current.save({signal:controller.current?.signal});await finish();
  });
 }
 return <fieldset ref={controlsRef} data-primary-group className="grid min-w-0 gap-3 md:contents">
  <button type="button" data-primary-control={draft?'save':'submit'} className={className??`${draftButton} bg-[#0875d1] text-white`} disabled={busy||!owner||!!attempt.current?.uncertain||!!moderation.current?.uncertain} onClick={event=>{
   if(event.currentTarget.form)void save(event.currentTarget.form);
  }}>{busy?(draft?'Сохраняем поля и фотографии…':'Сохраняем и отправляем…'):(draft?label:'Отправить на модерацию')}</button>
  {!draft&&!active&&<p className="text-sm text-slate-600 md:col-span-full">Сначала бесплатная проверка модератором. Отправка не публикует объявление и не списывает деньги.</p>}
  {active&&!done&&<p className="text-sm text-slate-600 md:col-span-full" role="status">Сохраняется снимок формы на момент нажатия. До подтверждения результата не создавайте объявление повторно.</p>}
  {message&&<p className="break-words text-sm font-semibold text-rose-700 md:col-span-full" role="alert">{message}</p>}
  {rejected&&attempt.current?.id&&<button type="button" className={draftButton} disabled={busy||!owner} onClick={()=>void run(async()=>{
   const snapshot=await productionListingForm.read(owner!,attempt.current!.id!,{signal:controller.current?.signal});
   baseline.current=snapshot;attempt.current=null;moderation.current=null;setActive(false);setRejected(false);setRemote(null);setMessage('Поля доступны для исправления. Изменения ещё не сохранены.');
   if(formRef.current)delete formRef.current.dataset.primaryIntent;
  })}>Вернуться к исправлению полей</button>}
  {(attempt.current?.uncertain||moderation.current?.uncertain)&&<button type="button" data-primary-control="readback" className={draftButton} disabled={busy} onClick={()=>void run(async()=>{
   if(moderation.current?.uncertain){await moderation.current.readback({signal:controller.current?.signal});if(moderation.current.completed)setDone(true);else setMessage('Отправка не подтверждена. Нажмите «Отправить на модерацию», чтобы отправить сохранённую версию.');}
   else{const value=await attempt.current!.readback({signal:controller.current?.signal});if(attempt.current!.completed){if(draft)await finish();else setMessage('Форма сохранена. Нажмите «Отправить на модерацию», чтобы продолжить.');}else setRemote(value);}
  })}>{moderation.current?.uncertain?'Проверить отправку':'Проверить сохранённую форму'}</button>}
  {!draft&&attempt.current?.completed&&!done&&<a href={returnHref} className="text-sm text-[#0875d1] underline md:col-span-full">Открыть сохранённое объявление в кабинете</a>}
  {remote&&<section className="min-w-0 rounded-lg border border-amber-400 bg-amber-50 p-4 md:col-span-full" aria-label="Сохранённая форма">
   <p>В БД сохранена другая версия. Ниже все её поля; ваши исходные данные сохранены в памяти этой вкладки.</p>
   <pre tabIndex={0} aria-label="Поля сохранённой версии" className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">{JSON.stringify(remote.form,null,2)}</pre>
   <button type="button" data-primary-control="resolve" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>{attempt.current!.acceptRemoteRevision();setRemote(null);void run(async()=>{await attempt.current!.save({signal:controller.current?.signal});await finish();});}}>{draft?'Сохранить мою исходную форму вместо показанной':'Сохранить мою форму вместо показанной и отправить на модерацию'}</button>
  </section>}
 </fieldset>;
}
