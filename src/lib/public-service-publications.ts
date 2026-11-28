import {parseServicePublicationForm,checkServicePublicationForm,type ServicePublicationKind} from './service-publication-contract.ts';
import {parseListingDraftId} from './listing-draft-contract.ts';import type {SpecialistProfile,FairApplication} from './types';
import {validProfileName} from './cabinet-field-validation.ts';
import {checkSpecialistApplicationForm,specialistAbout} from './specialist-application-profile.ts';
export type PublicServiceRow={testPublication?:boolean;id:string;kind:ServicePublicationKind;form:unknown;professionId?:string|null;mediaIds:string[];withdrawnPhotos?:string[];status:string;paid:boolean;createdAt:string;publishedAt:string|null;expiresAt:string|null;profileIdentity?:{name:string;avatarDataUrl:string}|null;locationWithdrawn?:boolean};
export type PublicMarquee={id:string;text:string;href?:string;publishedAt:string;expiresAt:string};
export type PublicServiceMaterial=SpecialistProfile|FairApplication|PublicMarquee;
/** Explicit public DTO: never spread the private form or copy its owner, contacts or review. */
export function mapPublicServicePublication(row:PublicServiceRow,now:number):PublicServiceMaterial|null{
 try{
  const id=parseListingDraftId(row.id),form=parseServicePublicationForm(row.kind,row.form),published=row.publishedAt?Date.parse(row.publishedAt):NaN,expires=row.expiresAt?Date.parse(row.expiresAt):NaN;
  const profileBound=form.kind==='specialist'&&Object.hasOwn(row,'profileIdentity');
  // Old paid catalogue records retain their original per-field limits until edited.
  const singleAbout=profileBound&&form.kind==='specialist'&&!form.skills;
  const issues=singleAbout?checkSpecialistApplicationForm(form):checkServicePublicationForm(form);
  if(row.status!=='published'||row.paid!==true||!Number.isFinite(now)||!Number.isFinite(published)||!Number.isFinite(expires)||published>now||expires<=now||expires<=published||
   !Number.isFinite(Date.parse(row.createdAt))||issues.length||!Array.isArray(row.mediaIds)||JSON.stringify(row.mediaIds)!==JSON.stringify(form.kind==='marquee'?[]:form.photoIds))return null;
  if(form.kind==='marquee')return{id,text:row.testPublication===true?'ТЕСТ · '+form.title:form.title,publishedAt:row.publishedAt!,expiresAt:row.expiresAt!,...(form.href?{href:form.href}:{})};
  const showExactAddress=form.showExactAddress&&row.locationWithdrawn!==true;
  const images=form.photoIds.filter(photo=>!row.withdrawnPhotos?.includes(photo)).map(photo=>`/api/service-publications/${id}/photos/${photo}`),location={showExactAddress,...(form.district&&!profileBound?{district:form.district}:{}),
   ...(showExactAddress?{address:form.address!,lat:form.latitude!,lng:form.longitude!}:{})};
  if(form.kind==='fair')return{id,participantName:form.title,city:form.cityName!,category:form.category!,description:form.description,productPhotos:images,
   ...(form.videoUrl?{videoUrl:form.videoUrl}:{}),phone:'',email:'',status:'published',paymentStatus:'succeeded',createdAt:row.createdAt,...location};
  const price=form.price!,display=`${price.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ')}${price.endsWith('.00')?'':','+price.split('.')[1]} ₽`;
  let name=form.title,specialistImages=images;
  if(Object.hasOwn(row,'profileIdentity')){
   const identity=row.profileIdentity;
   if(!identity||!validProfileName(identity.name)||typeof identity.avatarDataUrl!=='string'||identity.avatarDataUrl.length>409623||
    identity.avatarDataUrl&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(identity.avatarDataUrl))return null;
   name=identity.name;specialistImages=identity.avatarDataUrl?[identity.avatarDataUrl]:[];
  }
  return{id,...(row.testPublication===true?{testPublication:true}:{}),name:row.testPublication===true?'ТЕСТ · '+name:name,profession:form.professionName!,...(row.professionId?{professionId:parseListingDraftId(row.professionId)}:{}),skills:profileBound?'':form.skills!,description:profileBound?specialistAbout(form):form.description,city:form.cityName!,price:`от ${display}`,imageSeed:'',images:specialistImages,
   ...(form.videoUrl&&!profileBound?{videoUrl:form.videoUrl}:{}),status:'published',createdAt:row.createdAt,publishedAt:row.publishedAt!,hasMapPoint:showExactAddress,...location};
 }catch{return null;}
}
