"use client";
import {useId,useRef,useState} from 'react';import {Field,PhotoField,TextAreaField} from '@/components/FormPanel';
import {ListingLocationFields} from '@/components/listings/ListingFormControls';import {LegalConsentCheckbox,LegalLink} from '@/components/LegalConsentCheckbox';
import {useCookieCabinetProfile} from '@/components/cabinet/CookieCabinetProfileProvider';import {professions,fairCategories} from '@/lib/data';
import type {ServicePublicationKind} from '@/lib/service-publication-contract';import type {ServicePublicationSnapshot} from '@/lib/postgres-service-publications';
import {draftButton} from '@/components/listings/PrivateDraftEditor';import {ServicePublicationPhotos} from './ServicePublicationPhotos';import {useServicePublicationSave} from './useServicePublicationSave';
export const serviceFormLabels={specialist:'Анкета специалиста',fair:'Заявка на ярмарку',marquee:'Рекламный текст'};
export function ServicePublicationForm({owner,kind,initial,onSaved,onDirtyChange}:{owner:string;kind:ServicePublicationKind;initial?:ServicePublicationSnapshot;onSaved:(value:ServicePublicationSnapshot)=>void;onDirtyChange?:(value:boolean)=>void}){
 const element=useRef<HTMLFormElement>(null),[dirty,setDirty]=useState(false),list=useId(),save=useServicePublicationSave(owner,kind,element,dirty,initial,onSaved);
 const form=initial?.form,details=form&&form.kind!=='marquee'?form:null,specialist=form?.kind==='specialist'?form:null,fair=form?.kind==='fair'?form:null;
 const context=useCookieCabinetProfile(),profile=context?.ownerId===owner?context.profile:null;
 const changed=()=>{setDirty(true);onDirtyChange?.(true);};
 return <form ref={element} aria-label={serviceFormLabels[kind]} className="grid min-w-0 gap-4 [&_a]:text-blue-800 [&_.uppercase]:text-blue-800" onInput={changed} onChange={changed}
  onSubmit={event=>{event.preventDefault();void save.start(false);}}>
  <fieldset disabled={save.active&&!save.done} className="grid min-w-0 gap-4"><legend className="sr-only">Поля материала</legend>
   <Field name="title" label={kind==='specialist'?'Имя или название':kind==='fair'?'Название мастерской или ФИО':'Текст рекламы'} defaultValue={form?.title??(kind==='specialist'?profile?.name:'')??''} minLength={kind==='marquee'?10:2} maxLength={kind==='marquee'?140:160} required/>
   {kind==='marquee'?<Field name="href" label="Ссылка (необязательно)" type="url" maxLength={500} defaultValue={form?.kind==='marquee'?form.href??'':''} placeholder="https://..."/>:<>
    {kind==='specialist'?<><label className="grid min-w-0 gap-2 text-sm font-bold text-slate-700">Профессия<input name="profession" list={list} defaultValue={specialist?.professionName??''} maxLength={160} required className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 px-3 text-base font-normal"/>
     <datalist id={list}>{professions.filter(item=>item.active).map(item=><option key={item.slug} value={item.name}/>)}</datalist></label>
     <Field name="price" label="Стоимость работ, ₽" defaultValue={specialist?.price??''} inputMode="decimal" placeholder="Например, 1500" required/>
     <TextAreaField name="skills" label="Навыки" defaultValue={specialist?.skills??''} minLength={3} maxLength={500} required/>
     <TextAreaField name="experience" label="Опыт и квалификация" defaultValue={specialist?.experience??''} maxLength={500}/></>:
     <label className="grid gap-2 text-sm font-bold text-slate-700">Категория ярмарки<select name="category" defaultValue={fair?.category??''} required className="min-h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"><option value="" disabled>Выберите категорию</option>{fairCategories.map(item=><option key={item} value={item}>{item}</option>)}</select></label>}
    <ListingLocationFields cityFieldName="city" defaultCity={details?.cityName??profile?.city??'Краснодар'} defaultAddress={details?.showExactAddress?details.address??undefined:undefined}
     defaultLat={details?.showExactAddress?details.latitude??undefined:undefined} defaultLng={details?.showExactAddress?details.longitude??undefined:undefined} addressLegend="Город и адрес" inlineControls/>
    <Field name="district" label="Район" defaultValue={details?.district??''} maxLength={200}/>
    <TextAreaField name="description" label={kind==='specialist'?'О специалисте':'Описание работ или товаров'} defaultValue={details?.description??''} minLength={kind==='specialist'?20:1} maxLength={3000} required/>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2"><Field name="phone" label="Телефон" defaultValue={details?.contactPhone??profile?.phone??''} maxLength={40} type="tel" required={kind==='fair'}/>
     <Field name="email" label="Email" defaultValue={details?.email??profile?.email??''} maxLength={254} type="email" required={kind==='fair'}/></div>
    <Field name="messengerUrl" label="Telegram / WhatsApp" defaultValue={details?.messengerUrl??''} maxLength={500} placeholder="@username или https://..."/>
    <Field name="videoUrl" label="Ссылка на видео (необязательно)" defaultValue={details?.videoUrl??''} maxLength={500} type="url"/>
    {kind==='fair'&&<TextAreaField name="comment" label="Комментарий организатору (не публикуется)" defaultValue={fair?.comment??''} maxLength={1000}/>}
    <p className="text-sm text-slate-600">Контакты не показываются в публичной карточке.</p>
    {initial&&<ServicePublicationPhotos owner={owner} photos={initial.photos}/>}
    <PhotoField label="Фотографии" description="Первое фото будет обложкой." maxPhotos={kind==='specialist'?12:10} autoOpenCropper={false}/>
   </>}
   <label className="flex items-start gap-3 text-sm text-slate-700"><input name="placementRightConfirmed" type="checkbox" value="1" defaultChecked={form?.placementRightConfirmed??false} className="mt-1 h-4 w-4 shrink-0"/>
    <span>Подтверждаю право размещать этот материал, фотографии и контактные данные.</span></label>
   <LegalConsentCheckbox name="serviceLegalAccepted"><span>Соглашаюсь с <LegalLink href="/legal/agreement">пользовательским соглашением</LegalLink> и <LegalLink href="/legal/privacy">политикой обработки персональных данных</LegalLink>.</span></LegalConsentCheckbox>
  </fieldset>
  <div className="flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={save.busy||save.uncertain} onClick={()=>void save.start(true)}>{save.busy?'Сохраняем…':'Сохранить черновик'}</button>
   {!initial&&<button type="submit" className={`${draftButton} bg-brand-blue text-white`} disabled={save.busy||save.uncertain}>Отправить на модерацию</button>}</div>
  <p className="text-sm text-slate-600">Сохранение и модерация бесплатны. Оплата — отдельным шагом после одобрения.</p>
  {save.message&&<p role="alert" className="break-words text-sm font-semibold text-rose-700">{save.message}</p>}
  {save.uncertain&&<button type="button" className={draftButton} disabled={save.busy} onClick={()=>void save.readback()}>Проверить сохранённую форму</button>}
  {save.remote&&<section aria-label="Сохранённая версия" className="min-w-0 rounded-lg border border-amber-400 bg-amber-50 p-4"><p>В БД другая версия. Ваши правки сохранены в этой вкладке.</p>
   <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(save.remote.form,null,2)}</pre><button type="button" className={`${draftButton} mt-3`} disabled={save.busy} onClick={save.acceptRemote}>Оставить мои правки вместо показанной версии</button></section>}
 </form>;
}
