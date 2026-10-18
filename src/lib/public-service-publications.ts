import {parseServicePublicationForm,checkServicePublicationForm,type ServicePublicationKind} from './service-publication-contract.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';import type {SpecialistProfile,FairApplication} from './types';
export type PublicServiceRow={id:string;kind:ServicePublicationKind;form:unknown;mediaIds:string[];status:string;paid:boolean;createdAt:string;publishedAt:string|null;expiresAt:string|null};
export type PublicMarquee={id:string;text:string;href?:string};
export type PublicServiceMaterial=SpecialistProfile|FairApplication|PublicMarquee;
/** Explicit public DTO: never spread the private form or copy its owner, contacts or review. */
export function mapPublicServicePublication(row:PublicServiceRow,now:number):PublicServiceMaterial|null{
 try{
  const id=parseListingDraftId(row.id),form=parseServicePublicationForm(row.kind,row.form),published=row.publishedAt?Date.parse(row.publishedAt):NaN,expires=row.expiresAt?Date.parse(row.expiresAt):NaN;
  if(row.status!=='published'||row.paid!==true||!Number.isFinite(now)||!Number.isFinite(published)||!Number.isFinite(expires)||published>now||expires<=now||expires<=published||
   !Number.isFinite(Date.parse(row.createdAt))||checkServicePublicationForm(form).length||!Array.isArray(row.mediaIds)||JSON.stringify(row.mediaIds)!==JSON.stringify(form.kind==='marquee'?[]:form.photoIds))return null;
  if(form.kind==='marquee')return{id,text:form.title,...(form.href?{href:form.href}:{})};
  const images=form.photoIds.map(photo=>`/api/service-publications/${id}/photos/${photo}`),location={showExactAddress:form.showExactAddress,...(form.district?{district:form.district}:{}),
   ...(form.showExactAddress?{address:form.address!,lat:form.latitude!,lng:form.longitude!}:{})};
  if(form.kind==='fair')return{id,participantName:form.title,city:form.cityName!,category:form.category!,description:form.description,productPhotos:images,
   ...(form.videoUrl?{videoUrl:form.videoUrl}:{}),phone:'',email:'',status:'published',paymentStatus:'succeeded',createdAt:row.createdAt,...location};
  const price=form.price!,display=`${price.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ')}${price.endsWith('.00')?'':','+price.split('.')[1]} ₽`;
  return{id,name:form.title,profession:form.professionName!,skills:form.skills!,description:form.description,city:form.cityName!,price:`от ${display}`,imageSeed:'',images,
   ...(form.videoUrl?{videoUrl:form.videoUrl}:{}),status:'published',createdAt:row.createdAt,publishedAt:row.publishedAt!,hasMapPoint:form.showExactAddress,...location};
 }catch{return null;}
}
