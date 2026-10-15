"use client";
import {useEffect,useRef} from 'react';
import {categories,cities} from '@/lib/data';
import {bookingEditFields} from '@/lib/listing-form-edit';
import {draftButton} from './PrivateDraftEditor';
import type {usePrivateListingForm} from './usePrivateListingForm';
const field='mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-500 bg-white p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
export function PrivateListingFormEditor({edit,onClose}:{edit:ReturnType<typeof usePrivateListingForm>;onClose:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null),id=edit.editor?.saved.id;
 useEffect(()=>{heading.current?.focus();},[id]);
 const editor=edit.editor;if(!editor)return null;const {fields}=editor,category=categories.find(item=>item.slug===fields.categorySlug);
 return <section aria-labelledby="extra-fields-heading" className="mt-6 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
  <h2 id="extra-fields-heading" tabIndex={-1} ref={heading} className="text-xl font-bold">Дополнительные поля черновика</h2>
  <p className="mt-2 text-sm text-slate-600">Категория, место, контакты и аренда видны только вам. Текст и фотографии сохраняются без изменений. Это не публикация и не оплата.</p>
  <form className="mt-4" onSubmit={event=>{event.preventDefault();edit.save();}}>
   <fieldset disabled={edit.busy||editor.blocked} className="grid min-w-0 gap-4 sm:grid-cols-2">
    <legend className="sr-only">Дополнительные поля</legend>
    <div className="min-w-0"><label htmlFor="extra-category">Категория</label><select id="extra-category" className={field} value={fields.categorySlug} onChange={event=>edit.change({categorySlug:event.currentTarget.value,subcategoryName:''})}>
     <option value="">Не выбрана</option>{fields.categorySlug&&!category&&<option value={fields.categorySlug}>{fields.categorySlug}</option>}
     {categories.map(item=><option key={item.slug} value={item.slug}>{item.name}</option>)}</select></div>
    <label className="min-w-0">Подкатегория<input className={field} list="extra-subcategories" maxLength={160} value={fields.subcategoryName}
     onChange={event=>edit.change({subcategoryName:event.currentTarget.value})}/><datalist id="extra-subcategories">{category?.children.map(name=><option key={name} value={name}/>)}</datalist></label>
    <label className="min-w-0">Город<input className={field} list="extra-cities" maxLength={160} value={fields.cityName} onChange={event=>edit.change({cityName:event.currentTarget.value})}/>
     <datalist id="extra-cities">{cities.map(city=><option key={city.slug} value={city.name}/>)}</datalist></label>
    <label>Район<input className={field} maxLength={160} value={fields.district} onChange={event=>edit.change({district:event.currentTarget.value})}/></label>
    <label className="sm:col-span-2">Адрес<input className={field} maxLength={300} value={fields.address} onChange={event=>edit.change({address:event.currentTarget.value})}/></label>
    <label>Широта<input className={field} inputMode="decimal" maxLength={30} value={fields.latitude} onChange={event=>edit.change({latitude:event.currentTarget.value})}/></label>
    <label>Долгота<input className={field} inputMode="decimal" maxLength={30} value={fields.longitude} onChange={event=>edit.change({longitude:event.currentTarget.value})}/></label>
    <label className="flex min-h-11 items-center gap-3 sm:col-span-2"><input type="checkbox" checked={fields.showExactAddress} onChange={event=>edit.change({showExactAddress:event.currentTarget.checked})}/>Показывать точный адрес после публикации</label>
    <p className="text-sm text-slate-600 sm:col-span-2">Координаты указываются парой. Чтобы убрать точку, очистите оба поля и снимите показ точного адреса.</p>
    <label>Телефон для связи<input type="tel" className={field} maxLength={40} value={fields.contactPhone} onChange={event=>edit.change({contactPhone:event.currentTarget.value})}/></label>
    <label>Мессенджер<input className={field} maxLength={500} value={fields.messengerUrl} onChange={event=>edit.change({messengerUrl:event.currentTarget.value})}/></label>
    <div className="sm:col-span-2"><label htmlFor="extra-booking-mode">Режим бронирования</label><select id="extra-booking-mode" className={field} value={fields.bookingMode} onChange={event=>{
     const value=event.currentTarget.value;if(value===''||value==='stay'||value==='tour')edit.change({bookingMode:value});
    }}><option value="">Без бронирования</option><option value="stay">Проживание</option><option value="tour">Поход</option></select></div>
    {fields.bookingMode&&bookingEditFields.map(([key,label,kind])=><label key={key} className={kind==='text'||kind==='dates'?'min-w-0 sm:col-span-2':'min-w-0'}>{label}
     {kind==='text'||kind==='dates'?<textarea className={field} maxLength={kind==='dates'?8030:500} rows={2} value={fields.booking[key]}
      onChange={event=>edit.change({booking:{...fields.booking,[key]:event.currentTarget.value}})}/>:<input className={field} type={kind==='date'||kind==='time'?kind:'text'} inputMode={kind==='integer'?'numeric':kind==='number'?'decimal':undefined}
      maxLength={30} value={fields.booking[key]} onChange={event=>edit.change({booking:{...fields.booking,[key]:event.currentTarget.value}})}/>}</label>)}
    <button type="submit" disabled={!edit.dirty} className={`${draftButton} bg-[#0875d1] text-white sm:col-span-2`}>Сохранить дополнительные поля</button>
   </fieldset>
  </form>
  {edit.busy&&<p className="mt-3" role="status">Проверяем и сохраняем поля…</p>}
  {edit.message&&<p className="mt-3 break-words" role="status">{edit.message}</p>}
  {editor.blocked&&<div className="mt-4 rounded-lg border border-amber-400 bg-amber-50 p-4"><p>Версия изменилась или результат запроса неизвестен. Ваши правки сохранены в редакторе; автоматического повтора не будет.</p>
   <button type="button" className={`${draftButton} mt-3`} disabled={edit.busy} onClick={edit.readback}>Сверить дополнительные поля</button></div>}
  {editor.remote&&<section aria-label="Сохранённые дополнительные поля" className="mt-4 min-w-0 rounded-lg border border-slate-300 p-4">
   <h3 className="font-bold">Сохранённая полная версия</h3><pre className="mt-2 whitespace-pre-wrap break-words text-sm">{JSON.stringify(editor.remote.form,null,2)}</pre>
   <p className="mt-3">При сохранении ваших дополнительных правок текст и фотографии будут взяты из этой версии.</p>
   <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={edit.busy} onClick={()=>edit.choose(false)}>Принять сохранённые поля</button>
    <button type="button" className={draftButton} disabled={edit.busy} onClick={()=>edit.choose(true)}>Оставить мои дополнительные правки</button></div>
  </section>}
  <button type="button" className={`${draftButton} mt-4`} disabled={edit.busy} onClick={onClose}>Закрыть дополнительные поля</button>
 </section>;
}
