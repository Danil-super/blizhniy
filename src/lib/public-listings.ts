import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {parseListingFormDraft} from './listing-form-contract.ts';import {checkListingFormContent} from './listing-publication-check';
import {formatBookingPrice} from './booking-details';import type {Listing} from './types';
export type PublicListingRow={id:string;ownerId:string;revision:string;approvedRevision:string|null;authorName:string|null;form:unknown;mediaIds:string[];isSubcategory:boolean;status:string;paid:boolean;viewCount:number;createdAt:string;publishedAt:string|null;expiresAt:string|null};
const money=(value:string|null)=>!value||value==='0.00'?'по договоренности':`${value.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ')}${value.endsWith('.00')?'':','+value.split('.')[1]} ₽`;

/** Public DTO allowlist, not an owner/editor snapshot. SQL must also prove current author/reference/photo eligibility. */
export function mapPublicListing(row:PublicListingRow,now:number):Listing|null{
 try{
  const id=parseListingDraftId(row.id),ownerKey=parseListingDraftId(row.ownerId),revision=parseListingDraftRevision(row.revision),form=parseListingFormDraft(row.form);
  const stamp=(value:unknown)=>parseListingDraftCursor({id,updatedAt:value})!.updatedAt;
  const createdAt=stamp(row.createdAt),publishedAt=stamp(row.publishedAt),expiresAt=stamp(row.expiresAt),published=Date.parse(publishedAt),expires=Date.parse(expiresAt);
  if(!Number.isFinite(now)||row.status!=='published'||row.paid!==true||row.approvedRevision!==revision||published>now||expires<=now||expires<=published||Date.parse(createdAt)>published||
   checkListingFormContent(form,true).length||!Array.isArray(row.mediaIds)||JSON.stringify(row.mediaIds)!==JSON.stringify(form.photoIds)||
   !Number.isSafeInteger(row.viewCount)||row.viewCount<0||row.viewCount>2147483647||typeof row.isSubcategory!=='boolean'||row.isSubcategory!==(form.subcategoryName!==null)||form.kind!=='arenda'&&form.booking!==null)return null;
  let author='Автор объявления';if(row.authorName!==null){
   if(typeof row.authorName!=='string'||!row.authorName.trim()||row.authorName.length>120||!row.authorName.isWellFormed()||/[\x00-\x1f\x7f]/.test(row.authorName))return null;author=row.authorName.trim();
  }
  return{id,slug:id,ownerKey,kind:form.kind,categorySlug:form.categorySlug!,subcategory:form.subcategoryName??'',isSubcategory:row.isSubcategory,author,title:form.title,description:form.description,city:form.cityName!,
   ...(form.district?{district:form.district}:{}),showExactAddress:form.showExactAddress,hasMapPoint:form.showExactAddress,
   ...(form.showExactAddress?{...(form.address?{address:form.address}:{}),lat:form.latitude!,lng:form.longitude!}:{}),
   price:form.booking?formatBookingPrice(form.booking):money(form.price),images:form.photoIds.map(photo=>`/api/listings/${id}/photos/${photo}`),
   ...(form.booking?{booking:form.booking}:{}),imageTone:'blue',...(form.contactPhone?{phone:form.contactPhone}:{}),...(form.messengerUrl?{messengerUrl:form.messengerUrl}:{}),
   status:'published',paid:true,viewCount:row.viewCount,publishedAt,expiresAt};
 }catch{return null;}
}
