"use client";
import {ensurePhoneForPlacement} from '@/lib/phone-placement';
import {useEffect,useId,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {productionDrafts} from '@/lib/client-listing-drafts';
import {productionListingMedia,ListingMediaClientError} from '@/lib/client-listing-media';
import {productionListingForm,ListingFormClientError} from '@/lib/client-listing-form';
import {createListingFormSave,getListingEditor} from '@/lib/listing-form-save';
import {createListingFormModeration} from '@/lib/listing-form-moderation';
import {listingModeration} from '@/lib/client-listing-moderation';
import {checkListingFormContent} from '@/lib/listing-publication-check';
import {bookingTodayKey} from '@/lib/booking-availability';
import {readListingFormData} from '@/lib/listing-form-data';
import type {ListingFormSnapshot} from '@/lib/listing-form-contract';
import {ListingDraftInputError} from '@/lib/listing-draft-contract';
import {listingFormSaveConfirmed,listingFormSaveStarted} from './ListingFormLeaveGuard';
import {draftButton} from './PrivateDraftEditor';
import {canStartListingTest} from '@/lib/account-session-state';
import {useListingPostmoderation,useLocalPaymentSimulation} from './ListingWorkflowProvider';
import {accountTestPayment} from '@/lib/client-account-test-payment';
import {startListingPayment,type ListingCheckoutAttempt} from '@/lib/listing-payment-start';

export function PrimaryListingFormButton({draft,label,returnHref,className,existing,expectedOwnerId}:{draft:boolean;label:string;returnHref:string;className?:string;existing?:ListingFormSnapshot;expectedOwnerId?:string}){
 const postmoderation=useListingPostmoderation(),submitLabel=postmoderation?'Перейти к оплате':'Отправить на модерацию';
 const auth=usePrimaryAccountAuth(),identity=auth?.state==='signed-in'||auth?.state==='admin'?auth.userId:null;
 const owner=identity&&(!expectedOwnerId||identity===expectedOwnerId)?identity:null;
 const simulation=useLocalPaymentSimulation();
 const paymentUnavailable=!draft&&postmoderation&&!simulation&&!canStartListingTest(auth,owner);
 const attempt=useRef<ReturnType<typeof createListingFormSave>|null>(null),formRef=useRef<HTMLFormElement|null>(null),pending=useRef(false),epoch=useRef(0);
 const moderation=useRef<ReturnType<typeof createListingFormModeration>|null>(null),controlsRef=useRef<HTMLFieldSetElement|null>(null),intentKey=useId();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[remote,setRemote]=useState<ListingFormSnapshot|null>(null),[active,setActive]=useState(false),[done,setDone]=useState(false);
 const [checkoutBlocked,setCheckoutBlocked]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const [rejected,setRejected]=useState(false);
 const checkout=useRef<ListingCheckoutAttempt>({input:null,uncertain:false}),paymentId=useRef<string|null>(null);
 const [paymentUncertain,setPaymentUncertain]=useState(false);
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
 useEffect(()=>{
  if(!done)return;
  formRef.current?.dispatchEvent(new Event(listingFormSaveConfirmed));
  window.location.assign(paymentId.current?`/oplata/${paymentId.current}`:returnHref);
 },[done,returnHref]);
 async function finish(){
  if(!draft)await ensurePhoneForPlacement(owner!);
  if(!draft&&postmoderation){
   const saved=attempt.current?.completed;if(!saved||!owner)throw Error('Сначала подтвердите сохранение формы.');
   try{paymentId.current=await startListingPayment(accountTestPayment,owner,saved.id,saved.revision,checkout.current,{signal:controller.current?.signal});}
   finally{if(!controller.current?.signal.aborted)setPaymentUncertain(checkout.current.uncertain);}
  }
  if(!draft&&!postmoderation){
   const saved=attempt.current?.completed;if(!saved||!owner)throw Error('Сначала подтвердите сохранение формы.');
   moderation.current??=createListingFormModeration(owner,saved,listingModeration);
   await moderation.current.submit({signal:controller.current?.signal});
  }
  if(!controller.current?.signal.aborted)setDone(true);
 }
 async function run(work:()=>Promise<void>,firstSaveAttempt=false){
  if(pending.current||!owner)return;pending.current=true;setBusy(true);setMessage(null);setCheckoutBlocked(false);const generation=epoch.current;
  try{await work();}catch(error){if(generation===epoch.current){setMessage(error instanceof ListingDraftInputError?'Проверьте поля объявления: цену, контакты, координаты и параметры аренды.':error instanceof ListingMediaClientError?error.draftMessage:error instanceof Error?error.message:'Не удалось подтвердить сохранение.');
   if(error instanceof ListingMediaClientError&&error.allowsDraftEdit(firstSaveAttempt)&&attempt.current&&!attempt.current.uncertain&&!attempt.current.completed){
    setRejected(true);
    try{
     const id=attempt.current.id;
     if(id&&formRef.current){const editor=getListingEditor(formRef.current,owner!,existing);
      const snapshot=await productionListingForm.read(owner!,id,{signal:controller.current?.signal});
      if(generation===epoch.current&&snapshot.revision===(editor.baseline?.revision??'1')){
       editor.baseline=snapshot;attempt.current=null;setActive(false);setRejected(false);
       if(formRef.current)delete formRef.current.dataset.primaryIntent;
      }
     }
    }catch{if(generation===epoch.current)setMessage('Фото не принято. Не удалось проверить черновик; повторите проверку перед исправлением.');}
   }
   if(error instanceof ListingFormClientError&&['INVALID_INPUT','RATE_LIMITED','CHECKOUT_ACTIVE'].includes(error.code))setRejected(true);
   if(error instanceof ListingFormClientError&&error.code==='CHECKOUT_ACTIVE')setCheckoutBlocked(true);
  }}
  finally{if(generation===epoch.current){pending.current=false;setBusy(false);if(formRef.current)delete formRef.current.dataset.primarySaving;}}
 }
 async function save(form:HTMLFormElement){
  if(paymentUnavailable)return;
  if(form.querySelector('[data-photo-preparing="true"]')){setMessage('Дождитесь подготовки фотографий.');return;}
  if(form.dataset.primaryIntent&&form.dataset.primaryIntent!==intentKey){setMessage('В этой форме уже выполняется сохранение. Сначала проверьте его результат.');return;}
  if(form.dataset.primarySaving==='1')return;form.dataset.primarySaving='1';formRef.current=form;
  await run(async()=>{
   if(!attempt.current){
    const consent=form.querySelector<HTMLInputElement>('input[name="placementRightsAccepted"]');
    if(!consent?.checked)throw new Error('Подтвердите право размещать объявление и фотографии.');
    if(!draft&&postmoderation&&!form.querySelector<HTMLInputElement>('input[name="publicOfferAccepted"]')?.checked)throw new Error('Примите условия публичной оферты, чтобы перейти к оплате.');
    const data=new FormData(form),files=data.getAll('photos').filter((item):item is File=>item instanceof File&&item.size>0);
    const input=readListingFormData(data);
    if(!draft){const issues=checkListingFormContent(input,true,bookingTodayKey());if(issues.length)throw Error(issues.map(issue=>issue.message).join(' '));}
    const editor=getListingEditor(form,owner!,existing);
    attempt.current=createListingFormSave(owner!,input,files,{create:productionDrafts.createEmpty,upload:async(user,intent,file,options)=>{
     const cached=editor.readyFiles.get(file);if(cached)return cached;
     const uploaded=await productionListingMedia.upload(user,intent,file,options);editor.readyFiles.set(file,uploaded);return uploaded;
    },read:productionListingForm.read,write:productionListingForm.write},editor.baseline,data.get('photoOrder'));
    form.dataset.primaryIntent=intentKey;setActive(true);
    form.dispatchEvent(new Event(listingFormSaveStarted));
   }
   await attempt.current.save({signal:controller.current?.signal});await finish();
  },!attempt.current);
 }
 return <fieldset ref={controlsRef} data-primary-group className="grid min-w-0 gap-3 md:contents">
  <button type="button" data-primary-control={draft?'save':'submit'} className={className??`${draftButton} bg-[#0875d1] text-white`} disabled={busy||!owner||paymentUnavailable||!!attempt.current?.uncertain||!!moderation.current?.uncertain||paymentUncertain} onClick={event=>{
   if(event.currentTarget.form)void save(event.currentTarget.form);
  }}>{busy?(draft?'Сохраняем поля и фотографии…':'Сохраняем объявление…'):(draft?label:submitLabel)}</button>
  {!draft&&!active&&<p className="min-w-0 flex-1 basis-64 self-center text-sm text-slate-600 md:col-span-full">{paymentUnavailable?'Можно сохранить черновик. Оплата пока недоступна для этого аккаунта.':postmoderation?'Сначала проверим поля и сохраним фотографии. Перед тестовой оплатой вы увидите, предусмотрена ли публикация объявления.':'Сначала бесплатная проверка модератором. Отправка не публикует объявление и не списывает деньги.'}</p>}
  {busy&&active&&!done&&!checkoutBlocked&&<p className="text-sm text-slate-600 md:col-span-full" role="status">Сохраняется снимок формы на момент нажатия. До подтверждения результата не создавайте объявление повторно.</p>}
  {message&&<p className="break-words text-sm font-semibold text-rose-700 md:col-span-full" role="alert">{message}</p>}
  {checkoutBlocked&&<a href={returnHref} className="text-sm font-semibold text-[#0875d1] underline md:col-span-full">К начатой оплате в личном кабинете</a>}
  {paymentUncertain&&<button type="button" className={draftButton} disabled={busy||!owner} onClick={()=>void run(async()=>{
   if(!checkout.current.input)return;const order=await accountTestPayment.recover(owner!,checkout.current.input.creationKey,{signal:controller.current?.signal});
   if(controller.current?.signal.aborted)return;
   checkout.current.uncertain=false;setPaymentUncertain(false);
   if(order){paymentId.current=order.id;setDone(true);}else setMessage('Заказ не найден. Нажмите «Перейти к оплате» ещё раз: исходный ключ сохранён, повторного заказа не будет.');
  })}>Проверить сохранённый заказ</button>}
  {rejected&&attempt.current?.id&&<button type="button" className={draftButton} disabled={busy||!owner} onClick={()=>void run(async()=>{
   const snapshot=await productionListingForm.read(owner!,attempt.current!.id!,{signal:controller.current?.signal});
   if(controller.current?.signal.aborted||!formRef.current)return;
   getListingEditor(formRef.current,owner!,existing).baseline=snapshot;attempt.current=null;moderation.current=null;setActive(false);setRejected(false);setRemote(null);setMessage('Поля доступны для исправления. Изменения ещё не сохранены.');
   if(formRef.current)delete formRef.current.dataset.primaryIntent;
  })}>Вернуться к исправлению полей</button>}
  {(attempt.current?.uncertain||moderation.current?.uncertain)&&<button type="button" data-primary-control="readback" className={draftButton} disabled={busy} onClick={()=>void run(async()=>{
   if(moderation.current?.uncertain){await moderation.current.readback({signal:controller.current?.signal});if(moderation.current.completed)setDone(true);else setMessage('Отправка не подтверждена. Нажмите «Отправить на модерацию», чтобы отправить сохранённую версию.');}
   else{const value=await attempt.current!.readback({signal:controller.current?.signal});if(attempt.current!.completed){if(draft)await finish();else setMessage(`Форма сохранена. Нажмите «${submitLabel}», чтобы продолжить.`);}
    else if(attempt.current!.uncertain)setRemote(value);
    else{setRemote(null);setMessage('На сервере прежняя версия. Ваши правки остались в форме. Повторите сохранение.');}
   }
  })}>{moderation.current?.uncertain?'Проверить отправку':'Проверить сохранённую форму'}</button>}
  {!draft&&attempt.current?.completed&&!done&&<a href={returnHref} className="text-sm text-[#0875d1] underline md:col-span-full">Открыть сохранённое объявление в кабинете</a>}
  {remote&&<section className="min-w-0 rounded-lg border border-amber-400 bg-amber-50 p-4 md:col-span-full" aria-label="Сохранённая форма">
   <p>В БД сохранена другая версия. Ниже все её поля; ваши исходные данные сохранены в памяти этой вкладки.</p>
   <pre tabIndex={0} aria-label="Поля сохранённой версии" className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">{JSON.stringify(remote.form,null,2)}</pre>
   <button type="button" data-primary-control="resolve" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>{attempt.current!.acceptRemoteRevision();setRemote(null);void run(async()=>{await attempt.current!.save({signal:controller.current?.signal});await finish();});}}>{draft?'Сохранить мою исходную форму вместо показанной':postmoderation?'Сохранить мою форму вместо показанной и перейти к оплате':'Сохранить мою форму вместо показанной и отправить на модерацию'}</button>
  </section>}
 </fieldset>;
}
