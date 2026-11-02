"use client";
import {useRef,useState} from 'react';import {Field,PhotoField,TextAreaField} from '@/components/FormPanel';
import {ListingLocationFields} from '@/components/listings/ListingFormControls';import {LegalConsentCheckbox,LegalLink} from '@/components/LegalConsentCheckbox';
import {useCookieCabinetProfile} from '@/components/cabinet/CookieCabinetProfileProvider';import {fairCategories} from '@/lib/data';
import {PrimaryProfessionSelect} from '@/components/work/PrimaryProfessionSelect';import {CabinetFormValidation} from '@/components/CabinetFormValidation';
import {StoredMediaImage} from '@/components/StoredMedia';
import {specialistAbout} from '@/lib/specialist-application-profile';
import type {ServicePublicationKind} from '@/lib/service-publication-contract';import type {ServicePublicationSnapshot} from '@/lib/postgres-service-publications';
import {draftButton} from '@/components/listings/PrivateDraftEditor';import {PublicationPhotoEditor} from '@/components/PublicationPhotoEditor';import {useServicePublicationSave} from './useServicePublicationSave';
export const serviceFormLabels={specialist:'Анкета специалиста',fair:'Заявка на ярмарку',marquee:'Рекламный текст'};
export function ServicePublicationForm({owner,kind,initial,onSaved,onDirtyChange}:{owner:string;kind:ServicePublicationKind;initial?:ServicePublicationSnapshot;onSaved:(value:ServicePublicationSnapshot)=>void;onDirtyChange?:(value:boolean)=>void}){
 const element=useRef<HTMLFormElement>(null),[dirty,setDirty]=useState(false),save=useServicePublicationSave(owner,kind,element,dirty,initial,onSaved);
 const form=initial?.form,details=form&&form.kind!=='marquee'?form:null,specialist=form?.kind==='specialist'?form:null,fair=form?.kind==='fair'?form:null;
 const context=useCookieCabinetProfile(),profile=context?.ownerId===owner?context.profile:null;
 const about=specialist?specialistAbout(specialist):'';
 const changed=()=>{setDirty(true);onDirtyChange?.(true);};
 return <form ref={element} aria-label={serviceFormLabels[kind]} className="grid min-w-0 gap-4 [&_a]:text-blue-800 [&_.uppercase]:text-blue-800" onInput={changed} onChange={changed}
  onSubmit={event=>{event.preventDefault();void save.start(false);}}>
  <fieldset disabled={save.active&&!save.done} className="grid min-w-0 gap-4"><legend className="sr-only">Поля материала</legend>
   {kind==='specialist'?<section aria-label="Данные из профиля" className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-2xl font-bold text-blue-800">
     {profile?.avatarDataUrl?<StoredMediaImage src={profile.avatarDataUrl} alt="Фото из профиля" width={64} height={64} className="h-full w-full object-cover"/>:<span aria-hidden="true">{profile?.name?.slice(0,1)??'—'}</span>}
    </div>
    <div className="min-w-0 flex-1"><p className="break-words font-bold text-slate-950">{profile?.name??'Загружаем профиль…'}</p><p className="mt-1 text-sm text-slate-600">Имя и фото используются из вашего профиля.</p>
     <a href="/cabinet?settings=1" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-blue-800 underline">Изменить в настройках кабинета</a></div>
    <input type="hidden" name="title" value={profile?.name??''}/>
   </section>:<Field name="title" label={kind==='fair'?'Название мастерской или ФИО':'Текст рекламы'} defaultValue={form?.title??''} minLength={kind==='marquee'?10:2} maxLength={kind==='marquee'?140:160} required/>}
   {kind==='marquee'?<Field name="href" label="Ссылка (необязательно)" type="url" maxLength={500} defaultValue={form?.kind==='marquee'?form.href??'':''} placeholder="https://..."/>:<>
    {kind==='specialist'?<><PrimaryProfessionSelect defaultValue={specialist?.professionName??''} defaultId={initial?.professionId} required/>
     <Field name="price" label="Стоимость работ, ₽" defaultValue={specialist?.price?.replace(/\.00$/,'').replace('.',',')??''} inputMode="decimal" maxLength={13} pattern="[0-9]+([.,][0-9]{1,2})?" title="Сумма цифрами; допускается до двух знаков после запятой." placeholder="Например, 1500" required/>
     </>:
     <label className="grid gap-2 text-sm font-bold text-slate-700">Категория ярмарки<select name="category" defaultValue={fair?.category??''} required className="min-h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"><option value="" disabled>Выберите категорию</option>{fairCategories.map(item=><option key={item} value={item}>{item}</option>)}</select></label>}
    <ListingLocationFields cityFieldName="city" defaultCity={details?.cityName??profile?.city??'Краснодар'} defaultAddress={details?.showExactAddress?details.address??undefined:undefined}
     defaultLat={details?.showExactAddress?details.latitude??undefined:undefined} defaultLng={details?.showExactAddress?details.longitude??undefined:undefined} addressLegend="Город и адрес" inlineControls/>
    {kind==='fair'&&<input type="hidden" name="district" value={fair?.district??''}/>}
    <TextAreaField name="description" label={kind==='specialist'?'О себе':'Описание работ или товаров'} defaultValue={kind==='specialist'?about:details?.description??''} minLength={kind==='specialist'?20:1} maxLength={3000} required/>
    {kind==='specialist'&&<p className="-mt-2 text-sm text-slate-600">Расскажите, с какими задачами работаете, о своём опыте и условиях. От 20 до 3000 символов.</p>}
    {kind==='specialist'&&about.length>3000&&<p role="alert" className="text-sm font-semibold text-amber-800">Прежние тексты объединены без обрезки. Сократите «О себе» до 3000 символов перед сохранением; старая версия пока не изменена.</p>}
    <div className="grid min-w-0 gap-4 sm:grid-cols-2"><Field name="phone" label="Телефон" defaultValue={details?.contactPhone??profile?.phone??''} maxLength={40} type="tel" required={kind==='fair'}/>
     <Field name="email" label="Email" defaultValue={details?.email??profile?.email??''} maxLength={254} type="email" required={kind==='fair'}/></div>
    <Field name="messengerUrl" label="Telegram / WhatsApp" defaultValue={details?.messengerUrl??''} maxLength={500} placeholder="@username или https://..."/>
    {kind==='fair'&&<Field name="videoUrl" label="Ссылка на видео (необязательно)" defaultValue={fair?.videoUrl??''} maxLength={500} type="url"/>}
    {kind==='fair'&&<TextAreaField name="comment" label="Комментарий организатору (не публикуется)" defaultValue={fair?.comment??''} maxLength={1000}/>}
    <p className="text-sm text-slate-600">Контакты не показываются в публичной карточке.</p>
    {kind==='fair'&&(initial?<PublicationPhotoEditor owner={owner} photos={initial.photos} maxPhotos={10}/>:<PhotoField label="Фотографии" description="Первое фото будет обложкой." maxPhotos={10} autoOpenCropper={false}/>)}
   </>}
   <label className="flex items-start gap-3 text-sm text-slate-700"><input name="placementRightConfirmed" type="checkbox" value="1" defaultChecked={form?.placementRightConfirmed??false} className="mt-1 h-4 w-4 shrink-0"/>
    <span>Подтверждаю право размещать этот материал, фотографии и контактные данные.</span></label>
   <LegalConsentCheckbox name="serviceLegalAccepted"><span>Соглашаюсь с <LegalLink href="/legal/agreement">пользовательским соглашением</LegalLink> и <LegalLink href="/legal/privacy">политикой обработки персональных данных</LegalLink>.</span></LegalConsentCheckbox>
  </fieldset>
  <CabinetFormValidation/>
  <div className="flex flex-wrap gap-3"><button type="button" data-cabinet-save className={draftButton} disabled={save.busy||save.uncertain||kind==='specialist'&&!profile} onClick={()=>void save.start(true)}>{save.busy?'Сохраняем…':'Сохранить черновик'}</button>
   {(kind==='specialist'||!initial)&&<button type="submit" className={`${draftButton} bg-brand-blue text-white`} disabled={save.busy||save.uncertain||kind==='specialist'&&!profile}>{kind==='specialist'?'Сохранить анкету':'Отправить на модерацию'}</button>}</div>
  <p className="text-sm text-slate-600">{kind==='specialist'?'Заполненная сохранённая анкета доступна для откликов сразу. Модерация и оплата анкеты для этого не требуются.':'Сохранение и модерация бесплатны. Оплата — отдельным шагом после одобрения.'}</p>
  {save.message&&<p role="alert" className="break-words text-sm font-semibold text-rose-700">{save.message}</p>}
  {save.uncertain&&<button type="button" className={draftButton} disabled={save.busy} onClick={()=>void save.readback()}>Проверить сохранённую форму</button>}
  {save.remote&&<section aria-label="Сохранённая версия" className="min-w-0 rounded-lg border border-amber-400 bg-amber-50 p-4"><p>В БД другая версия. Ваши правки сохранены в этой вкладке.</p>
   <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(save.remote.form,null,2)}</pre><button type="button" className={`${draftButton} mt-3`} disabled={save.busy} onClick={save.acceptRemote}>Оставить мои правки вместо показанной версии</button></section>}
 </form>;
}
