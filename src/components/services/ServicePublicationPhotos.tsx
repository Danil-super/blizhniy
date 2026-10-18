"use client";
import {useEffect,useState} from 'react';import {productionListingMedia} from '@/lib/client-listing-media';import type {ListingDraftPhoto} from '@/lib/listing-photo-contract';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
/** One bounded preview at a time; selecting twelve photos cannot exhaust the shared read budget. */
export function ServicePublicationPhotos({owner,photos}:{owner:string;photos:ListingDraftPhoto[]}){
 const [index,setIndex]=useState(0),[url,setUrl]=useState<string|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0),photo=photos[index];
 useEffect(()=>{if(!photo)return;const controller=new AbortController();let objectUrl:string|null=null;setUrl(null);setError(false);
  void productionListingMedia.read(owner,photo.id,{signal:controller.signal}).then(blob=>{if(!controller.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[owner,photo,retry]);
 if(!photos.length)return null;
 return <section aria-label="Сохранённые фотографии" className="min-w-0 rounded-lg border border-slate-200 p-3">
  {url?<div role="img" aria-label={`Фотография ${index+1} из ${photos.length}`} className="h-48 bg-contain bg-center bg-no-repeat" style={{backgroundImage:`url("${url}")`}}/>:<p role="status">{error?'Не удалось загрузить превью. Фото сохранено.':'Загружаем фотографию…'}</p>}
  <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={index===0} onClick={()=>setIndex(value=>value-1)}>Предыдущая фотография</button>
   <button type="button" className={draftButton} disabled={index>=photos.length-1} onClick={()=>setIndex(value=>value+1)}>Следующая фотография</button>
   {error&&<button type="button" className={draftButton} onClick={()=>setRetry(value=>value+1)}>Повторить загрузку фото</button>}</div>
  <div className="mt-3 grid gap-2 sm:grid-cols-2">{photos.map((item,index)=><label key={item.id} className="flex min-h-11 items-center gap-3 text-sm"><input name="keepPhotoIds" type="checkbox" value={item.id} defaultChecked/>Оставить фото {index+1}</label>)}</div>
 </section>;
}
