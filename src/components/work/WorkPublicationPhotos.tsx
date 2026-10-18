"use client";
import {useEffect,useState} from 'react';
import {productionListingMedia} from '@/lib/client-listing-media';
import type {ListingDraftPhoto} from '@/lib/listing-photo-contract';

function Photo({owner,photo,index}:{owner:string;photo:ListingDraftPhoto;index:number}){
 const [url,setUrl]=useState<string|null>(null),[error,setError]=useState(false);
 useEffect(()=>{const controller=new AbortController();let objectUrl:string|null=null;
  void productionListingMedia.read(owner,photo.id,{signal:controller.signal}).then(blob=>{if(!controller.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[owner,photo.id]);
 return <label className="grid min-w-0 gap-2 rounded-lg border border-slate-200 p-3">
  {url?<span role="img" aria-label={`Фотография ${index+1}`} className="block h-32 bg-contain bg-center bg-no-repeat" style={{backgroundImage:`url("${url}")`}}/>:<span role="status">{error?'Не удалось загрузить превью. Фото сохранено.':'Загружаем фото…'}</span>}
  <span className="flex items-center gap-2 text-sm"><input type="checkbox" name="keepPhotoIds" value={photo.id} defaultChecked/>Оставить фото {index+1}</span>
 </label>;
}
export function WorkPublicationPhotos({owner,photos}:{owner:string;photos:ListingDraftPhoto[]}){
 return photos.length?<section aria-label="Сохранённые фотографии" className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((photo,index)=><Photo key={photo.id} owner={owner} photo={photo} index={index}/>)}</section>:null;
}
