"use client";
import Image from 'next/image';
import {useEffect,useState} from 'react';
import {productionListingMedia} from '@/lib/client-listing-media';
import type {ListingDraftPhoto} from '@/lib/listing-photo-contract';

export function SavedListingPhotos({owner,photos:initial}:{owner:string;photos:ListingDraftPhoto[]}){
 const [photos,setPhotos]=useState(initial),[index,setIndex]=useState(0),[url,setUrl]=useState<string|null>(null),[error,setError]=useState(false);
 const photo=photos[index];
 useEffect(()=>{
  const controller=new AbortController();let active=true,objectUrl:string|null=null;setUrl(null);setError(false);
  if(photo)void productionListingMedia.read(owner,photo.id,{signal:controller.signal}).then(blob=>{
   if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}
  }).catch(()=>{if(active)setError(true);});
  return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[owner,photo]);
 if(!initial.length)return null;
 return <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4" aria-label="Сохранённые фотографии">
  {photos.map(item=><input key={item.id} type="hidden" name="savedPhotoIds" value={item.id}/>)}
  <p className="font-semibold">Сохранённые фотографии: {photos.length}</p>
  <p className="mt-1 text-sm text-slate-600">Они останутся в объявлении. Новые фотографии добавятся после них.</p>
  {photo&&<><div className="mt-3 flex min-h-40 items-center justify-center rounded-lg bg-white">
   {url?<Image unoptimized src={url} alt={`Сохранённая фотография ${index+1} из ${photos.length}`} width={photo.width} height={photo.height} className="h-56 w-full object-contain"/>:
    <p role={error?'alert':'status'}>{error?'Не удалось загрузить фотографию. Она сохранена в объявлении.':'Загружаем фотографию…'}</p>}
  </div><div className="mt-3 flex flex-wrap gap-2">
   <button type="button" className="min-h-11 rounded-lg border bg-white px-3" disabled={index===0} onClick={()=>setIndex(value=>value-1)}>Предыдущая</button>
   <button type="button" className="min-h-11 rounded-lg border bg-white px-3" disabled={index===photos.length-1} onClick={()=>setIndex(value=>value+1)}>Следующая</button>
   {index>0&&<button type="button" className="min-h-11 rounded-lg border bg-white px-3" onClick={()=>{setPhotos(items=>[items[index],...items.filter((_,position)=>position!==index)]);setIndex(0);}}>Сделать обложкой</button>}
   <button type="button" className="min-h-11 rounded-lg border border-rose-200 bg-white px-3 text-rose-700" onClick={()=>{setPhotos(items=>items.filter(item=>item.id!==photo.id));setIndex(0);}}>Убрать фотографию</button>
  </div></>}
 </div>;
}
