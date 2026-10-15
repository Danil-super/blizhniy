"use client";
import {useEffect,useState} from 'react';
import {productionListingMedia} from '@/lib/client-listing-media';
import type {usePrivateDraftPhotos} from './usePrivateDraftPhotos';
import {draftButton} from './PrivateDraftEditor';

function PrivatePhoto({owner,id}:{owner:string;id:string}){
 const [url,setUrl]=useState<string|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{const controller=new AbortController();let active=true,objectUrl:string|undefined;
  void productionListingMedia.read(owner,id,{signal:controller.signal}).then(blob=>{if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}})
   .catch(()=>{if(active)setFailed(true);});
  return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[owner,id]);
 // A private blob URL cannot be optimized or fetched by Next's public image service.
 return <div className="flex h-36 items-center justify-center rounded-lg bg-slate-100">{url?
  <picture><img src={url} alt="Фотография черновика" className="h-36 max-w-full rounded-lg object-contain" /></picture>:
  <span role="status" className="p-3 text-sm">{failed?'Не удалось показать фото. Обновите список.':'Загружаем фото…'}</span>}</div>;
}
export function PrivateDraftPhotos({owner,photos,disabled}:{owner:string;photos:ReturnType<typeof usePrivateDraftPhotos>;disabled:boolean}){
 const list=photos.saved?.photos??[],blocked=disabled||photos.busy;
 return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="Фотографии черновика">
  <h2 className="text-xl font-bold">Фотографии</h2>
  <p className="mt-2 text-sm text-slate-600">Пока объявление в черновиках, фото доступны только вам. JPEG, PNG, WebP или статичный GIF до 10 МБ. Координаты и другие метаданные удаляются.</p>
  <button type="button" className={`${draftButton} mt-3`} disabled={blocked} onClick={photos.reload}>Обновить фотографии</button>
  {photos.message&&<p role="status" className="mt-3 break-words">{photos.message}</p>}
  {photos.busy&&<p role="status" className="mt-3">Обрабатываем фотографии…</p>}
  <ol className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">{list.map((photo,index)=><li key={photo.id} className="min-w-0 rounded-lg border p-3">
   <PrivatePhoto owner={owner} id={photo.id}/><p className="mt-2 text-sm">Фото {index+1}{index===0?' — обложка':''}</p>
   <div className="mt-2 flex flex-wrap gap-2">
    <button type="button" className={draftButton} disabled={blocked||index===0} onClick={()=>{const ids=list.map(item=>item.id);[ids[index-1],ids[index]]=[ids[index],ids[index-1]];photos.replace(ids);}} aria-label={`Переместить фото ${index+1} раньше`}>Раньше</button>
    <button type="button" className={draftButton} disabled={blocked} onClick={()=>photos.replace(list.filter(item=>item.id!==photo.id).map(item=>item.id))} aria-label={`Убрать фото ${index+1}`}>Убрать</button>
   </div>
  </li>)}</ol>
  <div className="mt-4 space-y-3">
   <label className="block" htmlFor="draft-photo-file">Добавить фотографию</label>
   <input id="draft-photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={blocked||!!photos.selection} className="max-w-full" onChange={event=>{
    const file=event.currentTarget.files?.[0];if(file)photos.choose(file);event.currentTarget.value='';
   }}/>
   {photos.selection&&<div className="space-y-3"><p className="break-words">Выбран файл: {photos.selection.file.name}</p>
    <p className="text-sm text-slate-600">Если ответ потерялся, повторная проверка использует тот же файл и не создаёт вторую загрузку.</p>
    <button type="button" className={`${draftButton} bg-[#0875d1] text-white`} disabled={blocked||!photos.saved} onClick={photos.upload}>{photos.selection.uploaded?'Сохранить загруженное фото':'Загрузить и сохранить фото'}</button>
    <button type="button" className={`${draftButton} ml-2`} disabled={blocked} onClick={photos.discard}>Убрать выбранный файл</button>
   </div>}
  </div>
 </section>;
}
