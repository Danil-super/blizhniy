"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { Camera, Images, Plus, X } from "lucide-react";
import { SquareImageCropper } from "@/components/SquareImageCropper";
import { StoredMediaImage } from "@/components/StoredMedia";
import { filterFormPhotoFiles, formPhotoLimitText } from "@/lib/media-limits";
import {productionListingMedia} from '@/lib/client-listing-media';
import {createListingThumbnailQueue} from '@/lib/listing-thumbnail-queue';
import type {ListingDraftPhoto} from '@/lib/listing-photo-contract';
const readPrivatePhoto=createListingThumbnailQueue(productionListingMedia.read);

type PreviewPhoto = {
  id: string;
  file?: File;
  name: string;
  persisted?: boolean;
  mediaId?: string;
  error?: boolean;
  sourceUrl: string;
  url: string;
};

function syncFileInput(input: HTMLInputElement | null, photos: PreviewPhoto[]) {
  if (!input) {
    return;
  }

  const transfer = new DataTransfer();
  photos.forEach((photo) => {
    if (photo.file) {
      transfer.items.add(photo.file);
    }
  });
  input.files = transfer.files;
}

async function dataUrlToImageFile(dataUrl: string, name: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}-crop.png`, { type: blob.type || "image/png" });
}

export function FormPhotoUploader({
  autoOpenCropper = true,
  defaultPhotos = [],
  description,
  label,
  maxPhotos = 12,
  name = "photos",
  required = false,
  savedMedia,
}: {
  autoOpenCropper?: boolean;
  defaultPhotos?: string[];
  description: string;
  label: string;
  maxPhotos?: number;
  name?: string;
  required?: boolean;
  savedMedia?: {owner:string;photos:ListingDraftPhoto[];fieldName?:string};
}) {
  const normalizedMaxPhotos = Math.max(1, maxPhotos);
  const [photos, setPhotos] = useState<PreviewPhoto[]>(
    savedMedia?savedMedia.photos.map((photo,index)=>({id:photo.id,mediaId:photo.id,name:`Фото ${index+1}`,persisted:true,sourceUrl:'',url:''})):
    defaultPhotos.slice(0, normalizedMaxPhotos).map((url, index) => ({
      id: `persisted-${index}-${url.slice(0, 24)}`,
      name: `Фото ${index + 1}`,
      persisted: true,
      sourceUrl: url,
      url,
    }))
  );
  const [cropEditorId, setCropEditorId] = useState("");
  const [message, setMessage] = useState("");
  const [removed,setRemoved]=useState<{photo:PreviewPhoto;index:number}|null>(null);
  const currentPhotos=useRef(photos);currentPhotos.current=photos;
  const scope=useRef<AbortController|null>(null);
  const urlsRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const cropEditorPhoto = photos.find((photo) => photo.id === cropEditorId);
  const savedOwner=savedMedia?.owner;
  function commit(next:PreviewPhoto[]){currentPhotos.current=next;syncFileInput(inputRef.current,next);setPhotos(next);inputRef.current?.dispatchEvent(new Event('input',{bubbles:true}));}
  const loadSaved=useCallback((photo:PreviewPhoto)=>{
    const controller=scope.current;if(!savedOwner||!photo.mediaId||!controller)return;
    void readPrivatePhoto(savedOwner,photo.mediaId,{signal:controller.signal}).then(blob=>{
      if(controller.signal.aborted)return;const url=URL.createObjectURL(blob);urlsRef.current.push(url);
      setPhotos(items=>items.map(item=>item.id===photo.id&&item.persisted?{...item,sourceUrl:url,url,error:false}:item));
    }).catch(()=>{if(!controller.signal.aborted)setPhotos(items=>items.map(item=>item.id===photo.id?{...item,error:true}:item));});
  },[savedOwner]);

  useEffect(() => {
    const controller=new AbortController();scope.current=controller;
    currentPhotos.current.filter(photo=>photo.mediaId).forEach(loadSaved);
    return () => {
      controller.abort();
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, [loadSaved]);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const availableSlots = Math.max(0, normalizedMaxPhotos - photos.length);
    const selectedFiles = Array.from(event.target.files ?? []).slice(0, availableSlots);
    const { accepted, rejectedMessages } = filterFormPhotoFiles(selectedFiles);
    const files = accepted.slice(0, availableSlots);

    setMessage(rejectedMessages[0] ?? (availableSlots <= 0 ? `Можно добавить не больше ${normalizedMaxPhotos} фото.` : ""));

    if (!files.length) {
      event.currentTarget.value = "";
      syncFileInput(inputRef.current, photos);
      return;
    }

    const nextPhotos = files.map((file) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);

      return {
        id: `${file.name}-${file.size}-${url}`,
        file,
        name: file.name,
        sourceUrl: url,
        url,
      };
    });

    event.currentTarget.value = "";
    commit([...currentPhotos.current,...nextPhotos].slice(0,normalizedMaxPhotos));
    if (autoOpenCropper) {
      setCropEditorId(nextPhotos[0]?.id ?? "");
    }
  }

  function removePhoto(id: string) {
    const index=currentPhotos.current.findIndex(photo=>photo.id===id),photo=currentPhotos.current[index];if(!photo)return;
    setMessage('');setRemoved({photo,index});commit(currentPhotos.current.filter(item=>item.id!==id));if(cropEditorId===id)setCropEditorId('');
  }

  async function applySquareCrop(photo: PreviewPhoto, dataUrl: string) {
    const controller=scope.current;
    const file = await dataUrlToImageFile(dataUrl, photo.name);
    if(controller?.signal.aborted||!currentPhotos.current.some(item=>item.id===photo.id))return;
    commit(currentPhotos.current.map((item) =>
        item.id === photo.id
          ? {
              ...item,
              file,
              persisted: false,
              mediaId: undefined,
              url: dataUrl,
            }
          : item
      ));
    setCropEditorId("");
  }

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-xl border border-blue-100 bg-white p-3 shadow-sm sm:p-4">
      <div className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-700">
            <Camera aria-hidden="true" className="h-5 w-5 text-[#0875d1]"/>
            <span>{label}{required ? <span className="text-rose-600"> *</span> : null}</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600" aria-live="polite"><Images aria-hidden="true" className="h-3.5 w-3.5"/>{photos.length}/{normalizedMaxPhotos}</span>
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-800 transition hover:bg-blue-100 focus-within:ring-2 focus-within:ring-blue-600">
            <input ref={inputRef} className="sr-only" name={name} type="file" accept="image/*" multiple={normalizedMaxPhotos > 1} required={required && !photos.length} onChange={handleFiles}/>
            <Plus aria-hidden="true" className="h-4 w-4"/>Добавить файлы
          </label>
        </div>
        <p className="sr-only">{description}</p>
        {photos.length ? (
          <div className="min-w-0">
            <div className="grid max-h-[28rem] min-w-0 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:flex lg:max-h-none lg:grid-cols-none lg:overflow-x-auto lg:overflow-y-hidden lg:pb-1 lg:pr-0">
              {photos.map((photo, index) => (
                <figure key={photo.id} className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white lg:w-44 lg:shrink-0">
                  <div className="aspect-[4/3] bg-slate-100">
                  {photo.url?<StoredMediaImage src={photo.url} alt={photo.name} className="h-full w-full object-contain" />:<div className="flex h-full flex-col items-center justify-center p-2 text-center text-xs text-slate-600"><span role={photo.error?'alert':'status'}>{photo.error?'Превью недоступно. Фото сохранено.':'Загружаем фото…'}</span>
                   {photo.error&&<button type="button" onClick={()=>loadSaved(photo)} className="min-h-11 underline">Повторить загрузку фото</button>}</div>}
                  </div>
                  <figcaption className="grid gap-1 border-t border-slate-200 p-2">
                  <div className="flex min-w-0 items-center justify-between gap-1">
                  {index===0?<span className="text-xs font-bold text-blue-800">Обложка</span>:<button type="button" aria-label={`Сделать обложкой ${photo.name}`} className="min-h-11 min-w-0 rounded px-1 text-xs font-semibold text-blue-800 hover:bg-blue-50" onClick={()=>commit([photo,...currentPhotos.current.filter(item=>item.id!==photo.id)])}>На обложку</button>}
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-rose-50 hover:text-rose-700"
                    aria-label={`Убрать ${photo.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                  </div>
                  <button
                    type="button"
                    disabled={!photo.url}
                    onClick={() => setCropEditorId(photo.id)}
                    className="min-h-11 rounded-lg border border-blue-100 bg-blue-50 px-2 text-xs font-semibold text-blue-800 transition hover:bg-blue-100 disabled:opacity-50"
                  >
                    <span className="lg:hidden">Кадр</span>
                    <span className="hidden lg:inline">Изменить кадр</span>
                  </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-slate-600">{formPhotoLimitText()}</p>
      {message ? <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{message}</p> : null}
      {removed&&<div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><p role="status">Фото убрано из формы. Изменения применятся после сохранения.</p><button type="button" disabled={photos.length>=normalizedMaxPhotos} className="min-h-11 font-semibold text-blue-800 underline" onClick={()=>{const next=[...currentPhotos.current];next.splice(Math.min(removed.index,next.length),0,removed.photo);commit(next);if(removed.photo.mediaId&&!removed.photo.url)loadSaved(removed.photo);setRemoved(null);}}>Вернуть фото</button></div>}
      {photos
        .filter((photo) => photo.persisted&&!photo.mediaId)
        .map((photo) => (
          <input key={`hidden-${photo.id}`} type="hidden" name="existingPhotos" value={photo.url} />
        ))}
      {photos.filter(photo=>photo.persisted&&photo.mediaId).map(photo=><input key={`saved-${photo.id}`} type="hidden" name={savedMedia?.fieldName??'keepPhotoIds'} value={photo.mediaId}/>)}
      {savedMedia&&<input type="hidden" name="photoOrder" value={JSON.stringify(photos.map(photo=>photo.persisted&&photo.mediaId?{savedId:photo.mediaId}:{uploadIndex:photos.filter(item=>item.file).findIndex(item=>item.id===photo.id)}))}/>}
      <input type="hidden" name={`${name}Refs`} value={JSON.stringify(photos.map((photo) => photo.url))} />
      {cropEditorPhoto ? (<div onInput={event=>event.stopPropagation()} onChange={event=>event.stopPropagation()}>
        <SquareImageCropper
          alt={cropEditorPhoto.name}
          aspectRatio={4/3}
          outputSize={1600}
          onApply={(dataUrl) => applySquareCrop(cropEditorPhoto, dataUrl)}
          onCancel={() => setCropEditorId("")}
          src={cropEditorPhoto.sourceUrl}
          title="Кадр для карточки"
        /></div>
      ) : null}
    </section>
  );
}
