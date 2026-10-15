"use client";
import {useEffect,useState} from 'react';
import {productionListingForm} from '@/lib/client-listing-form';
import type {ListingFormSnapshot} from '@/lib/listing-form-contract';
export function PrivateDraftDetails({owner,id,revision}:{owner:string;id:string;revision:string}){
 const [open,setOpen]=useState(false),[view,setView]=useState<ListingFormSnapshot|null>(null),[error,setError]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let active=true;setView(null);setError(false);
  if(open)void productionListingForm.read(owner,id,{signal:controller.signal}).then(value=>{if(active)setView(value);}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;controller.abort();};
 },[owner,id,revision,open,refresh]);
 const form=view?.form;
 return <details className="mt-6 rounded-xl border border-slate-200 bg-white p-4" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary className="min-h-11 cursor-pointer font-bold">Категория, место и контакты из полной формы</summary>
  {open&&!view&&!error&&<p role="status">Загружаем сохранённые поля…</p>}
  {error&&<div role="alert"><p>Не удалось прочитать полную форму.</p><button type="button" className="min-h-11 underline" onClick={()=>setRefresh(value=>value+1)}>Повторить загрузку полей</button></div>}
  {form&&<dl className="mt-3 grid min-w-0 gap-2 break-words sm:grid-cols-[auto_1fr]">
   <dt>Категория</dt><dd>{form.subcategoryName??form.categorySlug??'Не выбрана'}</dd>
   <dt>Город</dt><dd>{form.cityName??'Не выбран'}</dd><dt>Адрес</dt><dd>{form.address??'Не указан'}</dd>
   <dt>Телефон</dt><dd>{form.contactPhone??'Не указан'}</dd><dt>Мессенджер</dt><dd>{form.messengerUrl??'Не указан'}</dd>
   {form.latitude!==null&&<><dt>Точка на карте</dt><dd>{form.latitude}, {form.longitude}</dd></>}
   {form.booking&&<><dt>Параметры аренды</dt><dd><pre className="whitespace-pre-wrap break-words text-sm">{JSON.stringify(form.booking,null,2)}</pre></dd></>}
  </dl>}
  {form&&<p className="mt-3 text-sm text-slate-600">Эти поля видны только владельцу черновика. Сохранение текста и фотографий не удаляет их.</p>}
 </details>;
}
