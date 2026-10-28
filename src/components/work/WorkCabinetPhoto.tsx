"use client";
import Image from 'next/image';
import {ImageIcon} from 'lucide-react';
import {useEffect,useState} from 'react';
import {productionListingMedia,ListingMediaClientError} from '@/lib/client-listing-media';
import {createListingThumbnailQueue} from '@/lib/listing-thumbnail-queue';
import {notifyAccountSessionChange} from '@/lib/local-account';
const readThumbnail=createListingThumbnailQueue(productionListingMedia.read);

export function WorkCabinetPhoto({owner,photoId,title}:{owner:string;photoId:string|null;title:string}){
 const [url,setUrl]=useState<string|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();let active=true,objectUrl:string|null=null;setUrl(null);setFailed(false);
  if(photoId)void readThumbnail(owner,photoId,{signal:controller.signal}).then(blob=>{
   if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}
  }).catch(error=>{
   if(!active)return;setFailed(true);
   if(error instanceof ListingMediaClientError&&['UNAUTHENTICATED','SESSION_CHANGED'].includes(error.code)){
    notifyAccountSessionChange(true);notifyAccountSessionChange(false);
   }
  });
  return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[owner,photoId]);
 return <span data-work-photo-frame className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-t-xl bg-slate-100">
  {url&&!failed?<Image src={url} unoptimized alt={title} width={400} height={300} className="h-full w-full object-cover object-center" onError={()=>setFailed(true)}/>:
   <span className="flex flex-col items-center gap-1 text-xs text-slate-600"><ImageIcon className="h-7 w-7" aria-hidden="true"/>{photoId?failed?'Фото недоступно':'Загрузка фото…':'Без фото'}</span>}
 </span>;
}
