"use client";
import {FormPhotoUploader} from './FormPhotoUploader';
import type {ListingDraftPhoto} from '@/lib/listing-photo-contract';
export function PublicationPhotoEditor({owner,photos,maxPhotos=12,savedFieldName='keepPhotoIds'}:{owner:string;photos:ListingDraftPhoto[];maxPhotos?:number;savedFieldName?:string}){
 return <FormPhotoUploader key={`${owner}:${photos.map(photo=>photo.id).join(':')}`} label="Фотографии" description="Сохранённые и новые фото. Первое фото — обложка. Можно добавить, убрать или изменить кадр; изменения применятся после сохранения."
  maxPhotos={Math.max(maxPhotos,photos.length)} autoOpenCropper={false} savedMedia={{owner,photos,fieldName:savedFieldName}}/>;
}
