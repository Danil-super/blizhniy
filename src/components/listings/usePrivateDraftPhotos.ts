"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {productionListingMedia,ListingMediaClientError} from '@/lib/client-listing-media';
import type {ListingDraftPhotos} from '@/lib/listing-photo-contract';
import type {UploadedImage} from '@/lib/media-upload-contract';

/** Lives in the owner-keyed workspace, not the temporarily hidden editor DOM. */
export function usePrivateDraftPhotos(owner:string,id:string|undefined,revision:string|undefined,
 onRevision:(id:string,before:string,after:string)=>void,onConflict:(id:string)=>void){
 const [saved,setSaved]=useState<ListingDraftPhotos|null>(null),[selection,setSelection]=useState<{file:File;intent:string;uploaded?:UploadedImage}|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
 const scope=useRef<AbortController|null>(null),generation=useRef(0),locked=useRef(false);
 useEffect(()=>{setSaved(null);setSelection(null);setMessage(null);},[owner,id]);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;const epoch=++generation.current;locked.current=false;
  if(id&&revision){setBusy(true);void productionListingMedia.photos(owner,id,{signal:controller.signal}).then(value=>{
   if(generation.current!==epoch)return;setSaved(value);if(value.revision!==revision){onConflict(id);setMessage('Версия черновика изменилась. Сверьте текст перед изменением фото.');}
  }).catch(error=>{if(generation.current===epoch)setMessage(error instanceof ListingMediaClientError?error.message:'Не удалось загрузить фотографии.');})
   .finally(()=>{if(generation.current===epoch)setBusy(false);});
  }else setBusy(false);
  return()=>{generation.current=epoch+1;controller.abort();};
 },[owner,id,revision,refresh,onConflict]);
 const choose=useCallback((file:File)=>{
  if(locked.current)return;
  try{setSelection({file,intent:crypto.randomUUID()});setMessage(null);}catch{setMessage('Не удалось подготовить загрузку. Обновите страницу.');}
 },[]);
 const write=async(ids:string[])=>{
  if(!id||!revision||!saved||saved.revision!==revision)throw new ListingMediaClientError('DRAFT_CHANGED');
  const value=await productionListingMedia.replace(owner,id,revision,ids,{signal:scope.current?.signal});
  setSaved(value);onRevision(id,revision,value.revision);setMessage('Фотографии сохранены.');
 };
 async function run(work:()=>Promise<void>){
  if(locked.current||busy||!id)return;locked.current=true;setBusy(true);setMessage(null);const epoch=generation.current;
  try{await work();}catch(error){if(epoch===generation.current){
   const failure=error instanceof ListingMediaClientError?error:new ListingMediaClientError('UNKNOWN');setMessage(failure.message);
   if(failure.code==='DRAFT_CHANGED'||failure.code==='UNKNOWN')onConflict(id);
  }}finally{if(epoch===generation.current){locked.current=false;setBusy(false);}}
 }
 return{saved,selection,busy,message,choose,
  uncertain:selection!==null,
  reload:()=>{if(!busy)setRefresh(value=>value+1);},
  discard:()=>{if(!busy){setSelection(null);setMessage('Выбранный файл убран. Уже загруженный файл при этом не удаляется с сервера.');}},
  upload:()=>void run(async()=>{
   if(!selection||!saved)return;
   const uploaded=selection.uploaded??await productionListingMedia.upload(owner,selection.intent,selection.file,{signal:scope.current?.signal});
   setSelection(current=>current?.intent===selection.intent?{...current,uploaded}:current);
   if(!saved.photos.some(photo=>photo.id===uploaded.id))await write([...saved.photos.map(photo=>photo.id),uploaded.id]);
   setSelection(null);
  }),
  replace:(ids:string[])=>void run(()=>write(ids)),
 };
}
