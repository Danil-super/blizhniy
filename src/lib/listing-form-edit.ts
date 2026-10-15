import {parseListingFormDraft,type ListingFormDraft} from './listing-form-contract.ts';
import {ListingDraftInputError} from './listing-draft-contract.ts';
export const bookingEditFields=[
 ['priceWeekday','Будни, ₽/сутки','number'],['priceWeekend','Выходные, ₽/сутки','number'],['pricePerPerson','Стоимость с человека, ₽','number'],
 ['minNights','Минимум ночей','integer'],['includedGuests','Гостей включено','integer'],['maxGuests','Максимум гостей / мест','integer'],['extraGuestPrice','Доплата за гостя, ₽','number'],
 ['availableFrom','Принимать гостей с','date'],['availableTo','Принимать гостей до','date'],['blockedDates','Занятые даты через запятую','dates'],
 ['checkInTime','Заезд после','time'],['checkOutTime','Выезд до','time'],['included','Что включено','text'],['rules','Правила и ограничения','text'],
 ['tourDate','Дата похода','date'],['tourTime','Время старта','time'],['tourDuration','Продолжительность','text'],['tourDifficulty','Сложность','text'],['tourMeetingPoint','Место сбора','text'],
] as const;
type BookingKey=typeof bookingEditFields[number][0];
const textKeys=['categorySlug','subcategoryName','cityName','district','address','contactPhone','messengerUrl'] as const;
export type ListingExtraFields=Record<typeof textKeys[number],string>&{
 latitude:string;longitude:string;showExactAddress:boolean;bookingMode:''|'stay'|'tour';booking:Record<BookingKey,string>};
export function listingExtraFields(form:ListingFormDraft):ListingExtraFields{
 return{...Object.fromEntries(textKeys.map(key=>[key,form[key]??''])),latitude:form.latitude===null?'':String(form.latitude),
  longitude:form.longitude===null?'':String(form.longitude),showExactAddress:form.showExactAddress,bookingMode:form.booking?.mode??'',
  booking:Object.fromEntries(bookingEditFields.map(([key])=>{const value=form.booking?.[key];return[key,Array.isArray(value)?value.join(', '):value===undefined?'':String(value)];})),
 } as ListingExtraFields;
}
export function replaceListingExtraFields(saved:ListingFormDraft,fields:ListingExtraFields):ListingFormDraft{
 const number=(value:string)=>{if(!/^-?\d+(?:[.,]\d+)?$/.test(value.trim()))throw new ListingDraftInputError();return Number(value.trim().replace(',','.'));};
 const coordinate=(value:string)=>value===''?null:number(value);
 const booking:Record<string,unknown>|null=fields.bookingMode?{mode:fields.bookingMode}:null;
 if(booking)for(const [key,,kind] of bookingEditFields){const value=fields.booking[key];if(value===''){
   const previous=saved.booking?.[key];if(previous===''||(Array.isArray(previous)&&previous.length===0))booking[key]=previous;
   continue;
  }
  booking[key]=kind==='number'||kind==='integer'?number(value):kind==='dates'?value.split(/[\s,]+/).filter(Boolean):value;
 }
 return parseListingFormDraft({...saved,...Object.fromEntries(textKeys.map(key=>[key,fields[key]||null])),
  latitude:coordinate(fields.latitude),longitude:coordinate(fields.longitude),showExactAddress:fields.showExactAddress,booking});
}
