"use client";
import Image from 'next/image';import {useEffect,useState} from 'react';
import {adminListingModeration,AdminModerationClientError} from '@/lib/client-admin-listing-moderation';
import type {ListingDraftPhoto} from '@/lib/listing-photo-contract';import {notifyAccountSessionChange} from '@/lib/local-account';
export function ModerationPhotoPreview({actor,requestId,photo,index,count}:{actor:string;requestId:string;photo:ListingDraftPhoto;index:number;count:number}){
 const [url,setUrl]=useState<string|null>(null),[error,setError]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();let active=true,objectUrl:string|null=null;setUrl(null);setError(false);
  void adminListingModeration.photo(actor,requestId,photo.id,{signal:controller.signal}).then(blob=>{
   if(!active)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);
  }).catch(error=>{if(active){setError(true);if(error instanceof AdminModerationClientError&&['ADMIN_REQUIRED','UNAUTHENTICATED'].includes(error.code)){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}}});
  return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[actor,requestId,photo.id]);
 return <div className="mt-3 flex min-h-56 min-w-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-3 sm:min-h-80">
  {error?<p role="alert">Фотография недоступна. Перечитайте запрос перед решением.</p>:url?<Image src={url} unoptimized alt={`Фотография ${index+1} из ${count}`} width={photo.width} height={photo.height}
   className="h-56 w-full max-w-full rounded-lg object-contain sm:h-80" onError={()=>setError(true)}/>:<p role="status">Загружаем приватную фотографию…</p>}
 </div>;
}
