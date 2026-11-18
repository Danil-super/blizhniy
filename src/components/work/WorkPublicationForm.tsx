"use client";
import {useRef,useState} from 'react';
import {Field,PhotoField,TextAreaField} from '@/components/FormPanel';
import {VacancyEmployerFields} from '@/components/VacancyEmployerFields';
import {VacancyEmployerFlow} from './VacancyEmployerFlow';
import {useListingPostmoderation,useLocalPaymentSimulation} from '@/components/listings/ListingWorkflowProvider';
import {ListingLocationFields} from '@/components/listings/ListingFormControls';
import {LegalConsentCheckbox,LegalLink} from '@/components/LegalConsentCheckbox';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import type {WorkPublicationKind} from '@/lib/work-publication-contract';
import type {WorkPublicationSnapshot} from '@/lib/postgres-work-publications';
import {useWorkPublicationSave} from './useWorkPublicationSave';
import {WorkAmountField} from './WorkAmountField';
import {PrimaryProfessionSelect} from './PrimaryProfessionSelect';
import {VacancyTermsFields} from './VacancyTermsFields';
import {PublicationPhotoEditor} from '@/components/PublicationPhotoEditor';
import {CabinetFormValidation} from '@/components/CabinetFormValidation';

/** Existing form vocabulary, one owner-scoped save intent for both actions. */
export function WorkPublicationForm({owner,kind,initial,onSaved,onDirtyChange}:{owner:string;kind:WorkPublicationKind;initial?:WorkPublicationSnapshot;onSaved?:(snapshot:WorkPublicationSnapshot)=>void;onDirtyChange?:(dirty:boolean)=>void}){
 const formRef=useRef<HTMLFormElement>(null),[dirty,setDirty]=useState(false),localPayment=useListingPostmoderation(),simulation=useLocalPaymentSimulation();
 const save=useWorkPublicationSave(owner,kind,formRef,dirty,initial,onSaved),form=initial?.form,vacancy=form?.kind==='vacancy'?form:null;
 const paidEdit=initial?.paid===true;
 const amount=vacancy?.salary??(form?.kind==='workRequest'?form.budget:null);
 const amountInput=amount?.replace(/\.00$/,'').replace('.',',');
 const editable=save.active&&!save.done;
 const defaults=vacancy?{...vacancy,email:vacancy.email??undefined,organization:vacancy.organization??undefined,
    contactPerson:vacancy.contactPerson??undefined,website:vacancy.website??undefined,messengerUrl:vacancy.messengerUrl??undefined,phone:vacancy.contactPhone??undefined}:undefined;
 const body=<>
   <Field name="title" label={kind==='vacancy'?'Название':'Название заказа'} defaultValue={form?.title} minLength={3} maxLength={120} placeholder={kind==='vacancy'?'Мастер по ремонту':'Нужен ремонт ванной'} required/>
   <PrimaryProfessionSelect defaultValue={form?.professionName??''} defaultId={initial?.professionId} required/>
   <ListingLocationFields cityFieldName={kind==='vacancy'?'location':'city'} defaultCity={form?.cityName??'Краснодар'} defaultAddress={form?.address??undefined}
    defaultLat={form?.latitude??undefined} defaultLng={form?.longitude??undefined} addressLegend="Место работы" inlineControls/>
    {kind==='vacancy'?<Field name="district" label="Район" defaultValue={form?.district??''} maxLength={200}/>:<input type="hidden" name="district" value={form?.district??''}/>}
   {localPayment&&kind==='vacancy'?<VacancyTermsFields salary={amountInput} schedule={vacancy?.schedule} workFormat={vacancy?.workFormat}/>:<>
    <WorkAmountField kind={kind} value={amountInput}/>
    {kind==='vacancy'?<div className="grid gap-4 sm:grid-cols-2"><Field name="schedule" label="График" defaultValue={vacancy?.schedule??''} maxLength={160}/>
    <Field name="workFormat" label="Формат работы" defaultValue={vacancy?.workFormat??''} maxLength={160}/></div>:<div className="grid gap-4 sm:grid-cols-2">
    <Field name="phone" label="Телефон" defaultValue={form?.contactPhone??''}/><Field name="messengerUrl" label="WhatsApp / Telegram" defaultValue={form?.messengerUrl??''}/></div>}
   </>}
   <p className="text-sm text-slate-600">Контакты не показываются в публичной карточке.</p>
   <TextAreaField name="description" label="Описание" defaultValue={form?.description} maxLength={3000} required/>
   {kind==='vacancy'&&<><TextAreaField name="responsibilities" label="Обязанности" defaultValue={vacancy?.responsibilities??''} maxLength={3000}/>
    <TextAreaField name="requirements" label="Требования" defaultValue={vacancy?.requirements??''} maxLength={3000}/>
    <TextAreaField name="conditions" label="Условия" defaultValue={vacancy?.conditions??''} maxLength={3000}/></>}
   {initial?<PublicationPhotoEditor owner={owner} photos={initial.photos} maxPhotos={kind==='vacancy'?12:6}/>:<PhotoField label="Фотографии" description="Первое фото будет обложкой." autoOpenCropper={false} maxPhotos={kind==='vacancy'?12:6}/>}
   <label className="flex items-start gap-3 text-sm text-slate-700"><input name="placementRightConfirmed" type="checkbox" value="1" defaultChecked={form?.placementRightConfirmed??false} className="mt-1 h-4 w-4 shrink-0"/>
    <span>Подтверждаю право размещать эту публикацию, фотографии и контактные данные.</span></label>
   <LegalConsentCheckbox name="workLegalAccepted"><span>Соглашаюсь с <LegalLink href="/legal/agreement">пользовательским соглашением</LegalLink> и <LegalLink href="/legal/privacy">политикой обработки персональных данных</LegalLink>.</span></LegalConsentCheckbox>
 </>;
 const actions=<>
  <div className="flex flex-wrap gap-3">
   <button type="button" data-cabinet-save className={draftButton} disabled={save.busy||save.uncertain||save.lockedAction==='submit'} onClick={()=>void save.start(true)}>{save.busy?'Сохраняем…':paidEdit?'Сохранить изменения':'Сохранить черновик'}</button>
   {(!initial||localPayment&&!initial.paid)&&<button type="submit" className={`${draftButton} bg-brand-blue text-white`} disabled={save.busy||save.uncertain||save.lockedAction==='draft'||localPayment&&!simulation}>{save.busy?'Сохраняем…':localPayment?(kind==='workRequest'?'Оплатить':'Перейти к оплате'):'Отправить на модерацию'}</button>}
  </div>
  <p className="text-sm text-slate-600">{paidEdit
   ? 'Изменения сохранятся без повторной оплаты. Срок размещения не изменится.'
   : !localPayment
   ? 'Сначала бесплатная проверка модератором. Сохранение и отправка не списывают деньги и не публикуют материал.'
   : simulation
   ? 'Сначала сохраним данные и фотографии, затем откроем тестовую оплату без списания денег.'
   : 'Сохраните черновик. Оплата из этой формы пока недоступна.'}</p>
 </>;
 return <form ref={formRef} className="grid min-w-0 gap-4 [&_a]:text-blue-800 [&_.uppercase]:text-blue-800" aria-label={initial?'Редактирование публикации':kind==='vacancy'?'Создание вакансии':'Создание заказа'}
  onInput={()=>{setDirty(true);onDirtyChange?.(true);}} onChange={()=>{setDirty(true);onDirtyChange?.(true);}} onSubmit={event=>{event.preventDefault();void save.start(paidEdit||(!localPayment&&!!initial));}}>
  {localPayment&&kind==='vacancy'?<VacancyEmployerFlow defaults={defaults} disabled={editable} actions={actions}>{body}</VacancyEmployerFlow>:<>
   <fieldset disabled={editable} className="grid min-w-0 gap-4"><legend className="sr-only">Поля публикации</legend>
    {kind==='vacancy'?<VacancyEmployerFields defaults={defaults}>{body}</VacancyEmployerFields>:body}
   </fieldset>{actions}
  </>}
  <CabinetFormValidation/>
  {save.message&&<p role="alert" className="break-words text-sm font-semibold text-rose-700">{save.message}</p>}
  {save.uncertain&&<button type="button" className={draftButton} disabled={save.busy} onClick={()=>void save.readback()}>{save.paymentUncertain?'Проверить сохранённый заказ':'Проверить сохранённую форму'}</button>}
  {save.remote&&<section aria-label="Сохранённая форма" className="min-w-0 rounded-lg border border-amber-400 bg-amber-50 p-4">
   <p>В БД другая версия. Ваши введённые данные остаются в этой вкладке.</p><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(save.remote.form,null,2)}</pre>
   <button type="button" className={`${draftButton} mt-3`} disabled={save.busy} onClick={save.acceptRemote}>Оставить мои правки вместо показанной версии</button>
  </section>}
  {dirty&&!save.done&&<p className="sr-only" role="status">Есть несохранённые изменения.</p>}
 </form>;
}
