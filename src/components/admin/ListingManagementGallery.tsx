"use client";
import {useState} from 'react';
import type {ListingDraftPhoto} from '@/lib/listing-photo-contract';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {ListingManagementPhoto} from './ListingManagementPhoto';
export function ListingManagementGallery({actor,listingId,photos}:{actor:string;listingId:string;photos:ListingDraftPhoto[]}){
 const [index,setIndex]=useState(0);
 if(!photos.length)return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Нет фотографий</p>;
 const current=Math.min(index,photos.length-1),start=Math.floor(current/8)*8;
 return <div className="min-w-0 max-w-sm" aria-label="Фотографии объявления">
  <div className="overflow-hidden rounded-lg border border-slate-200"><ListingManagementPhoto key={photos[current].id} actor={actor} listingId={listingId} photoId={photos[current].id} alt={`Фотография ${current+1} из ${photos.length}`}/></div>
  <div className="mt-2 grid grid-cols-4 gap-2" aria-label="Выбор фотографии">{photos.slice(start,start+8).map((photo,offset)=><button key={photo.id} type="button" className={`overflow-hidden rounded-md border-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${current===start+offset?'border-blue-600':'border-transparent'}`} aria-label={`Показать фото ${start+offset+1} из ${photos.length}`} aria-pressed={current===start+offset} onClick={()=>setIndex(start+offset)}>
   <ListingManagementPhoto actor={actor} listingId={listingId} photoId={photo.id} alt="" thumbnail/>
  </button>)}</div>
  <div className="mt-2 flex items-center justify-between gap-2"><button type="button" className={draftButton} disabled={current===0} onClick={()=>setIndex(current-1)} aria-label="Предыдущее фото">←</button><span className="text-sm text-slate-600" role="status">{current+1} / {photos.length}</span><button type="button" className={draftButton} disabled={current===photos.length-1} onClick={()=>setIndex(current+1)} aria-label="Следующее фото">→</button></div>
  {photos.length>8&&<p className="mt-1 text-xs text-slate-600">Показаны миниатюры {start+1}–{Math.min(start+8,photos.length)}. Остальные доступны стрелками.</p>}
 </div>;
}
