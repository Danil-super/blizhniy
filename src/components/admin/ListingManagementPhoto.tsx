"use client";
import Image from 'next/image';
import {ImageIcon} from 'lucide-react';
import {useEffect,useState} from 'react';
import {listingManagement,ListingManagementClientError} from '@/lib/client-listing-management';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {createListingThumbnailQueue} from '@/lib/listing-thumbnail-queue';
const readPhoto=createListingThumbnailQueue((actor:string,key:string,{signal})=>{
 const [listingId,photoId]=key.split(':');return listingManagement.photo(actor,listingId,photoId,signal);
});
/** All administrative images share a bounded queue, including gallery thumbnails. */
export function ListingManagementPhoto({actor,listingId,photoId,alt,thumbnail=false}:{actor:string;listingId:string;photoId:string|null;alt:string;thumbnail?:boolean}){
 const [url,setUrl]=useState<string|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();let active=true,objectUrl:string|null=null;setUrl(null);setError(false);
  if(photoId)void readPhoto(actor,`${listingId}:${photoId}`,{signal:controller.signal}).then(blob=>{if(!active)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}).catch(error=>{
   if(active){setError(true);if(error instanceof ListingManagementClientError&&['ADMIN_REQUIRED','UNAUTHENTICATED'].includes(error.code)){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}}
  });return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[actor,listingId,photoId,attempt]);
 return <div data-listing-photo-frame className="relative flex aspect-[4/3] w-full min-w-0 items-center justify-center overflow-hidden bg-slate-100">
  {url&&!error?<Image src={url} unoptimized alt={alt} width={400} height={300} className="h-full w-full object-cover object-center" onError={()=>setError(true)}/>:<span className="flex flex-col items-center gap-1 p-1 text-center text-xs text-slate-600"><ImageIcon className="h-6 w-6" aria-hidden="true"/>{!thumbnail&&(photoId?error?'Фото недоступно':'Загрузка фото…':'Без фото')}</span>}
  {error&&!thumbnail&&<button type="button" className="absolute bottom-2 rounded border bg-white px-2 py-1 text-xs font-semibold" onClick={()=>setAttempt(value=>value+1)}>Повторить загрузку</button>}
 </div>;
}
