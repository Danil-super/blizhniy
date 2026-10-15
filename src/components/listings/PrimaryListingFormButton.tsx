"use client";
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {productionDrafts} from '@/lib/client-listing-drafts';
import {productionListingMedia} from '@/lib/client-listing-media';
import {productionListingForm} from '@/lib/client-listing-form';
import {createListingFormSave} from '@/lib/listing-form-save';
import {readListingFormData} from '@/lib/listing-form-data';
import type {ListingFormSnapshot} from '@/lib/listing-form-contract';
import {useDraftLeaveGuard} from './useDraftLeaveGuard';
import {draftButton} from './PrivateDraftEditor';

export function PrimaryListingFormButton({draft,label,returnHref,className}:{draft:boolean;label:string;returnHref:string;className?:string}){
 const auth=usePrimaryAccountAuth(),owner=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null;
 const attempt=useRef<ReturnType<typeof createListingFormSave>|null>(null),formRef=useRef<HTMLFormElement|null>(null),pending=useRef(false),epoch=useRef(0);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[remote,setRemote]=useState<ListingFormSnapshot|null>(null),[active,setActive]=useState(false),[done,setDone]=useState(false);
 const controller=useRef<AbortController|null>(null);
 useDraftLeaveGuard(active&&!done);
 useEffect(()=>{const scope=new AbortController();controller.current=scope;const generation=++epoch.current;
  return()=>{epoch.current=generation+1;scope.abort();};
 },[]);
 useEffect(()=>{
  if(!active||done||!formRef.current)return;
  const controls=Array.from(formRef.current.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,textarea,select,button:not([data-primary-control])')).map(control=>({control,disabled:control.disabled}));
  controls.forEach(({control})=>{control.disabled=true;});
  return()=>{controls.forEach(({control,disabled})=>{control.disabled=disabled;});};
 },[active,done]);
 useEffect(()=>{if(done)window.location.assign(returnHref);},[done,returnHref]);
 function finish(){setDone(true);}
 async function run(work:()=>Promise<void>){
  if(pending.current||!owner)return;pending.current=true;setBusy(true);setMessage(null);const generation=epoch.current;
  try{await work();}catch(error){if(generation===epoch.current)setMessage(error instanceof Error?error.message:'Не удалось подтвердить сохранение.');}
  finally{if(generation===epoch.current){pending.current=false;setBusy(false);if(formRef.current)delete formRef.current.dataset.primarySaving;}}
 }
 async function save(form:HTMLFormElement){
  if(form.dataset.primarySaving==='1')return;form.dataset.primarySaving='1';formRef.current=form;
  await run(async()=>{
   if(!attempt.current){
    const consent=form.querySelector<HTMLInputElement>('input[name="placementRightsAccepted"]');
    if(!consent?.checked)throw new Error('Подтвердите право размещать объявление и фотографии.');
    const data=new FormData(form),files=data.getAll('photos').filter((item):item is File=>item instanceof File&&item.size>0);
    attempt.current=createListingFormSave(owner!,readListingFormData(data),files,{create:productionDrafts.createEmpty,upload:productionListingMedia.upload,read:productionListingForm.read,write:productionListingForm.write});setActive(true);
   }
   await attempt.current.save({signal:controller.current?.signal});finish();
  });
 }
 return <div className="grid gap-3 md:contents">
  <button type="button" data-primary-control={draft?'save':undefined} className={className??`${draftButton} bg-[#0875d1] text-white`} disabled={busy||!owner||!!attempt.current?.uncertain} onClick={event=>{
   if(!draft){setMessage('Публикация и оплата ещё переносятся. Сначала сохраните объявление как черновик — данные и фото останутся в новой БД.');return;}
   if(event.currentTarget.form)void save(event.currentTarget.form);
  }}>{busy?'Сохраняем поля и фотографии…':label}</button>
  {active&&!done&&<p className="text-sm text-slate-600 md:col-span-full" role="status">Сохраняется снимок формы на момент нажатия. До подтверждения результата не создавайте объявление повторно.</p>}
  {message&&<p className="break-words text-sm font-semibold text-rose-700 md:col-span-full" role="alert">{message}</p>}
  {attempt.current?.uncertain&&<button type="button" data-primary-control="readback" className={draftButton} disabled={busy} onClick={()=>void run(async()=>{
   const value=await attempt.current!.readback({signal:controller.current?.signal});if(attempt.current!.completed)finish();else setRemote(value);
  })}>Проверить сохранённую форму</button>}
  {remote&&<section className="min-w-0 rounded-lg border border-amber-400 bg-amber-50 p-4 md:col-span-full" aria-label="Сохранённая форма">
   <p>В БД сохранена другая версия. Ниже все её поля; ваши исходные данные сохранены в памяти этой вкладки.</p>
   <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(remote.form,null,2)}</pre>
   <button type="button" data-primary-control="resolve" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>{attempt.current!.acceptRemoteRevision();setRemote(null);void run(async()=>{await attempt.current!.save({signal:controller.current?.signal});finish();});}}>Сохранить мою исходную форму вместо показанной</button>
  </section>}
 </div>;
}
